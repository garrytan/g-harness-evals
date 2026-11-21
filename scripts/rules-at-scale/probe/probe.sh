#!/usr/bin/env bash
# probe.sh: see what your coding agent sends the model when it loads your rules file. No API key and no paid call: the
# harness talks to a local fake model (fake_server.py) that records each request and answers "ok".
#
#   bash scripts/rules-at-scale/probe/probe.sh <harness> <your rules file> [--version V] [--bin PATH] [--out DIR] [--port N]
#       [--extra-config TEXT]
#
# harness: claude-code, codex, gemini-cli, pi, openclaw or hermes. The file is copied into a fresh git repository under the
# name that harness reads (CLAUDE.md, AGENTS.md or GEMINI.md) and the harness runs one turn there ("Reply with the single
# word ok."). npm harnesses are installed into ~/.cache/rules-probe (or $RULES_PROBE_CACHE) unless --bin names one you have.
# Hermes needs --bin (see README.md). The harness runs under env -i with a fake key, an isolated HOME and a short PATH.
# --extra-config adds one setting: a TOML line for codex (project_doc_max_bytes = 262144), JSON text after the model entry
# for openclaw (, "bootstrapMaxChars": 200000), a YAML line for hermes (  context_length: 1000000, under model:).
# Output: report.py's summary; the captured requests are in <out>/capture, the harness's output in <out>/stdout.txt and
# <out>/stderr.txt.
set -euo pipefail

usage() { echo "usage: probe.sh <claude-code|codex|gemini-cli|pi|openclaw|hermes> <rules file> [--version V] [--bin PATH] [--out DIR] [--port N] [--extra-config TEXT]" >&2; exit 2; }
[ $# -ge 2 ] || usage
HERE=$(cd "$(dirname "$0")" && pwd)
harness=$1; rules=$2; shift 2
[ -f "$rules" ] || { echo "probe: $rules is not a file" >&2; exit 2; }
rules=$(cd "$(dirname "$rules")" && pwd)/$(basename "$rules")
version=latest; bin=""; out=""; port=18089; extra=""
while [ $# -gt 0 ]; do
  case $1 in
    --version) version=$2; shift 2 ;;
    --bin) bin=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --port) port=$2; shift 2 ;;
    --extra-config) extra=$2; shift 2 ;;
    *) usage ;;
  esac
done
case $harness in
  claude-code) name=CLAUDE.md; pkg=@anthropic-ai/claude-code; rel=node_modules/.bin/claude ;;
  codex) name=AGENTS.md; pkg=@openai/codex; rel=node_modules/.bin/codex ;;
  gemini-cli) name=GEMINI.md; pkg=@google/gemini-cli; rel=node_modules/.bin/gemini ;;
  pi) name=AGENTS.md; pkg=@earendil-works/pi-coding-agent; rel=node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js ;;
  openclaw) name=AGENTS.md; pkg=openclaw; rel=node_modules/.bin/openclaw ;;
  hermes) name=AGENTS.md; pkg=""; rel="" ;;
  *) usage ;;
esac
node_bin=$(dirname "$(command -v node)")
cache=${RULES_PROBE_CACHE:-$HOME/.cache/rules-probe}
if [ -z "$bin" ]; then
  [ -n "$pkg" ] || { echo "probe: hermes is not on npm; install it from source and pass --bin <path to hermes> (see README.md)" >&2; exit 2; }
  dir=$cache/$harness-$version
  if [ ! -e "$dir/$rel" ]; then
    echo "probe: installing $pkg@$version into $dir" >&2
    mkdir -p "$dir" && npm --prefix "$dir" install --no-audit --no-fund --loglevel=error "$pkg@$version" >&2
  fi
  bin=$dir/$rel
fi
[ -e "$bin" ] || { echo "probe: $bin does not exist" >&2; exit 2; }

out=${out:-$(mktemp -d "${TMPDIR:-/tmp}/rules-probe-XXXXXX")}
mkdir -p "$out"
repo=$out/repo; home=$out/home; cap=$out/capture
rm -rf "$repo" "$home" "$cap"; mkdir -p "$repo" "$home"
cp "$rules" "$repo/$name"
id=(-c user.name=probe -c user.email=probe@example.invalid)
git -C "$repo" init -q && git -C "$repo" "${id[@]}" add -A && git -C "$repo" "${id[@]}" commit -q -m init

