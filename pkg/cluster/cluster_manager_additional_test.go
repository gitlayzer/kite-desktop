package cluster

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/bytedance/mockey"
	"github.com/glebarez/sqlite"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/zxh326/kite/pkg/kube"
)

func init() {
	if err := os.Setenv("MOCKEY_CHECK_GCFLAGS", "false"); err != nil {
		panic(err)
	}
}

func setupClusterTestDB(t *testing.T) {
	t.Helper()

	oldDB := model.DB
	oldKey := common.KiteEncryptKey

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Cluster{}); err != nil {
		t.Fatalf("automigrate cluster: %v", err)
	}

	model.DB = db
	common.KiteEncryptKey = "cluster-test-key"
	t.Cleanup(func() {
		model.DB = oldDB
		common.KiteEncryptKey = oldKey
	})
}

func TestIsClusterLocalURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{
			name: "cluster local dns name",
			url:  "http://prometheus.monitoring.svc.cluster.local:9090",
			want: true,
		},
		{
			name: "svc host with port",
			url:  "http://prometheus.monitoring.svc:9090",
			want: true,
		},
		{
			name: "external url",
			url:  "https://prometheus.example.com",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isClusterLocalURL(tt.url); got != tt.want {
				t.Fatalf("isClusterLocalURL(%q) = %v, want %v", tt.url, got, tt.want)
			}
		})
	}
}

func TestCreateK8sProxyTransport(t *testing.T) {
	k8sConfig := &rest.Config{
		Host: "https://apiserver.example.com",
		TLSClientConfig: rest.TLSClientConfig{
			Insecure: true,
		},
	}

	t.Run("uses explicit port", func(t *testing.T) {
		transport, err := createK8sProxyTransport(k8sConfig, "https://prometheus.monitoring.svc.cluster.local:9090")
		if err != nil {
			t.Fatalf("createK8sProxyTransport() error = %v", err)
		}
		if transport.namespace != "monitoring" {
			t.Fatalf("namespace = %q, want %q", transport.namespace, "monitoring")
		}
		if transport.svcName != "prometheus" {
			t.Fatalf("svcName = %q, want %q", transport.svcName, "prometheus")
		}
		if transport.port != "9090" {
			t.Fatalf("port = %q, want %q", transport.port, "9090")
		}
	})

	t.Run("defaults https port", func(t *testing.T) {
		transport, err := createK8sProxyTransport(k8sConfig, "https://prometheus.monitoring.svc.cluster.local")
		if err != nil {
			t.Fatalf("createK8sProxyTransport() error = %v", err)
		}
		if transport.port != "443" {
			t.Fatalf("port = %q, want %q", transport.port, "443")
		}
	})
}

func TestK8sProxyTransportRoundTrip(t *testing.T) {
	var gotMethod string
	var gotScheme string
	var gotHost string
	var gotPath string

	transport := &k8sProxyTransport{
		transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			gotMethod = req.Method
			gotScheme = req.URL.Scheme
			gotHost = req.URL.Host
			gotPath = req.URL.Path
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("ok")),
				Header:     make(http.Header),
			}, nil
		}),
		apiServerURL: "https://apiserver.example.com",
		namespace:    "monitoring",
		svcName:      "prometheus",
		port:         "443",
	}

	req := httptest.NewRequest(http.MethodGet, "http://example.com/api/v1/query", nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip() error = %v", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("StatusCode = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if gotMethod != http.MethodGet {
		t.Fatalf("method = %q, want %q", gotMethod, http.MethodGet)
	}
	if gotScheme != "https" {
		t.Fatalf("scheme = %q, want %q", gotScheme, "https")
	}
	if gotHost != "apiserver.example.com" {
		t.Fatalf("host = %q, want %q", gotHost, "apiserver.example.com")
	}
	if gotPath != "/api/v1/namespaces/monitoring/services/prometheus:443/proxy/api/v1/query" {
		t.Fatalf("path = %q, want %q", gotPath, "/api/v1/namespaces/monitoring/services/prometheus:443/proxy/api/v1/query")
	}
}

