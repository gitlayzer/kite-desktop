package desktopaccess

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/zxh326/kite/pkg/common"
	"k8s.io/klog/v2"
)

const (
	Header = "X-Kite-Desktop-Token"
	Cookie = "kite_desktop_access"
)

func TokenMatches(candidate string) bool {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || common.DesktopAccessToken == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(candidate), []byte(common.DesktopAccessToken)) == 1
}

func WebSocketOriginAllowed(r *http.Request) bool {
	if !common.DesktopMode {
		return true
	}

	if common.DesktopAccessToken == "" {
		klog.Warning("desktop websocket rejected: access token is not configured")
		return false
	}

	if !originAllowed(r.Header.Get("Origin"), r.Host) {
		return false
	}

	if TokenMatches(r.URL.Query().Get("desktopToken")) || TokenMatches(r.URL.Query().Get("kiteDesktopToken")) {
		return true
	}

	if cookie, err := r.Cookie(Cookie); err == nil && TokenMatches(cookie.Value) {
		return true
	}

	return TokenMatches(r.Header.Get(Header))
}

func originAllowed(origin, host string) bool {
	if origin == "" {
		return true
	}
	origin = strings.TrimRight(origin, "/")
	return origin == "http://"+host || origin == "https://"+host
}
