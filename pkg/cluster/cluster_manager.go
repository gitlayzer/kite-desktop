package cluster

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/prometheus"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"
)

type ClientSet struct {
	Name       string
	Version    string // Kubernetes version
	K8sClient  *kube.K8sClient
	PromClient *prometheus.Client

	DiscoveredPrometheusURL string
	DefaultNamespace        string
	config                  string
	prometheusURL           string
}

type ClusterManager struct {
	mu             sync.RWMutex
	syncMu         sync.Mutex
	clusters       map[string]*ClientSet
	errors         map[string]string
	defaultContext string
}

const (
	clusterStartupSyncTimeout  = 10 * time.Second
	clusterConnectivityTimeout = 8 * time.Second
	maxStoredClusterNameLength = 100
)

type ImportClustersResult struct {
	Imported      int64
	Skipped       int64
	Errors        []string
	Warnings      []string
	ImportedNames []string
}

func createClientSetInCluster(name, prometheusURL string) (*ClientSet, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		return nil, err
	}

	return newClientSet(name, config, prometheusURL)
}

func createClientSetFromConfig(name, content, prometheusURL string) (*ClientSet, error) {
	restConfig, err := clientcmd.RESTConfigFromKubeConfig([]byte(content))
	if err != nil {
		klog.Warningf("Failed to create REST config for cluster %s: %v", name, err)
		return nil, err
	}
	cs, err := newClientSet(name, restConfig, prometheusURL)
	if err != nil {
		return nil, err
	}
	cs.config = content
	cs.DefaultNamespace = defaultNamespaceFromKubeconfig(content)

	return cs, nil
}

func newClientSet(name string, k8sConfig *rest.Config, prometheusURL string) (*ClientSet, error) {
	k8sConfig = rest.CopyConfig(k8sConfig)
	if k8sConfig.Timeout == 0 {
		k8sConfig.Timeout = clusterConnectivityTimeout
	}

	cs := &ClientSet{
		Name:             name,
		DefaultNamespace: "default",
		prometheusURL:    prometheusURL,
	}
	var err error
	cs.K8sClient, err = kube.NewClient(k8sConfig)
	if err != nil {
		klog.Warningf("Failed to create k8s client for cluster %s: %v", name, err)
		return nil, fmt.Errorf("%s", clusterConnectionErrorMessage(err))
	}
	v, err := cs.K8sClient.ClientSet.Discovery().ServerVersion()
	if err != nil {
		cs.K8sClient.Stop(name)
		return nil, fmt.Errorf("%s", clusterConnectionErrorMessage(err))
	}
	cs.Version = v.String()

	if prometheusURL == "" {
		prometheusURL = discoveryPrometheusURL(cs.K8sClient)
		if prometheusURL != "" {
			cs.DiscoveredPrometheusURL = prometheusURL
			klog.Infof("Discovered Prometheus URL for cluster %s: %s", name, cs.DiscoveredPrometheusURL)
		}
	}
	if prometheusURL != "" {
		var rt = http.DefaultTransport
		var err error
		if isClusterLocalURL(prometheusURL) {
			rt, err = createK8sProxyTransport(k8sConfig, prometheusURL)
			if err != nil {
				klog.Warningf("Failed to create k8s proxy transport for cluster %s: %v, using direct connection", name, err)
			} else {
				klog.Infof("Using k8s API proxy for Prometheus in cluster %s", name)
			}
		}
		cs.PromClient, err = prometheus.NewClientWithRoundTripper(prometheusURL, rt)
		if err != nil {
			klog.Warningf("Failed to create Prometheus client for cluster %s, some features may not work as expected, err: %v", name, err)
		}
	}
	klog.Infof("Loaded K8s client for cluster: %s, version: %s", name, cs.Version)
	return cs, nil
}

