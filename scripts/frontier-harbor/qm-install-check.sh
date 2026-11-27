#!/usr/bin/env bash
# The keyless install check of QM on the frontier Harbor path (internal-task), the same shape as install-check.sh's agents,
# zdr and canary steps, on its own cells file (install-check-qm-prereg.json: QM on Claude Opus 5.5 through the proxy's
# anthropic route, GPT-6.2 Sol through its openai route and Gemini 4 Carbon through its OpenRouter route, one task each,
# uncounted, fake upstream). Keyless: no provider key is read or passed. Run on a fresh Ubicloud VM after
# scripts/ubicloud/bootstrap.sh, from the repository root:
#
#   bash scripts/frontier-harbor/qm-install-check.sh <out dir>
#
# It writes <out>/install-check-qm.json (the committed copy is scripts/frontier-harbor/install-check-qm.json) and passes
# when vm-run.sh exits 0 and, for every cell:
#   - the trial ran with no infra class, and every agent-loop request sent effort high (to-trials.ts efforts_agent_loop);
#   - QM was set up as agents.py FrontierQm says: every admin call 2xx, the sandbox created and made the default, QM's
#     provisioning ran in the task container (its credential directory and links are there), and core's docker CLI got
#     only the calls qm-docker-shim.sh answers;
#   - the QM turn finished (qm-turn.json status ok);
#   - on OpenRouter, the reasoning replay seen is the one pin.json declares for qm (replays when none is declared): the fake
#     answers Gemini's tool calls with a thought signature and refuses a replayed tool-call turn without it;
# and zdr-check.ts passes the Sol cell (a tool-output turn with no previous_response_id), web-tools-check.ts finds no web
# tool in what QM offered, and the canary scan finds the fake provider key in no file of the run and no per-trial token
# in what reached the fake upstream or in QM core's copied log.
# Exit 0 when every check passed, 1 when one failed, 2 or 3 for a usage or setup failure.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?usage: qm-install-check.sh <out dir>}
cells_file=$here/install-check-qm-prereg.json
mkdir -p "$out"
out=$(cd "$out" && pwd)
[ ! -e "$out/agents" ] || { echo "qm-install-check: $out already holds a run (agents/); give an empty directory" >&2; exit 2; }
rm -f "$out/install-check-qm.json"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY CURSOR_API_KEY XAI_API_KEY
say() { printf '%s qm-install-check: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/install-check.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
read -r tb_repo tb_commit <<< "$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["terminal_bench"]; print(t["repo"], t["commit"])' "$here/pin.json")"
tb21=$HOME/terminal-bench-2-1
if [ "$(git -C "$tb21" rev-parse HEAD 2>/dev/null)" != "$tb_commit" ]; then
  rm -rf "$tb21"
  git clone --quiet --filter=blob:none "$tb_repo" "$tb21" >> "$out/install-check.log" 2>&1
  git -C "$tb21" checkout --quiet "$tb_commit"
fi
say "terminal-bench-2-1 at $(git -C "$tb21" rev-parse HEAD); kernel $(uname -r); $(docker --version)"
set +e
"${safe_env[@]}" bash "$here/vm-run.sh" --prereg "$cells_file" --name install-check-qm --lease-usd 200 --out "$out/agents" \
  --tb21 "$tb21" --fake-upstream --uncounted "QM install check (keyless, fake upstream)"
agents_rc=$?
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/zdr-check.ts --smoke "$out" --prereg "$cells_file" --cells qm-sol --out "$out/zdr.json") >> "$out/install-check.log" 2>&1
zdr_rc=$?
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/web-tools-check.ts --smoke "$out" --prereg "$cells_file" --name install-check-qm --out "$out/web-tools.json") >> "$out/install-check.log" 2>&1
web_rc=$?
set -e
say "agents: vm-run.sh exited $agents_rc; zdr-check.ts exited $zdr_rc; web-tools-check.ts exited $web_rc"
canary_files=$( [ -s "$out/agents/canary.txt" ] && grep -rlF -f "$out/agents/canary.txt" "$out/agents" --exclude=canary.txt 2>/dev/null | sed "s#^$out/##" || true)
python3 "$here/qm-install-report.py" "$out" "$here" "$repo" "$agents_rc" "$zdr_rc" "$web_rc" "$canary_files"