func TestDiscoveryPrometheusURL(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "prometheus",
			Namespace: "monitoring",
			Labels: map[string]string{
				"app.kubernetes.io/name": "prometheus",
			},
		},
		Spec: corev1.ServiceSpec{
			Type: corev1.ServiceTypeClusterIP,
			Ports: []corev1.ServicePort{
				{Port: 9090},
			},
		},
	}

	kc := &kube.K8sClient{
		Client: fake.NewClientBuilder().
			WithScheme(kube.GetScheme()).
			WithObjects(svc).
			Build(),
	}

	got := discoveryPrometheusURL(kc)
	want := "http://prometheus.monitoring.svc.cluster.local:9090"
	if got != want {
		t.Fatalf("discoveryPrometheusURL() = %q, want %q", got, want)
	}
}

func TestGetClientSet(t *testing.T) {
	t.Run("returns error when no clusters exist", func(t *testing.T) {
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{},
			errors:   map[string]string{},
		}

		_, err := cm.GetClientSet("")
		if err == nil || err.Error() != "no clusters available" {
			t.Fatalf("GetClientSet() error = %v, want %q", err, "no clusters available")
		}
	})

	t.Run("returns cluster error when named cluster failed to load", func(t *testing.T) {
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{},
			errors: map[string]string{
				"broken": "集群认证失败：请重新导入 kubeconfig。",
			},
		}

		_, err := cm.GetClientSet("broken")
		if err == nil || err.Error() != "集群认证失败：请重新导入 kubeconfig。" {
			t.Fatalf("GetClientSet() error = %v, want stored cluster error", err)
		}
	})

	t.Run("returns first stored error when all clusters failed to load", func(t *testing.T) {
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{},
			errors: map[string]string{
				"z-broken": "无法连接集群：z",
				"a-broken": "无法连接集群：a",
			},
		}

		_, err := cm.GetClientSet("")
		if err == nil || err.Error() != "无法连接集群：a" {
			t.Fatalf("GetClientSet() error = %v, want first stored cluster error", err)
		}
	})

	t.Run("returns default cluster when set", func(t *testing.T) {
		expected := &ClientSet{Name: "default"}
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"default": expected,
				"other":   {Name: "other"},
			},
			errors:         map[string]string{},
			defaultContext: "default",
		}

		got, err := cm.GetClientSet("")
		if err != nil {
			t.Fatalf("GetClientSet() error = %v", err)
		}
		if got != expected {
			t.Fatalf("GetClientSet() = %#v, want %#v", got, expected)
		}
	})

	t.Run("falls back to first cluster when default context is empty", func(t *testing.T) {
		expected := &ClientSet{Name: "first"}
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"first": expected,
			},
			errors: map[string]string{},
		}

		got, err := cm.GetClientSet("")
		if err != nil {
			t.Fatalf("GetClientSet() error = %v", err)
		}
		if got != expected {
			t.Fatalf("GetClientSet() = %#v, want %#v", got, expected)
		}
	})

	t.Run("returns named cluster", func(t *testing.T) {
		expected := &ClientSet{Name: "target"}
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"target": expected,
			},
			errors: map[string]string{},
		}

		got, err := cm.GetClientSet("target")
		if err != nil {
			t.Fatalf("GetClientSet() error = %v", err)
		}
		if got != expected {
			t.Fatalf("GetClientSet() = %#v, want %#v", got, expected)
		}
	})

	t.Run("returns error for missing cluster", func(t *testing.T) {
		cm := &ClusterManager{
			clusters: map[string]*ClientSet{
				"target": {Name: "target"},
			},
			errors: map[string]string{},
		}

		_, err := cm.GetClientSet("missing")
		if err == nil || err.Error() != "cluster not found: missing" {
			t.Fatalf("GetClientSet() error = %v, want %q", err, "cluster not found: missing")
		}
	})
}