func clusterConnectionErrorMessage(err error) string {
	if err == nil {
		return ""
	}

	detail := strings.TrimSpace(err.Error())
	lower := strings.ToLower(detail)

	switch {
	case strings.Contains(lower, "the server has asked for the client to provide credentials"),
		strings.Contains(lower, "unauthorized"),
		strings.Contains(lower, "invalid bearer token"),
		strings.Contains(lower, "token has expired"):
		return fmt.Sprintf("集群认证失败：kubeconfig 中的 token 或证书无效、已过期，或当前账号已经失效。请重新导入 kubeconfig。原始错误：%s", detail)
	case strings.Contains(lower, "x509:"),
		strings.Contains(lower, "certificate signed by unknown authority"),
		strings.Contains(lower, "certificate is not trusted"),
		strings.Contains(lower, "tls: failed to verify certificate"):
		return fmt.Sprintf("集群证书校验失败：kubeconfig 中的证书信息与 API Server 不匹配，或证书在这台电脑上无法通过校验。请重新导出 kubeconfig。原始错误：%s", detail)
	case strings.Contains(lower, "context deadline exceeded"),
		strings.Contains(lower, "client.timeout exceeded"),
		strings.Contains(lower, "i/o timeout"),
		strings.Contains(lower, "net/http: timeout"):
		return fmt.Sprintf("连接集群超时：请检查网络、VPN、代理、防火墙，以及 kubeconfig 里的 server 地址是否能访问。原始错误：%s", detail)
	case strings.Contains(lower, "connection refused"):
		return fmt.Sprintf("无法连接集群：API Server 拒绝连接，请检查 kubeconfig 的 server 地址和端口是否正确。原始错误：%s", detail)
	case strings.Contains(lower, "no such host"),
		strings.Contains(lower, "server misbehaving"):
		return fmt.Sprintf("无法解析集群地址：请检查 DNS、网络环境，或 kubeconfig 的 server 域名是否正确。原始错误：%s", detail)
	case strings.Contains(lower, "no route to host"),
		strings.Contains(lower, "network is unreachable"):
		return fmt.Sprintf("网络无法到达集群：请检查当前网络、VPN、代理或防火墙设置。原始错误：%s", detail)
	}

	return fmt.Sprintf("无法连接集群：%s", detail)
}

func defaultNamespaceFromKubeconfig(content string) string {
	kubeconfig, err := clientcmd.Load([]byte(content))
	if err != nil {
		return "default"
	}
	contextName := kubeconfig.CurrentContext
	if contextName == "" && len(kubeconfig.Contexts) == 1 {
		for name := range kubeconfig.Contexts {
			contextName = name
		}
	}
	if contextName == "" {
		return "default"
	}
	context := kubeconfig.Contexts[contextName]
	if context == nil || strings.TrimSpace(context.Namespace) == "" {
		return "default"
	}
	return context.Namespace
}

func isClusterLocalURL(urlStr string) bool {
	return strings.Contains(urlStr, ".svc.cluster.local") || strings.Contains(urlStr, ".svc:")
}

func createK8sProxyTransport(k8sConfig *rest.Config, prometheusURL string) (*k8sProxyTransport, error) {
	parsedURL, err := url.Parse(prometheusURL)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(parsedURL.Host, ".")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid cluster local URL format")
	}
	svcName := parts[0]
	namespace := parts[1]

	transport, err := rest.TransportFor(k8sConfig)
	if err != nil {
		return nil, err
	}

	transportWrapper := &k8sProxyTransport{
		transport:    transport,
		apiServerURL: k8sConfig.Host,
		namespace:    namespace,
		svcName:      svcName,
		scheme:       parsedURL.Scheme,
	}
	transportWrapper.port = parsedURL.Port()
	if transportWrapper.port == "" {
		if parsedURL.Scheme == "https" {
			transportWrapper.port = "443"
		} else {
			transportWrapper.port = "80"
		}
	}

	return transportWrapper, nil
}

type k8sProxyTransport struct {
	transport    http.RoundTripper
	apiServerURL string
	namespace    string
	svcName      string
	scheme       string
	port         string
}

func (t *k8sProxyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	proxyURL, err := url.Parse(t.apiServerURL)
	if err != nil {
		return nil, err
	}
	req.URL.Scheme = proxyURL.Scheme
	req.URL.Host = proxyURL.Host

	servicePath := fmt.Sprintf("/api/v1/namespaces/%s/services/%s:%s/proxy", t.namespace, t.svcName, t.port)
	req.URL.Path = servicePath + req.URL.Path

	return t.transport.RoundTrip(req)
}

