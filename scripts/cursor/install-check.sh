#!/usr/bin/env bash
# Keyless install check and one-trial offline smoke of the Cursor CLI harness (harnesses/cursor/README.md). It needs no
# key and sends nothing to Cursor: every key variable is unset first, and the smoke's container gets a random canary as
# CURSOR_API_KEY behind an egress allowlist that admits no host.
#
#   bash scripts/cursor/install-check.sh [--out <dir>] [--task <v0.1 dev task id>] [--no-smoke]
#
# In order, each a line "ok <step> ..." or "FAIL <step> ..." on stdout:
#   1. selfcheck  bun scripts/cursor/key-scan.ts selfcheck: CURSOR_API_KEY is in the public export's KEY_NAMES and in every
#                 keyless list (the D1 check)
#   2. pins       harnesses/cursor/Dockerfile's version and sha256 arguments are pin.json's
#   3. image      docker build -t harness-eval/cursor:dev harnesses/cursor (the build checks the package and launcher
#                 sha256 and agent --version), then agent --version inside the image is pin.json's version
#   4. smoke      a scratch preregistration with one Cursor cell on one dev task (one repetition, network internal),
#                 runner plan, preflight --cells and run --cursor-offline: the world, the container, the adapter's
#                 refusals and instruction-file check, the CLI up to its first CONNECT to Cursor, which the allowlist
#                 denies and logs, and the scan for the canary afterwards (cursor-offline.json must say ok)
# Results go to --out (default ${TMPDIR:-/tmp}/cursor-install-check-<UTC stamp>): install-check.json, and smoke/ with
# the scratch run (manifest, trials.jsonl, egress.ndjson, cursor-offline.json, trial logs).
# Exit 0 when every step passed, 1 when one failed, 2 for a usage error. The step that needs the key, a real turn
# against Cursor's backend, is the shard's own smoke (scripts/run-shard.sh with CURSOR_API_KEY set).
set -uo pipefail
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY CURSOR_API_KEY
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
cd "$root"
export PATH="$HOME/.bun/bin:$PATH"
# A fresh VM session may not hold the docker group yet (bootstrap.sh's usermod); re-enter with it, as vm-shard.sh does.
if [ -z "${HE_CURSOR_CHECK_IN_DOCKER_GROUP:-}" ] && getent group docker >/dev/null && ! id -nG | grep -qw docker && id -nG "${USER:-}" 2>/dev/null | grep -qw docker; then
  export HE_CURSOR_CHECK_IN_DOCKER_GROUP=1
  exec sg docker -c "bash $(printf %q "$0") $(printf '%q ' "$@")"
fi

out="" task="" smoke=1
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --task) task=$2; shift 2 ;;
    --no-smoke) smoke=0; shift ;;
    -h|--help) sed -n '2,/^set -uo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    *) echo "install-check (cursor): unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done
out=${out:-${TMPDIR:-/tmp}/cursor-install-check-$(date -u +%Y%m%dT%H%M%SZ)}
mkdir -p "$out" && out=$(cd "$out" && pwd) || { echo "install-check (cursor): --out $out cannot be created" >&2; exit 2; }
[ -d node_modules ] || bun install --frozen-lockfile > "$out/bun-install.log" 2>&1 || { echo "FAIL deps bun install --frozen-lockfile (see $out/bun-install.log)"; exit 1; }

steps=()
failed=0
record() { steps+=("$(python3 -c 'import json,sys; print(json.dumps({"step": sys.argv[1], "ok": sys.argv[2] == "1", "detail": sys.argv[3]}))' "$1" "$2" "$3")"); }
ok() { echo "ok $1 $2"; record "$1" 1 "$2"; }
fail() { echo "FAIL $1 $2"; failed=1; record "$1" 0 "$2"; }
finish() {
  printf '%s\n' "${steps[@]}" | python3 -c 'import json,sys; s=[json.loads(l) for l in sys.stdin if l.strip()]; json.dump({"harness": "cursor", "keyless": True, "ok": all(x["ok"] for x in s), "steps": s}, open(sys.argv[1], "w"), indent=1)' "$out/install-check.json"
  echo "install-check (cursor): $([ "$failed" -eq 0 ] && echo ok || echo FAILED); $out/install-check.json"
  exit "$failed"
}

# 1. the D1 key-list check
if line=$(bun scripts/cursor/key-scan.ts selfcheck 2>&1); then ok selfcheck "$line"; else fail selfcheck "$(printf '%s' "$line" | tr '\n' ';')"; fi