func TestClusterConnectionErrorMessage(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{
			name: "expired credentials",
			err:  fmt.Errorf("the server has asked for the client to provide credentials"),
			want: "集群认证失败",
		},
		{
			name: "certificate mismatch",
			err:  fmt.Errorf("x509: certificate signed by unknown authority"),
			want: "集群证书校验失败",
		},
		{
			name: "timeout",
			err:  fmt.Errorf("context deadline exceeded"),
			want: "连接集群超时",
		},
		{
			name: "dns failure",
			err:  fmt.Errorf("dial tcp: lookup api.example.invalid: no such host"),
			want: "无法解析集群地址",
		},
		{
			name: "generic",
			err:  fmt.Errorf("something else"),
			want: "无法连接集群",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := clusterConnectionErrorMessage(tt.err)
			if !strings.Contains(got, tt.want) {
				t.Fatalf("clusterConnectionErrorMessage() = %q, want to contain %q", got, tt.want)
			}
		})
	}
}

func TestBuildClientSet(t *testing.T) {
	t.Run("uses in-cluster constructor", func(t *testing.T) {
		inClusterCalled := false
		inClusterMock := mockey.Mock(createClientSetInCluster).To(func(name, prometheusURL string) (*ClientSet, error) {
			inClusterCalled = true
			if name != "cluster-a" {
				t.Fatalf("name = %q, want %q", name, "cluster-a")
			}
			if prometheusURL != "http://prometheus" {
				t.Fatalf("prometheusURL = %q, want %q", prometheusURL, "http://prometheus")
			}
			return &ClientSet{Name: name}, nil
		}).Build()
		defer inClusterMock.UnPatch()

		fromConfigMock := mockey.Mock(createClientSetFromConfig).To(func(name, content, prometheusURL string) (*ClientSet, error) {
			t.Fatalf("createClientSetFromConfig() unexpectedly called with name=%q content=%q prometheusURL=%q", name, content, prometheusURL)
			return nil, nil
		}).Build()
		defer fromConfigMock.UnPatch()

		got, err := buildClientSet(&model.Cluster{
			Name:          "cluster-a",
			InCluster:     true,
			PrometheusURL: "http://prometheus",
		})
		if err != nil {
			t.Fatalf("buildClientSet() error = %v", err)
		}
		if !inClusterCalled {
			t.Fatalf("createClientSetInCluster() was not called")
		}
		if got.Name != "cluster-a" {
			t.Fatalf("buildClientSet() = %#v, want cluster name %q", got, "cluster-a")
		}
	})

	t.Run("uses kubeconfig constructor", func(t *testing.T) {
		fromConfigCalled := false
		inClusterMock := mockey.Mock(createClientSetInCluster).To(func(name, prometheusURL string) (*ClientSet, error) {
			t.Fatalf("createClientSetInCluster() unexpectedly called with name=%q prometheusURL=%q", name, prometheusURL)
			return nil, nil
		}).Build()
		defer inClusterMock.UnPatch()

		fromConfigMock := mockey.Mock(createClientSetFromConfig).To(func(name, content, prometheusURL string) (*ClientSet, error) {
			fromConfigCalled = true
			if name != "cluster-b" {
				t.Fatalf("name = %q, want %q", name, "cluster-b")
			}
			if content != "config-data" {
				t.Fatalf("content = %q, want %q", content, "config-data")
			}
			if prometheusURL != "http://prometheus" {
				t.Fatalf("prometheusURL = %q, want %q", prometheusURL, "http://prometheus")
			}
			return &ClientSet{Name: name}, nil
		}).Build()
		defer fromConfigMock.UnPatch()

		got, err := buildClientSet(&model.Cluster{
			Name:          "cluster-b",
			Config:        model.SecretString("config-data"),
			PrometheusURL: "http://prometheus",
		})
		if err != nil {
			t.Fatalf("buildClientSet() error = %v", err)
		}
		if !fromConfigCalled {
			t.Fatalf("createClientSetFromConfig() was not called")
		}
		if got.Name != "cluster-b" {
			t.Fatalf("buildClientSet() = %#v, want cluster name %q", got, "cluster-b")
		}
	})
}

