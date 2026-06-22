package resources

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/klog/v2"
	"k8s.io/kubectl/pkg/drain"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

type NodeHandler struct {
	*GenericResourceHandler[*corev1.Node, *corev1.NodeList]
}

func NewNodeHandler() *NodeHandler {
	return &NodeHandler{
		GenericResourceHandler: NewGenericResourceHandler[*corev1.Node, *corev1.NodeList](common.Nodes),
	}
}

// DrainNode drains a node by evicting all pods
func (h *NodeHandler) DrainNode(c *gin.Context) {
	nodeName := c.Param("name")
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)
	// Parse the request body for drain options
	var drainRequest struct {
		Force            bool `json:"force" binding:"required"`
		GracePeriod      int  `json:"gracePeriod" binding:"min=0"`
		DeleteLocal      bool `json:"deleteLocalData"`
		IgnoreDaemonsets bool `json:"ignoreDaemonsets"`
	}

	if err := c.ShouldBindJSON(&drainRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get the node first to ensure it exists
	var node corev1.Node
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Name: nodeName}, &node); err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	drainer := &drain.Helper{
		Ctx:                 ctx,
		Client:              cs.K8sClient.ClientSet,
		Force:               drainRequest.Force,
		GracePeriodSeconds:  drainRequest.GracePeriod,
		IgnoreAllDaemonSets: drainRequest.IgnoreDaemonsets,
		DeleteEmptyDirData:  drainRequest.DeleteLocal,
		Out:                 io.Discard,
		ErrOut:              io.Discard,
	}

	if err := drain.RunCordonOrUncordon(drainer, &node, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cordon node: " + err.Error()})
		return
	}

	podDeleteList, errs := drainer.GetPodsForDeletion(nodeName)
	if len(errs) > 0 {
		errMsg := ""
		for i, item := range errs {
			if i > 0 {
				errMsg += "; "
			}
			errMsg += item.Error()
		}
		c.JSON(http.StatusConflict, gin.H{"error": errMsg})
		return
	}

	if err := drainer.DeleteOrEvictPods(podDeleteList.Pods()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to drain node: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  fmt.Sprintf("Node %s drained successfully", nodeName),
		"node":     node.Name,
		"pods":     len(podDeleteList.Pods()),
		"warnings": podDeleteList.Warnings(),
	})
}

func (h *NodeHandler) markNodeSchedulable(ctx context.Context, client *kube.K8sClient, nodeName string, schedulable bool) error {
	// Get the current node
	var node corev1.Node
	if err := client.Get(ctx, types.NamespacedName{Name: nodeName}, &node); err != nil {
		return err
	}
	node.Spec.Unschedulable = !schedulable
	if err := client.Update(ctx, &node); err != nil {
		return err
	}
	return nil
}

// CordonNode marks a node as unschedulable
func (h *NodeHandler) CordonNode(c *gin.Context) {
	nodeName := c.Param("name")
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := h.markNodeSchedulable(ctx, cs.K8sClient, nodeName, false); err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Node %s cordoned successfully", nodeName),
	})
}

// UncordonNode marks a node as schedulable
func (h *NodeHandler) UncordonNode(c *gin.Context) {
	nodeName := c.Param("name")
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	if err := h.markNodeSchedulable(ctx, cs.K8sClient, nodeName, true); err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Node %s uncordoned successfully", nodeName),
	})
}

// TaintNode adds or updates taints on a node
func (h *NodeHandler) TaintNode(c *gin.Context) {
	nodeName := c.Param("name")
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	// Parse the request body for taint information
	var taintRequest struct {
		Key    string `json:"key" binding:"required"`
		Value  string `json:"value"`
		Effect string `json:"effect" binding:"required,oneof=NoSchedule PreferNoSchedule NoExecute"`
	}

	if err := c.ShouldBindJSON(&taintRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get the current node
	var node corev1.Node
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Name: nodeName}, &node); err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Create the new taint
	newTaint := corev1.Taint{
		Key:    taintRequest.Key,
		Value:  taintRequest.Value,
		Effect: corev1.TaintEffect(taintRequest.Effect),
	}

	// Check if taint with same key already exists and update it, otherwise add new taint
	found := false
	for i, taint := range node.Spec.Taints {
		if taint.Key == taintRequest.Key {
			node.Spec.Taints[i] = newTaint
			found = true
			break
		}
	}

	if !found {
		node.Spec.Taints = append(node.Spec.Taints, newTaint)
	}

	// Update the node
	if err := cs.K8sClient.Update(ctx, &node); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to taint node: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Node %s tainted successfully", nodeName),
		"node":    node.Name,
		"taint":   newTaint,
	})
}

