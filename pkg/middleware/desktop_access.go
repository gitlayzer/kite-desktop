package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/desktopaccess"
)

const (
	DesktopAccessHeader = desktopaccess.Header
	desktopAccessCookie = desktopaccess.Cookie
)

func DesktopAccessGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.DesktopMode {
			c.Next()
			return
		}

		if common.DesktopAccessToken == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "desktop access token is not configured"})
			c.Abort()
			return
		}

		if desktopaccess.TokenMatches(c.GetHeader(DesktopAccessHeader)) {
			setDesktopAccessCookie(c)
			c.Next()
			return
		}

		if isWebSocketUpgrade(c.Request) && (desktopaccess.TokenMatches(c.Query("desktopToken")) || desktopaccess.TokenMatches(c.Query("kiteDesktopToken"))) {
			setDesktopAccessCookie(c)
			c.Next()
			return
		}

		if cookie, err := c.Cookie(desktopAccessCookie); err == nil && desktopaccess.TokenMatches(cookie) {
			c.Next()
			return
		}

		c.JSON(http.StatusForbidden, gin.H{"error": "Kite desktop can only be opened from the app"})
		c.Abort()
	}
}

func DesktopStaticAccessGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !common.DesktopMode {
			c.Next()
			return
		}

		if common.DesktopAccessToken == "" {
			c.String(http.StatusForbidden, "Kite desktop access token is not configured")
			c.Abort()
			return
		}

		if desktopaccess.TokenMatches(c.GetHeader(DesktopAccessHeader)) {
			setDesktopAccessCookie(c)
			c.Next()
			return
		}

		if cookie, err := c.Cookie(desktopAccessCookie); err == nil && desktopaccess.TokenMatches(cookie) {
			c.Next()
			return
		}

		c.String(http.StatusForbidden, "请从 Kite App 打开，浏览器不能直接访问本地服务。")
		c.Abort()
	}
}

func setDesktopAccessCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     desktopAccessCookie,
		Value:    common.DesktopAccessToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}
