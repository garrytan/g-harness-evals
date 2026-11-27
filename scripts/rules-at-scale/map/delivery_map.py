"""Reads a delivery-map.sh run and writes <out>/delivery-map.json and <out>/delivery-map.md.

  python3 scripts/rules-at-scale/map/delivery_map.py <out dir> [<materializer path>]

Per cell (harness x arm, one trial on the stub task): the harness_settings.json rules record (checks, clean-arm probes,
watcher, the repository listing before placing and at launch), the request bodies fake-upstream.ts logged under the
trial's path prefix, and the agent logs. The first request is the first agent-loop request (one that declares a shell tool,
as scripts/frontier-harbor/delivery_smoke.py reads it); the follow-up is the first holding the probe's tool output.
For each planted rule, its state in each of those requests:
  whole    the rule's exact text (without its leading "- ") is in the request
  partial  not whole, but a 32-character window of it is
  absent   neither
  unscorable  no request, or a request that did not decode
"fetched later" (a file read of the rules file before the first edit) needs a model that reads files, so the keyless map
cannot see it; the graders report it from real trials. Byte-identical first requests: each harness's first requests,
with the trial's own names, ids and times replaced, hashed; cells sharing a hash send the same bytes to the model.
"""

from __future__ import annotations

import glob
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent.parent / "frontier-harbor"))

import rules_wiring as rw  # noqa: E402
from delivery_smoke import PROBE_OUTPUT, SHELL_TOOLS, strings, tools_of  # noqa: E402

WINDOW = 32
LOOP_TOOLS = SHELL_TOOLS | {"run_shell_command"}


def declared(body: dict[str, Any]) -> set[str]:
    """Tool names a request declares: delivery_smoke's reading plus Gemini's tools[].functionDeclarations[]."""
    names = set(tools_of(body))
    for t in body.get("tools") or []:
        if isinstance(t, dict):
            names |= {f.get("name") for f in t.get("functionDeclarations") or [] if isinstance(f, dict)}
    return names