// UntaintNode removes a taint from a node
func (h *NodeHandler) UntaintNode(c *gin.Context) {
	nodeName := c.Param("name")
	ctx := c.Request.Context()
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	// Parse the request body for taint key to remove
	var untaintRequest struct {
		Key string `json:"key" binding:"required"`
	}

	if err := c.ShouldBindJSON(&untaintRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
		return
	}

	// Get the current node
	var node corev1.Node
	if err := cs.K8sClient.Get(ctx, types.NamespacedName{Name: nodeName}, &node); err != nil {
		if errors.IsNotFound(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Find and remove the taint with the specified key
	originalLength := len(node.Spec.Taints)
	var newTaints []corev1.Taint
	for _, taint := range node.Spec.Taints {
		if taint.Key != untaintRequest.Key {
			newTaints = append(newTaints, taint)
		}
	}
	node.Spec.Taints = newTaints

	if len(newTaints) == originalLength {
		c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("Taint with key '%s' not found on node", untaintRequest.Key)})
		return
	}

	// Update the node
	if err := cs.K8sClient.Update(ctx, &node); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to untaint node: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         fmt.Sprintf("Taint with key '%s' removed from node %s successfully", untaintRequest.Key, nodeName),
		"node":            node.Name,
		"removedTaintKey": untaintRequest.Key,
	})
}

