package system

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"github.com/zxh326/kite/pkg/utils"
	"golang.org/x/sync/errgroup"
	v1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/klog/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const overviewSampleLimit int64 = 500

type OverviewData struct {
	TotalNodes       int                   `json:"totalNodes"`
	ReadyNodes       int                   `json:"readyNodes"`
	TotalPods        int                   `json:"totalPods"`
	RunningPods      int                   `json:"runningPods"`
	TotalNamespaces  int                   `json:"totalNamespaces"`
	TotalServices    int                   `json:"totalServices"`
	PromEnabled      bool                  `json:"prometheusEnabled"`
	Resource         common.ResourceMetric `json:"resource"`
	NodeStatsPartial bool                  `json:"nodeStatsPartial,omitempty"`
	NodeCountPartial bool                  `json:"nodeCountPartial,omitempty"`
	PodStatsPartial  bool                  `json:"podStatsPartial,omitempty"`
	PodCountPartial  bool                  `json:"podCountPartial,omitempty"`
	NsCountPartial   bool                  `json:"namespaceCountPartial,omitempty"`
	SvcCountPartial  bool                  `json:"serviceCountPartial,omitempty"`
	ResourcePartial  bool                  `json:"resourcePartial,omitempty"`
}

// nodeMetrics holds aggregated metrics computed from the node list.
type nodeMetrics struct {
	total          int
	ready          int
	cpuAllocatable int64 // millicores
	memAllocatable int64 // milli-bytes (matches original MilliValue() contract)
	partial        bool
	countPartial   bool
}

// podMetrics holds aggregated metrics computed from the pod list.
type podMetrics struct {
	total        int
	running      int
	cpuRequested int64 // millicores
	memRequested int64 // milli-bytes (matches original MilliValue() contract)
	cpuLimited   int64 // millicores
	memLimited   int64 // milli-bytes (matches original MilliValue() contract)
	partial      bool
	countPartial bool
}

