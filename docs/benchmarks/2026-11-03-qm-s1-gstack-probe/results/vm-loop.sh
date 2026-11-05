#!/usr/bin/env bash
# VM side of the HARN-38 S1 counted run. Started detached by run.sh with the model keys in ~/.ubirun-env, which it
# reads into its own environment and deletes before any turn. Runs the pinned driver in whole quads (the driver's own
# turn order), at most 3 quads per invocation, and only as many as fit before the VM's TTL minus 20 minutes. Never
# prints a key or the environment.
set -u
CREATED=$1
COMMIT=f5491d7d02f34dad833abeab54d02141a0ee5a64
S=$HOME/s1; R=$S/results; L=$R/ledger.sqlite; WK=$S/work; LOG=$S/loop.log
. "$HOME/.ubirun-env"; rm -f "$HOME/.ubirun-env"
export PATH=$HOME/.bun/bin:$PATH
TTL_END=$((CREATED + 3*3600)); DEADLINE=$((TTL_END - 20*60))
QUAD_EST=960; OVER_EST=240
[ -f "$S/est" ] && . "$S/est"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >>"$LOG"; }
finish() {
  echo "$1" >"$S/state.tmp"
  ( cd "$HOME/work/harness-evals" && bun -e 'const {Database}=require("bun:sqlite"); const d=new Database(process.argv[1]); d.exec("PRAGMA wal_checkpoint(TRUNCATE)"); d.close()' "$L" ) >>"$LOG" 2>&1 && log "ledger checkpointed"
  ( cd "$HOME/work/harness-evals" && bun runner/proxy/metering-proxy.ts summary --budget-ledger "$L" --run-id qm-s1-gstack-probe-2026-11 ) >"$S/meter-summary.txt" 2>&1
  log "meter summary written (exit $?)"
  log "loop end: $1"
  mv "$S/state.tmp" "$S/state"
  exit 0
}
cd "$HOME/work/harness-evals" || { log "no checkout"; echo error >"$S/state"; exit 1; }
head=$(git rev-parse HEAD); clean=$([ -z "$(git status --porcelain)" ] && echo yes || echo no)
log "loop start on $(hostname): loaded commit $head clean=$clean; prior turn records $(grep -c . "$R/turns.jsonl" 2>/dev/null || echo 0); deadline $(date -u -d @$DEADLINE +%Y-%m-%dT%H:%M:%SZ) (TTL end $(date -u -d @$TTL_END +%Y-%m-%dT%H:%M:%SZ))"
[ "$head" = "$COMMIT" ] && [ "$clean" = yes ] || { log "wrong or dirty commit"; finish error; }
for k in ANTHROPIC_API_KEY OPENAI_API_KEY; do log "$k $([ -n "${!k:+x}" ] && echo set || echo missing)"; done
log "keys inside sg: $(sg docker -c 'a=no; o=no; [ -n "${ANTHROPIC_API_KEY:+x}" ] && a=yes; [ -n "${OPENAI_API_KEY:+x}" ] && o=yes; echo anthropic=$a openai=$o')"
bun -e 'import { turnPlan } from "./harnesses/qm/gstack/s1-probe.ts"; const p = turnPlan(3); for (let i = 0; i < p.length; i += 4) console.log(p.slice(i, i + 4).map((t) => t.id).join(","));' >"$S/quads.txt" || finish error
log "plan: $(wc -l <"$S/quads.txt") quads"
bad_streak=0
while :; do
  [ -f "$S/stop" ] && finish stopped
  done_ids=$(jq -r '.turn_id' "$R/turns.jsonl" 2>/dev/null | sed -E 's/-r[0-9]+$//' | sort -u)
  if jq -e -s 'any(.[]; .termination == "cap_stop")' "$R/turns.jsonl" >/dev/null 2>&1; then finish cap_stop; fi
  todo=()
  while IFS= read -r q; do
    rest=$(tr ',' '\n' <<<"$q" | grep -vxF -f <(printf '%s\n' "$done_ids" | grep .) | paste -sd, -)
    [ -n "$rest" ] && todo+=("$rest")
  done <"$S/quads.txt"
  [ ${#todo[@]} -eq 0 ] && finish complete
  now=$(date +%s); n=$(( (DEADLINE - now - OVER_EST) / QUAD_EST ))
  [ $n -gt 3 ] && n=3
  [ $n -gt ${#todo[@]} ] && n=${#todo[@]}
  if [ $n -lt 1 ]; then log "ttl: $(( DEADLINE - now ))s left before the deadline, a quad is estimated at ${QUAD_EST}s plus ${OVER_EST}s overhead"; finish ttl_stop; fi
  ids=$(printf '%s\n' "${todo[@]:0:$n}" | paste -sd, -)
  t0=$(date +%s)
  log "invoke: $n quad(s): $ids"
  sg docker -c "bun harnesses/qm/gstack/s1-probe.ts --ledger $L --lease-usd 20 --out $R --work $WK --skip-build --only $ids" >>"$S/driver.log" 2>&1
  rc=$?; t1=$(date +%s)
  log "driver exit $rc after $(( t1 - t0 ))s"
  missing=0; nonok=0
  for id in $(tr ',' ' ' <<<"$ids"); do
    rec=$(jq -c --arg id "$id" 'select(.turn_id == $id)' "$R/turns.jsonl" 2>/dev/null | tail -1)
    if [ -z "$rec" ]; then missing=$((missing+1)); continue; fi
    term=$(jq -r .termination <<<"$rec")
    if [ "$term" = ok ]; then bad_streak=0; else nonok=$((nonok+1)); bad_streak=$((bad_streak+1)); log "turn $id termination $term"; fi
  done
  if jq -e -s 'any(.[]; .termination == "cap_stop")' "$R/turns.jsonl" >/dev/null 2>&1; then finish cap_stop; fi
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 1 ]; then log "driver exit $rc is not a turn outcome"; finish error; fi
  if [ $missing -gt 0 ]; then log "$missing requested turn(s) have no record"; finish error; fi
  if [ $bad_streak -ge 4 ]; then log "4 turns in a row did not end ok"; finish error; fi
  pre=$(ls -t "$R"/preflight*.json 2>/dev/null | head -1)
  if [ -n "$pre" ]; then
    pt=$(stat -c %Y "$pre"); over=$(( pt - t0 )); per=$(( (t1 - pt) / n ))
    [ $over -gt 0 ] && OVER_EST=$(( over + 60 ))
    QUAD_EST=$(( per * 5 / 4 )); [ $QUAD_EST -lt 300 ] && QUAD_EST=300
    printf 'QUAD_EST=%d\nOVER_EST=%d\n' "$QUAD_EST" "$OVER_EST" >"$S/est"
    log "estimates: quad ${QUAD_EST}s (measured ${per}s), overhead ${OVER_EST}s (measured ${over}s)"
  fi
done
