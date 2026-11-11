#!/usr/bin/env bash
# The one-VM install check of the frontier Harbor path (internal-task plan, Implementation step 1). Keyless: no provider key
# is read or passed; every model call goes to scripts/frontier-harbor/fake-upstream.ts through the metering proxy.
# Run on a fresh Ubicloud VM after scripts/ubicloud/bootstrap.sh, from the repository root:
#
#   bash scripts/frontier-harbor/install-check.sh <out dir> [--baselines three|all]
#
# It checks, and writes <out>/install-check.json (the committed copy is scripts/frontier-harbor/install-check.json):
#   1. agents: vm-run.sh on install-check-prereg.json (each agent class, Claude Code on Opus 5.5 and Fable 5.1, Codex on GPT-6.1 Sol and GPT-6
#      Astra, Hermes, OpenClaw, Pi and mini-swe-agent on Opus 5.5 and GPT-6.1 Sol), one task each, uncounted, fake
#      upstream: every class must install its pinned version, bind its slot, reach the fake model through the proxy and
#      finish its trial.
#   2. oracle and nop behind the blocklist on three pinned tasks, or with --baselines all on every pinned task (the 52 and
#      the kept sample): oracle passes every one, nop fails every one. The run's baseline gate uses --baselines all once
#      before its first paid trial.
#   3. egress: the egress-probe task's verifier, inside a task container behind the blocklist sidecar, must be refused
#      every blocklisted host (TLS by SNI, HTTP by Host), reach github.com, pypi.org, raw.githubusercontent.com,
#      huggingface.co and the host gateway (where the proxy listens), and records whether a docker socket is present.
#   4. canary: the fake provider key the proxy held appears in no file of the agent run (Harbor jobs, agent logs,
#      captured request bodies), the fake upstream saw it on every forwarded request, and no per-trial token reached it.
#   5. QM: whether QM's Pi loop can run inside a task container (yes or no, with the reason).
#   6. gstack: gstack-check.sh (the gstack arms of Claude Code, Codex and Hermes, gstack-skill-start's network, and with
#      --baselines all the install facts of every pinned task image), its gstack-check.json under "gstack".
# Exit 0 when every check passed, 1 when one failed, 2 or 3 for a usage or setup failure.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?usage: install-check.sh <out dir> [--baselines three|all]}
baselines=three
if [ $# -gt 1 ]; then
  [ "$2" = "--baselines" ] && [ $# -eq 3 ] && { [ "$3" = three ] || [ "$3" = all ]; } || { echo "usage: install-check.sh <out dir> [--baselines three|all]" >&2; exit 2; }
  baselines=$3
fi
mkdir -p "$out"
out=$(cd "$out" && pwd)
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY
venv=${FRONTIER_HARBOR_VENV:-$HOME/.frontier-harbor/venv}
say() { printf '%s install-check: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/install-check.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
read -r tb_repo tb_commit <<< "$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["terminal_bench"]; print(t["repo"], t["commit"])' "$here/pin.json")"
tb21=$HOME/terminal-bench-2-1
if [ "$(git -C "$tb21" rev-parse HEAD 2>/dev/null)" != "$tb_commit" ]; then
  rm -rf "$tb21"
  git clone --quiet --filter=blob:none "$tb_repo" "$tb21" >> "$out/install-check.log" 2>&1
  git -C "$tb21" checkout --quiet "$tb_commit"
fi
say "terminal-bench-2-1 at $(git -C "$tb21" rev-parse HEAD); kernel $(uname -r); $(docker --version)"

# 1. every agent class against the fake upstream
set +e
"${safe_env[@]}" bash "$here/vm-run.sh" --prereg "$here/install-check-prereg.json" --name install-check --lease-usd 200 --out "$out/agents" \
  --tb21 "$tb21" --fake-upstream --uncounted "install check (keyless, fake upstream)"
agents_rc=$?
set -e
say "agents: vm-run.sh exited $agents_rc"
[ -x "$venv/bin/harbor" ] || { say "Harbor is not installed (vm-run.sh failed before installing it)"; exit 3; }

gw=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
harbor_env=("${safe_env[@]}" "PYTHONPATH=$here")
job() {
  python3 - "$@" <<'PY'
import json, sys
path, name, jobs, agent, conc, tasks = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), sys.argv[6:]
json.dump({"job_name": name, "jobs_dir": jobs, "n_attempts": 1, "n_concurrent_trials": conc, "quiet": True, "retry": {"max_retries": 0},
           "environment": {"import_path": "egress:BlocklistDockerEnvironment", "delete": True},
           "agents": [{"name": agent}], "tasks": [{"path": t} for t in tasks]}, open(path, "w"), indent=2)
PY
}

# 2. oracle and nop on three pinned tasks, or on every pinned task with --baselines all
if [ "$baselines" = all ]; then
  ids=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); print(",".join(list(p["task_selection"]["tasks"]) + list(p["kept_selection"]["tasks"])))' "$here/pin.json")
  conc=8
else
  ids="nginx-request-logging,cobol-modernization,configure-git-webserver"
  conc=3
fi
say "baselines: oracle and nop on $(printf '%s' "$ids" | tr ',' '\n' | grep -c .) task(s), $conc at a time"
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts tb21 --src "$tb21" --out "$out/baselines" --ids "$ids") >> "$out/install-check.log" 2>&1
for agent in oracle nop; do
  job "$out/baselines/$agent.json" "$agent" "$out/baselines/jobs" "$agent" "$conc" $(for t in ${ids//,/ }; do printf '%s ' "$out/baselines/tasks/$t"; done)
  (cd "$out/baselines" && "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$out/baselines/$agent.json") >> "$out/baselines/harbor.log" 2>&1 || say "harbor $agent exited non-zero (see baselines/harbor.log)"
done

# 3. the egress probe, with a stand-in status endpoint on the gateway port pattern the proxy uses
mkdir -p "$out/probe/tasks"
rm -rf "$out/probe/tasks/egress-probe"
cp -r "$here/egress-probe" "$out/probe/tasks/egress-probe"
sed -i "s#@PROXY_STATUS_URL@#http://$gw:18790/__proxy/status#" "$out/probe/tasks/egress-probe/task.toml"
("${safe_env[@]}" setsid bun -e 'Bun.serve({ hostname: process.argv[1], port: 18790, fetch: () => Response.json({ ok: true }) })' "$gw") >> "$out/probe/status-server.log" 2>&1 &
status_pid=$!
job "$out/probe/probe.json" egress-probe "$out/probe/jobs" nop 1 "$out/probe/tasks/egress-probe"
(cd "$out/probe" && "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$out/probe/probe.json") >> "$out/probe/harbor.log" 2>&1 || say "harbor egress-probe exited non-zero (see probe/harbor.log)"
kill "$status_pid" 2>/dev/null || true

# 6. the gstack arms (internal-task): gstack-check.sh, with the image probe when every pinned task's baseline ran
set +e
bash "$here/gstack-check.sh" "$out/gstack" --tb21 "$tb21" --images "$([ "$baselines" = all ] && echo all || echo none)" >> "$out/install-check.log" 2>&1
say "gstack: gstack-check.sh exited $?"
set -e

# 4 and 5. the canary scan, then install-check.json
canary_files=$( [ -s "$out/agents/canary.txt" ] && grep -rlF -f "$out/agents/canary.txt" "$out/agents" --exclude=canary.txt 2>/dev/null | sed "s#^$out/##" || true)
python3 - "$out" "$here/pin.json" "$repo" "$agents_rc" "$canary_files" "$ids" <<'PY'
import glob, json, os, subprocess, sys
out, pin_path, repo, agents_rc, canary_files = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), [f for f in sys.argv[5].splitlines() if f]
baseline_ids = [t for t in sys.argv[6].split(",") if t]
pin = json.load(open(pin_path))
def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []
def marker(name):
    p = os.path.expanduser("~/.frontier-harbor/venv/" + name)
    return open(p).read() if os.path.exists(p) else None
def rewards(jobs, job):
    res = {}
    for r in glob.glob(f"{jobs}/{job}/*/result.json"):
        d = json.load(open(r))
        task = os.path.basename(os.path.dirname(r)).split("__")[0]
        v = (d.get("verifier_result") or {}).get("rewards") or {}
        res[task] = {"reward": v.get("reward", next(iter(v.values()), None)), "exception": (d.get("exception_info") or {}).get("exception_type")}
    return res
trials = jl(f"{out}/agents/trials.jsonl")
agents = {}
for t in trials:
    fr = t["frontier"]
    settings_path = glob.glob(f"{out}/agents/{t['paths']['trial_dir']}/harbor/agent/harness_settings.json")
    settings = json.load(open(settings_path[0])) if settings_path else {}
    agents[t["cell"]] = {"harness": t["harness"], "model": t["model"], "termination": t["termination"], "infra_class": fr["infra_class"],
                         "exception": fr["exception"], "reward": fr["reward"], "requests_forwarded": (t.get("usage") or {}).get("requests", 0),
                         "requests_refused": (t.get("usage") or {}).get("refused", 0), "efforts_requested": fr["efforts_requested"], "efforts_sent": fr["efforts_sent"],
                         "efforts_agent_loop": fr.get("efforts_agent_loop"), "effort_flag": fr.get("effort_flag"),
                         "install_checks": settings.get("install_checks"), "harness_version": settings.get("harness_version"),
                         "ran": fr["infra_class"] is None and (t.get("usage") or {}).get("requests", 0) > 0}
planned = [c["id"] for c in json.load(open(os.path.join(os.path.dirname(pin_path), "install-check-prereg.json")))["cells"]]
for c in planned:
    agents.setdefault(c, {"ran": False, "termination": None, "note": "no trial record"})
upstream = jl(f"{out}/agents/fake-upstream.jsonl")
posts = [u for u in upstream if u["method"] == "POST"]
bodies = open(f"{out}/agents/fake-upstream-bodies.jsonl").read() if os.path.exists(f"{out}/agents/fake-upstream-bodies.jsonl") else ""
oracle, nop = rewards(f"{out}/baselines/jobs", "oracle"), rewards(f"{out}/baselines/jobs", "nop")
probe_files = glob.glob(f"{out}/probe/jobs/egress-probe/*/verifier/probe.json")
probe = json.load(open(probe_files[0])) if probe_files else None
canary = {"files_with_canary": canary_files, "upstream_requests": len(posts),
          "upstream_saw_canary_on_every_request": bool(posts) and all(u["credential_is_canary"] for u in posts),
          "per_trial_tokens_in_upstream_bodies": bodies.count("trial-token:")}
canary["pass"] = not canary_files and canary["upstream_saw_canary_on_every_request"] and canary["per_trial_tokens_in_upstream_bodies"] == 0
qm_socket = probe.get("docker_socket_in_task_container") if probe else None
report = {
    "schema": "frontier-harbor-install-check/1",
    "checked_at": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
    "repo_commit": subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip(),
    "machine": {"kernel": os.uname().release, "docker": subprocess.run(["docker", "--version"], capture_output=True, text=True).stdout.strip()},
    "harbor": {"version": pin["harbor"]["version"], "wheel_sha256": pin["harbor"]["wheel_sha256"], "installed_from_pinned_wheel": marker(".wheel-sha256") == pin["harbor"]["wheel_sha256"],
               "dependencies": pin["harbor"]["dependencies"]["file"], "dependencies_sha256": pin["harbor"]["dependencies"]["sha256"], "installed_from_hashed_lock": marker(".lock-sha256") == pin["harbor"]["dependencies"]["sha256"],
               "python": subprocess.run([os.path.expanduser("~/.frontier-harbor/venv/bin/python"), "--version"], capture_output=True, text=True).stdout.strip() or None},
    "terminal_bench_2_1": pin["terminal_bench"]["commit"],
    "agents": {"vm_run_exit": agents_rc, "cells": agents, "pass": all(a.get("ran") and a.get("effort_flag") is None for a in agents.values())},
    "oracle": {"tasks": oracle, "planned": len(baseline_ids), "pass": sorted(oracle) == sorted(baseline_ids) and all(v["reward"] == 1 for v in oracle.values())},
    "nop": {"tasks": nop, "planned": len(baseline_ids), "pass": sorted(nop) == sorted(baseline_ids) and all(v["reward"] == 0 for v in nop.values())},
    "egress": {"probe": probe, "pass": bool(probe and probe.get("pass"))},
    "canary": canary,
    "qm": {"loop_runs_in_task_container": "no",
           "reason": "QM's Pi loop runs inside QM core, a service that needs Postgres beside it, and its tool calls run in sandbox containers core starts through the host Docker socket (harnesses/qm/pin.json sandbox_backend: local, one container per scope from Dockerfile.sandbox). A Harbor installed agent runs inside the task's own container, which the verifier grades; the task container has no Docker socket (docker_socket_in_task_container below), so QM's commands could not reach the task's files there. A QM cell needs its own topology (core and Postgres as sidecars, QM's sandbox replaced by the task container), not an installed-agent class.",
           "docker_socket_in_task_container": qm_socket},
    "licences": pin["licences"],
}
gstack_path = f"{out}/gstack/gstack-check.json"
report["gstack"] = json.load(open(gstack_path)) if os.path.exists(gstack_path) else {"pass": False, "note": "gstack-check.sh wrote no gstack-check.json"}
report["pass"] = all(report[k]["pass"] for k in ("agents", "oracle", "nop", "egress", "canary", "gstack"))
json.dump(report, open(f"{out}/install-check.json", "w"), indent=2)
print(json.dumps({k: report[k]["pass"] for k in ("agents", "oracle", "nop", "egress", "canary", "gstack")} | {"pass": report["pass"]}))
sys.exit(0 if report["pass"] else 1)
PY
