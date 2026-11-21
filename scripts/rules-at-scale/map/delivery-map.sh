#!/usr/bin/env bash
# The keyless delivery map of the rules-at-scale eval: every harness and arm through
# agents_rules.py and the real harness binary at scripts/rules-at-scale/pin.json, in Harbor's docker environment, on the
# stub task (map/stub-task), every model call answered by scripts/frontier-harbor/fake-upstream.ts --tool-call (one shell
# tool call, then a text reply), so each session sends its first request and one tool follow-up. A small forwarder in front
# of it records each request under its trial (the path's first segment) and strips that segment. No provider key is read
# or passed; every process runs under env -i with a short allowlist.
#
#   bash scripts/rules-at-scale/map/delivery-map.sh <out dir> [--materializer <script>] [--harnesses a,b] [--arms a,b]
#        [--concurrency n] [--rotation 0|1|2]
#
# --materializer defaults to lane B's scripts/rules-at-scale/materialize.ts. --rotation sets the stub task's rotation
# (default 0: R1 and R2 top, R3 and R4 middle, R5 and R6 end; rules.json "rotations"). The agent phase runs on Harbor's plain docker environment with the verifier off: the map needs neither, and no
# request leaves the machine. delivery_map.py then writes <out>/delivery-map.json and <out>/delivery-map.md.
# Exit 0 when every cell ran and mapped, 1 otherwise, 2 usage, 3 setup.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
rules=$(cd "$here/.." && pwd)
repo=$(cd "$here/../../.." && pwd)
fh="$repo/scripts/frontier-harbor"
out=${1:?usage: delivery-map.sh <out dir> [--materializer s] [--harnesses a,b] [--arms a,b] [--concurrency n] [--rotation r]}
shift
materializer="$rules/materialize.ts" harnesses=claude-code,codex,hermes,openclaw,pi,gemini-cli
arms=none,short,b8k,b28k,b80k,b160k,split,hook,cutlift conc=3 rotation=0 environment=harbor.environments.docker.docker:DockerEnvironment
while [ $# -gt 0 ]; do
  case "$1" in
    --materializer) materializer=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --harnesses) harnesses=$2; shift 2 ;;
    --arms) arms=$2; shift 2 ;;
    --concurrency) conc=$2; shift 2 ;;
    --rotation) rotation=$2; shift 2 ;;
    *) echo "delivery-map: unknown argument $1" >&2; exit 2 ;;
  esac
