#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

make build

mkdir -p desktop/resources
cp ./kite desktop/resources/kite
chmod +x desktop/resources/kite

cd desktop
pnpm install
pnpm run package:mac

echo "macOS app: $ROOT_DIR/desktop/dist/mac-arm64/Kite.app"
