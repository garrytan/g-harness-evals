#!/usr/bin/env bash
# Stub of scripts/canary/<suite>/t0.sh for tests/canary-core-run.test.ts: writes a contract-shaped t0.json. CANARY_STUB_MODE=broken
# (for the suite named by CANARY_STUB_SUITE) reports a failed install check and exits 10.
suite=$(basename "$(dirname "$0")")
while [ $# -gt 0 ]; do case $1 in --out) out=$2; shift 2 ;; --fake) shift ;; *) shift 2 ;; esac; done
mkdir -p "$out"
mode=ok; [ "${CANARY_STUB_SUITE:-}" != "$suite" ] || mode=${CANARY_STUB_MODE:-ok}
if [ "$mode" = broken ]; then
  printf '{"suite":"%s","ok":false,"checks":[{"arm":"new","harness":"claude-code","name":"skills_installed","ok":false,"detail":"no gstack SKILL.md under ~/.claude/skills"}]}\n' "$suite" > "$out/t0.json"
  exit 10
fi
printf '{"suite":"%s","ok":true,"checks":[{"arm":"new","harness":"claude-code","name":"skills_installed","ok":true,"detail":"ok"}]}\n' "$suite" > "$out/t0.json"
