#!/usr/bin/env bash
# Keyless smoke of the delivery arms on repo tasks (internal-task plan, Implementation steps 3 and 4): every harness and arm
# through agents.py on a gstack-native repo task, every model call answered by fake-upstream.ts --tool-call (one shell
# tool call, then a text reply), so each agent sends request 1 and one tool follow-up. No provider key is read or passed.
#
#   bash scripts/frontier-harbor/delivery-smoke.sh <out dir> [--harnesses claude-code,codex,hermes,openclaw,pi]
#       [--arms none,skill,hook,startup,placebo] [--tasks gn-dev-review-01] [--concurrency 2] [--local] [--cards <review card>,<ship card>]
#
# The broker here is a stand-in that hands each class the fake upstream's address directly (/<trial>/<provider>), so a
# request's path names its trial; there is no metering proxy and no lease, and nothing is counted. The task containers run
# on the run's blocklist environment (egress:BlocklistDockerEnvironment, which needs nftables fib inet support): Harbor's
# plain docker environment refuses the separate verifier's no-network policy. --local (a machine without nftables fib inet,
# such as a Capy cloud machine) runs the agent phase only, on the plain docker environment with the verifier off, and
# says so in delivery-smoke.json; the delivery checks need no verifier. The cards default to
# harnesses/routes/gstack-cards/review.md and ship.md (plan step 5); the placebo arm carries harnesses/routes/placebo.md.
# delivery_smoke.py then checks every trial and writes <out>/delivery-smoke.json: health checks passed before the agent
# started; the card (or its placebo) in request 1; on the hook and placebo arms a fresh copy after the tool call in
# the follow-up request; no card bytes on none and skill; no gstack skill file in the container except on skill, where
# review and ship are installed; the /work tree hash at agent start the same across a harness's arms.
# Exit 0 when every check passed, 1 when one failed, 2 usage, 3 setup.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?usage: delivery-smoke.sh <out dir> [--harnesses a,b] [--arms a,b] [--tasks a,b] [--concurrency n] [--local] [--cards a,b]}
shift
harnesses=claude-code,codex,hermes,openclaw,pi arms=none,skill,hook,startup,placebo tasks=gn-dev-review-01 conc=2
environment=egress:BlocklistDockerEnvironment verify=1 cards=harnesses/routes/gstack-cards/review.md,harnesses/routes/gstack-cards/ship.md
while [ $# -gt 0 ]; do
  case "$1" in
    --harnesses) harnesses=$2; shift 2 ;;
    --arms) arms=$2; shift 2 ;;
    --tasks) tasks=$2; shift 2 ;;
    --concurrency) conc=$2; shift 2 ;;
    --local) environment=harbor.environments.docker.docker:DockerEnvironment verify=0; shift ;;
    --cards) cards=$2; shift 2 ;;
    *) echo "delivery-smoke: unknown argument $1" >&2; exit 2 ;;
  esac
done
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY CURSOR_API_KEY
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
venv=${FRONTIER_HARBOR_VENV:-$HOME/.frontier-harbor/venv}
[ -x "$venv/bin/harbor" ] || { echo "delivery-smoke: no Harbor at $venv (set FRONTIER_HARBOR_VENV)" >&2; exit 3; }
mkdir -p "$out"
out=$(cd "$out" && pwd)
say() { printf '%s delivery-smoke: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/delivery-smoke.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
gw=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts repo --src tasks/repo/gstack-native-v1/dev --out "$out" --ids "$tasks") >> "$out/delivery-smoke.log" 2>&1 \
  || { say "materialize.ts repo failed (delivery-smoke.log)"; exit 3; }