func TestImportableKubeconfigContextNamesDedupesSameCluster(t *testing.T) {
	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.CurrentContext = "alias-b"
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"cluster-a": {Server: "https://api.example.com"},
		"cluster-b": {Server: "https://api.example.com"},
		"cluster-c": {Server: "https://other.example.com"},
	}
	kubeconfig.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		"user-a": {Token: "token-a"},
		"user-b": {Token: "token-b"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"alias-a": {
			Cluster:  "cluster-a",
			AuthInfo: "user-a",
		},
		"alias-b": {
			Cluster:  "cluster-b",
			AuthInfo: "user-b",
		},
		"other": {
			Cluster:  "cluster-c",
			AuthInfo: "user-a",
		},
	}

	got := importableKubeconfigContextNames(kubeconfig)
	want := []string{"alias-b", "alias-a", "other"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("importableKubeconfigContextNames() = %#v, want %#v", got, want)
	}
}

func TestImportableKubeconfigContextNamesDedupesSameClusterAndAuth(t *testing.T) {
	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.CurrentContext = "alias-b"
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"cluster-a": {Server: "https://api.example.com"},
		"cluster-b": {Server: "https://api.example.com"},
	}
	kubeconfig.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		"user-a": {Token: "same-token"},
		"user-b": {Token: "same-token"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"alias-a": {Cluster: "cluster-a", AuthInfo: "user-a"},
		"alias-b": {Cluster: "cluster-b", AuthInfo: "user-b"},
	}

	got := importableKubeconfigContextNames(kubeconfig)
	want := []string{"alias-b"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("importableKubeconfigContextNames() = %#v, want %#v", got, want)
	}
}

func TestImportableKubeconfigContextNamesSkipsBrokenContexts(t *testing.T) {
	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"cluster-a": {Server: "https://api.example.com"},
		"cluster-b": {Server: "https://api-b.example.com"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"broken": {Cluster: "missing"},
		"valid":  {Cluster: "cluster-a"},
	}

	got := importableKubeconfigContextNames(kubeconfig)
	want := []string{"valid"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("importableKubeconfigContextNames() = %#v, want %#v", got, want)
	}
}

func TestImportableKubeconfigContextNamesFallsBackToOnlyCluster(t *testing.T) {
	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"cluster-a": {Server: "https://api.example.com"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"fallback": {Cluster: "missing"},
	}

	got := importableKubeconfigContextNames(kubeconfig)
	want := []string{"fallback"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("importableKubeconfigContextNames() = %#v, want %#v", got, want)
	}
}

func TestImportableKubeconfigContextNamesSkipsExistingClusterIdentities(t *testing.T) {
	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.CurrentContext = "existing-alias"
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"existing": {Server: "https://api.example.com"},
		"new":      {Server: "https://new.example.com"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"existing-alias": {Cluster: "existing"},
		"new-alias":      {Cluster: "new"},
	}
	existingContext := kubeconfig.Contexts["existing-alias"]
	seen := map[string]struct{}{
		kubeconfigContextIdentity(kubeconfig, "existing-alias", existingContext, kubeconfig.Clusters["existing"]): {},
	}

	got := importableKubeconfigContextNames(kubeconfig, seen)
	want := []string{"new-alias"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("importableKubeconfigContextNames() = %#v, want %#v", got, want)
	}
}