func (cm *ClusterManager) GetClientSet(clusterName string) (*ClientSet, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if clusterName == "" {
		clusterName = cm.defaultContext
		if clusterName == "" {
			// If no default context is set, return the first available cluster
			for _, cs := range cm.clusters {
				return cs, nil
			}
		}
	}
	if cluster, ok := cm.clusters[clusterName]; ok {
		return cluster, nil
	}
	if errMsg, ok := cm.errors[clusterName]; ok {
		return nil, fmt.Errorf("%s", errMsg)
	}
	if len(cm.clusters) == 0 {
		if len(cm.errors) > 0 {
			names := make([]string, 0, len(cm.errors))
			for name := range cm.errors {
				names = append(names, name)
			}
			sort.Strings(names)
			return nil, fmt.Errorf("%s", cm.errors[names[0]])
		}
		return nil, fmt.Errorf("no clusters available")
	}
	return nil, fmt.Errorf("cluster not found: %s", clusterName)
}

func ImportClustersFromKubeconfig(kubeconfig *clientcmdapi.Config) int64 {
	return ImportClustersFromKubeconfigWithResult(kubeconfig).Imported
}

func loadKubeconfigsFromImport(content string) ([]*clientcmdapi.Config, []string, error) {
	blocks := splitKubeconfigImportDocuments(content)
	if len(blocks) == 0 {
		return nil, nil, fmt.Errorf("kubeconfig 内容不能为空")
	}

	configs := make([]*clientcmdapi.Config, 0, len(blocks))
	warnings := make([]string, 0)
	for index, block := range blocks {
		kubeconfig, err := clientcmd.Load([]byte(block))
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("第 %d 段 kubeconfig 解析失败：%v", index+1, err))
			continue
		}
		if len(kubeconfig.Contexts) == 0 {
			warnings = append(warnings, fmt.Sprintf("第 %d 段 kubeconfig 没有 contexts，已跳过。", index+1))
			continue
		}
		warnings = append(warnings, kubeconfigImportWarnings(kubeconfig)...)
		configs = append(configs, kubeconfig)
	}

	if len(configs) == 0 {
		if len(warnings) > 0 {
			return nil, warnings, fmt.Errorf("%s", strings.Join(warnings, "; "))
		}
		return nil, warnings, fmt.Errorf("kubeconfig 中没有可用的 context")
	}

	return configs, warnings, nil
}

func splitKubeconfigImportDocuments(content string) []string {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	documentBlocks := splitYAMLDocumentBlocks(normalized)
	blocks := make([]string, 0, len(documentBlocks))
	for _, block := range documentBlocks {
		blocks = append(blocks, splitConcatenatedKubeconfigs(block)...)
	}
	return blocks
}

func splitYAMLDocumentBlocks(content string) []string {
	lines := strings.Split(content, "\n")
	blocks := make([]string, 0, 1)
	current := make([]string, 0, len(lines))

	flush := func() {
		block := strings.TrimSpace(strings.Join(current, "\n"))
		if block != "" {
			blocks = append(blocks, block)
		}
		current = current[:0]
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "---" {
			flush()
			continue
		}
		current = append(current, line)
	}
	flush()

	return blocks
}

func splitConcatenatedKubeconfigs(content string) []string {
	lines := strings.Split(content, "\n")
	start := 0
	seenDocumentStart := false
	blocks := make([]string, 0, 1)

	flush := func(end int) {
		block := strings.TrimSpace(strings.Join(lines[start:end], "\n"))
		if block != "" {
			blocks = append(blocks, block)
		}
	}

	for index, line := range lines {
		if !isTopLevelAPIVersionLine(line) {
			continue
		}
		if seenDocumentStart {
			flush(index)
			start = index
		}
		seenDocumentStart = true
	}

	flush(len(lines))
	return blocks
}

func isTopLevelAPIVersionLine(line string) bool {
	if line == "" || line[0] == ' ' || line[0] == '\t' {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(line), "apiVersion:")
}

