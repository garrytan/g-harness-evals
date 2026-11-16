#!/usr/bin/env bash
# Stub of scripts/canary/<suite>/t0.sh for tests/canary-core-run.test.ts: writes a contract-shaped t0.json. CANARY_STUB_MODE=broken
# (for the suite named by CANARY_STUB_SUITE) reports a failed install check and exits 10; quota-t0 answers like a VM create
# refused for vCPU quota (the ubi-runner.sh line in <out>/remote.log, exit 1, no t0.json) while the number in
# CANARY_STUB_QUOTA_LEFT (a file) is above 0, counting it down.
suite=$(basename "$(dirname "$0")")
while [ $# -gt 0 ]; do case $1 in --out) out=$2; shift 2 ;; --fake|--remote) shift ;; *) shift 2 ;; esac; done
mkdir -p "$out"
mode=ok; [ "${CANARY_STUB_SUITE:-}" != "$suite" ] || mode=${CANARY_STUB_MODE:-ok}
if [ "$mode" = quota-t0 ] && [ "$(cat "$CANARY_STUB_QUOTA_LEFT")" -gt 0 ]; then
  echo $(( $(cat "$CANARY_STUB_QUOTA_LEFT") - 1 )) > "$CANARY_STUB_QUOTA_LEFT"
  echo "ubi-runner: create failed: vCPU quota exhausted; wait for running VMs to finish, or use fewer or smaller VMs (ci:ubicloud --vms N)" > "$out/remote.log"
  exit 1
fi
if [ "$mode" = broken ]; then
  printf '{"suite":"%s","ok":false,"checks":[{"arm":"new","harness":"claude-code","name":"skills_installed","ok":false,"detail":"no gstack SKILL.md under ~/.claude/skills"}]}\n' "$suite" > "$out/t0.json"
  exit 10
fi
printf '{"suite":"%s","ok":true,"checks":[{"arm":"new","harness":"claude-code","name":"skills_installed","ok":true,"detail":"ok"}]}\n' "$suite" > "$out/t0.json"
