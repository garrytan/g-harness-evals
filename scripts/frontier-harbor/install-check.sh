#!/usr/bin/env bash
# The one-VM install check of the frontier Harbor path (internal-task plan, Implementation step 1). Keyless: no provider key
# is read or passed; every model call goes to scripts/frontier-harbor/fake-upstream.ts through the metering proxy.
# Run on a fresh Ubicloud VM after scripts/ubicloud/bootstrap.sh, from the repository root:
#
#   bash scripts/frontier-harbor/install-check.sh <out dir> [--baselines three|all] [--prereg <cells file>]
#
# --prereg runs step 1 (and 1b) on another frontier-harbor/1 file in place of install-check-prereg.json, for example a
# run's own install check with only the harness and model pairs it uses (the gstack delivery run's install-check-harbor.json,
# whose results its shards take as --zdr-gate). Every cell of that file must be a cell of install-check-prereg.json,
# field for field, so it can only drop cells; anything else exits 2 before the check fetches or runs anything.
#
# It checks, and writes <out>/install-check.json (the committed copy is scripts/frontier-harbor/install-check.json):
#   1. agents: vm-run.sh on install-check-prereg.json (each agent class, Claude Code on Opus 5.5 and Fable 5.1, Codex on GPT-6.1 Sol and GPT-6
#      Astra, Hermes, OpenClaw, Pi and mini-swe-agent on Opus 5.5 and GPT-6.1 Sol, Hermes, OpenClaw and Pi on Particle-1
#      through the proxy's Particle route, Pi, Hermes and OpenClaw on DeepSeek V4.1 Flash 1017 through the proxy's
#      OpenRouter route, DeepSeek Harness (dsh) on Opus 5.5, GPT-6.1 Sol, Particle-1 and DeepSeek-V4.1-Flash-1017, Gemini CLI
#      on Gemini 4 Carbon through the proxy's google route, Grok Build, Pi, Hermes and OpenClaw on Grok 4.7 through its xai
#      route (xAI's Responses API), Muse Code on Muse Wonder through its OpenRouter Responses route, Pi, OpenClaw and
#      Hermes on Gemini 4 Carbon and Pi and OpenClaw on Gemini 4 Hydrogen through the proxy's google route (amendment 2 of
#      frontier-shootout-2026-11), and Pi, OpenClaw and Hermes on Muse Wonder and Pi and OpenClaw on GLM 5.3 through its
#      OpenRouter route, GLM pinned to Baidu's fp8 endpoint at the standard tier),
#      one task each, uncounted, fake
#      upstream: every class must install its pinned version, bind its slot, reach the fake model through the proxy and
#      finish its trial. On the OpenRouter route the fake answers with one tool call and refuses a tool-call turn replayed
#      without its reasoning, as DeepSeek does, so an OpenRouter cell passes only when its harness sent the reasoning
#      back on every replayed tool-call turn (the cell's reasoning_replay, from to-trials.ts), unless pin.json declares
#      another verdict for that harness and model (models.<model>.reasoning_replay.<harness>: drops when no replayed turn
#      carried reasoning, partial when some did). A declared verdict must be the one seen, and a declared partial also takes
#      a turn-by-turn full replay, since a field the check sees carried can still be incomplete (OpenClaw sends Gemini's
#      signature with no reasoning text). Any other verdict fails the cell and is named under "reasons". The xai route's
#      fake answers each harness's shell tool with a call after a reasoning item carrying encrypted_content, and an xAI
#      cell is held to the same rule: it passes only when that encrypted reasoning came back on every replayed turn.
#      The google route's fake answers the first declared function with a call carrying a thoughtSignature and refuses a
#      function call replayed without one with Gemini's 400, and a Gemini API cell (Gemini CLI, and since amendment 2 of
#      frontier-shootout-2026-11 Hermes, OpenClaw and Pi on Carbon and Hydrogen) is held to the same rule on that signature.
#   1b. zero data retention: zdr-check.ts reads the agents' captures. The fake upstream answers a Responses request that
#      declares a function or custom tool (in a namespace too, as Codex does) with one call of it and refuses one chained
#      on previous_response_id with OpenAI's zero-data-retention 400, so every OpenAI cell of Codex, Hermes, OpenClaw, Pi and dsh must have sent a tool-output
#      turn with no chained request (zdr.json). mini-swe-agent is left out: it declares no tools, so the fake's text reply
#      ends its trial at the first request and nothing shows how it continues; no counted cell runs it.
#   2. oracle and nop behind the blocklist on three pinned tasks, or with --baselines all on every pinned task (the 52 and
#      the kept sample): oracle passes every one, nop fails every one. The run's baseline gate uses --baselines all once
#      before its first paid trial.
#   3. egress: the egress-probe task's verifier, inside a task container behind the blocklist sidecar, must be refused
#      every blocklisted host (TLS by SNI, HTTP by Host), reach github.com, pypi.org, raw.githubusercontent.com,
#      huggingface.co and the host gateway (where the proxy listens), get a reply the gateway holds back for 30 seconds
#      (gost's 15-second default read timeout would cut it), and records whether a docker socket is present.
#   4. canary: the fake provider key the proxy held appears in no file of the agent run (Harbor jobs, agent logs,
#      captured request bodies), the fake upstream saw it on every forwarded request, and no per-trial token reached it.
#   5. QM: whether QM's Pi loop can run inside a task container (yes or no, with the reason).
# The Cursor cell (cursor-opus) is keyless here too: vm-run.sh writes no Cursor key file under --fake-upstream, so the
# check passes when the trial stopped at agent setup with HE-CURSOR-002, recorded cursor_api_key absent, and ran no agent
# command in its task container (no container_logs_entries check, no cursor_version); nothing contacts Cursor. The keyed
# one-trial smoke is a separate, paid step (scripts/frontier-harbor/README.md "Cursor").
#   6. gstack: gstack-check.sh (the gstack arms of Claude Code, Codex and Hermes, gstack-skill-start's network, and with
#      --baselines all the install facts of every pinned task image), its gstack-check.json under "gstack".
# The agents check needs vm-run.sh to exit 0 and the gstack check needs gstack-check.sh to exit 0, whatever the reports
# say; install-check.json lists every failed check under "reasons".
# Exit 0 when every check passed, 1 when one failed, 2 or 3 for a usage or setup failure.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
usage() { echo "usage: install-check.sh <out dir> [--baselines three|all] [--prereg <cells file>]" >&2; exit 2; }
out=${1:?usage: install-check.sh <out dir> [--baselines three|all] [--prereg <cells file>]}
shift
baselines=three
cells_file=$here/install-check-prereg.json
while [ $# -gt 0 ]; do
  case $1 in
    --baselines) { [ "${2:-}" = three ] || [ "${2:-}" = all ]; } || usage; baselines=$2; shift 2 ;;
    --prereg) [ -f "${2:-}" ] || usage; cells_file=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    *) usage ;;
  esac