func kubeconfigImportWarnings(kubeconfig *clientcmdapi.Config) []string {
	if kubeconfig == nil || len(kubeconfig.Contexts) <= 1 || len(kubeconfig.Clusters) != 1 {
		return nil
	}

	contextClusterNames := make(map[string]struct{}, len(kubeconfig.Contexts))
	for _, context := range kubeconfig.Contexts {
		if context == nil {
			continue
		}
		contextClusterNames[context.Cluster] = struct{}{}
	}
	if len(contextClusterNames) != 1 {
		return nil
	}

	return []string{"检测到多个 context 共用同一个 cluster 配置。Kite 会按 context 拆成独立集群导入；如果这些 context 原本来自不同集群，手工合并时可能已经丢失各自的 server/certificate-authority-data，请直接粘贴多个原始 kubeconfig 块或为每个 cluster 使用唯一名称。"}
}

func ImportClustersFromKubeconfigsWithResult(kubeconfigs []*clientcmdapi.Config) ImportClustersResult {
	result := ImportClustersResult{}
	for _, kubeconfig := range kubeconfigs {
		result.merge(ImportClustersFromKubeconfigWithResult(kubeconfig))
	}
	return result
}

func (result *ImportClustersResult) merge(next ImportClustersResult) {
	result.Imported += next.Imported
	result.Skipped += next.Skipped
	result.Errors = append(result.Errors, next.Errors...)
	result.Warnings = append(result.Warnings, next.Warnings...)
	result.ImportedNames = append(result.ImportedNames, next.ImportedNames...)
}

func ImportClustersFromKubeconfigWithResult(kubeconfig *clientcmdapi.Config) ImportClustersResult {
	existingIdentities := existingClusterIdentities()
	contextNames := importableKubeconfigContextNames(kubeconfig, existingIdentities)
	if len(contextNames) == 0 {
		return ImportClustersResult{Skipped: int64(len(kubeconfigContextNames(kubeconfig)))}
	}

	result := ImportClustersResult{}
	for _, contextName := range contextNames {
		context := kubeconfig.Contexts[contextName]
		resolved, err := resolveKubeconfigContext(kubeconfig, contextName, context)
		if err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, err.Error())
			continue
		}
		result.Warnings = append(result.Warnings, resolved.warnings...)

		clusterName := uniqueClusterName(contextName)
		contextCopy := *resolved.context
		contextCopy.Cluster = clusterName
		authInfos := map[string]*clientcmdapi.AuthInfo{}
		if resolved.authInfo != nil {
			authName := resolved.authName
			if authName == "" {
				authName = clusterName + "-user"
			}
			contextCopy.AuthInfo = authName
			authInfos[authName] = resolved.authInfo
		}
		clusterConfig := *resolved.cluster

		config := clientcmdapi.NewConfig()
		config.Contexts = map[string]*clientcmdapi.Context{
			clusterName: &contextCopy,
		}
		config.CurrentContext = clusterName
		config.Clusters = map[string]*clientcmdapi.Cluster{
			clusterName: &clusterConfig,
		}
		config.AuthInfos = authInfos
		configStr, err := clientcmd.Write(*config)
		if err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", contextName, err))
			continue
		}
		isDefault := contextName == kubeconfig.CurrentContext || (kubeconfig.CurrentContext == "" && result.Imported == 0)
		if exists, err := model.ClusterNameExists(clusterName); err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", contextName, err))
			continue
		} else if exists {
			result.Skipped++
			continue
		}
		if isDefault {
			if err := model.ClearDefaultCluster(); err != nil {
				result.Skipped++
				result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", contextName, err))
				continue
			}
		}
		cluster := model.Cluster{
			Name:      clusterName,
			Config:    model.SecretString(configStr),
			IsDefault: isDefault,
			Enable:    true,
		}
		if err := model.AddCluster(&cluster); err != nil {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("%s: %v", contextName, err))
			continue
		}
		result.Imported++
		result.ImportedNames = append(result.ImportedNames, clusterName)
		klog.Infof("Imported cluster success: %s", clusterName)
	}
	return result
}

type resolvedKubeconfigContext struct {
	context  *clientcmdapi.Context
	cluster  *clientcmdapi.Cluster
	authName string
	authInfo *clientcmdapi.AuthInfo
	warnings []string
}

