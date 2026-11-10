#!/usr/bin/env python3
"""Summarise the QM exposure pilot (uncounted, edition arm). Grades nothing."""
import json, pathlib

here = pathlib.Path(__file__).resolve().parent
turns = [json.loads(l) for l in (here / "turns.jsonl").read_text().splitlines() if l.strip()]
plain = {}
for l in (here.parent / "headroom" / "turns.jsonl").read_text().splitlines():
    if l.strip():
        t = json.loads(l)
        plain[(t["task_id"], t["model"])] = t["usage"]["usd"]

rows = []
for t in sorted(turns, key=lambda t: t["trial_id"]):
    c = t["counts"]
    detail = json.loads((here / "trials" / t["trial_id"] / "trial.json").read_text())["detail"]
    cd = detail["count_detail"]
    rows.append({
        "trial_id": t["trial_id"],
        "task_id": t["task_id"],
        "model": t["model"],
        "status": t["status"],
        "index_listed": all(v["listed"] and v["description_intact"] for v in detail["evidence"]["index_lines"].values()),
        "open_matched": c["open_matched"],
        "complete_read": c["complete_read"],
        "first_step": c["first_step"],
        "first_step_anywhere": cd["first_step_anywhere"],
        "approvals_answered": c["approvals_answered"],
        "contaminated": c["contaminated"],
        "other_skill_reads": cd["other_skill_reads"],
        "usd": t["usage"]["usd"],
        "plain_usd": plain[(t["task_id"], t["model"])],
        "wall_s": t["wall_s"],
    })

def mult(rs):
    return sum(r["usd"] for r in rs) / sum(r["plain_usd"] for r in rs)

summary = {
    "stage": "exposure pilot (uncounted)",
    "trials": len(rows),
    "pass_rule": {
        "no_trial_contaminated": not any(r["contaminated"] for r in rows),
        "at_least_one_matched_open_and_complete_read": any(r["open_matched"] and r["complete_read"] for r in rows),
    },
    "cost_note": "The edition and plain cost sums are in ../spend-internal.md, an internal file kept out of the public copy.",
    "cost_multiplier": round(mult(rows), 3),
    "cost_multiplier_by_model": {m: round(mult([r for r in rows if r["model"] == m]), 3) for m in sorted({r["model"] for r in rows})},
    "rows": rows,
}
summary["pass_rule"]["holds"] = all(summary["pass_rule"].values())
(here / "pilot-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
with open(here / "replies.jsonl", "w") as f:
    for t in sorted(turns, key=lambda t: t["trial_id"]):
        f.write(json.dumps({k: t[k] for k in ("trial_id", "task_id", "family", "model", "arm", "reply_text")}) + "\n")
print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, indent=2))
