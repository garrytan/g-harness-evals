#!/usr/bin/env python3
"""The C4 preregistration's commit-binding assertions ("Commit binding", last bullet), read from the shard receipts.

Usage: python3 binding-check.py <results dir> <prereg.json>; writes analysis/binding-check.json, exits 1 on any failure.
"""
import hashlib
import json
import os
import sys

MERGE_COMMIT = "f5491d7d02f34dad833abeab54d02141a0ee5a64"
GBRAIN = "a590ad07"
results, prereg = sys.argv[1], sys.argv[2]
prereg_sha = hashlib.sha256(open(prereg, "rb").read()).hexdigest()
checks = []
for shard, manifest in (("qm-opus", "manifest.json"), ("qm-sol", "qm-sol.manifest.json")):
    sj = json.load(open(os.path.join(results, f"{shard}.shard.json")))
    vm = json.load(open(os.path.join(results, f"{shard}.shard-vm.json")))
    mf = json.load(open(os.path.join(results, manifest)))
    checks += [
        {"shard": shard, "check": "shard.json commit is the merge commit", "value": sj.get("commit"), "pass": sj.get("commit") == MERGE_COMMIT},
        {"shard": shard, "check": "shard-vm.json commit is the merge commit", "value": vm.get("commit"), "pass": vm.get("commit") == MERGE_COMMIT},
        {"shard": shard, "check": "shard-vm.json scratch_prereg is false", "value": vm.get("scratch_prereg"), "pass": vm.get("scratch_prereg") is False},
        {"shard": shard, "check": f"{manifest} prereg_sha256 equals prereg.json", "value": mf.get("prereg_sha256"), "pass": mf.get("prereg_sha256") == prereg_sha},
        {"shard": shard, "check": f"{manifest} gbrain_commit is a590ad07", "value": mf.get("gbrain_commit"), "pass": str(mf.get("gbrain_commit", "")).startswith(GBRAIN)},
        {"shard": shard, "check": "shard.json records an image id for harness-eval/qm-sandbox:dev", "value": sj.get("images", {}).get("harness-eval/qm-sandbox:dev"), "pass": str(sj.get("images", {}).get("harness-eval/qm-sandbox:dev", "")).startswith("sha256:")},
        {"shard": shard, "check": "shard-vm.json records the VM destroyed", "value": vm.get("destroyed_at"), "pass": bool(vm.get("destroyed_at"))},
    ]
out = {"prereg_sha256": prereg_sha, "merge_commit": MERGE_COMMIT, "checks": checks, "pass": all(c["pass"] for c in checks)}
json.dump(out, open(os.path.join(results, "analysis", "binding-check.json"), "w"), indent=2)
for c in checks:
    print(("PASS" if c["pass"] else "FAIL"), c["shard"], c["check"], c["value"])
sys.exit(0 if out["pass"] else 1)