func resolveKubeconfigContext(
	kubeconfig *clientcmdapi.Config,
	contextName string,
	context *clientcmdapi.Context,
) (*resolvedKubeconfigContext, error) {
	if kubeconfig == nil {
		return nil, fmt.Errorf("%s: kubeconfig 为空", contextName)
	}
	if context == nil {
		return nil, fmt.Errorf("%s: context 为空", contextName)
	}

	contextCopy := *context
	warnings := make([]string, 0)

	clusterName := strings.TrimSpace(contextCopy.Cluster)
	clusterConfig := kubeconfig.Clusters[clusterName]
	if clusterConfig == nil {
		fallbackName, fallbackCluster := singleKubeconfigCluster(kubeconfig)
		if fallbackCluster == nil {
			return nil, fmt.Errorf("%s: context 引用的 cluster %q 不存在", contextName, contextCopy.Cluster)
		}
		warnings = append(warnings, fmt.Sprintf("%s: context 引用的 cluster %q 不存在，已使用 kubeconfig 中唯一的 cluster %q。", contextName, contextCopy.Cluster, fallbackName))
		clusterName = fallbackName
		clusterConfig = fallbackCluster
		contextCopy.Cluster = fallbackName
	}
	clusterCopy := *clusterConfig

	authName := strings.TrimSpace(contextCopy.AuthInfo)
	var authInfo *clientcmdapi.AuthInfo
	if authName != "" {
		authInfo = kubeconfig.AuthInfos[authName]
		if authInfo == nil {
			fallbackName, fallbackAuthInfo := singleKubeconfigAuthInfo(kubeconfig)
			if fallbackAuthInfo == nil {
				return nil, fmt.Errorf("%s: context 引用的 user %q 不存在", contextName, contextCopy.AuthInfo)
			}
			warnings = append(warnings, fmt.Sprintf("%s: context 引用的 user %q 不存在，已使用 kubeconfig 中唯一的 user %q。", contextName, contextCopy.AuthInfo, fallbackName))
			authName = fallbackName
			authInfo = fallbackAuthInfo
			contextCopy.AuthInfo = fallbackName
		}
	} else {
		fallbackName, fallbackAuthInfo := singleKubeconfigAuthInfo(kubeconfig)
		if fallbackAuthInfo != nil {
			warnings = append(warnings, fmt.Sprintf("%s: context 未指定 user，已使用 kubeconfig 中唯一的 user %q。", contextName, fallbackName))
			authName = fallbackName
			authInfo = fallbackAuthInfo
			contextCopy.AuthInfo = fallbackName
		}
	}

	var authCopy *clientcmdapi.AuthInfo
	if authInfo != nil {
		copyValue := *authInfo
		authCopy = &copyValue
	}

	return &resolvedKubeconfigContext{
		context:  &contextCopy,
		cluster:  &clusterCopy,
		authName: authName,
		authInfo: authCopy,
		warnings: warnings,
	}, nil
}

func singleKubeconfigCluster(kubeconfig *clientcmdapi.Config) (string, *clientcmdapi.Cluster) {
	if kubeconfig == nil || len(kubeconfig.Clusters) != 1 {
		return "", nil
	}
	for name, cluster := range kubeconfig.Clusters {
		return name, cluster
	}
	return "", nil
}

func singleKubeconfigAuthInfo(kubeconfig *clientcmdapi.Config) (string, *clientcmdapi.AuthInfo) {
	if kubeconfig == nil || len(kubeconfig.AuthInfos) != 1 {
		return "", nil
	}
	for name, authInfo := range kubeconfig.AuthInfos {
		return name, authInfo
	}
	return "", nil
}

func importableKubeconfigContextNames(kubeconfig *clientcmdapi.Config, initialSeen ...map[string]struct{}) []string {
	if kubeconfig == nil || len(kubeconfig.Contexts) == 0 {
		return nil
	}

	names := make([]string, 0, len(kubeconfig.Contexts))
	for name := range kubeconfig.Contexts {
		names = append(names, name)
	}
	sort.Strings(names)

	if kubeconfig.CurrentContext != "" {
		for index, name := range names {
			if name == kubeconfig.CurrentContext {
				names = append([]string{name}, append(names[:index], names[index+1:]...)...)
				break
			}
		}
	}

	seen := make(map[string]struct{}, len(names))
	if len(initialSeen) > 0 {
		maps.Copy(seen, initialSeen[0])
	}
	result := make([]string, 0, len(names))
	for _, name := range names {
		context := kubeconfig.Contexts[name]
		if context == nil {
			continue
		}
		resolved, err := resolveKubeconfigContext(kubeconfig, name, context)
		if err != nil {
			continue
		}
		key := kubeconfigContextIdentity(kubeconfig, name, resolved.context, resolved.cluster)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, name)
	}

	return result
}

