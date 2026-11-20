#!/usr/bin/env bash
set -euo pipefail
platform=$(cd "$(dirname "$0")/.." && pwd)
exec node "$platform/scripts/demo-app.mjs" "$@"
