#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "=== 1. Fetching latest upstream ==="
git fetch origin main

echo "=== 2. Rebasing custom patch onto origin/main ==="
git rebase origin/main

echo "=== 3. Running focused tests ==="
bun test packages/ui/src/components/chat/components/LiveTurnActivity.test.tsx
bun test packages/ui/src/components/chat/message/renderCompare.test.ts

echo "=== 4. Building packages (SDK + Web) ==="
bun run --cwd packages/sdk build
bun run --cwd packages/web build

echo "=== 5. Packing archives ==="
rm -f "$REPO_DIR"/*.tgz
SDK_TGZ=$(cd packages/sdk && bun pm pack --destination "$REPO_DIR" | grep -F '.tgz' | tail -1)
WEB_TGZ=$(cd packages/web && bun pm pack --destination "$REPO_DIR" | grep -F '.tgz' | tail -1)

# Ensure absolute paths
[[ "$SDK_TGZ" = /* ]] || SDK_TGZ="$REPO_DIR/$SDK_TGZ"
[[ "$WEB_TGZ" = /* ]] || WEB_TGZ="$REPO_DIR/$WEB_TGZ"

echo "SDK tarball: $SDK_TGZ"
echo "Web tarball: $WEB_TGZ"

echo "=== 6. Installing custom packages globally ==="
# Install SDK first so web resolves the matching version
npm install -g "$SDK_TGZ" "$WEB_TGZ"
rm -f "$SDK_TGZ" "$WEB_TGZ"

echo "=== 7. Restarting OpenChamber service ==="
launchctl kickstart -k "gui/$(id -u)/dev.openchamber.web"

echo "=== 8. Verifying service ==="
for i in {1..10}; do
  sleep 1
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || true)
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "OpenChamber restarted and healthy (HTTP 200) after ${i}s."
    exit 0
  fi
done

echo "Warning: Service did not return HTTP 200 within 10s (last status: $HTTP_STATUS)"
exit 1
