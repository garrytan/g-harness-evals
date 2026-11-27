"""The report of qm-install-check.sh (internal-task): reads the keyless QM install check's run and writes install-check-qm.json.

python3 qm-install-report.py <out> <scripts/frontier-harbor> <repo> <vm-run exit> <zdr exit> <web-tools exit> <canary files>
Exit 0 when every check passed, 1 otherwise. qm-install-check.sh's header says what each check is.
"""

import glob
import json
import os
import re
import subprocess
import sys

out, here, repo = sys.argv[1], sys.argv[2], sys.argv[3]
agents_rc, zdr_rc, web_rc = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
canary_files = [f for f in sys.argv[7].splitlines() if f]
pin = json.load(open(f"{here}/pin.json"))
cells = json.load(open(f"{here}/install-check-qm-prereg.json"))["cells"]
SHIM_CALLS = {"version", "image inspect", "inspect", "volume inspect", "volume create", "volume rm", "network inspect", "network create", "run", "start", "stop", "rm", "port", "ps"}
LEAK_SHAPE = re.compile(r"trial-token:[A-Za-z0-9._-]+\.[0-9a-f]{32}")


def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []


def read(p):
    return open(p, errors="replace").read() if p and os.path.exists(p) else ""


def replay_seen(r):
    if not r or r["replaying"] < 1:
        return None
    return "replays" if r["with_reasoning"] == r["replaying"] else "drops" if r["with_reasoning"] == 0 else "partial"


report_cells, reasons = {}, []
trials = {t["cell"]: t for t in jl(f"{out}/agents/trials.jsonl")}
for c in cells:
    t = trials.get(c["id"])
    if not t:
        report_cells[c["id"]] = {"ran": False, "note": "no trial record"}
        reasons.append(f"cell {c['id']}: no trial record")
        continue
    fr = t["frontier"]
    found = glob.glob(f"{out}/agents/{t['paths']['trial_dir']}/harbor/agent")
    agent_dir = found[0] if found else ""
    settings = json.loads(read(f"{agent_dir}/harness_settings.json") or "{}")
    checks = settings.get("install_checks") or {}
    turn = json.loads(read(f"{agent_dir}/qm-turn.json") or "{}").get("status") or {}
    admin = checks.get("qm_admin") or {}
    shim = checks.get("qm_shim_calls") or []
    provisioned = checks.get("qm_provisioned") or []
    replay = fr.get("reasoning_replay")
    declared = (pin["models"][c["model"]].get("reasoning_replay") or {}).get("qm", "replays") if c["model"].startswith("openrouter:") else None
    row = {"model": c["model"], "infra_class": fr["infra_class"], "exception": fr["exception"], "requests_forwarded": (t.get("usage") or {}).get("requests", 0),
           "efforts_agent_loop": fr.get("efforts_agent_loop"), "effort_flag": fr.get("effort_flag"), "turn": turn,
           "admin": {k: v.get("http") for k, v in admin.items()}, "shim_calls": shim, "provisioned": provisioned,
           "node": checks.get("node"), "task_uid": checks.get("task_uid"), "task_workdir": checks.get("task_workdir"),
           "daemon_sha256": checks.get("qm_daemon_sha256"), "network": checks.get("qm_network"),
           "core_ready_after_s": checks.get("qm_core_ready_after_s"), "tokens_in_core_log": len(LEAK_SHAPE.findall(read(f"{agent_dir}/qm-core.log")))}
    if declared:
        row.update({"replay_verdict": {"seen": replay_seen(replay), "declared": declared}, "reasoning_replay": replay})
    why = []
    if fr["infra_class"] is not None or row["requests_forwarded"] < 1:
        why.append(f"did not run (infra_class {fr['infra_class']}, {row['requests_forwarded']} requests)")
    if fr.get("effort_flag") is not None:
        why.append(f"effort flag {fr['effort_flag']}")
    if not turn.get("finished"):
        why.append(f"turn not finished ({turn.get('status')})")
    if not admin or "sandbox_default" not in admin or any(v.get("http") not in (200, 201, 204) for v in admin.values()):
        why.append("admin calls not all 2xx")
    if "creds-dir" not in provisioned or not any(p.startswith("link /root/") for p in provisioned):
        why.append("QM's provisioning did not run in the task container")
    if not shim or set(shim) - SHIM_CALLS:
        why.append(f"docker calls the shim does not answer: {sorted(set(shim) - SHIM_CALLS)}")
    if row["tokens_in_core_log"]:
        why.append("a per-trial token is in qm-core.log")
    if declared and replay_seen(replay) != declared:
        why.append(f"reasoning replay {replay_seen(replay) or 'not seen'}, pin.json declares {declared}")
    row["ran"] = not why
    report_cells[c["id"]] = row
    reasons += [f"cell {c['id']}: {w}" for w in why]
posts = [u for u in jl(f"{out}/agents/fake-upstream.jsonl") if u["method"] == "POST"]
bodies = read(f"{out}/agents/fake-upstream-bodies.jsonl")
canary = {"files_with_canary": canary_files, "upstream_requests": len(posts),
          "upstream_saw_canary_on_every_request": bool(posts) and all(u["credential_is_canary"] for u in posts),
          "per_trial_tokens_in_upstream_bodies": bodies.count("trial-token:")}
canary["pass"] = not canary_files and canary["upstream_saw_canary_on_every_request"] and canary["per_trial_tokens_in_upstream_bodies"] == 0
zdr = json.loads(read(f"{out}/zdr.json") or '{"pass": false, "note": "zdr-check.ts wrote no zdr.json"}')
web = json.loads(read(f"{out}/web-tools.json") or '{"note": "web-tools-check.ts wrote no web-tools.json"}')
if agents_rc != 0:
    reasons.append(f"agents: vm-run.sh exited {agents_rc}")
if zdr_rc != 0 or not zdr.get("pass"):
    reasons.append(f"zdr: zdr-check.ts exited {zdr_rc}")
if web_rc != 0:
    reasons.append(f"web tools: web-tools-check.ts exited {web_rc}")
if not canary["pass"]:
    reasons.append("canary: failed")
report = {
    "schema": "frontier-harbor-install-check-qm/1",
    "checked_at": subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip(),
    "repo_commit": subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip(),
    "machine": {"kernel": os.uname().release, "docker": subprocess.run(["docker", "--version"], capture_output=True, text=True).stdout.strip()},
    "harbor": pin["harbor"]["version"], "qm": {"version": pin["harnesses"]["qm"]["version"], "commit": pin["harnesses"]["qm"]["commit"]},
    "terminal_bench_2_1": pin["terminal_bench"]["commit"],
    "agents": {"vm_run_exit": agents_rc, "cells": report_cells}, "zdr": zdr, "web_tools": web, "canary": canary,
    "reasons": reasons, "pass": not reasons,
}
json.dump(report, open(f"{out}/install-check-qm.json", "w"), indent=2)
print(json.dumps({"pass": report["pass"], "reasons": reasons}))
sys.exit(0 if report["pass"] else 1)