done
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
venv=${FRONTIER_HARBOR_VENV:-$HOME/.frontier-harbor/venv}
[ -x "$venv/bin/harbor" ] || { echo "delivery-map: no Harbor at $venv (set FRONTIER_HARBOR_VENV)" >&2; exit 3; }
[ -f "$materializer" ] || { echo "delivery-map: no materializer at $materializer" >&2; exit 3; }
# distinct file times on the rules-fix task set before any image build (lane A; docker/buildx#3232, moby/moby#51518)
(cd "$repo" && env -i "PATH=$PATH" "HOME=$HOME" TZ=UTC bun scripts/repo-tasks/rules-fix/build.ts --stamp) || { echo "delivery-map: build.ts --stamp failed" >&2; exit 3; }
mkdir -p "$out"
out=$(cd "$out" && pwd)
say() { printf '%s delivery-map: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/delivery-map.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
gw=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
rm -rf "$out/tasks" "$out/rules" "$out/jobs"
mkdir -p "$out/tasks"
cp -r "$here/stub-task" "$out/tasks/rs-map-stub-01"
chmod 755 "$out/tasks/rs-map-stub-01/tests/test.sh"
case "$rotation" in 0|1|2) sed -i "s/^rotation = .*/rotation = $rotation/" "$out/tasks/rs-map-stub-01/task.toml" ;; *) echo "delivery-map: --rotation must be 0, 1 or 2" >&2; exit 2 ;; esac
rm -f "$out/fake-upstream.jsonl" "$out/fake-upstream-bodies.jsonl" "$out/fake-upstream-raw-bodies.jsonl" "$out/binds.jsonl"
cat > "$out/broker-stub.ts" <<'TS'
import { appendFileSync } from 'node:fs';
const [listen, upstream, log] = process.argv.slice(2);
const [hostname, port] = listen!.split(':');
Bun.serve({ hostname, port: Number(port), async fetch(req) {
  if (req.method !== 'POST' || new URL(req.url).pathname !== '/bind') return new Response('not found', { status: 404 });
  const b = await req.json() as { trial: string; model: string };
  appendFileSync(log!, JSON.stringify({ at: new Date().toISOString(), ...b }) + '\n');
  return Response.json({ token: 'map-token-' + b.trial, base_url: upstream + '/' + b.trial + '/' + b.model.split(':')[0] });
} });
TS
cat > "$out/forward.ts" <<'TS'
// Records each request under its trial and forwards it to the fake upstream with the trial segment removed, so the
// upstream sees the route the metering proxy would forward (/google/v1beta/..., /v1/messages, ...).
import { appendFileSync } from 'node:fs';
const [listen, upstream, log] = process.argv.slice(2);
const [hostname, port] = listen!.split(':');
let n = 0;
Bun.serve({ hostname, port: Number(port), idleTimeout: 120, async fetch(req) {
  const url = new URL(req.url);
  const rest = url.pathname.replace(/^\/[^/]+/, '') || '/';
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  if (body) appendFileSync(log!, JSON.stringify({ n: ++n, path: url.pathname, body }) + '\n');
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('content-length');
  return fetch(upstream + rest + url.search, { method: req.method, headers, body });
} });
TS
pids=()
cleanup() { for p in "${pids[@]}"; do kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
("${safe_env[@]}" setsid bun "$fh/fake-upstream.ts" --listen "$gw:8799" --log "$out/fake-upstream.jsonl" --bodies "$out/fake-upstream-raw-bodies.jsonl" --tool-call) >> "$out/fake-upstream.log" 2>&1 & pids+=($!)
("${safe_env[@]}" setsid bun "$out/forward.ts" "$gw:8798" "http://$gw:8799" "$out/fake-upstream-bodies.jsonl") >> "$out/forward.log" 2>&1 & pids+=($!)
("${safe_env[@]}" setsid bun "$out/broker-stub.ts" 127.0.0.1:8791 "http://$gw:8798" "$out/binds.jsonl") >> "$out/broker.log" 2>&1 & pids+=($!)
for _ in $(seq 1 50); do curl -fsS -o /dev/null "$gw:8799/v1/models" 2>/dev/null && break; sleep 0.2; done
curl -fsS -o /dev/null "$gw:8799/v1/models" || { say "the fake upstream did not come up (fake-upstream.log)"; exit 3; }
for _ in $(seq 1 50); do curl -fsS -o /dev/null "$gw:8798/x/v1/models" 2>/dev/null && break; sleep 0.2; done
curl -fsS -o /dev/null "$gw:8798/x/v1/models" || { say "the recording forwarder did not come up (forward.log)"; exit 3; }
jobs=$("${safe_env[@]}" python3 - "$out" "$rules" "$harnesses" "$arms" "$environment" "$materializer" <<'PY'
import json, sys
out, rules, harnesses, arms, environment, materializer = sys.argv[1:7]
sys.path.insert(0, rules)
import rules_wiring as rw
classes = {"claude-code": "RulesClaudeCode", "codex": "RulesCodex", "hermes": "RulesHermes", "openclaw": "RulesOpenClaw", "pi": "RulesPi", "gemini-cli": "RulesGeminiCli"}
model = {"codex": "openai/gpt-6.1-sol", "gemini-cli": "google/gemini-4-carbon"}
names = []
for h in harnesses.split(","):
    for arm in arms.split(","):
        m = model.get(h, "anthropic/claude-opus-5-5")
        if rw.cant_run(h, arm):
            continue
        kw = {"arm": arm}
        if arm != "none":
            files_dir = f"{out}/rules/{h}/{arm}"
            rw.materialize(f"{out}/tasks", h, arm, files_dir, materializer)
            kw["files_dir"] = files_dir
        try:
            rw.resolve(h, kw, m.replace("/", ":", 1))
        except rw.RulesRefused as e:
            print(f"skip {h} {arm}: {e}", file=sys.stderr)
            continue
        name = f"{h}__{arm}"
        job = {"job_name": name, "jobs_dir": f"{out}/jobs", "n_attempts": 1, "n_concurrent_trials": 1, "quiet": True, "retry": {"max_retries": 0},
               "environment": {"import_path": environment, "delete": True}, "verifier": {"disable": True},
               "agents": [{"name": "rules-" + h, "import_path": "agents_rules:" + classes[h], "model_name": m,
                           "kwargs": {"version": rw.PIN["harnesses"][h]["version"], "broker_url": "http://127.0.0.1:8791", "cell": f"map-{h}-{arm}", "attempt": 1, "rules": kw}}],
               "tasks": [{"path": f"{out}/tasks/rs-map-stub-01"}]}
        json.dump(job, open(f"{out}/{name}.json", "w"), indent=2)
        names.append(name)
print(" ".join(names))
PY
) 2>> "$out/delivery-map.log" || { say "writing the jobs failed (delivery-map.log)"; exit 3; }
say "$(printf '%s\n' $jobs | wc -l) job(s), $conc at a time, materializer $materializer"
printf '%s\n' $jobs | xargs -P "$conc" -I{} bash -c 'cd "$1" && "${@:4}" "$2/bin/harbor" run -y -c "$1/$3.json" > "$1/harbor-$3.log" 2>&1 || echo "harbor $3 exited non-zero" >> "$1/delivery-map.log"' _ "$out" "$venv" {} "${safe_env[@]}" "PYTHONPATH=$fh:$rules" PYTHONDONTWRITEBYTECODE=1
say "harbor done; mapping"
"${safe_env[@]}" PYTHONDONTWRITEBYTECODE=1 python3 "$here/delivery_map.py" "$out" "$materializer" | tee -a "$out/delivery-map.log"