func TestImportClustersFromKubeconfigWithResultImportsMultipleContexts(t *testing.T) {
	setupClusterTestDB(t)

	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.CurrentContext = "prod-admin"
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"prod": {Server: "https://prod.example.com"},
		"dev":  {Server: "https://dev.example.com"},
	}
	kubeconfig.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		"admin": {Token: "admin-token"},
		"dev":   {Token: "dev-token"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"prod-admin": {Cluster: "prod", AuthInfo: "admin", Namespace: "default"},
		"dev":        {Cluster: "dev", AuthInfo: "dev", Namespace: "dev"},
	}

	result := ImportClustersFromKubeconfigWithResult(kubeconfig)
	if result.Imported != 2 {
		t.Fatalf("imported = %d, want 2, errors=%v", result.Imported, result.Errors)
	}

	clusters, err := model.ListClusters()
	if err != nil {
		t.Fatalf("list clusters: %v", err)
	}
	if len(clusters) != 2 {
		t.Fatalf("len(clusters) = %d, want 2", len(clusters))
	}

	result = ImportClustersFromKubeconfigWithResult(kubeconfig)
	if result.Imported != 0 || result.Skipped != 2 {
		t.Fatalf("second import result = %#v, want imported=0 skipped=2", result)
	}
}

func TestImportClustersFromKubeconfigWithResultStoresIndependentContextConfigs(t *testing.T) {
	setupClusterTestDB(t)

	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.CurrentContext = "prod-admin"
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"shared": {Server: "https://shared.example.com"},
	}
	kubeconfig.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		"prod": {Token: "prod-token"},
		"dev":  {Token: "dev-token"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"prod-admin": {Cluster: "shared", AuthInfo: "prod", Namespace: "prod"},
		"dev-admin":  {Cluster: "shared", AuthInfo: "dev", Namespace: "dev"},
	}

	result := ImportClustersFromKubeconfigWithResult(kubeconfig)
	if result.Imported != 2 {
		t.Fatalf("imported = %d, want 2, errors=%v", result.Imported, result.Errors)
	}

	clusters, err := model.ListClustersWithConfigStatus()
	if err != nil {
		t.Fatalf("list clusters: %v", err)
	}
	if len(clusters) != 2 {
		t.Fatalf("len(clusters) = %d, want 2", len(clusters))
	}

	for _, item := range clusters {
		if item.ConfigError != nil {
			t.Fatalf("config decrypt error for %s: %v", item.Cluster.Name, item.ConfigError)
		}
		stored, err := clientcmd.Load([]byte(item.Cluster.Config))
		if err != nil {
			t.Fatalf("load stored kubeconfig for %s: %v", item.Cluster.Name, err)
		}
		if stored.CurrentContext != item.Cluster.Name {
			t.Fatalf("stored current context for %s = %q, want cluster name", item.Cluster.Name, stored.CurrentContext)
		}
		if len(stored.Contexts) != 1 || len(stored.Clusters) != 1 || len(stored.AuthInfos) != 1 {
			t.Fatalf("stored config for %s should be single-context, got contexts=%d clusters=%d authInfos=%d", item.Cluster.Name, len(stored.Contexts), len(stored.Clusters), len(stored.AuthInfos))
		}
		context := stored.Contexts[stored.CurrentContext]
		if context == nil {
			t.Fatalf("stored config for %s has no current context", item.Cluster.Name)
		}
		if context.Cluster != item.Cluster.Name {
			t.Fatalf("stored context cluster for %s = %q, want %q", item.Cluster.Name, context.Cluster, item.Cluster.Name)
		}
		if stored.Clusters[item.Cluster.Name] == nil {
			t.Fatalf("stored config for %s has no internal cluster key", item.Cluster.Name)
		}
	}
}

