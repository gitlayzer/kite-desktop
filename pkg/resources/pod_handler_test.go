package resources

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

func TestParseLsOutput(t *testing.T) {
	output := `
total 8
drwxr-xr-x    1 root     root        4.0K 2025-05-30 12:13:44 +0000 beta
-rw-r--r--    1 root     root          12 2025-05-30 12:13:44 +0000 alpha
drwxr-xr-x    1 root     root        4.0K 2025-05-30 12:13:44 +0000 .
drwxr-xr-x    1 root     root        4.0K 2025-05-30 12:13:44 +0000 ..
ignored line
`

	files := parseLsOutput(output)
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}

	if files[0].Name != "beta" || !files[0].IsDir {
		t.Fatalf("expected directory first, got %#v", files[0])
	}
	if files[1].Name != "alpha" || files[1].IsDir {
		t.Fatalf("expected file second, got %#v", files[1])
	}
}

func TestGetPodMetrics(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "demo"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "app",
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("256Mi"),
						},
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("250m"),
							corev1.ResourceMemory: resource.MustParse("128Mi"),
						},
					},
				},
				{
					Name: "sidecar",
					Resources: corev1.ResourceRequirements{
						Limits: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("250m"),
							corev1.ResourceMemory: resource.MustParse("64Mi"),
						},
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("100m"),
						},
					},
				},
			},
		},
	}

	metricsMap := map[string]metricsv1.PodMetrics{
		"default/demo": {
			ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
			Containers: []metricsv1.ContainerMetrics{
				{
					Usage: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("300m"),
						corev1.ResourceMemory: resource.MustParse("200Mi"),
					},
				},
				{
					Usage: corev1.ResourceList{
						corev1.ResourceCPU: resource.MustParse("50m"),
					},
				},
			},
		},
	}

	got := GetPodMetrics(metricsMap, pod)
	if got == nil {
		t.Fatalf("expected metrics, got nil")
	}
	if got.CPUUsage != 350 || got.MemoryUsage != 200*1024*1024 {
		t.Fatalf("unexpected usage: %#v", got)
	}
	if got.CPULimit != 750 || got.MemoryLimit != 320*1024*1024 {
		t.Fatalf("unexpected limits: %#v", got)
	}
	if got.CPURequest != 350 || got.MemoryRequest != 128*1024*1024 {
		t.Fatalf("unexpected requests: %#v", got)
	}
}

func TestGetPodMetricsMissingMetrics(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "default", Name: "demo"},
	}

	if got := GetPodMetrics(map[string]metricsv1.PodMetrics{}, pod); got != nil {
		t.Fatalf("expected nil metrics, got %#v", got)
	}
}

func TestPodWatchRejectsUnfilteredAllNamespaces(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/pods/_all/watch", nil)
	ctx.Params = gin.Params{{Key: "namespace", Value: "_all"}}
	ctx.Set("cluster", newFakeClientSet(t))

	NewPodHandler().Watch(ctx)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "event: error") {
		t.Fatalf("expected SSE error event, body=%q", body)
	}
	if !strings.Contains(body, "不能直接监听全集群 Pods") {
		t.Fatalf("expected plain Chinese large-cluster warning, body=%q", body)
	}
}

func TestWriteSSEWarningEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)

	requireNoError(t, writeSSE(ctx, "warning", gin.H{"warning": "达到显示上限"}))

	body := rec.Body.String()
	if !strings.Contains(body, "event: warning") {
		t.Fatalf("expected warning event, body=%q", body)
	}
	if strings.Contains(body, "event: error") {
		t.Fatalf("warning must not be emitted as error, body=%q", body)
	}

	var payload map[string]string
	data := strings.TrimSpace(strings.TrimPrefix(strings.Split(body, "data: ")[1], ""))
	requireNoError(t, json.Unmarshal([]byte(data), &payload))
	if payload["warning"] != "达到显示上限" {
		t.Fatalf("payload warning = %q", payload["warning"])
	}
}

func TestParseKubeSemverAndResizeSupport(t *testing.T) {
	tests := []struct {
		name       string
		version    string
		wantValid  bool
		wantResize bool
	}{
		{name: "trimmed prefix", version: " v1.35.0 ", wantValid: true, wantResize: true},
		{name: "below threshold", version: "v1.34.9", wantValid: true, wantResize: false},
		{name: "at threshold", version: "1.35.0", wantValid: true, wantResize: true},
		{name: "invalid", version: "not-a-version", wantValid: false, wantResize: false},
		{name: "empty", version: " ", wantValid: false, wantResize: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := parseKubeSemver(tt.version)
			if (err == nil) != tt.wantValid {
				t.Fatalf("parseKubeSemver(%q) error = %v, wantValid %v", tt.version, err, tt.wantValid)
			}
			if got := isPodResizeSupported(tt.version); got != tt.wantResize {
				t.Fatalf("isPodResizeSupported(%q) = %v, want %v", tt.version, got, tt.wantResize)
			}
			if tt.wantValid && parsed.Major == 0 && parsed.Minor == 0 && parsed.Patch == 0 {
				t.Fatalf("expected parsed version for %q", tt.version)
			}
		})
	}
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