func GetOverview(c *gin.Context) {
	ctx := c.Request.Context()

	cs := c.MustGet("cluster").(*cluster.ClientSet)
	user := c.MustGet("user").(model.User)
	if !rbac.CanAccessCluster(user, cs.Name) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	defaultNamespace := cs.DefaultNamespace
	if defaultNamespace == "" {
		defaultNamespace = "default"
	}

	// Solution : Fetch and compute all 4 resource types in parallel.
	// Each goroutine owns its data — no shared state, no mutexes needed.
	var nm nodeMetrics
	var pm podMetrics
	var nsCount, svcCount countMetrics

	g, gctx := errgroup.WithContext(ctx)

	// Goroutine 1: List nodes + compute allocatable resources + ready count
	g.Go(func() error {
		var nodes v1.NodeList
		if err := cs.K8sClient.List(gctx, &nodes, client.Limit(overviewSampleLimit)); err != nil {
			if apierrors.IsForbidden(err) {
				nm.partial = true
				nm.countPartial = true
				return nil
			}
			klog.Warningf("overview: failed to list nodes: %v", err)
			nm.partial = true
			nm.countPartial = true
			return nil
		}
		nm.total, nm.countPartial = listCount(len(nodes.Items), nodes.GetRemainingItemCount(), nodes.GetContinue())
		nm.partial = nodes.GetContinue() != ""
		// Solution : Use int64 arithmetic instead of resource.Quantity.Add()
		// (avoids big.Int operations — ~10-50x faster for the accumulation loop)
		for i := range nodes.Items {
			node := &nodes.Items[i]
			nm.cpuAllocatable += node.Status.Allocatable.Cpu().MilliValue()
			nm.memAllocatable += node.Status.Allocatable.Memory().MilliValue()
			for _, cond := range node.Status.Conditions {
				if cond.Type == v1.NodeReady && cond.Status == v1.ConditionTrue {
					nm.ready++
					break
				}
			}
		}
		return nil
	})

	// Goroutine 2: List pods + compute resource requests/limits + running count
	g.Go(func() error {
		var pods v1.PodList
		listOpts := []client.ListOption{client.Limit(overviewSampleLimit)}
		namespaceOnly := false
		if err := cs.K8sClient.List(gctx, &pods, listOpts...); err != nil {
			if !apierrors.IsForbidden(err) {
				klog.Warningf("overview: failed to list pods: %v", err)
				pm.partial = true
				pm.countPartial = true
				return nil
			}
			namespaceOnly = true
			if retryErr := cs.K8sClient.List(gctx, &pods, client.InNamespace(defaultNamespace), client.Limit(overviewSampleLimit)); retryErr != nil {
				klog.Warningf("overview: failed to list pods in default namespace %s: %v", defaultNamespace, retryErr)
				pm.partial = true
				pm.countPartial = true
				return nil
			}
		}
		pm.total, pm.countPartial = listCount(len(pods.Items), pods.GetRemainingItemCount(), pods.GetContinue())
		pm.partial = pods.GetContinue() != ""
		if namespaceOnly {
			pm.partial = true
			pm.countPartial = true
		}
		// Solution : int64 accumulation instead of resource.Quantity.Add()
		for i := range pods.Items {
			pod := &pods.Items[i]
			// Skip terminal pods; leads to over counting
			if pod.Status.Phase != v1.PodSucceeded && pod.Status.Phase != v1.PodFailed {
				for j := range pod.Spec.Containers {
					container := &pod.Spec.Containers[j]
					pm.cpuRequested += container.Resources.Requests.Cpu().MilliValue()
					pm.memRequested += container.Resources.Requests.Memory().MilliValue()

					if container.Resources.Limits != nil {
						if cpu := container.Resources.Limits.Cpu(); cpu != nil {
							pm.cpuLimited += cpu.MilliValue()
						}
						if mem := container.Resources.Limits.Memory(); mem != nil {
							pm.memLimited += mem.MilliValue()
						}
					}
				}
			}
			if utils.IsPodReady(pod) || pod.Status.Phase == v1.PodSucceeded {
				pm.running++
			}
		}
		return nil
	})

	// Goroutine 3: List namespaces (count only)
	g.Go(func() error {
		var namespaces v1.NamespaceList
		if err := cs.K8sClient.List(gctx, &namespaces, client.Limit(1)); err != nil {
			if apierrors.IsForbidden(err) {
				nsCount.total = 1
				nsCount.partial = true
				return nil
			}
			klog.Warningf("overview: failed to list namespaces: %v", err)
			nsCount.partial = true
			return nil
		}
		nsCount.total, nsCount.partial = listCount(len(namespaces.Items), namespaces.GetRemainingItemCount(), namespaces.GetContinue())
		return nil
	})

	// Goroutine 4: List services (count only)
	g.Go(func() error {
		var services v1.ServiceList
		namespaceOnly := false
		if err := cs.K8sClient.List(gctx, &services, client.Limit(1)); err != nil {
			if !apierrors.IsForbidden(err) {
				klog.Warningf("overview: failed to list services: %v", err)
				svcCount.partial = true
				return nil
			}
			namespaceOnly = true
			if retryErr := cs.K8sClient.List(gctx, &services, client.InNamespace(defaultNamespace), client.Limit(1)); retryErr != nil {
				klog.Warningf("overview: failed to list services in default namespace %s: %v", defaultNamespace, retryErr)
				svcCount.partial = true
				return nil
			}
		}
		svcCount.total, svcCount.partial = listCount(len(services.Items), services.GetRemainingItemCount(), services.GetContinue())
		if namespaceOnly {
			svcCount.partial = true
		}
		return nil
	})

	// Wait for all goroutines; if any fails the context is cancelled
	if err := g.Wait(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Memory is reported in bytes from Value(); convert to milli for the API
	// (consistent with the original behavior that used MilliValue() on Quantity)
	overview := OverviewData{
		TotalNodes:       nm.total,
		ReadyNodes:       nm.ready,
		TotalPods:        pm.total,
		RunningPods:      pm.running,
		TotalNamespaces:  nsCount.total,
		TotalServices:    svcCount.total,
		PromEnabled:      cs.PromClient != nil,
		NodeStatsPartial: nm.partial,
		NodeCountPartial: nm.countPartial,
		PodStatsPartial:  pm.partial,
		PodCountPartial:  pm.countPartial,
		NsCountPartial:   nsCount.partial,
		SvcCountPartial:  svcCount.partial,
		ResourcePartial:  pm.partial || nm.partial,
		Resource: common.ResourceMetric{
			CPU: common.Resource{
				Allocatable: nm.cpuAllocatable,
				Requested:   pm.cpuRequested,
				Limited:     pm.cpuLimited,
			},
			Mem: common.Resource{
				Allocatable: nm.memAllocatable,
				Requested:   pm.memRequested,
				Limited:     pm.memLimited,
			},
		},
	}

	c.JSON(http.StatusOK, overview)
}

type countMetrics struct {
	total   int
	partial bool
}

func listCount(current int, remaining *int64, continueToken string) (int, bool) {
	if remaining != nil {
		return current + int(*remaining), false
	}
	return current, continueToken != ""
}
