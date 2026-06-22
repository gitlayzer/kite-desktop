package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/desktopaccess"
)

func TestDesktopAccessGuard(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDesktopMode := common.DesktopMode
	oldToken := common.DesktopAccessToken
	defer func() {
		common.DesktopMode = oldDesktopMode
		common.DesktopAccessToken = oldToken
	}()

	common.DesktopMode = true
	common.DesktopAccessToken = "secret-token"

	r := gin.New()
	r.Use(DesktopAccessGuard())
	r.GET("/api/v1/test", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	t.Run("rejects missing token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
		}
	})

	t.Run("accepts app token and sets cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
		req.Header.Set(DesktopAccessHeader, "secret-token")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
		if got := rec.Result().Cookies(); len(got) == 0 || got[0].Name != desktopAccessCookie {
			t.Fatalf("desktop cookie was not set: %#v", got)
		}
	})

	t.Run("accepts cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
		req.AddCookie(&http.Cookie{Name: desktopAccessCookie, Value: "secret-token"})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
		}
	})
}

func TestDesktopWebSocketOriginAllowed(t *testing.T) {
	oldDesktopMode := common.DesktopMode
	oldToken := common.DesktopAccessToken
	defer func() {
		common.DesktopMode = oldDesktopMode
		common.DesktopAccessToken = oldToken
	}()

	common.DesktopMode = true
	common.DesktopAccessToken = "secret-token"

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:47826/api/v1/kubectl-terminal/ws", nil)
	req.Host = "127.0.0.1:47826"
	req.Header.Set("Origin", "http://evil.example")
	req.AddCookie(&http.Cookie{Name: desktopAccessCookie, Value: "secret-token"})
	if desktopaccess.WebSocketOriginAllowed(req) {
		t.Fatal("cross-origin websocket was allowed")
	}

	req.Header.Set("Origin", "http://127.0.0.1:47826")
	if !desktopaccess.WebSocketOriginAllowed(req) {
		t.Fatal("same-origin websocket with desktop cookie was rejected")
	}
}
