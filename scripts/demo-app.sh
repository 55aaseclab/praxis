#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: npm run app:demo -- {reminder|knowledge|lattice-slides|travel|tingproof|memo|projects|finance|intelligence} [port]" >&2
  exit 2
}
[[ $# -ge 1 && $# -le 2 ]] || usage
app=$1
module=$app
port=${2:-18432}
[[ $port =~ ^[1-9][0-9]{0,4}$ ]] && ((port >= 1024 && port <= 65535)) || usage
case "$app" in
  lattice-slides) module=lattice ;;
  reminder|knowledge|travel|tingproof|memo|projects|finance|intelligence) ;;
  *) usage ;;
esac

platform=$(cd "$(dirname "$0")/.." && pwd)
source_dir=$platform/third_party/$module
entry=$(git -C "$platform" ls-tree HEAD -- "third_party/$module")
read -r mode type revision _ <<< "$entry"
if [[ $mode != 160000 || $type != commit || ! -e "$source_dir/.git" ]]; then
  echo "Initialize the pinned $module source with git submodule update --init --recursive." >&2
  exit 1
fi

umask 077
demo_root=$(mktemp -d "${TMPDIR:-/tmp}/praxis-$app-XXXXXXXX")
child=
cleanup() {
  if [[ -n $child ]]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  rm -rf -- "$demo_root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir "$demo_root"/{app,data,home}
git -C "$source_dir" archive --format=tar --output="$demo_root/source.tar" "$revision"
tar -xf "$demo_root/source.tar" -C "$demo_root/app"
rm "$demo_root/source.tar"
cd "$demo_root/app"

# Pass only the local demo settings to dependency installers and app processes.
demo_env=(env -i "PATH=$PATH" "HOME=$demo_root/home" "TMPDIR=$demo_root" HOST=127.0.0.1 "PORT=$port")
case "$app" in
  knowledge|lattice-slides|tingproof|travel) "${demo_env[@]}" npm ci --ignore-scripts --no-audit --no-fund ;;
esac

case "$app" in
  reminder)
    demo_env+=("REMINDER_DATA=$demo_root/data/checklist.json")
    "${demo_env[@]}" node src/cli.js import data/checklist.example.json
    command=(src/server.js) ;;
  knowledge)
    demo_env+=("KNOWLEDGE_DATA_DIR=$demo_root/data")
    command=(src/runtime/server.mjs) ;;
  lattice-slides)
    "${demo_env[@]}" npm run build
    command=(scripts/serve.mjs) ;;
  travel)
    "${demo_env[@]}" npm run build
    command=(src/server.js) ;;
  tingproof)
    "${demo_env[@]}" npm run build
    demo_env+=("TINGPROOF_DATA_DIR=$demo_root/data")
    command=(dist-server/main.js) ;;
  memo)
    demo_env+=("MEMO_DATA_DIR=$demo_root/data")
    command=(src/main.mjs) ;;
  projects)
    demo_env+=("PROJECTS_DATA_DIR=$demo_root/data")
    command=(src/server.mjs --host 127.0.0.1 --port "$port") ;;
  finance)
    demo_env+=("FINANCE_DATA=$demo_root/data/finance.json")
    command=(src/server.mjs) ;;
  intelligence) command=(src/server.mjs --demo) ;;
esac
echo "Starting $app on loopback. Open the demo workbench URL. Press Ctrl-C to discard the demo."
"${demo_env[@]}" "PRAXIS_DEMO_APP=$app" node --import "$platform/scripts/demo-workbench.mjs" "${command[@]}" &
child=$!
wait "$child"
child=