func TestImportClustersFromKubeconfigWithResultFallsBackToOnlyUser(t *testing.T) {
	setupClusterTestDB(t)

	kubeconfig := clientcmdapi.NewConfig()
	kubeconfig.CurrentContext = "missing-user"
	kubeconfig.Clusters = map[string]*clientcmdapi.Cluster{
		"cluster-a": {Server: "https://api.example.com"},
	}
	kubeconfig.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		"only-user": {Token: "token"},
	}
	kubeconfig.Contexts = map[string]*clientcmdapi.Context{
		"missing-user": {Cluster: "cluster-a", AuthInfo: "not-found"},
	}

	result := ImportClustersFromKubeconfigWithResult(kubeconfig)
	if result.Imported != 1 {
		t.Fatalf("imported = %d, want 1, result=%#v", result.Imported, result)
	}
	if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "唯一的 user") {
		t.Fatalf("warnings = %#v, want only-user fallback warning", result.Warnings)
	}

	clusters, err := model.ListClustersWithConfigStatus()
	if err != nil {
		t.Fatalf("list clusters: %v", err)
	}
	stored, err := clientcmd.Load([]byte(clusters[0].Cluster.Config))
	if err != nil {
		t.Fatalf("load stored kubeconfig: %v", err)
	}
	context := stored.Contexts[stored.CurrentContext]
	if context.AuthInfo != "only-user" {
		t.Fatalf("stored authInfo = %q, want only-user", context.AuthInfo)
	}
	if stored.AuthInfos["only-user"] == nil {
		t.Fatalf("stored auth info map is missing only-user")
	}
}

func TestUniqueClusterNameTruncatesToDatabaseLimit(t *testing.T) {
	setupClusterTestDB(t)

	name := uniqueClusterName(strings.Repeat("a", 140))
	if len([]rune(name)) != maxStoredClusterNameLength {
		t.Fatalf("len(name) = %d, want %d", len([]rune(name)), maxStoredClusterNameLength)
	}
	if err := model.AddCluster(&model.Cluster{Name: name, Enable: true}); err != nil {
		t.Fatalf("add cluster: %v", err)
	}

	next := uniqueClusterName(strings.Repeat("a", 140))
	if len([]rune(next)) > maxStoredClusterNameLength {
		t.Fatalf("len(next) = %d, want <= %d", len([]rune(next)), maxStoredClusterNameLength)
	}
	if next == name {
		t.Fatalf("next name should be unique")
	}
}