func (h *NodeHandler) List(c *gin.Context) {
	cs := c.MustGet("cluster").(*cluster.ClientSet)

	var nodes corev1.NodeList
	listOpts, err := buildNodeListOptions(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := cs.K8sClient.List(c.Request.Context(), &nodes, listOpts...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list nodes: " + err.Error()})
		return
	}

	nodeMetricsMap := getNodeMetricsForPage(c.Request.Context(), cs.K8sClient, nodes.Items)
	nodeResourceRequests := map[string]common.MetricsCell{}
	if shouldIncludeNodePodRequests(c) {
		nodeResourceRequests = listNodeResourceRequests(c.Request.Context(), cs.K8sClient, nodes.Items)
	}

	result := &common.NodeListWithMetrics{
		TypeMeta: nodes.TypeMeta,
		ListMeta: nodes.ListMeta,
		Items:    []*common.NodeWithMetrics{},
	}
	result.Items = make([]*common.NodeWithMetrics, len(nodes.Items))
	for i, node := range nodes.Items {
		metricsCell := &common.MetricsCell{}
		metricsCell.CPULimit = node.Status.Allocatable.Cpu().MilliValue()
		metricsCell.MemoryLimit = node.Status.Allocatable.Memory().Value()
		metricsCell.PodsLimit = node.Status.Allocatable.Pods().Value()

		if nm, ok := nodeMetricsMap[node.Name]; ok {
			if cpuQuantity, ok := nm.Usage["cpu"]; ok {
				metricsCell.CPUUsage = cpuQuantity.MilliValue()
			}
			if memQuantity, ok := nm.Usage["memory"]; ok {
				metricsCell.MemoryUsage = memQuantity.Value()
			}
		}
		if requests, exists := nodeResourceRequests[node.Name]; exists {
			metricsCell.CPURequest = requests.CPURequest
			metricsCell.MemoryRequest = requests.MemoryRequest
			metricsCell.Pods = requests.Pods
		}
		result.Items[i] = &common.NodeWithMetrics{
			Node:    &node,
			Metrics: metricsCell,
		}
	}
	sort.Slice(result.Items, func(i, j int) bool {
		return result.Items[i].Name < result.Items[j].Name
	})
	c.JSON(http.StatusOK, result)
}

func buildNodeListOptions(c *gin.Context) ([]client.ListOption, error) {
	var listOpts []client.ListOption
	if limit, enabled, err := normalizeListLimit(c.Query("limit")); err != nil {
		return nil, err
	} else if enabled {
		listOpts = append(listOpts, client.Limit(limit))
	}
	if continueToken := c.Query("continue"); continueToken != "" {
		listOpts = append(listOpts, client.Continue(continueToken))
	}
	return listOpts, nil
}

func shouldIncludeNodePodRequests(c *gin.Context) bool {
	switch c.Query("includePodRequests") {
	case "true":
		return true
	case "false":
		return false
	}
	return os.Getenv("KITE_DESKTOP_MODE") != "1" && os.Getenv("KITE_DESKTOP_MODE") != "true"
}

func (h *NodeHandler) registerCustomRoutes(group *gin.RouterGroup) {
	group.POST("/_all/:name/drain", h.DrainNode)
	group.POST("/_all/:name/cordon", h.CordonNode)
	group.POST("/_all/:name/uncordon", h.UncordonNode)
	group.POST("/_all/:name/taint", h.TaintNode)
	group.POST("/_all/:name/untaint", h.UntaintNode)
}

func getNodeMetricsForPage(ctx context.Context, k8sClient *kube.K8sClient, nodes []corev1.Node) map[string]metricsv1.NodeMetrics {
	metricsMap := make(map[string]metricsv1.NodeMetrics, len(nodes))
	for i := range nodes {
		node := &nodes[i]
		var nodeMetric metricsv1.NodeMetrics
		if err := k8sClient.Get(ctx, types.NamespacedName{Name: node.Name}, &nodeMetric); err != nil {
			if !errors.IsNotFound(err) {
				klog.Warningf("Failed to get node metrics for %s: %v", node.Name, err)
			}
			continue
		}
		metricsMap[node.Name] = nodeMetric
	}
	return metricsMap
}

func listNodeResourceRequests(ctx context.Context, k8sClient *kube.K8sClient, nodes []corev1.Node) map[string]common.MetricsCell {
	nodeResourceRequests := make(map[string]common.MetricsCell, len(nodes))
	for _, node := range nodes {
		if k8sClient.CacheEnabled {
			var nodePods corev1.PodList
			if err := k8sClient.List(ctx, &nodePods, client.MatchingFields{"spec.nodeName": node.Name}, client.Limit(maxListLimit)); err != nil {
				klog.Warningf("Failed to list pods for node %s: %v", node.Name, err)
				continue
			}

			var metrics common.MetricsCell
			for i := range nodePods.Items {
				addPodResources(&metrics, &nodePods.Items[i])
			}
			nodeResourceRequests[node.Name] = metrics
			continue
		}

		nodeResourceRequests[node.Name] = listNodePodsUncached(ctx, k8sClient, node.Name)
	}
	return nodeResourceRequests
}

func listNodePodsUncached(ctx context.Context, k8sClient *kube.K8sClient, nodeName string) common.MetricsCell {
	var metrics common.MetricsCell
	var continueToken string

	for {
		var nodePods corev1.PodList
		listOpts := []client.ListOption{
			client.MatchingFields{"spec.nodeName": nodeName},
			client.Limit(maxListLimit),
		}
		if continueToken != "" {
			listOpts = append(listOpts, client.Continue(continueToken))
		}

		if err := k8sClient.List(ctx, &nodePods, listOpts...); err != nil {
			klog.Warningf("Failed to list pods for node %s: %v", nodeName, err)
			return metrics
		}

		for i := range nodePods.Items {
			addPodResources(&metrics, &nodePods.Items[i])
		}

		continueToken = nodePods.GetContinue()
		if continueToken == "" {
			return metrics
		}
	}
}

func addPodResources(metrics *common.MetricsCell, pod *corev1.Pod) {
	metrics.Pods++
	for _, container := range pod.Spec.Containers {
		if cpuRequest := container.Resources.Requests.Cpu(); cpuRequest != nil {
			metrics.CPURequest += cpuRequest.MilliValue()
		}
		if memoryRequest := container.Resources.Requests.Memory(); memoryRequest != nil {
			metrics.MemoryRequest += memoryRequest.Value()
		}
	}
}
