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

allow_unsigned_dmg() {
  [ "${KITE_ALLOW_UNSIGNED_DMG:-}" = "1" ] || [ "${KITE_ALLOW_UNSIGNED_DMG:-}" = "true" ]
}

has_codesigning_identity() {
  if [ -n "${MAC_CODE_SIGN_IDENTITY:-}" ] || [ -n "${CSC_NAME:-}" ]; then
    return 0
  fi

  security find-identity -v -p codesigning 2>/dev/null | grep -q 'Developer ID Application'
}

require_macos_distribution_signing() {
  if allow_unsigned_dmg; then
    cat >&2 <<'EOF'
==> WARNING: building unsigned macOS DMGs for local development only.
    These DMGs are not suitable for sending to other Macs. Gatekeeper may show
    "Kite.app is damaged" or refuse to open the app after download.
EOF
    return
  fi

  if has_codesigning_identity; then
    return
  fi

  cat >&2 <<'EOF'
ERROR: No Developer ID Application signing identity was found.

macOS DMGs sent to other machines must be signed and notarized, otherwise
Gatekeeper can reject the app as damaged or unidentified.

Provide a Developer ID certificate via MAC_CODE_SIGN_IDENTITY/CSC_NAME and
notarization credentials, or set KITE_ALLOW_UNSIGNED_DMG=1 only for local
development builds that will not be distributed.
EOF
  exit 1
}

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

clean_macos_output() {
  local electron_arch="$1"
  local app_dir="mac"

  if [ "$electron_arch" = "arm64" ]; then
    app_dir="mac-arm64"
  fi

  rm -rf "$DESKTOP_DIR/dist/$app_dir"
  rm -f "$DESKTOP_DIR/dist/Kite-$DESKTOP_VERSION-mac-$electron_arch.dmg"
  rm -f "$DESKTOP_DIR/dist/Kite-$DESKTOP_VERSION-mac-$electron_arch.dmg.blockmap"
  rm -f "$INSTALLER_DIR/Kite-$DESKTOP_VERSION-mac-$electron_arch.dmg"
}

clean_windows_output() {
  rm -rf "$DESKTOP_DIR/dist/win-unpacked"
  rm -f "$DESKTOP_DIR/dist/Kite-$DESKTOP_VERSION-win-x64.exe"
  rm -f "$DESKTOP_DIR/dist/Kite-$DESKTOP_VERSION-win-x64.exe.blockmap"
  rm -f "$INSTALLER_DIR/Kite-$DESKTOP_VERSION-win-x64.exe"
}

verify_macos_signature() {
  local electron_arch="$1"
  local app_dir="mac"

  if [ "$electron_arch" = "arm64" ]; then
    app_dir="mac-arm64"
  fi

  local app_path="$DESKTOP_DIR/dist/$app_dir/Kite.app"
  if [ ! -d "$app_path" ]; then
    echo "Unable to find packaged app for signature verification: $app_path" >&2
    exit 1
  fi

  echo "==> Verifying macOS $electron_arch app signature"
  codesign --verify --deep --strict --verbose=2 "$app_path"
}

run_electron_builder() {
  local label="$1"
  shift
  local attempt=1
  local max_attempts=3

  while true; do
    if (cd "$DESKTOP_DIR" && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder "$@"); then
      return 0
    fi

    if [ "$attempt" -ge "$max_attempts" ]; then
      return 1
    fi

    echo "electron-builder failed for $label, retrying ($attempt/$max_attempts)..." >&2
    attempt=$((attempt + 1))
    sleep 5
  done
}

package_macos() {
  local electron_arch="$1"
  local goarch="$2"
  local mac_sign_args=()

  require_macos_distribution_signing
  clean_macos_output "$electron_arch"
  build_backend darwin "$goarch" "$RESOURCE_DIR/kite"
  if [ -n "${MAC_CODE_SIGN_IDENTITY:-}" ]; then
    echo "==> Using macOS signing identity: $MAC_CODE_SIGN_IDENTITY"
    mac_sign_args+=(--config.mac.identity="$MAC_CODE_SIGN_IDENTITY" --config.mac.hardenedRuntime=true)
  elif [ -n "${CSC_NAME:-}" ]; then
    echo "==> Using macOS signing identity from CSC_NAME"
    mac_sign_args+=(--config.mac.identity="$CSC_NAME" --config.mac.hardenedRuntime=true)
  else
    mac_sign_args+=(--config.mac.identity=- --config.mac.hardenedRuntime=false)
  fi
  echo "==> Packaging macOS $electron_arch DMG"
  run_electron_builder "macOS $electron_arch" --mac dmg "--$electron_arch" "${mac_sign_args[@]}"
  verify_macos_signature "$electron_arch"
  copy_dist_artifact "Kite-$DESKTOP_VERSION-*-$electron_arch.dmg"
}

package_windows() {
  ensure_windows_icon
  clean_windows_output
  build_backend windows amd64 "$RESOURCE_DIR/kite.exe"
  echo "==> Packaging Windows x64 installer"
  run_electron_builder "Windows x64" --win nsis --x64
  copy_dist_artifact "Kite-$DESKTOP_VERSION-*-x64.exe"
}

build_frontend
install_desktop_deps
package_macos arm64 arm64
package_macos x64 amd64
package_windows

echo "==> Installers"
ls -lh "$INSTALLER_DIR"