func TestLoadKubeconfigsFromImportSplitsConcatenatedKubeconfigs(t *testing.T) {
	raw := strings.Join([]string{
		mustWriteKubeconfig(t, "user-a@sealos", "https://a.example.com", "ca-a", "token-a"),
		mustWriteKubeconfig(t, "user-b@sealos", "https://b.example.com", "ca-b", "token-b"),
		mustWriteKubeconfig(t, "user-c@sealos", "https://c.example.com", "ca-c", "token-c"),
	}, "\n\n")

	configs, warnings, err := loadKubeconfigsFromImport(raw)
	if err != nil {
		t.Fatalf("loadKubeconfigsFromImport() error = %v", err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", warnings)
	}
	if len(configs) != 3 {
		t.Fatalf("len(configs) = %d, want 3", len(configs))
	}

	for index, config := range configs {
		wantServer := fmt.Sprintf("https://%c.example.com", 'a'+rune(index))
		gotServer := config.Clusters["sealos"].Server
		if gotServer != wantServer {
			t.Fatalf("config %d server = %q, want %q", index, gotServer, wantServer)
		}
	}
}

func TestImportClustersFromKubeconfigsWithResultPreservesSameClusterNameFromSeparateDocs(t *testing.T) {
	setupClusterTestDB(t)

	raw := strings.Join([]string{
		mustWriteKubeconfig(t, "user-a@sealos", "https://a.example.com", "ca-a", "token-a"),
		mustWriteKubeconfig(t, "user-b@sealos", "https://b.example.com", "ca-b", "token-b"),
		mustWriteKubeconfig(t, "user-c@sealos", "https://c.example.com", "ca-c", "token-c"),
	}, "\n\n")
	configs, _, err := loadKubeconfigsFromImport(raw)
	if err != nil {
		t.Fatalf("loadKubeconfigsFromImport() error = %v", err)
	}

	result := ImportClustersFromKubeconfigsWithResult(configs)
	if result.Imported != 3 {
		t.Fatalf("imported = %d, want 3, result=%#v", result.Imported, result)
	}
	if strings.Join(result.ImportedNames, ",") != "user-a@sealos,user-b@sealos,user-c@sealos" {
		t.Fatalf("importedNames = %#v", result.ImportedNames)
	}

	clusters, err := model.ListClustersWithConfigStatus()
	if err != nil {
		t.Fatalf("list clusters: %v", err)
	}
	if len(clusters) != 3 {
		t.Fatalf("len(clusters) = %d, want 3", len(clusters))
	}

	servers := map[string]string{}
	for _, item := range clusters {
		if item.ConfigError != nil {
			t.Fatalf("config decrypt error for %s: %v", item.Cluster.Name, item.ConfigError)
		}
		config, err := clientcmd.Load([]byte(item.Cluster.Config))
		if err != nil {
			t.Fatalf("load stored kubeconfig for %s: %v", item.Cluster.Name, err)
		}
		context := config.Contexts[config.CurrentContext]
		if context == nil {
			t.Fatalf("stored config for %s has no current context", item.Cluster.Name)
		}
		clusterConfig := config.Clusters[context.Cluster]
		if clusterConfig == nil {
			t.Fatalf("stored config for %s has no cluster config", item.Cluster.Name)
		}
		servers[item.Cluster.Name] = clusterConfig.Server
	}

	wantServers := map[string]string{
		"user-a@sealos": "https://a.example.com",
		"user-b@sealos": "https://b.example.com",
		"user-c@sealos": "https://c.example.com",
	}
	for name, wantServer := range wantServers {
		if servers[name] != wantServer {
			t.Fatalf("stored server for %s = %q, want %q; all=%#v", name, servers[name], wantServer, servers)
		}
	}
}

func TestLoadKubeconfigsFromImportWarnsAboutLossyMergedSingleCluster(t *testing.T) {
	config := clientcmdapi.NewConfig()
	config.CurrentContext = "user-a@sealos"
	config.Clusters = map[string]*clientcmdapi.Cluster{
		"sealos": {
			Server:                   "https://a.example.com",
			CertificateAuthorityData: []byte("ca-a"),
		},
	}
	config.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		"user-a": {Token: "token-a"},
		"user-b": {Token: "token-b"},
	}
	config.Contexts = map[string]*clientcmdapi.Context{
		"user-a@sealos": {Cluster: "sealos", AuthInfo: "user-a"},
		"user-b@sealos": {Cluster: "sealos", AuthInfo: "user-b"},
	}
	raw, err := clientcmd.Write(*config)
	if err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	configs, warnings, err := loadKubeconfigsFromImport(string(raw))
	if err != nil {
		t.Fatalf("loadKubeconfigsFromImport() error = %v", err)
	}
	if len(configs) != 1 {
		t.Fatalf("len(configs) = %d, want 1", len(configs))
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "server/certificate-authority-data") {
		t.Fatalf("warnings = %#v, want lossy merge warning", warnings)
	}
}

func mustWriteKubeconfig(t *testing.T, contextName, server, ca, token string) string {
	t.Helper()

	config := clientcmdapi.NewConfig()
	config.CurrentContext = contextName
	config.Clusters = map[string]*clientcmdapi.Cluster{
		"sealos": {
			Server:                   server,
			CertificateAuthorityData: []byte(ca),
		},
	}
	config.AuthInfos = map[string]*clientcmdapi.AuthInfo{
		strings.TrimSuffix(contextName, "@sealos"): {
			Token: token,
		},
	}
	config.Contexts = map[string]*clientcmdapi.Context{
		contextName: {
			Cluster:  "sealos",
			AuthInfo: strings.TrimSuffix(contextName, "@sealos"),
		},
	}
	raw, err := clientcmd.Write(*config)
	if err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}
	return string(raw)
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
