"""Checks a delivery-smoke.sh run (internal-task d1, d8, d12) and writes <out>/delivery-smoke.json. No Harbor import.

  python3 delivery_smoke.py <out dir> [<environment import path> <1 if the verifier ran, else 0>]

Per trial (<out>/jobs/<harness>__<arm>/<trial>/, its job config <out>/<harness>__<arm>.json naming the card and placebo
paths): the harness_settings.json delivery record, the trial's result.json and
the request bodies the fake upstream logged under the trial's path prefix (/<trial>/...). A request is an agent-loop
request when it declares a shell tool (fake-upstream.ts SHELL_TOOLS); request 1 is the first of them, the follow-up the
first that holds the probe's tool output. Text is searched in the body's strings joined in document order, so the
wire format's escaping does not matter. A fresh copy on the follow-up is one in the conversation (messages or input)
after the probe's tool call: Claude Code and Codex add their hook context after the call (Codex before the call's
output), Hermes, OpenClaw and Pi append it to the tool result.
"""

from __future__ import annotations

import base64
import glob
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import delivery as dl

SHELL_TOOLS = {"Bash", "bash", "exec_command", "shell", "terminal", "exec"}
PROBE_OUTPUT = "he-delivery-probe-42"
PROBE_COMMAND = "echo he-delivery-probe-$((6*7))"


def strings(v: Any) -> list[str]:
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
        except ValueError:
            return [v]
        return strings(parsed) if isinstance(parsed, (dict, list)) else [v]
    if isinstance(v, dict):
        return [s for x in v.values() for s in strings(x)]
    if isinstance(v, list):
        return [s for x in v for s in strings(x)]
    return []


def flat(body: dict[str, Any]) -> str:
    return "\x00".join(strings(body))


def tools_of(body: dict[str, Any]) -> list[str]:
    """Tool names in body.tools and in Codex's additional_tools input items (namespaces flattened), as fake-upstream.ts declaredTools."""
    def flat(ts: list[Any]) -> list[str]:
        out: list[str] = []
        for t in ts:
            if not isinstance(t, dict):
                continue
            if t.get("type") == "namespace" and isinstance(t.get("tools"), list):
                out += flat(t["tools"])
            else:
                out.append(t.get("name") or (t.get("function") or {}).get("name") or t.get("type"))
        return out
    extra = [t for i in body.get("input") or [] if isinstance(i, dict) and i.get("type") == "additional_tools" for t in i.get("tools") or []]
    return flat(list(body.get("tools") or []) + extra)


def trial_requests(bodies: list[dict[str, Any]], trial: str) -> list[dict[str, Any]]:
    out = []
    for b in bodies:
        if not b["path"].startswith("/" + trial + "/") or not b.get("body"):
            continue
        body = json.loads(b["body"])
        out.append({"n": b["n"], "path": b["path"], "loop": bool(SHELL_TOOLS & set(tools_of(body))), "text": flat(body),
                    "conversation": "\x00".join(strings(body.get("messages") if "messages" in body else body.get("input") or []))})
    return sorted(out, key=lambda r: r["n"])


