package cluster

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
)

const encryptedClusterConfigRecoveryMessage = "集群配置无法解密。通常是把 Kite 的数据文件复制到了另一台电脑，或者本机加密密钥发生了变化。请删除这个集群后重新导入 kubeconfig。"

func clusterConfigErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	var decryptErr *model.ClusterConfigDecryptError
	if errors.As(err, &decryptErr) {
		return encryptedClusterConfigRecoveryMessage
	}
	return err.Error()
}

func clusterDefaultNamespace(cluster *model.Cluster, configErr error) string {
	if cluster == nil || configErr != nil || cluster.Config == "" {
		return "default"
	}
	return defaultNamespaceFromKubeconfig(string(cluster.Config))
}

func (cm *ClusterManager) GetClusters(c *gin.Context) {
	clusterState, errorState, _ := cm.snapshotState()
	dbClusters, err := model.ListClustersWithConfigStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	result := make([]common.ClusterInfo, 0, len(dbClusters))
	user := c.MustGet("user").(model.User)
	for _, item := range dbClusters {
		cluster := item.Cluster
		if !cluster.Enable || !rbac.CanAccessCluster(user, cluster.Name) {
			continue
		}

		clusterInfo := common.ClusterInfo{
			ID:               cluster.ID,
			Name:             cluster.Name,
			Description:      cluster.Description,
			Enabled:          cluster.Enable,
			InCluster:        cluster.InCluster,
			IsDefault:        cluster.IsDefault,
			DefaultNamespace: clusterDefaultNamespace(cluster, item.ConfigError),
			PrometheusURL:    cluster.PrometheusURL,
		}

		if clientSet, exists := clusterState[cluster.Name]; exists {
			clusterInfo.Version = clientSet.Version
			clusterInfo.DefaultNamespace = clientSet.DefaultNamespace
		}
		if item.ConfigError != nil {
			clusterInfo.Error = clusterConfigErrorMessage(item.ConfigError)
		} else if errMsg, exists := errorState[cluster.Name]; exists {
			clusterInfo.Error = errMsg
		}

		result = append(result, clusterInfo)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	c.JSON(http.StatusOK, result)
}

func (cm *ClusterManager) GetClusterList(c *gin.Context) {
	clusters, err := model.ListClustersWithConfigStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	clusterState, errorState, _ := cm.snapshotState()
	result := make([]gin.H, 0, len(clusters))
	for _, item := range clusters {
		cluster := item.Cluster
		clusterInfo := gin.H{
			"id":               cluster.ID,
			"name":             cluster.Name,
			"description":      cluster.Description,
			"enabled":          cluster.Enable,
			"inCluster":        cluster.InCluster,
			"isDefault":        cluster.IsDefault,
			"defaultNamespace": clusterDefaultNamespace(cluster, item.ConfigError),
			"prometheusURL":    cluster.PrometheusURL,
			"config":           "",
		}

		if clientSet, exists := clusterState[cluster.Name]; exists {
			clusterInfo["version"] = clientSet.Version
			clusterInfo["defaultNamespace"] = clientSet.DefaultNamespace
		}
		if item.ConfigError != nil {
			clusterInfo["error"] = clusterConfigErrorMessage(item.ConfigError)
		} else if errMsg, exists := errorState[cluster.Name]; exists {
			clusterInfo["error"] = errMsg
		}

		result = append(result, clusterInfo)
	}

	c.JSON(http.StatusOK, result)
}

func (cm *ClusterManager) CreateCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var req struct {
		Name          string `json:"name" binding:"required"`
		Description   string `json:"description"`
		Config        string `json:"config"`
		PrometheusURL string `json:"prometheusURL"`
		InCluster     bool   `json:"inCluster"`
		IsDefault     bool   `json:"isDefault"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := model.GetClusterByName(req.Name); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "cluster already exists"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.IsDefault {
		if err := model.ClearDefaultCluster(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	cluster := &model.Cluster{
		Name:          req.Name,
		Description:   req.Description,
		Config:        model.SecretString(req.Config),
		PrometheusURL: req.PrometheusURL,
		InCluster:     req.InCluster,
		IsDefault:     req.IsDefault,
		Enable:        true,
	}

	if err := model.AddCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := cm.syncClusters(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":      cluster.ID,
		"message": "cluster created successfully",
	})
}

func (cm *ClusterManager) UpdateCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	var req struct {
		Name          string `json:"name"`
		Description   string `json:"description"`
		Config        string `json:"config"`
		PrometheusURL string `json:"prometheusURL"`
		InCluster     bool   `json:"inCluster"`
		IsDefault     bool   `json:"isDefault"`
		Enabled       bool   `json:"enabled"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cluster, err := model.GetClusterByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if req.IsDefault && !cluster.IsDefault {
		if err := model.ClearDefaultCluster(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	updates := map[string]interface{}{
		"description":    req.Description,
		"prometheus_url": req.PrometheusURL,
		"in_cluster":     req.InCluster,
		"is_default":     req.IsDefault,
		"enable":         req.Enabled,
	}

	if req.Name != "" && req.Name != cluster.Name {
		updates["name"] = req.Name
	}

	if req.Config != "" {
		updates["config"] = model.SecretString(req.Config)
	}

	if err := model.UpdateCluster(cluster, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := cm.syncClusters(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "cluster updated successfully"})
}

func (cm *ClusterManager) DeleteCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	if err := model.DeleteClusterByID(uint(id)); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if err := cm.syncClusters(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "cluster deleted successfully"})
}

func (cm *ClusterManager) ImportClustersFromKubeconfig(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var clusterReq common.ImportClustersRequest
	if err := c.ShouldBindJSON(&clusterReq); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !clusterReq.InCluster && clusterReq.Config == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config is required when inCluster is false"})
		return
	}

	if clusterReq.InCluster {
		if _, err := model.GetClusterByName("in-cluster"); err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "cluster already exists"})
			return
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		// In-cluster config
		cluster := &model.Cluster{
			Name:        "in-cluster",
			InCluster:   true,
			Description: "Kubernetes in-cluster config",
			IsDefault:   true,
			Enable:      true,
		}
		if err := model.AddCluster(cluster); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if err := cm.syncClusters(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"message": fmt.Sprintf("imported %d clusters successfully", 1)})
		return
	}

	kubeconfigs, warnings, err := loadKubeconfigsFromImport(clusterReq.Config)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    err.Error(),
			"warnings": warnings,
		})
		return
	}

	result := ImportClustersFromKubeconfigsWithResult(kubeconfigs)
	result.Warnings = append(result.Warnings, warnings...)
	if result.Imported == 0 {
		message := "没有导入任何集群。请确认 kubeconfig 中存在有效的 contexts，并且这些集群没有被重复导入。"
		if len(result.Errors) > 0 {
			message = fmt.Sprintf("%s 详情: %s", message, strings.Join(result.Errors, "; "))
		}
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    message,
			"skipped":  result.Skipped,
			"errors":   result.Errors,
			"warnings": result.Warnings,
		})
		return
	}
	if err := cm.syncClusters(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_, errorState, _ := cm.snapshotState()
	connectionErrors := make(map[string]string)
	for _, name := range result.ImportedNames {
		if errMsg := errorState[name]; errMsg != "" {
			connectionErrors[name] = errMsg
		}
	}
	message := fmt.Sprintf("已导入 %d 个集群", result.Imported)
	if len(connectionErrors) > 0 {
		message = fmt.Sprintf(
			"已导入 %d 个集群，其中 %d 个连接异常。请把鼠标移到卡片上的异常状态查看原因；如果这是手工合并的 kubeconfig，请确认每个 context 都保留了自己的 server 和 certificate-authority-data。",
			result.Imported,
			len(connectionErrors),
		)
	} else if len(result.Warnings) > 0 {
		message = fmt.Sprintf("已导入 %d 个集群，但 kubeconfig 可能存在合并风险：%s", result.Imported, result.Warnings[0])
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":          message,
		"imported":         result.Imported,
		"skipped":          result.Skipped,
		"errors":           result.Errors,
		"warnings":         result.Warnings,
		"connectionErrors": connectionErrors,
	})
}