rm -f "$out/fake-upstream.jsonl" "$out/fake-upstream-bodies.jsonl" "$out/binds.jsonl"
cat > "$out/broker-stub.ts" <<'TS'
import { appendFileSync } from 'node:fs';
const [listen, upstream, log] = process.argv.slice(2);
const [hostname, port] = listen!.split(':');
Bun.serve({ hostname, port: Number(port), async fetch(req) {
  if (req.method !== 'POST' || new URL(req.url).pathname !== '/bind') return new Response('not found', { status: 404 });
  const b = await req.json() as { trial: string; model: string };
  appendFileSync(log!, JSON.stringify({ at: new Date().toISOString(), ...b }) + '\n');
  return Response.json({ token: 'smoke-token-' + b.trial, base_url: upstream + '/' + b.trial + '/' + b.model.split(':')[0] });
} });
TS
pids=()
cleanup() { for p in "${pids[@]}"; do kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT
("${safe_env[@]}" setsid bun "$here/fake-upstream.ts" --listen "$gw:8799" --log "$out/fake-upstream.jsonl" --bodies "$out/fake-upstream-bodies.jsonl" --tool-call) >> "$out/fake-upstream.log" 2>&1 & pids+=($!)
("${safe_env[@]}" setsid bun "$out/broker-stub.ts" 127.0.0.1:8791 "http://$gw:8799" "$out/binds.jsonl") >> "$out/broker.log" 2>&1 & pids+=($!)
for _ in $(seq 1 50); do curl -fsS -o /dev/null "$gw:8799/v1/models" 2>/dev/null && break; sleep 0.2; done
curl -fsS -o /dev/null "$gw:8799/v1/models" || { say "the fake upstream did not come up (fake-upstream.log)"; exit 3; }
jobs=$("${safe_env[@]}" python3 - "$out" "$here" "$repo" "$harnesses" "$arms" "$tasks" "$environment" "$verify" "$cards" <<'PY'
import json, sys
out, here, repo, harnesses, arms, tasks, environment, verify, cards = sys.argv[1:10]
pin = json.load(open(f"{here}/pin.json"))
kinds = json.load(open(f"{out}/kinds.json"))
classes = {"claude-code": "FrontierClaudeCode", "codex": "FrontierCodex", "hermes": "FrontierHermes", "openclaw": "FrontierOpenClaw", "pi": "FrontierPi"}
model = {"codex": "openai/gpt-6.1-sol"}
review_card, ship_card = cards.split(",")
sys.path.insert(0, here)
import delivery as dl
names = []
for h in harnesses.split(","):
    for arm in arms.split(","):
        if dl.cant_run(h, arm):
            continue
        name = f"{h}__{arm}"
        job = {"job_name": name, "jobs_dir": f"{out}/jobs", "n_attempts": 1, "n_concurrent_trials": 1, "quiet": True, "retry": {"max_retries": 0},
               "environment": {"import_path": environment, "delete": True}, "verifier": {"disable": verify != "1"},
               "agents": [{"name": "frontier-" + h, "import_path": "agents:" + classes[h], "model_name": model.get(h, "anthropic/claude-opus-5-5"),
                           "kwargs": {"version": str(pin["harnesses"][h]["version"]), "broker_url": "http://127.0.0.1:8791", "cell": f"smoke-{h}-{arm}", "attempt": 1,
                                      "delivery": {"arm": arm, "cards": {"review": review_card, "ship": ship_card}, "placebo": "harnesses/routes/placebo.md", "kinds": kinds}}}],
               "tasks": [{"path": f"{out}/tasks/{t}"} for t in tasks.split(",")]}
        json.dump(job, open(f"{out}/{name}.json", "w"), indent=2)
        names.append(name)
print(" ".join(names))
PY
)
say "$(printf '%s\n' $jobs | wc -l) job(s), $conc at a time, environment $environment, verifier $([ "$verify" = 1 ] && echo on || echo off)"
rm -rf "$out/jobs"
printf '%s\n' $jobs | xargs -P "$conc" -I{} bash -c 'cd "$1" && "${@:4}" "$2/bin/harbor" run -y -c "$1/$3.json" > "$1/harbor-$3.log" 2>&1 || echo "harbor $3 exited non-zero" >> "$1/delivery-smoke.log"' _ "$out" "$venv" {} "${safe_env[@]}" "PYTHONPATH=$here" PYTHONDONTWRITEBYTECODE=1
say "harbor done; checking"
"${safe_env[@]}" PYTHONDONTWRITEBYTECODE=1 python3 "$here/delivery_smoke.py" "$out" "$environment" "$verify" | tee -a "$out/delivery-smoke.log"
