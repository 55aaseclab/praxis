#!/usr/bin/env bash
set -euo pipefail
platform=$(cd "$(dirname "$0")/.." && pwd)
entry=$(git -C "$platform" ls-tree HEAD -- third_party/polaris)
read -r mode type revision _ <<< "$entry"
if [[ $mode != 160000 || $type != commit || ! -e "$platform/third_party/polaris/.git" ]]; then
  echo 'Initialize the pinned Polaris viewer with git submodule update --init third_party/polaris.' >&2
  exit 1
fi

umask 077
build_root=$(mktemp -d "${TMPDIR:-/tmp}/praxis-viewer-build-XXXXXXXX")
trap 'rm -rf -- "$build_root"' EXIT
git -C "$platform/third_party/polaris" archive --format=tar "$revision" \
  package.json package-lock.json apps/polaris-portal packages/polaris-shell packages/surface-wanghai server.mjs |
  tar -xf - -C "$build_root"
cp "$platform/packaging/polaris-viewer/"{Dockerfile,entrypoint.mjs,ingress.mjs} "$build_root/"
docker build --build-arg "REVISION=$revision" --tag "praxis-polaris-viewer:$revision" "$build_root"