# 2. the Dockerfile's arguments against pin.json
pins=$(python3 - <<'PY'
import json, re
pin = json.load(open('harnesses/cursor/pin.json'))
df = open('harnesses/cursor/Dockerfile').read()
arg = lambda n: (re.search(r'^ARG ' + n + r'=(\S+)$', df, re.M) or [None, None])[1]
want = {'CURSOR_AGENT_VERSION': pin['version'], 'CURSOR_AGENT_SHA256': pin['integrity']['package_sha256'], 'CURSOR_LAUNCHER_SHA256': pin['integrity']['launcher_sha256']}
bad = [f'{k}={arg(k)} but pin.json says {v}' for k, v in want.items() if arg(k) != v]
print('; '.join(bad) if bad else 'Dockerfile version ' + pin['version'] + ', package and launcher sha256 match pin.json')
raise SystemExit(1 if bad else 0)
PY
) && ok pins "$pins" || fail pins "$pins"
version=$(python3 -c 'import json; print(json.load(open("harnesses/cursor/pin.json"))["version"])')

# 3. the image
if docker build -q -t harness-eval/cursor:dev harnesses/cursor > "$out/build-cursor.log" 2>&1; then
  got=$(docker run --rm --network none --entrypoint agent -e HOME=/tmp harness-eval/cursor:dev --version 2>/dev/null)
  if [ "$got" = "$version" ]; then ok image "harness-eval/cursor:dev $(docker image inspect -f '{{.Id}}' harness-eval/cursor:dev | cut -c1-19), agent --version $got"; else fail image "agent --version in the image is '$got', pin.json says $version"; fi
else
  fail image "docker build failed; last lines of $out/build-cursor.log: $(tail -3 "$out/build-cursor.log" | tr '\n' ' ')"
  finish
fi
[ "$smoke" -eq 1 ] || finish

# 4. the offline one-trial smoke through the runner
run_id="cursor-install-check-$(date -u +%Y%m%dt%H%M%Sz)"
mkdir -p "$out/smoke"
python3 - "$out/smoke/prereg.json" "$run_id" "$task" <<'PY' || { fail smoke "the scratch preregistration could not be written"; finish; }
import json, os, sys
out, run_id, task = sys.argv[1:]
tasks = sorted(d for d in os.listdir('tasks/multiuser/dev') if os.path.isdir(os.path.join('tasks/multiuser/dev', d)))
task = task or tasks[0]
if task not in tasks: sys.exit(f'--task {task} is not a v0.1 dev task')
cell = {'id': 'cursor-opus-offline', 'harness': 'cursor', 'model': 'anthropic:claude-opus-5-5', 'slice': 'multiuser', 'split': 'dev', 'tasks': [task], 'repetitions': 1, 'ceiling': {'input_tokens': 80000, 'output_tokens': 6000}, 'network': 'internal'}
json.dump({'schema_version': 1, 'run_id': run_id, 'question': 'UNCOUNTED keyless install check of the Cursor harness: one offline trial with a canary key and no egress host. Never cited as a result.',
           'tasks': {}, 'cells': [cell], 'wall_clock_s': {'multiuser': 900}, 'spend_cap_usd': 0.01, 'drop_order': [], 'minimum_v01': []}, open(out, 'w'), indent=1)
PY
run_dir="$out/smoke/run"
if ! bun runner/run.ts plan --prereg "$out/smoke/prereg.json" --out "$run_dir" > "$out/smoke/plan.log" 2>&1; then fail smoke "plan failed: $(tail -2 "$out/smoke/plan.log" | tr '\n' ' ')"; finish; fi
if ! bun runner/run.ts preflight --manifest "$run_dir/manifest.json" --cells cursor-opus-offline > "$out/smoke/preflight.log" 2>&1; then fail smoke "preflight failed: $(tail -3 "$out/smoke/preflight.log" | tr '\n' ' ')"; finish; fi
bun runner/run.ts run --manifest "$run_dir/manifest.json" --cells cursor-opus-offline --cursor-offline > "$out/smoke/run.stdout.log" 2>&1
rc=$?
verdict=$(python3 - "$run_dir" "$rc" <<'PY'
import json, os, sys
d, rc = sys.argv[1], int(sys.argv[2])
rows = [json.loads(l) for l in open(os.path.join(d, 'trials.jsonl')) if l.strip()] if os.path.exists(os.path.join(d, 'trials.jsonl')) else []
off = json.load(open(os.path.join(d, 'cursor-offline.json'))) if os.path.exists(os.path.join(d, 'cursor-offline.json')) else None
t = off['trials'][0] if off and off.get('trials') else {}
r = rows[0] if rows else {}
desc = f"run exit {rc}; trial termination={r.get('termination')} turns_run={(r.get('turns') or {}).get('run')}; egress denied {t.get('denied', 0)} ({', '.join(t.get('denied_hosts', [])) or 'none'}); canary in trial dir: {'yes' if t.get('key_found') else 'no'}"
good = rc == 0 and bool(rows) and bool(off and off.get('ok'))
print(desc); sys.exit(0 if good else 1)
PY
) && ok smoke "$verdict; $run_dir" || fail smoke "$verdict; see $out/smoke/run.stdout.log and $run_dir/cursor-offline.json"
finish