done
python3 - "$cells_file" "$here/install-check-prereg.json" <<'PY' || exit 2
import json, os, sys
path, full_path = sys.argv[1], sys.argv[2]
if os.path.realpath(path) == os.path.realpath(full_path): sys.exit(0)
full = json.load(open(full_path))["cells"]
cells = json.load(open(path)).get("cells") or []
bad = [c.get("id") for c in cells if c not in full]
if not cells or bad:
    print(f"install-check: cell {','.join(map(str, bad)) or '(none)'} of {path} is not a cell of install-check-prereg.json; a --prereg file can only drop its cells", file=sys.stderr)
    sys.exit(1)
PY
mkdir -p "$out"
out=$(cd "$out" && pwd)
rm -f "$out/install-check.json"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY CURSOR_API_KEY
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
say "agents: the cells of ${cells_file#"$repo"/}"
set +e
"${safe_env[@]}" bash "$here/vm-run.sh" --prereg "$cells_file" --name install-check --lease-usd 200 --out "$out/agents" \
  --tb21 "$tb21" --fake-upstream --uncounted "install check (keyless, fake upstream)"
agents_rc=$?
set -e
say "agents: vm-run.sh exited $agents_rc"
zdr_cells=$(python3 -c 'import json,sys; print(",".join(c["id"] for c in json.load(open(sys.argv[1]))["cells"] if c["model"].startswith("openai:") and c["harness"] != "mini-swe-agent"))' "$cells_file")
set +e
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/zdr-check.ts --smoke "$out" --prereg "$cells_file" --cells "$zdr_cells" --out "$out/zdr.json") >> "$out/install-check.log" 2>&1
zdr_rc=$?
set -e
say "zdr: zdr-check.ts exited $zdr_rc (cells $zdr_cells)"
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
sed -i -e "s#@PROXY_STATUS_URL@#http://$gw:18790/__proxy/status#" -e "s#@PROXY_SLOW_URL@#http://$gw:18790/__probe/slow#" "$out/probe/tasks/egress-probe/task.toml"
("${safe_env[@]}" setsid bun -e 'Bun.serve({ hostname: process.argv[1], port: 18790, idleTimeout: 120, fetch: async (r) => { if (new URL(r.url).pathname === "/__probe/slow") await Bun.sleep(30000); return Response.json({ ok: true }); } })' "$gw") >> "$out/probe/status-server.log" 2>&1 &
status_pid=$!
job "$out/probe/probe.json" egress-probe "$out/probe/jobs" nop 1 "$out/probe/tasks/egress-probe"
(cd "$out/probe" && "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$out/probe/probe.json") >> "$out/probe/harbor.log" 2>&1 || say "harbor egress-probe exited non-zero (see probe/harbor.log)"
kill "$status_pid" 2>/dev/null || true

# 6. the gstack arms (internal-task): gstack-check.sh, with the image probe when every pinned task's baseline ran
set +e
bash "$here/gstack-check.sh" "$out/gstack" --tb21 "$tb21" --images "$([ "$baselines" = all ] && echo all || echo none)" >> "$out/install-check.log" 2>&1
gstack_rc=$?
say "gstack: gstack-check.sh exited $gstack_rc"
set -e