RULES_JSON = HERE.parent / "rules.json"
SPEC_RULES = {
    "R1": "- Record every change in a new file under `changes/`, named in kebab-case after what it fixes (for example `changes/fix-date-parsing.md`), with one sentence describing the change.",
    "R2": "- After your last edit, run `./scripts/precheck` and make sure it passes before you finish.",
    "R3": "- Leave existing test files unchanged; put any new tests in a new file.",
    "R4": "- Commit your finished work to the current branch with a sign-off line (`git commit -s`).",
    "R5": "- Before your first edit, look up the module you will change with `./scripts/notes search <module>`.",
    "R6": "- Before you commit, read the whole staged diff with `git diff --staged` (no path filter) and fix anything you did not mean to change.",
}
MARKERS = ("[...truncated", "(truncated ", "Bootstrap truncation warning", "Policy digest", "more policy lines omitted", "Loaded only", "middle is omitted")
VOLATILE = [
    (re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I), "<uuid>"),
    (re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?"), "<time>"),
    (re.compile(r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? [A-Z][a-z]+ \d{1,2},? \d{4}\b"), "<date>"),
    (re.compile(r"\b\d{4}-\d{2}-\d{2}\b"), "<date>"),
    (re.compile(r"\b1[789]\d{8}(\d{3})?(\.\d+)?\b"), "<epoch>"),
    (re.compile(r"<date> \d{1,2}:\d{2}(:\d{2})?\b"), "<date> <clock>"),
    (re.compile(r"map-token-[A-Za-z0-9_.-]+"), "<token>"),
]


def rule_texts() -> dict[str, str]:
    """Lane B's rules.json when present (its strings are the frozen ones), else the spec's strings."""
    if RULES_JSON.is_file():
        data = json.loads(RULES_JSON.read_text())
        items = data.get("rules", data) if isinstance(data, dict) else data
        if isinstance(items, dict):
            return {k: (v["text"] if isinstance(v, dict) else v) for k, v in items.items()}
        return {r["id"]: r["text"] for r in items}
    return dict(SPEC_RULES)


def paths(v: Any, at: str = "$") -> list[tuple[str, str]]:
    """Every string in a decoded body with its JSON path; strings that hold JSON are walked too."""
    if isinstance(v, str):
        try:
            p = json.loads(v)
        except ValueError:
            return [(at, v)]
        return paths(p, at + "<json>") if isinstance(p, (dict, list)) else [(at, v)]
    if isinstance(v, dict):
        return [x for k, y in v.items() for x in paths(y, f"{at}.{k}")]
    if isinstance(v, list):
        return [x for i, y in enumerate(v) for x in paths(y, f"{at}[{i}]")]
    return []


def state(text: str, needle: str) -> str:
    if needle in text:
        return "whole"
    for i in range(0, max(1, len(needle) - WINDOW + 1), 4):
        if needle[i:i + WINDOW] in text:
            return "partial"
    return "absent"


def normalize(raw: str, trial: str) -> str:
    """The trial's own names, ids, times and tokens replaced, and a JSON body's keys sorted (Codex orders its
    client_metadata keys differently from run to run)."""
    try:
        raw = json.dumps(json.loads(raw), sort_keys=True, ensure_ascii=False)
    except ValueError:
        pass
    out = raw.replace(trial, "<trial>")
    for rx, sub in VOLATILE:
        out = rx.sub(sub, out)
    return out


def requests(bodies: list[dict[str, Any]], trial: str) -> list[dict[str, Any]]:
    out = []
    for b in bodies:
        if not b["path"].startswith("/" + trial + "/") or not b.get("body"):
            continue
        try:
            body = json.loads(b["body"])
        except ValueError:
            out.append({"n": b["n"], "path": b["path"], "raw": b["body"], "body": None, "loop": False})
            continue
        out.append({"n": b["n"], "path": b["path"], "raw": b["body"], "body": body, "loop": bool(LOOP_TOOLS & declared(body))})
    return sorted(out, key=lambda r: r["n"])


def read_logs(trial_dir: Path) -> str:
    text = []
    for p in sorted(glob.glob(str(trial_dir / "agent" / "*"))):
        q = Path(p)
        if q.is_file() and q.suffix in (".txt", ".log", "") and q.stat().st_size < 5_000_000:
            text.append(q.read_text(errors="replace"))
    return "\n".join(text)


def map_cell(harness: str, arm: str, trial_dir: Path, bodies: list[dict[str, Any]], texts: dict[str, str], files_dir: Path | None) -> dict[str, Any]:
    trial = trial_dir.name
    settings_p = trial_dir / "agent" / "harness_settings.json"
    settings = json.loads(settings_p.read_text()) if settings_p.exists() else {}
    rec = settings.get("rules") or {}
    result = json.loads((trial_dir / "result.json").read_text()) if (trial_dir / "result.json").exists() else {}
    exc = result.get("exception_info") or {}
    reqs = requests(bodies, trial)
    loop = [r for r in reqs if r["loop"]]
    first = loop[0] if loop else None
    follow = next((r for r in loop[1:] if PROBE_OUTPUT in r["raw"]), None)
    manifest = None
    if files_dir is not None:
        folders = [d for d in files_dir.iterdir() if (d / "manifest.json").is_file()]
        manifest = json.loads((folders[0] / "manifest.json").read_text()) if folders else None
    positions = {r["id"]: {"position": r["position"], "file": r["file"], "byte_offset": r["byte_offset"]} for r in (manifest or {}).get("rules", []) if r["position"] != "hook"}
    hook_file = next((f["path"] for f in (manifest or {}).get("files", []) if f.get("placement") == "hook"), None)
    hook_text = (folders[0] / hook_file).read_text() if hook_file else None
    cell: dict[str, Any] = {
        "trial": trial, "exception": exc.get("exception_type"), "exception_message": (exc.get("exception_message") or "")[:400] or None,
        "installed_version": rec.get("installed_version"), "requests": len(reqs), "agent_loop_requests": len(loop),
        "first_request": None, "follow_up": None, "rules": {},
        "files": [{"path": f["path"], "bytes": f["bytes"], "chars": f["chars"]} for f in (manifest or {}).get("files", [])],
        "checks_ok": all(c.get("ok") for c in rec.get("checks", [])) if rec.get("checks") else None,
        "watcher": rec.get("watcher"), "clean_arm": rec.get("clean_arm"),
        "repo_before": rec.get("repo_before"), "repo_at_launch": rec.get("repo_at_launch"),
        "named_settings": rec.get("named_settings"), "cutlift": rec.get("cutlift"), "hook": (rec.get("hook") or {}).get("mechanism"),
    }
    for key, r in (("first_request", first), ("follow_up", follow)):
        if r is None:
            continue
        flat = "\x00".join(s for _, s in paths(r["body"])) if r["body"] is not None else ""
        cell[key] = {"n": r["n"], "path": r["path"].split("/", 2)[-1], "bytes": len(r["raw"].encode()),
                     "sha256": hashlib.sha256(r["raw"].encode()).hexdigest(),
                     "normalized_sha256": hashlib.sha256(normalize(r["raw"], trial).encode()).hexdigest(),
                     "markers": sorted({m for m in MARKERS if m in flat}),
                     "hook_copies": flat.count(hook_text.strip()) if hook_text else None}
    for rid, full in texts.items():
        needle = full[2:] if full.startswith("- ") else full
        row: dict[str, Any] = {**positions.get(rid, {"position": None})}
        for key, r in (("first_request", first), ("follow_up", follow)):
            if r is None and key == "follow_up":
                row[key] = "none_sent"
                continue
            if r is None or r["body"] is None:
                row[key] = "unscorable"
                continue
            strs = paths(r["body"])
            flat = "\x00".join(s for _, s in strs)
            row[key] = state(flat, needle)
            if key == "first_request":
                row["copies"] = flat.count(needle)
                row["where"] = sorted({p for p, s in strs if needle in s})[:4]
        cell["rules"][rid] = row
    logs = read_logs(trial_dir)
    cell["agent_log_notes"] = sorted({ln.strip()[:300] for ln in logs.splitlines() if re.search(r"Loaded only \d+ of|truncating|bootstrap file \S+ is \d+ chars|context file \S+ truncated", ln)})[:6]
    if harness == "openclaw" and first and first["body"] is not None:
        flat = "\n".join(s for _, s in paths(first["body"]))
        cell["openclaw_reads"] = sorted(set(re.findall(r"^## (\S*AGENTS\.md)\s*$", flat, re.M)))
    if harness == "hermes" and first and first["body"] is not None:
        flat = "\n".join(s for _, s in paths(first["body"]))
        cell["hermes_cut"] = sorted(set(re.findall(r"\[\.\.\.truncated [^\]]{0,200}\]", flat)))[:3]
    return cell


def table(cells: dict[str, dict[str, Any]], groups: dict[str, list[list[str]]]) -> str:
    abbrev = {"whole": "W", "partial": "P", "absent": "-", "unscorable": "?", "none_sent": "n"}
    lines = ["| harness | arm | first request bytes | R1 | R2 | R3 | R4 | R5 | R6 | follow-up (R1..R6) | markers | hook copies | ran |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for key in sorted(cells):
        c = cells[key]
        h, arm = key.split(" ", 1)
        fr = c.get("first_request") or {}
        rs = c.get("rules", {})
        pos = lambda rid: (rs.get(rid, {}).get("position") or "")[:1]
        cols = [f"{abbrev.get(rs.get(r, {}).get('first_request'), '?')}{('/' + pos(r)) if pos(r) else ''}" for r in ("R1", "R2", "R3", "R4", "R5", "R6")]
        fu = "".join(abbrev.get(rs.get(r, {}).get("follow_up"), "?") for r in ("R1", "R2", "R3", "R4", "R5", "R6"))
        ran = "yes" if c.get("exception") is None and fr else (c.get("exception") or "no request")
        lines.append(f"| {h} | {arm} | {fr.get('bytes', '')} | " + " | ".join(cols) + f" | {fu} | {', '.join(fr.get('markers', []))} | {fr.get('hook_copies') if fr.get('hook_copies') is not None else ''} | {ran} |")
    lines += ["", "W whole, P partial, - absent, ? unscorable, n no follow-up request was sent; after the slash, the rule's place in the manifest (t top, m middle, e end, f a folder file, i the imported docs/conventions.md).", "",
              "Cells whose first requests are byte-identical once the trial's own names, ids and times are replaced:", ""]
    for h, gs in sorted(groups.items()):
        same = [g for g in gs if len(g) > 1]
        lines.append(f"- {h}: " + ("; ".join(" = ".join(g) for g in same) if same else "none"))
    return "\n".join(lines) + "\n"


QM_PREDICTED = {
    "status": "predicted from a source read of yc-software/qm 90e4ced7, not captured: the map ran before QM's rules arms were wired, and the QM pilot checks each trial's first request with rules_wiring.qm_soul_delivered",
    "where": f"the SOUL, set by PUT {rw.QM_SOUL_PATH} before the turn and shown in the system prompt under \"{rw.QM_SOUL_HEADING}\"",
    "workspace_rules_file": "none read: QM loads no AGENTS.md or CLAUDE.md from the workspace, so the qm-repo arm's AGENTS.md reaches the model only if it opens the file itself",
    "cells": {
        "none": "QM's default SOUL; no rules",
        "qm-repo": "b8k AGENTS.md in the repository, empty SOUL: predicted absent from the first request",
        "short": "all 6 rules whole under the heading",
        "b8k": "all 6 rules whole under the heading",
        "b28k": "all 6 rules whole under the heading",
        "b80k": "all 6 rules whole under the heading (about 80,000 characters, under the cap)",
        "qm-top": "all 6 rules whole under the heading, at the top of the SOUL",
    },
    "cap": f"{rw.QM_MAX_SOUL_CHARS} characters (MAX_SOUL_CHARS); a longer text fails the trial with HE-RULES-011 and is never cut, so b160k is not offered",
    "not_offered": ["b160k", "split", "hook", "cutlift"],
    "proof": "the captured first agent-loop request shows the text under the heading; the admin reply is not proof",
    "carbon": "Carbon runs on QM only through OpenRouter; no Carbon cell is in QM's arms",
}


def qm_section() -> str:
    q = QM_PREDICTED
    lines = ["", "## QM (predicted, not captured)", "", f"- {q['status']}.", f"- Rules arrive through {q['where']}.", f"- Workspace rules file: {q['workspace_rules_file']}.", f"- Cap: {q['cap']}.", f"- Proof: {q['proof']}.", f"- {q['carbon']}.", ""]
    lines += [f"| qm | {arm} | {what} |" for arm, what in q["cells"].items()]
    lines.insert(len(lines) - len(q["cells"]), "| harness | arm | predicted first request |")
    lines.insert(len(lines) - len(q["cells"]), "|---|---|---|")
    return "\n".join(lines) + "\n"


def main(out: str, materializer: str | None = None) -> int:
    root = Path(out)
    bodies = [json.loads(line) for line in open(root / "fake-upstream-bodies.jsonl")] if (root / "fake-upstream-bodies.jsonl").exists() else []
    texts = rule_texts()
    cells: dict[str, dict[str, Any]] = {}
    for job in sorted(glob.glob(str(root / "jobs" / "*__*"))):
        harness, arm = Path(job).name.split("__", 1)
        trials = [Path(p).parent for p in sorted(glob.glob(job + "/*/config.json"))]
        files_dir = root / "rules" / harness / arm
        cells[f"{harness} {arm}"] = map_cell(harness, arm, trials[0], bodies, texts, files_dir if files_dir.is_dir() else None) if trials else {"exception": "no trial directory"}
    by: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for key, c in cells.items():
        h, arm = key.split(" ", 1)
        if c.get("first_request"):
            by[h][c["first_request"]["normalized_sha256"]].append(arm)
    groups = {h: sorted(v.values()) for h, v in by.items()}
    report = {"schema": "rules-at-scale-delivery-map/1", "materializer": materializer, "pin": rw.PIN["harnesses"],
              "rules": texts, "cells": cells, "byte_identical_first_requests": groups, "qm_predicted": QM_PREDICTED,
              "cant_run": {f"{h} {a}": rw.cant_run(h, a) for h in rw.HARNESSES for a in rw.ARMS if rw.cant_run(h, a) and not a.startswith("qm-")}}
    report["all_ran"] = all(c.get("exception") is None and c.get("first_request") for c in cells.values())
    (root / "delivery-map.json").write_text(json.dumps(report, indent=2) + "\n")
    (root / "delivery-map.md").write_text(table(cells, groups) + qm_section())
    print(json.dumps({"cells": len(cells), "all_ran": report["all_ran"], "failed": sorted(k for k, c in cells.items() if c.get("exception") or not c.get("first_request"))}))
    return 0 if report["all_ran"] else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]) if len(sys.argv) in (2, 3) else __doc__)
