#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
RESOURCE_DIR="$DESKTOP_DIR/resources"
INSTALLER_DIR="$DESKTOP_DIR/dist/installers"

VERSION="$("$ROOT_DIR/scripts/get-version.sh")"
DESKTOP_VERSION="$(cd "$DESKTOP_DIR" && node -p "require('./package.json').version")"
BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
COMMIT_ID="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"
LDFLAGS="-s -w -X github.com/zxh326/kite/pkg/version.Version=$VERSION -X github.com/zxh326/kite/pkg/version.BuildDate=$BUILD_DATE -X github.com/zxh326/kite/pkg/version.CommitID=$COMMIT_ID"

mkdir -p "$RESOURCE_DIR" "$INSTALLER_DIR"

ensure_windows_icon() {
  if [ -f "$DESKTOP_DIR/build/icon.ico" ]; then
    return
  fi

  python3 - "$DESKTOP_DIR/build/Kite.iconset/icon_512x512.png" "$DESKTOP_DIR/build/icon.ico" <<'PY'
import sys
from PIL import Image

source, target = sys.argv[1], sys.argv[2]
image = Image.open(source).convert("RGBA")
sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
image.save(target, sizes=sizes)
PY
}

build_frontend() {
  echo "==> Building frontend"
  (cd "$ROOT_DIR/ui" && pnpm run build)
}

install_desktop_deps() {
  echo "==> Installing desktop dependencies"
  (cd "$DESKTOP_DIR" && pnpm install --frozen-lockfile)
}

build_backend() {
  local goos="$1"
  local goarch="$2"
  local output="$3"

  echo "==> Building backend $goos/$goarch"
  (cd "$ROOT_DIR" && CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath -ldflags "$LDFLAGS" -o "$output" .)

  if [ "$goos" != "windows" ]; then
    chmod +x "$output"
  fi
}

copy_dist_artifact() {
  local pattern="$1"
  local artifact

  artifact="$(find "$DESKTOP_DIR/dist" -maxdepth 1 -type f -name "$pattern" -print | sort | tail -n 1)"
  if [ -z "$artifact" ]; then
    echo "Unable to find packaged artifact matching: $pattern" >&2
    find "$DESKTOP_DIR/dist" -maxdepth 1 -type f -print >&2
    exit 1
  fi

  cp "$artifact" "$INSTALLER_DIR/"
}

package_macos() {
  local electron_arch="$1"
  local goarch="$2"

  build_backend darwin "$goarch" "$RESOURCE_DIR/kite"
  echo "==> Packaging macOS $electron_arch DMG"
  (cd "$DESKTOP_DIR" && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dmg "--$electron_arch")
  copy_dist_artifact "Kite-$DESKTOP_VERSION-*-$electron_arch.dmg"
}

package_windows() {
  ensure_windows_icon
  build_backend windows amd64 "$RESOURCE_DIR/kite.exe"
  echo "==> Packaging Windows x64 installer"
  (cd "$DESKTOP_DIR" && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --win nsis --x64)
  copy_dist_artifact "Kite-$DESKTOP_VERSION-*-x64.exe"
}

build_frontend
install_desktop_deps
package_macos arm64 arm64
package_macos x64 amd64
package_windows

echo "==> Installers"
ls -lh "$INSTALLER_DIR"