# 4 and 5. the canary scan, then install-check.json
canary_files=$( [ -s "$out/agents/canary.txt" ] && grep -rlF -f "$out/agents/canary.txt" "$out/agents" --exclude=canary.txt 2>/dev/null | sed "s#^$out/##" || true)
python3 - "$out" "$here/pin.json" "$repo" "$agents_rc" "$canary_files" "$ids" "$gstack_rc" "$cells_file" <<'PY'
import glob, json, os, subprocess, sys
out, pin_path, repo, agents_rc, canary_files = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), [f for f in sys.argv[5].splitlines() if f]
gstack_rc = int(sys.argv[7])
baseline_ids = [t for t in sys.argv[6].split(",") if t]
pin = json.load(open(pin_path))
def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []
def marker(name):
    p = os.path.expanduser("~/.frontier-harbor/venv/" + name)
    return open(p).read() if os.path.exists(p) else None
def replay_seen(a):
    r = a.get("reasoning_replay")
    if not r or r["replaying"] < 1:
        return None
    return "replays" if r["with_reasoning"] == r["replaying"] else "drops" if r["with_reasoning"] == 0 else "partial"
def replay_declared(a):
    return ((pin["models"].get(a.get("model") or "") or {}).get("reasoning_replay") or {}).get(a.get("harness"), "replays")
def replay_checked(a):
    return str(a.get("model") or "").startswith(("openrouter:", "xai:", "google:"))
def replayed(a):
    if not replay_checked(a):
        return True
    seen, declared = replay_seen(a), replay_declared(a)
    return seen == declared or (seen == "replays" and declared == "partial")
def effort_flagged(a):
    return a.get("effort_flag") is not None and not (a.get("keyless_stop") and a["effort_flag"] == "unchecked")
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
                         "reasoning_replay": fr.get("reasoning_replay"),
                         "ran": fr["infra_class"] is None and (t.get("usage") or {}).get("requests", 0) > 0}
    if t["harness"] == "cursor":
        checks = settings.get("install_checks") or {}
        stopped = (t.get("error") or "").startswith("HE-CURSOR-002") and checks.get("cursor_api_key") == "absent" and "container_logs_entries" not in checks and "cursor_version" not in checks
        agents[t["cell"]].update({"expected": "HE-CURSOR-002 at agent setup, no agent command in the task container, nothing sent to Cursor",
                                  "keyless_stop": stopped, "ran": stopped, "error": t.get("error")})
for a in agents.values():
    if replay_checked(a):
        a["replay_verdict"] = {"seen": replay_seen(a), "declared": replay_declared(a)}
planned = [c["id"] for c in json.load(open(sys.argv[8] if len(sys.argv) > 8 else os.path.join(os.path.dirname(pin_path), "install-check-prereg.json")))["cells"]]
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
    "agents": {"vm_run_exit": agents_rc, "cells": agents, "pass": agents_rc == 0 and all(a.get("ran") and not effort_flagged(a) and replayed(a) for a in agents.values())},
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
report["gstack"]["gstack_check_exit"] = gstack_rc
report["zdr"] = json.load(open(f"{out}/zdr.json")) if os.path.exists(f"{out}/zdr.json") else {"pass": False, "note": "zdr-check.ts wrote no zdr.json"}
if gstack_rc != 0:
    report["gstack"]["pass"] = False
reasons = []
if agents_rc != 0:
    reasons.append(f"agents: vm-run.sh exited {agents_rc}")
reasons += [f"agents: cell {c} did not run" for c, a in agents.items() if not a.get("ran")]
reasons += [f"agents: cell {c} has effort flag {a['effort_flag']}" for c, a in agents.items() if a.get("ran") and effort_flagged(a)]
reasons += [f"agents: cell {c} reasoning replay {replay_seen(a) or 'not seen'}, pin.json declares {replay_declared(a)} for {a['harness']} on {a['model']}" for c, a in agents.items() if a.get("ran") and not replayed(a)]
reasons += [f"{k}: failed" for k in ("oracle", "nop", "egress", "canary") if not report[k]["pass"]]
reasons += [f"zdr: cell {c['cell']} {c['status']}: {c.get('note', '')}" for c in report["zdr"].get("cells", []) if c["status"] != "pass"] or ([] if report["zdr"]["pass"] else ["zdr: " + report["zdr"].get("note", "failed")])
if gstack_rc != 0:
    reasons.append(f"gstack: gstack-check.sh exited {gstack_rc}")
if not report["gstack"]["pass"]:
    reasons += ["gstack: " + r for r in report["gstack"].get("reasons") or ([] if gstack_rc != 0 else [report["gstack"].get("note") or "failed"])]
report["reasons"] = reasons
report["pass"] = not reasons and all(report[k]["pass"] for k in ("agents", "oracle", "nop", "egress", "canary", "gstack", "zdr"))
json.dump(report, open(f"{out}/install-check.json", "w"), indent=2)
print(json.dumps({k: report[k]["pass"] for k in ("agents", "oracle", "nop", "egress", "canary", "gstack", "zdr")} | {"pass": report["pass"]}))
sys.exit(0 if report["pass"] else 1)
PY
