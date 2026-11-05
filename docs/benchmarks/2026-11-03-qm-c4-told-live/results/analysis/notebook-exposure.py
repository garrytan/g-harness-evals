#!/usr/bin/env python3
"""QM's own notebook in the consumer turn: does the last stored UserMessage's
environment carry the task's answer value under "## What you remember"?
The notebook ends where QM's injected "### gbrain" provider block starts, so a
fact the provider delivered is counted under gbrain_block_has_answer, not as
notebook memory.

Reads trials/<cell>/<task>/<rep>/logs/qm-user-messages.jsonl (written by
extract-qm-user-rows.py) and tasks/<set>/<task>/spec.json (the `answer`
predicate's value). Descriptive only; not a preregistered endpoint.

Usage: python3 notebook-exposure.py <results dir> <tasks dir>
"""
import json
import os
import sys

results, tasks = sys.argv[1], sys.argv[2]
trials_dir = os.path.join(results, "trials")
out = {}
for cell in sorted(os.listdir(trials_dir)):
    rows = {}
    for task in sorted(os.listdir(os.path.join(trials_dir, cell))):
        spec = json.load(open(os.path.join(tasks, task, "spec.json")))
        value = next(e["value"] for e in spec["expects"] if e.get("predicate") == "answer")
        family = "continuity" if task.startswith("cn-") else "corrections"
        for rep in sorted(os.listdir(os.path.join(trials_dir, cell, task))):
            path = os.path.join(trials_dir, cell, task, rep, "logs", "qm-user-messages.jsonl")
            msgs = [json.loads(line) for line in open(path) if line.strip()]
            last = max(msgs, key=lambda m: m["created_at"])
            env = last.get("environment") or ""
            remembered = env.split("## What you remember", 1)[1] if "## What you remember" in env else ""
            notebook, _, gbrain_block = remembered.partition("### gbrain")
            fam = rows.setdefault(family, {"trials": 0, "notebook_block": 0, "notebook_has_answer": 0, "gbrain_block_has_answer": 0, "trial_ids_without": []})
            fam["trials"] += 1
            fam["notebook_block"] += bool(notebook)
            fam["gbrain_block_has_answer"] += value in gbrain_block
            if value in notebook:
                fam["notebook_has_answer"] += 1
            else:
                fam["trial_ids_without"].append(f"{task}/{rep}")
    out[cell] = rows

json.dump(out, open(os.path.join(results, "analysis", "notebook-exposure.json"), "w"), indent=2)
for cell, rows in out.items():
    for family, r in rows.items():
        print(f"{cell} {family}: notebook block {r['notebook_block']}/{r['trials']}, answer in notebook {r['notebook_has_answer']}/{r['trials']}, answer in gbrain block {r['gbrain_block_has_answer']}/{r['trials']}")
