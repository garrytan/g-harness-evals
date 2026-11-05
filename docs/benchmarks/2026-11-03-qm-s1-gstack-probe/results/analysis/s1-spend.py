#!/usr/bin/env python3
"""S1 spend by cell, model and housekeeping model (turns.jsonl usage), and VM
minutes at list price from vms.jsonl (up to down, rounded up to the minute;
the rate and IPv4 basis of scripts/ubicloud/run-shard.sh, as in C4's shard-vm.json).

Usage: python3 s1-spend.py <results dir>
"""
import collections
import json
import math
import os
import sys
from datetime import datetime

RATE_USD_PER_MIN = 0.00831
IPV4_USD_PER_MIN = 6.944e-05

results = sys.argv[1]
rows = [json.loads(line) for line in open(os.path.join(results, "turns.jsonl")) if line.strip()]
cells = collections.defaultdict(lambda: {"turns": 0, "usd": 0.0, "requests": 0})
models = collections.defaultdict(lambda: {"usd": 0.0, "requests": 0})
housekeeping = collections.defaultdict(lambda: {"usd": 0.0, "requests": 0})
for r in rows:
    model = "opus" if "opus" in r["model"] else "sol"
    c = cells[f"{model}/{r['arm']}"]
    c["turns"] += 1
    c["usd"] += r["usage"]["usd"]
    c["requests"] += r["usage"]["requests"]
    for name, m in r["usage"]["by_model"].items():
        models[name]["usd"] += m["usd"]
        models[name]["requests"] += m["requests"]
    h = r["housekeeping"]
    housekeeping[h["model"]]["usd"] += h["usd"]
    housekeeping[h["model"]]["requests"] += h["requests"]

vms = {}
for line in open(os.path.join(results, "vms.jsonl")):
    e = json.loads(line)
    vms.setdefault(e["vm"], {"phase": e["phase"]})[e["event"]] = e["at"]
for v in vms.values():
    seconds = (datetime.fromisoformat(v["down"].replace("Z", "+00:00")) - datetime.fromisoformat(v["up"].replace("Z", "+00:00"))).total_seconds()
    v["minutes"] = math.ceil(seconds / 60)
    v["list_price_usd"] = round(v["minutes"] * (RATE_USD_PER_MIN + IPV4_USD_PER_MIN), 4)

out = {
    "cells": cells,
    "total_usd": sum(c["usd"] for c in cells.values()),
    "total_requests": sum(c["requests"] for c in cells.values()),
    "by_model": models,
    "housekeeping_shipped_default": housekeeping,
    "vms": vms,
    "vm_minutes": sum(v["minutes"] for v in vms.values()),
    "vm_list_price_usd": round(sum(v["list_price_usd"] for v in vms.values()), 4),
}
json.dump(out, open(os.path.join(results, "analysis", "s1-spend.json"), "w"), indent=2)
print(json.dumps(out, indent=2))