def check_trial(harness: str, arm: str, delivery: dict[str, Any], trial_dir: Path, bodies: list[dict[str, Any]]) -> dict[str, Any]:
    trial = trial_dir.name
    settings_path = trial_dir / "agent" / "harness_settings.json"
    settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
    rec = settings.get("delivery") or {}
    result = json.loads((trial_dir / "result.json").read_text()) if (trial_dir / "result.json").exists() else {}
    exc = (result.get("exception_info") or {})
    reqs = trial_requests(bodies, trial)
    loop = [r for r in reqs if r["loop"]]
    first = loop[0] if loop else None
    follow = next((r for r in loop if PROBE_OUTPUT in r["text"]), None)
    kind = rec.get("kind") or "review"
    resolved = dl.resolve(harness, delivery)
    card = base64.b64decode(resolved["cards"][kind]["body_b64"]) if kind in resolved["cards"] else b"\x00"
    placebo = base64.b64decode(resolved["placebo"]["body_b64"])
    text = {"hook": card, "startup": card, "placebo": placebo}.get(arm)
    needle = text.decode().strip() if text else None
    c = {
        "trial": trial, "exception": exc.get("exception_type"), "exception_message": (exc.get("exception_message") or "")[:300] or None,
        "requests": len(reqs), "agent_loop_requests": len(loop), "health": rec.get("health", []),
        "health_ok": all(h.get("ok") for h in rec.get("health", [])) and "launch_health" not in rec,
        "launched": "work_tree_sha256_at_launch" in rec, "work_tree_sha256_at_launch": rec.get("work_tree_sha256_at_launch"),
        "work_tree_sha256_setup": rec.get("work_tree_sha256_setup"),
        "gstack_found": {k[len("gstack_found_"):]: v for k, v in rec.items() if k.startswith("gstack_found_")},
        "tool_follow_up_seen": follow is not None, "tirith": rec.get("tirith"),
    }
    if needle:
        c["copies_per_request"] = [r["text"].count(needle) for r in loop]
        c["text_in_request_1"] = bool(first and needle in first["text"])
        if follow and PROBE_COMMAND in follow["conversation"]:
            after = follow["conversation"][follow["conversation"].rindex(PROBE_COMMAND):]
            c["fresh_copy_after_tool_call"] = needle in after
    for name, b in (("card", card), ("placebo", placebo)):
        n = b.decode().strip()
        c[name + "_in_any_request"] = any(n in r["text"] for r in reqs)
    if arm == "skill" and first and kind:
        c["told_in_request_1"] = dl.told(harness, "skill", kind) in first["text"]
    checks = {"no_exception": c["exception"] is None, "health_ok": c["health_ok"], "launched": c["launched"], "reached_upstream": bool(first),
              "tool_follow_up_seen": c["tool_follow_up_seen"]}
    found = c["gstack_found"]
    if arm == "skill":
        checks["gstack_absent_before"] = not found.get("before")
        checks["gstack_review_and_ship_installed"] = all(any(p.endswith("/" + s + "/SKILL.md") for p in found.get("after_install", [])) for s in ("review", "ship"))
        checks["told_in_request_1"] = c.get("told_in_request_1") is True
        checks["no_card_bytes"] = not c.get("card_in_any_request") and not c.get("placebo_in_any_request")
    else:
        checks["gstack_absent"] = not any(found.values())
    if arm == "none":
        checks["no_card_bytes"] = not c.get("card_in_any_request") and not c.get("placebo_in_any_request")
    if arm in ("hook", "startup", "placebo"):
        checks["text_in_request_1"] = c.get("text_in_request_1") is True
    if arm in ("hook", "placebo"):
        checks["fresh_copy_after_tool_call"] = c.get("fresh_copy_after_tool_call") is True
    if arm == "placebo":
        checks["no_card_bytes"] = not c.get("card_in_any_request")
    if arm in ("hook", "startup"):
        checks["no_placebo_bytes"] = not c.get("placebo_in_any_request")
    c["checks"] = checks
    c["pass"] = all(checks.values())
    return c


def main(out: str, environment: str | None = None, verify: str | None = None) -> int:
    root = Path(out)
    bodies = [json.loads(line) for line in open(root / "fake-upstream-bodies.jsonl")] if (root / "fake-upstream-bodies.jsonl").exists() else []
    cells: dict[str, Any] = {}
    hashes: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for job in sorted(glob.glob(str(root / "jobs" / "*__*"))):
        harness, arm = os.path.basename(job).split("__", 1)
        trials = [Path(p).parent for p in sorted(glob.glob(job + "/*/config.json"))]
        delivery = json.loads((root / (os.path.basename(job) + ".json")).read_text())["agents"][0]["kwargs"]["delivery"]
        cells[f"{harness} {arm}"] = [check_trial(harness, arm, delivery, t, bodies) for t in trials] or [{"pass": False, "checks": {"trial_ran": False}}]
        for t in cells[f"{harness} {arm}"]:
            if t.get("work_tree_sha256_at_launch"):
                hashes[harness][t["trial"].rsplit("__", 1)[0]].add(t["work_tree_sha256_at_launch"])
    same = {h: {task: len(v) == 1 for task, v in by.items()} for h, by in hashes.items()}
    report = {"schema": "frontier-harbor-delivery-smoke/1", "environment": environment, "verifier": None if verify is None else verify == "1", "cells": cells, "work_tree_same_across_arms": same,
              "cant_run": {f"{h} {a}": dl.cant_run(h, a) for h in dl.HARNESSES for a in dl.ARMS if dl.cant_run(h, a)}}
    report["pass"] = all(t["pass"] for ts in cells.values() for t in ts) and all(all(v.values()) for v in same.values())
    (root / "delivery-smoke.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: all(t["pass"] for t in v) for k, v in cells.items()} | {"work_tree_same_across_arms": same, "pass": report["pass"]}))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]) if len(sys.argv) in (2, 4) else __doc__)