python3 "$HERE/fake_server.py" "$port" "$cap" &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null && break; sleep 0.2; done

url=http://127.0.0.1:$port
prompt="Reply with the single word ok."
base=(env -i "PATH=$node_bin:/usr/bin:/bin" "HOME=$home" TERM=dumb)
cd "$repo"
set +e
case $harness in
  claude-code)
    "${base[@]}" ANTHROPIC_BASE_URL=$url ANTHROPIC_API_KEY=sk-fake CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 \
      timeout 180 "$bin" -p --model claude-sonnet-4-5 --output-format json "$prompt" ;;
  codex)
    mkdir -p "$home/codex"
    printf 'model = "gpt-5.1-codex"\nmodel_provider = "fake"\n%s\n[model_providers.fake]\nname = "fake"\nbase_url = "%s/v1"\nenv_key = "FAKE_OPENAI_KEY"\nwire_api = "responses"\n' "$extra" "$url" > "$home/codex/config.toml"
    "${base[@]}" CODEX_HOME=$home/codex FAKE_OPENAI_KEY=sk-fake timeout 180 "$bin" exec --skip-git-repo-check --sandbox read-only "$prompt" ;;
  gemini-cli)
    mkdir -p "$home/.gemini"
    printf '{"privacy": {"usageStatisticsEnabled": false}, "telemetry": {"enabled": false}, "security": {"auth": {"selectedType": "gemini-api-key"}}, "general": {"disableAutoUpdate": true, "disableUpdateNag": true}}\n' > "$home/.gemini/settings.json"
    "${base[@]}" GEMINI_API_KEY=sk-fake GOOGLE_GEMINI_BASE_URL=$url GEMINI_CLI_NO_RELAUNCH=true GEMINI_CLI_TRUST_WORKSPACE=true \
      timeout 180 "$bin" -p "$prompt" -m gemini-2.5-pro ;;
  pi)
    mkdir -p "$home/pi"
    printf '{"providers": {"fake": {"name": "fake", "baseUrl": "%s/v1", "apiKey": "sk-fake", "api": "openai-completions", "models": [{"id": "fake-model", "name": "fake-model", "contextWindow": 400000, "maxTokens": 4096, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}}]}}}\n' "$url" > "$home/pi/models.json"
    "${base[@]}" PI_CODING_AGENT_DIR=$home/pi PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 \
      timeout 180 node "$bin" --print --provider fake --model fake-model --no-session "$prompt" ;;
  openclaw)
    mkdir -p "$home/state"
    printf '{"models": {"mode": "merge", "providers": {"fake": {"baseUrl": "%s/v1", "apiKey": "sk-fake", "api": "openai-completions", "models": [{"id": "fake-model", "name": "fake-model", "reasoning": false, "input": ["text"], "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}, "contextWindow": 400000, "maxTokens": 4096}]}}}, "agents": {"defaults": {"workspace": "%s", "model": {"primary": "fake/fake-model"} %s}}}\n' "$url" "$repo" "$extra" > "$home/openclaw.json"
    "${base[@]}" OPENCLAW_STATE_DIR=$home/state timeout 240 "$bin" agent exec --config "$home/openclaw.json" --model fake/fake-model --cwd "$repo" --json "$prompt" ;;
  hermes)
    mkdir -p "$home/hermes"
    printf 'model:\n  provider: custom\n  default: fake-model\n  base_url: %s/v1\n  api_key: sk-fake\n%s\n' "$url" "$extra" > "$home/hermes/config.yaml"
    env -i "PATH=$(dirname "$bin"):/usr/bin:/bin" "HOME=$home" TERM=dumb HERMES_HOME=$home/hermes timeout 240 "$bin" -z "$prompt" ;;
esac > "$out/stdout.txt" 2> "$out/stderr.txt"
code=$?
set -e
echo "probe: $harness exited $code; captured requests are in $cap" >&2
python3 "$HERE/report.py" --rules "$rules" --capture "$cap" --harness "$harness"