func kubeconfigContextNames(kubeconfig *clientcmdapi.Config) []string {
	if kubeconfig == nil || len(kubeconfig.Contexts) == 0 {
		return nil
	}

	names := make([]string, 0, len(kubeconfig.Contexts))
	for name := range kubeconfig.Contexts {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func uniqueClusterName(baseName string) string {
	name := normalizeClusterName(baseName)

	exists, err := model.ClusterNameExists(name)
	if err != nil || !exists {
		return name
	}

	for i := 2; ; i++ {
		candidate := clusterNameWithSuffix(name, fmt.Sprintf("-%d", i))
		exists, err := model.ClusterNameExists(candidate)
		if err != nil || !exists {
			return candidate
		}
	}
}

func normalizeClusterName(baseName string) string {
	name := strings.TrimSpace(baseName)
	name = strings.NewReplacer("\r", "-", "\n", "-", "\t", "-").Replace(name)
	if name == "" {
		name = "cluster"
	}
	return truncateClusterName(name, maxStoredClusterNameLength)
}

func clusterNameWithSuffix(baseName, suffix string) string {
	name := normalizeClusterName(baseName)
	if len([]rune(suffix)) >= maxStoredClusterNameLength {
		return truncateClusterName(suffix, maxStoredClusterNameLength)
	}
	prefixLimit := maxStoredClusterNameLength - len([]rune(suffix))
	return truncateClusterName(name, prefixLimit) + suffix
}

func truncateClusterName(name string, maxLength int) string {
	if maxLength <= 0 {
		return ""
	}
	runes := []rune(name)
	if len(runes) <= maxLength {
		return name
	}
	return string(runes[:maxLength])
}

func existingClusterIdentities() map[string]struct{} {
	if model.DB == nil {
		return nil
	}

	clusters, err := model.ListClustersWithConfigStatus()
	if err != nil || len(clusters) == 0 {
		return nil
	}

	identities := make(map[string]struct{}, len(clusters))
	for _, item := range clusters {
		if item.ConfigError != nil {
			continue
		}
		cluster := item.Cluster
		if cluster == nil || cluster.InCluster || strings.TrimSpace(string(cluster.Config)) == "" {
			continue
		}
		kubeconfig, err := clientcmd.Load([]byte(cluster.Config))
		if err != nil {
			continue
		}
		for _, name := range importableKubeconfigContextNames(kubeconfig) {
			context := kubeconfig.Contexts[name]
			if context == nil {
				continue
			}
			resolved, err := resolveKubeconfigContext(kubeconfig, name, context)
			if err != nil {
				continue
			}
			identities[kubeconfigContextIdentity(kubeconfig, name, resolved.context, resolved.cluster)] = struct{}{}
		}
	}
	return identities
}

func kubeconfigClusterIdentity(clusterName string, clusterConfig *clientcmdapi.Cluster) string {
	if clusterConfig == nil {
		return "name:" + clusterName
	}

	server := strings.TrimSpace(clusterConfig.Server)
	if server == "" {
		return "name:" + clusterName
	}

	return strings.Join([]string{
		server,
		clusterConfig.CertificateAuthority,
		base64.StdEncoding.EncodeToString(clusterConfig.CertificateAuthorityData),
		fmt.Sprintf("%t", clusterConfig.InsecureSkipTLSVerify),
		clusterConfig.TLSServerName,
		clusterConfig.ProxyURL,
	}, "\x00")
}

func kubeconfigContextIdentity(
	kubeconfig *clientcmdapi.Config,
	contextName string,
	context *clientcmdapi.Context,
	clusterConfig *clientcmdapi.Cluster,
) string {
	if context == nil {
		return "context:" + contextName
	}
	authInfoName := strings.TrimSpace(context.AuthInfo)
	authIdentity := authInfoName
	if kubeconfig != nil && authInfoName != "" {
		authIdentity = kubeconfigAuthIdentity(authInfoName, kubeconfig.AuthInfos[authInfoName])
	}
	return strings.Join([]string{
		kubeconfigClusterIdentity(context.Cluster, clusterConfig),
		authIdentity,
		strings.TrimSpace(context.Namespace),
	}, "\x00")
}

func kubeconfigAuthIdentity(name string, authInfo *clientcmdapi.AuthInfo) string {
	if authInfo == nil {
		return "auth-name:" + name
	}
	execConfig, _ := json.Marshal(authInfo.Exec)
	authProvider, _ := json.Marshal(authInfo.AuthProvider)
	impersonateExtra, _ := json.Marshal(authInfo.ImpersonateUserExtra)
	return strings.Join([]string{
		authInfo.Username,
		authInfo.Password,
		authInfo.Token,
		authInfo.TokenFile,
		authInfo.ClientCertificate,
		base64.StdEncoding.EncodeToString(authInfo.ClientCertificateData),
		authInfo.ClientKey,
		base64.StdEncoding.EncodeToString(authInfo.ClientKeyData),
		authInfo.Impersonate,
		authInfo.ImpersonateUID,
		strings.Join(authInfo.ImpersonateGroups, ","),
		string(impersonateExtra),
		string(execConfig),
		string(authProvider),
	}, "\x00")
}

var (
	syncNow = make(chan struct{}, 1)
)

func TriggerClusterSync() {
	select {
	case syncNow <- struct{}{}:
	default:
	}
}

func syncClusters(cm *ClusterManager, readyCh chan<- struct{}) error {
	if readyCh != nil {
		defer func() {
			select {
			case readyCh <- struct{}{}:
			default:
			}
		}()
	}

	clusters, err := model.ListClustersWithConfigStatus()
	if err != nil {
		klog.Warningf("list cluster err: %v", err)
		time.Sleep(5 * time.Second)
		return err
	}
	dbClusterMap := make(map[string]interface{})
	nextDefaultContext := ""
	type buildResult struct {
		cluster   *model.Cluster
		clientSet *ClientSet
		err       error
	}
	buildQueue := make([]*model.Cluster, 0)
	for _, item := range clusters {
		cluster := item.Cluster
		dbClusterMap[cluster.Name] = cluster
		if cluster.IsDefault && cluster.Enable && item.ConfigError == nil {
			nextDefaultContext = cluster.Name
		}
		cm.mu.RLock()
		current, currentExist := cm.clusters[cluster.Name]
		cm.mu.RUnlock()
		if item.ConfigError != nil {
			if currentExist {
				cm.mu.Lock()
				delete(cm.clusters, cluster.Name)
				cm.mu.Unlock()
				if current != nil && current.K8sClient != nil {
					current.K8sClient.Stop(cluster.Name)
				}
			}
			cm.mu.Lock()
			cm.errors[cluster.Name] = clusterConfigErrorMessage(item.ConfigError)
			cm.mu.Unlock()
			continue
		}
		if shouldUpdateCluster(current, cluster) {
			if currentExist {
				cm.mu.Lock()
				delete(cm.clusters, cluster.Name)
				cm.mu.Unlock()
				if current != nil && current.K8sClient != nil {
					current.K8sClient.Stop(cluster.Name)
				}
			}
			if cluster.Enable {
				buildQueue = append(buildQueue, cluster)
			} else {
				cm.mu.Lock()
				delete(cm.errors, cluster.Name)
				cm.mu.Unlock()
			}
		}
	}
	results := make(chan buildResult, len(buildQueue))
	var wg sync.WaitGroup
	for _, cluster := range buildQueue {
		wg.Add(1)
		go func(cluster *model.Cluster) {
			defer wg.Done()
			clientSet, err := buildClientSet(cluster)
			results <- buildResult{
				cluster:   cluster,
				clientSet: clientSet,
				err:       err,
			}
		}(cluster)
	}
	go func() {
		wg.Wait()
		close(results)
	}()
	for result := range results {
		if result.err != nil {
			klog.Errorf("Failed to build k8s client for cluster %s, in cluster: %t, err: %v", result.cluster.Name, result.cluster.InCluster, result.err)
			cm.mu.Lock()
			cm.errors[result.cluster.Name] = result.err.Error()
			cm.mu.Unlock()
			continue
		}
		cm.mu.Lock()
		delete(cm.errors, result.cluster.Name)
		cm.clusters[result.cluster.Name] = result.clientSet
		cm.mu.Unlock()
	}
	cm.mu.Lock()
	cm.defaultContext = nextDefaultContext
	for name, clientSet := range cm.clusters {
		if _, ok := dbClusterMap[name]; !ok {
			delete(cm.clusters, name)
			clientSet.K8sClient.Stop(name)
		}
	}
	for name := range cm.errors {
		if _, ok := dbClusterMap[name]; !ok {
			delete(cm.errors, name)
		}
	}
	cm.mu.Unlock()

	return nil
}

// shouldUpdateCluster decides whether the cached ClientSet needs to be updated
// based on the desired state from the database.
func shouldUpdateCluster(cs *ClientSet, cluster *model.Cluster) bool {
	// enable/disable toggle
	if (cs == nil && cluster.Enable) || (cs != nil && !cluster.Enable) {
		klog.Infof("Cluster %s status changed, updating, enabled -> %v", cluster.Name, cluster.Enable)
		return true
	}
	if cs == nil && !cluster.Enable {
		return false
	}

	if cs == nil || cs.K8sClient == nil || cs.K8sClient.ClientSet == nil {
		return true
	}

	// kubeconfig change
	if cs.config != string(cluster.Config) {
		klog.Infof("Kubeconfig changed for cluster %s, updating", cluster.Name)
		return true
	}

	// prometheus URL change
	if cs.prometheusURL != cluster.PrometheusURL {
		klog.Infof("Prometheus URL changed for cluster %s, updating", cluster.Name)
		return true
	}

	// k8s version change
	// TODO: Replace direct ClientSet.Discovery() call with a small DiscoveryInterface.
	// current code depends on *kubernetes.Clientset, which is hard to mock in tests.
	version, err := cs.K8sClient.ClientSet.Discovery().ServerVersion()
	if err != nil {
		klog.Warningf("Failed to get server version for cluster %s: %v", cluster.Name, err)
		return true
	} else if version.String() != cs.Version {
		klog.Infof("Server version changed for cluster %s, updating, old: %s, new: %s", cluster.Name, cs.Version, version.String())
		return true
	}

	return false
}

func buildClientSet(cluster *model.Cluster) (*ClientSet, error) {
	if cluster.InCluster {
		return createClientSetInCluster(cluster.Name, cluster.PrometheusURL)
	}
	return createClientSetFromConfig(cluster.Name, string(cluster.Config), cluster.PrometheusURL)
}

func (cm *ClusterManager) syncClusters() error {
	cm.syncMu.Lock()
	defer cm.syncMu.Unlock()

	return syncClusters(cm, nil)
}

func (cm *ClusterManager) syncClustersUntilReady(readyCh chan<- struct{}) error {
	cm.syncMu.Lock()
	defer cm.syncMu.Unlock()

	return syncClusters(cm, readyCh)
}

func (cm *ClusterManager) snapshotState() (map[string]*ClientSet, map[string]string, string) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	clusters := make(map[string]*ClientSet, len(cm.clusters))
	maps.Copy(clusters, cm.clusters)

	errors := make(map[string]string, len(cm.errors))
	maps.Copy(errors, cm.errors)

	return clusters, errors, cm.defaultContext
}

func NewClusterManager() (*ClusterManager, error) {
	cm := new(ClusterManager)
	cm.clusters = make(map[string]*ClientSet)
	cm.errors = make(map[string]string)

	initialReady := make(chan struct{}, 1)
	go func() {
		if err := cm.syncClustersUntilReady(initialReady); err != nil {
			klog.Warningf("Failed to sync clusters: %v", err)
		}
	}()

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
			case <-syncNow:
			}
			if err := cm.syncClusters(); err != nil {
				klog.Warningf("Failed to sync clusters: %v", err)
			}
		}
	}()

	timer := time.NewTimer(clusterStartupSyncTimeout)
	defer timer.Stop()

	select {
	case <-initialReady:
	case <-timer.C:
		klog.Warningf("Timed out waiting for cluster readiness after %s, continuing startup", clusterStartupSyncTimeout)
	}
	return cm, nil
}
