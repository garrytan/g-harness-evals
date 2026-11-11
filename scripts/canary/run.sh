#!/usr/bin/env bash
# The regression canary's one entry point (plan decision 7 and "What gets built" item 6). The nightly automation runs:
#
#   scripts/canary/run.sh --drive-dir <dir> [--run-id <id>] [--products gstack,gbrain] [--fake] [--local] [--prereg-ref <ref>] [--now <iso>]
#   scripts/canary/run.sh --baseline --gstack-prev <sha> --gstack-new <sha> --gbrain-prev <sha> --gbrain-new <sha> [same flags]
#   scripts/canary/run.sh dead-man [--hours 48] [--now <iso>]
#
# It refuses unless HEAD is the canary_rig commit named in prereg-canary.json as read from --prereg-ref (default origin/main), and
# unless the task lists match the hashes there. Then: lock (receipts.sh) -> releases (releases.ts current) -> state (receipts.sh)
# -> when nothing moved, no T2 is due and nothing is pending: an OK "no move" history line and exit 0. Otherwise, per product:
# T0 -> T1 (previous and new side by side) -> decide -> T2 when flagged or due (every 30 days) -> decide -> T3, or bisect when
# several stable moves lie in range, when flagged -> decide. Then <drive dir>/canary/runs/<run id>/{verdict.json,alert.md,
# summary.md}, the receipts push, and the alert between CANARY_ALERT_BEGIN and CANARY_ALERT_END when the status is not OK.
# Exit 0 for OK, WATCH or REGRESSION, 10 for BROKEN, 30 for INCOMPLETE. Every failure path writes an INCOMPLETE verdict and
# history line and exits 30.
# Money: a monthly ledger lease canary-YYYY-MM (prereg leases.monthly, $1,000) that every tier's lease is reserved from; T2,
# T3 and bisect keep the month's T1 reserve untouched, so a used-up month runs T0 and T1 only and the verdict says so.
# --baseline runs T0, then T2 at 3 attempts for each product with the given commits, under a canary-baseline ledger.
# Suites are scripts/canary/<suite>/t0.sh and run-tier.sh (docs/canary.md); --fake passes through to them, and without
# --local t0.sh and run-tier.sh get --remote (one Ubicloud VM per tier; UBI_OWNER must be set by the caller).
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
prereg_path=docs/benchmarks/2026-11-09-regression-canary/prereg-canary.json
mode=nightly fake=0 local_run=0 drive="" run_id="" prereg_ref=origin/main products="gstack,gbrain" now="" hours=48
declare -A pin=()
if [ "${1:-}" = dead-man ]; then mode=dead-man; shift; fi
while [ $# -gt 0 ]; do
  case $1 in
    --baseline) mode=baseline; shift ;;
    --fake) fake=1; shift ;;
    --local) local_run=1; shift ;;
    --drive-dir) drive=$2; shift 2 ;;
    --run-id) run_id=$2; shift 2 ;;
    --prereg-ref) prereg_ref=$2; shift 2 ;;
    --products) products=$2; shift 2 ;;
    --now) now=$2; shift 2 ;;
    --hours) hours=$2; shift 2 ;;
    --gstack-prev|--gstack-new|--gbrain-prev|--gbrain-new) pin[${1#--}]=$2; shift 2 ;;
    *) echo "canary: unknown argument $1" >&2; exit 2 ;;
  esac
done
now=${now:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
stamp=$(date -u -d "$now" +%Y%m%dT%H%M%SZ)
month=${now:0:7}
receipts() { bash "$here/receipts.sh" "$@"; }

if [ "$mode" = dead-man ]; then
  st=$(receipts state --now "$now") || { printf 'CANARY_ALERT_BEGIN\nHarness Evals canary: INCOMPLETE, dead-man check could not read canary-receipts\n- Suggested owner: internal-task; what to check first: the receipts remote and this machine'"'"'s git access\nCANARY_ALERT_END\n'; exit 30; }
  last=$(jq -r '.last_history_at // "never"' <<<"$st")
  ago=$(jq -r 'if .hours_since_last == null then "none" else (.hours_since_last * 10 | round / 10 | tostring) end' <<<"$st")
  if [ "$ago" = none ] || jq -e --argjson h "$hours" '.hours_since_last > $h' <<<"$st" >/dev/null; then
    printf 'CANARY_ALERT_BEGIN\nHarness Evals canary: INCOMPLETE, no run has reported for %s hours (last history line %s)\n- Suggested owner: internal-task; what to check first: the nightly automation'"'"'s last run and its thread\nCANARY_ALERT_END\n' "$ago" "$last"
    exit 30
  fi
  echo "Harness Evals canary: dead-man OK, last history line $last ($ago hours ago)"
  exit 0
fi

run_id=${run_id:-canary-$stamp}
case $run_id in *[!A-Za-z0-9._-]*) echo "canary: a run id is [A-Za-z0-9._-] only" >&2; exit 2 ;; esac
work=${CANARY_WORK:-$HOME/.cache/harness-evals-canary/runs}/$run_id
out=$work/out
rm -rf "$work"
mkdir -p "$out"
IFS=, read -r -a plist <<<"$products"
log() { echo "canary: $*" >&2; echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" >> "$out/run.log"; }
P() { jq -r "$1" "$out/prereg.json"; }
finished=0 locked=0 budget_run="" ledger="" ledger_name="" step=start
declare -A pending=() spend=()

# ---- the end of every path -------------------------------------------------------------------------------------------
rank() { case $1 in OK) echo 0 ;; WATCH) echo 1 ;; REGRESSION) echo 2 ;; INCOMPLETE) echo 3 ;; BROKEN) echo 4 ;; *) echo 3 ;; esac; }
release_args() { # <product>: decide's release flags from $out/<p>/release.json, or "unknown"
  local f="$out/$1/release.json"
  if [ -f "$f" ]; then jq -r '["--prev-sha", .prev.sha, "--prev-version", .prev.version, "--new-sha", .new.sha, "--new-version", .new.version] | .[]' "$f"
  else printf '%s\n' --prev-sha unknown --prev-version unknown --new-sha unknown --new-version unknown; fi
}
incomplete() { # <product> <detail> <check first>: an INCOMPLETE verdict for a product that has none yet
  local p=$1 earlier=()
  [ ! -f "$out/$p/verdict.json" ] || return 0
  mkdir -p "$out/$p/failed"
  [ -z "${last_verdict[$p]:-}" ] || earlier=(--earlier "${last_verdict[$p]}")
  mapfile -t rel < <(release_args "$p")
  bun "$here/decide.ts" --suite "$p" --tier T0 --prereg "$out/prereg.json" --tasks "$(tasks_for "$p")" "${rel[@]}" --run-id "$run_id" \
    --receipts-dir "runs/$run_id/$p" --failure "$2" --check-first "$3" "${earlier[@]}" --out "$out/$p/failed" >/dev/null 2>>"$out/run.log" \
    || printf '{"schema":"canary-verdict/1","suite":"%s","run_id":"%s","tier":"T0","tiers_run":[],"status":"INCOMPLETE","next":"none","release":{"prev":{"sha":"unknown","version":"unknown"},"new":{"sha":"unknown","version":"unknown"},"range":[],"bisect":null},"install_route":null,"receipts_dir":"runs/%s/%s","reasons":[{"rule":"run_failed","status":"INCOMPLETE","tier":"T0","detail":"decide could not run","check_first":"the run log","sticky":false}],"cleared":[],"models":{},"particle_flags":[],"digest":[],"notes":[]}\n' "$p" "$run_id" "$run_id" "$p" > "$out/$p/failed/verdict.json"
  [ -f "$out/$p/failed/alert.md" ] || printf 'Harness Evals canary: INCOMPLETE in %s stable unknown (unknown), previous unknown (unknown)\n- Suggested owner: internal-task; what to check first: the run log\n' "$p" > "$out/$p/failed/alert.md"
  cp "$out/$p/failed/verdict.json" "$out/$p/verdict.json"
  cp "$out/$p/failed/alert.md" "$out/$p/alert.md"
}
tasks_for() { local t; t=$(jq -r --arg p "$1" '.suites[$p].tasks.path // empty' "$out/prereg.json" 2>/dev/null); echo "$root/${t:-$prereg_path}"; }

finish() {
  finished=1
  local worst=OK p verdicts=() lines="$out/history.add"
  : > "$lines"
  for p in "${plist[@]}"; do
    [ -f "$out/$p/verdict.json" ] || continue
    verdicts+=("$out/$p/verdict.json")
    local s; s=$(jq -r .status "$out/$p/verdict.json")
    [ "$(rank "$s")" -le "$(rank "$worst")" ] || worst=$s
    jq -c --arg at "$now" --arg month "$month" --arg mode "$mode" --arg pending "${pending[$p]:-}" --argjson spend "${spend[$p]:-0}" --arg v "runs/$run_id/$p/verdict.json" \
      '{schema: "canary-history/1", at: $at, run_id, product: .suite, status, tiers: .tiers_run, prev: .release.prev, new: .release.new, next,
        pending: (if $pending == "" then null else $pending end), lease_month: $month, spend_usd: $spend, digest, particle_flags, verdict: $v, mode: $mode}' \
      "$out/$p/verdict.json" >> "$lines"
  done
  if [ ${#verdicts[@]} -eq 0 ]; then
    jq -c -n --arg at "$now" --arg id "$run_id" --arg month "$month" --arg note "${quiet_note:-no stable move}" \
      '{schema: "canary-history/1", at: $at, run_id: $id, product: null, status: "OK", lease_month: $month, note: $note, mode: "nightly"}' >> "$lines"
  fi
  # alert and summary
  if [ ${#verdicts[@]} -eq 0 ]; then
    printf '%s\n' "${quiet_line:-Harness Evals canary: OK, no stable move}" > "$out/alert.md"
    printf '# Canary run %s\n\n%s\n' "$run_id" "${quiet_line:-Harness Evals canary: OK, no stable move}" > "$out/summary.md"
  else
    : > "$out/alert.md"
    for p in "${plist[@]}"; do
      [ -f "$out/$p/verdict.json" ] || continue
      if [ "$worst" = OK ] || [ "$(jq -r .status "$out/$p/verdict.json")" != OK ]; then { cat "$out/$p/alert.md"; echo; } >> "$out/alert.md"; fi
    done
    bun "$here/alert.ts" summary $(printf -- '--verdict %s ' "${verdicts[@]}") > "$out/summary.md" 2>>"$out/run.log" || cp "$out/alert.md" "$out/summary.md"
  fi
  if [ -n "$drive" ]; then
    local dd="$drive/canary/runs/$run_id"
    mkdir -p "$dd"
    if [ ${#verdicts[@]} -gt 0 ]; then jq -s --arg id "$run_id" --arg s "$worst" '{schema: "canary-run/1", run_id: $id, status: $s, products: (map({(.suite): .}) | add)}' "${verdicts[@]}" > "$dd/verdict.json"
    else jq -n --arg id "$run_id" '{schema: "canary-run/1", run_id: $id, status: "OK", products: {}, note: "no stable move"}' > "$dd/verdict.json"; fi
    cp "$out/alert.md" "$dd/alert.md"; cp "$out/summary.md" "$dd/summary.md"
  else
    log "no --drive-dir: the drive copy was not written"
  fi
  if [ -n "$budget_run" ]; then bun "$here/lease.ts" close --ledger "$ledger" --budget-run "$budget_run" >/dev/null 2>>"$out/run.log" || true; fi
  local ledger_args=()
  [ -z "$ledger" ] || [ ! -f "$ledger" ] || ledger_args=(--ledger "$ledger" --ledger-name "$ledger_name")
  local published=1
  receipts publish --run-id "$run_id" --dir "$out" --history "$lines" "${ledger_args[@]}" 2>>"$work/publish.log" || published=0
  if [ $published -eq 0 ]; then
    [ $locked -eq 0 ] || receipts unlock --run-id "$run_id" 2>/dev/null || true
    worst=INCOMPLETE
    printf -- '- Receipts push failed (%s); the next run repeats this one. Check first: %s\n' "$(tail -1 "$work/publish.log" 2>/dev/null)" "the canary-receipts remote" >> "$out/alert.md"
  fi
  if [ "$worst" != OK ]; then printf 'CANARY_ALERT_BEGIN\n'; cat "$out/alert.md"; printf 'CANARY_ALERT_END\n'; else cat "$out/alert.md"; fi
  case $worst in BROKEN) exit 10 ;; INCOMPLETE) exit 30 ;; *) exit 0 ;; esac
}

fail_run() { # <detail> <check first>: every product without a verdict ends INCOMPLETE
  log "INCOMPLETE: $1"
  local p
  for p in "${plist[@]}"; do incomplete "$p" "$1" "$2"; done
  finish
}
on_exit() {
  local rc=$?
  [ $finished -eq 0 ] || exit $rc
  fail_run "run.sh stopped unexpectedly during $step (exit $rc)" "the run log at step $step"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

# ---- refusals: the rig, the task lists, the lane -------------------------------------------------------------------------
step=rig
declare -A last_verdict=()
git -C "$root" show "$prereg_ref:$prereg_path" > "$out/prereg.json" 2>/dev/null || { echo '{}' > "$out/prereg.json"; fail_run "cannot read $prereg_path at $prereg_ref" "git fetch origin, then the preregistration on main"; }
rig=$(P '.canary_rig // empty'); head=$(git -C "$root" rev-parse HEAD)
[ "$rig" = "$head" ] || fail_run "HEAD $head is not the canary_rig commit (${rig:-none}) named in $prereg_path at $prereg_ref" "run from a worktree pinned at canary_rig"
for p in "${plist[@]}"; do
  case $p in gstack|gbrain) ;; *) fail_run "unknown product $p" "--products" ;; esac
  want=$(P ".suites.$p.tasks.sha256"); have=$(sha256sum "$(tasks_for "$p")" 2>/dev/null | cut -d' ' -f1)
  [ -n "$have" ] && [ "$want" = "$have" ] || fail_run "the $p task list does not match its preregistered sha256" "$(P ".suites.$p.tasks.path")"
done
if [ $local_run -eq 0 ] && [ -z "${UBI_OWNER:+x}" ]; then fail_run "UBI_OWNER is not set for the Ubicloud lane" "the automation prompt: it must set UBI_OWNER"; fi

# ---- lock, releases, state, lease ------------------------------------------------------------------------------------------
step=lock
receipts lock --run-id "$run_id" --fresh-hours "$(P '.schedule.lock_fresh_hours // 12')" --now "$now" 2>>"$out/run.log"
case $? in 0) locked=1 ;; 3) fail_run "another canary run holds the lock on canary-receipts" "the run named in canary-receipts lock.json" ;; *) fail_run "could not take the run lock on canary-receipts" "the receipts remote and git access" ;; esac
step=releases
bun "$here/releases.ts" current > "$out/releases.json" 2>>"$out/run.log" || fail_run "could not resolve the stable releases" "git ls-remote to garrytan/gstack and garrytan/gbrain"
step=state
receipts state --now "$now" > "$out/state.json" 2>>"$out/run.log" || fail_run "could not read canary-receipts history" "the receipts remote"
step=lease
if [ "$mode" = baseline ]; then
  ledger_name=canary-baseline.sqlite
  cap=0; for p in "${plist[@]}"; do cap=$(( cap + $(P ".leases.baseline_usd.$p") )); done
else
  ledger_name=canary-$month.sqlite; cap=$(P '.leases.monthly.cap_usd')
fi
ledger=$work/$ledger_name
receipts cat --path "leases/$ledger_name" --out "$ledger" 2>>"$out/run.log"
case $? in 0) ;; 1) rm -f "$ledger" ;; *) fail_run "could not read the lease leases/$ledger_name from canary-receipts" "the receipts remote and git access; a fresh ledger would reset the month's spend" ;; esac
budget_run=$(bun "$here/lease.ts" open --ledger "$ledger" --month "${ledger_name%.sqlite}" --cap-usd "$cap" --run-id "$run_id" 2>>"$out/run.log")
case $? in 0) ;; 20) budget_run=""; log "the lease $ledger_name is used up" ;; *) fail_run "could not open the lease $ledger_name" "runner/ledger/budget-ledger.ts on $ledger_name" ;; esac
t1_keep=$(P '.leases.monthly.t1_reserve_usd // 0'); [ "$mode" = baseline ] && t1_keep=0
# reserve <usd> <what> <keep>: prints the entry id; 20 when the lease cannot cover it
reserve() { [ -n "$budget_run" ] || return 20; bun "$here/lease.ts" reserve --ledger "$ledger" --budget-run "$budget_run" --usd "$1" --what "$2" --keep-usd "$3" 2>>"$out/run.log"; }
settle() { bun "$here/lease.ts" settle --ledger "$ledger" --budget-run "$budget_run" --entry "$1" --trials "$2" >/dev/null 2>>"$out/run.log" || log "could not settle $1"; }

# ---- one product ------------------------------------------------------------------------------------------------------
suite() { # <product> <script> <args...>
  local p=$1 s=$2; shift 2
  local script="$root/scripts/canary/$p/$s" extra=()
  [ -f "$script" ] || { log "missing $script"; return 127; }
  [ $fake -eq 0 ] || extra+=(--fake)
  [ $local_run -eq 1 ] || extra+=(--remote)
  bash "$script" "$@" "${extra[@]}" >> "$out/$p/suite.log" 2>&1
}

run_tier() { # <product> <tier> <attempts> <arms> <models> <lease usd> <keep usd> <dir> <prev sha> <new sha> <decide release args...>
  local p=$1 tier=$2 attempts=$3 arms=$4 models=$5 lease=$6 keep=$7 dir=$8 prev=$9 new=${10}; shift 10
  local entry rc
  entry=$(reserve "$lease" "$run_id $p $tier" "$keep") || return 20
  mkdir -p "$dir"
  step="$p $tier"
  suite "$p" run-tier.sh --tier "${tier%%-*}" --prev "$prev" --new "$new" --tasks "$(tasks_for "$p")" --attempts "$attempts" --arms "$arms" \
    --models "$models" --lease-usd "$lease" --run-id "$run_id-$p-${tier,,}" --out "$dir"
  rc=$?
  settle "$entry" "$dir/trials.jsonl"
  local prev_args=()
  [ ! -f "$out/$p/previous-t2.json" ] || prev_args=(--previous "$out/$p/previous-t2.json")
  decide_last=(--suite "$p" --tier "${tier%%-*}" --prereg "$out/prereg.json" --tasks "$(tasks_for "$p")" "$@" --run-id "$run_id" --receipts-dir "runs/$run_id/$p"
    --range "$out/$p/range.json" --trials "$dir/trials.jsonl" --suite-exit "$rc" --arms "$arms" --models "$models" --earlier "${last_verdict[$p]}" "${prev_args[@]}")
  bun "$here/decide.ts" "${decide_last[@]}" --out "$dir" >/dev/null 2>>"$out/run.log" || { log "decide failed for $p $tier"; return 1; }
  return 0
}

lease_skip() { # <product> <tier>
  pending[$1]=$2
  local note="the $ledger_name lease is used up: $2 did not run (it runs when the lease renews)"
  [ "$mode" != baseline ] || note="the baseline lease could not cover $2"
  log "$1: $note"
  notes+=(--note "$note")
}

run_product() { # <product> <kind: moved|due|baseline> <prev sha> <new sha>
  local p=$1 kind=$2 prev=$3 new=$4 pd="$out/$1" v next status
  local -a rel notes=()
  step="$p setup"
  mkdir -p "$pd"
  bun "$here/releases.ts" describe --product "$p" --sha "$prev" > "$pd/prev.json" 2>>"$out/run.log" || { incomplete "$p" "could not describe $p $prev" "releases.ts describe"; return; }
  bun "$here/releases.ts" describe --product "$p" --sha "$new" > "$pd/new.json" 2>>"$out/run.log" || { incomplete "$p" "could not describe $p $new" "releases.ts describe"; return; }
  if [ "$kind" = moved ]; then
    bun "$here/releases.ts" moves --product "$p" --from "$prev" --to "$new" > "$pd/range.json" 2>>"$out/run.log" || { incomplete "$p" "could not list the $p stable moves" "releases.ts moves"; return; }
  else echo '[]' > "$pd/range.json"; fi
  jq -n --slurpfile a "$pd/prev.json" --slurpfile b "$pd/new.json" --slurpfile r "$pd/range.json" '{prev: {sha: $a[0].sha, version: $a[0].version}, new: {sha: $b[0].sha, version: $b[0].version}, range: $r[0]}' > "$pd/release.json"
  mapfile -t rel < <(release_args "$p")
  local t2_verdict; t2_verdict=$(jq -r --arg p "$p" '.products[$p].t2_verdict // empty' "$out/state.json")
  [ -z "$t2_verdict" ] || receipts cat --path "$t2_verdict" --out "$pd/previous-t2.json" 2>/dev/null || rm -f "$pd/previous-t2.json"

  step="$p T0"
  suite "$p" t0.sh --prev "$prev" --new "$new" --out "$pd/t0"
  local t0rc=$?
  bun "$here/decide.ts" --suite "$p" --tier T0 --prereg "$out/prereg.json" --tasks "$(tasks_for "$p")" "${rel[@]}" --run-id "$run_id" --receipts-dir "runs/$run_id/$p" \
    --range "$pd/range.json" --t0 "$pd/t0/t0.json" --t0-exit "$t0rc" --out "$pd/T0" >/dev/null 2>>"$out/run.log" || { incomplete "$p" "decide failed at T0" "the run log"; return; }
  last_verdict[$p]=$pd/T0/verdict.json
  decide_last=()
  status=$(jq -r .status "${last_verdict[$p]}")
  local t1_models t2_models
  t1_models=$(P ".suites.$p.models.T1 | join(\",\")"); t2_models=$(P ".suites.$p.models.T2 | join(\",\")")

  if [ "$status" != BROKEN ] && [ "$status" != INCOMPLETE ] && [ "$kind" = moved ]; then
    run_tier "$p" T1 1 prev,new "$t1_models" "$(P ".leases.per_run_usd.T1.$p")" 0 "$pd/T1" "$prev" "$new" "${rel[@]}"
    case $? in 0) last_verdict[$p]=$pd/T1/verdict.json ;; 20) incomplete "$p" "the lease could not cover T1 (monthly lease $ledger_name)" "the monthly lease: it renews next month"; return ;; *) incomplete "$p" "T1 could not be decided" "the run log"; return ;; esac
  fi
  v=${last_verdict[$p]}; status=$(jq -r .status "$v"); next=$(jq -r .next "$v")
  local due=0 every; every=$(P '.tiers.T2.every_days // 30')
  jq -e --arg p "$p" --arg now "$now" --argjson d "$every" '.products[$p].last_t2_at == null or (($now | fromdate) - (.products[$p].last_t2_at | fromdate) >= $d * 86400)' "$out/state.json" >/dev/null && due=1
  [ -z "${pending_in[$p]:-}" ] || due=1
  if [ "$status" != BROKEN ] && [ "$status" != INCOMPLETE ] && { [ "$next" = T2 ] || [ $due -eq 1 ] || [ "$kind" = baseline ]; }; then
    local attempts=1 lease; lease=$(P ".leases.per_run_usd.T2.$p")
    [ "$kind" != baseline ] || { attempts=$(P '.tiers.baseline.attempts'); lease=$(P ".leases.baseline_usd.$p"); }
    run_tier "$p" T2 "$attempts" plain,prev,new "$t2_models" "$lease" "$t1_keep" "$pd/T2" "$prev" "$new" "${rel[@]}"
    case $? in 0) last_verdict[$p]=$pd/T2/verdict.json ;; 20) lease_skip "$p" T2 ;; *) incomplete "$p" "T2 could not be decided" "the run log"; return ;; esac
  fi
  v=${last_verdict[$p]}; status=$(jq -r .status "$v"); next=$(jq -r .next "$v")
  if [ "$kind" != baseline ] && { [ "$next" = T3 ] || [ "$next" = bisect ]; }; then
    local flagged n
    flagged=$(jq -r '[.reasons[] | select(.confirm_with == "T3" and .model != null and .model != "particle") | .model] | unique | join(",")' "$v")
    n=$(awk -F, '{print NF}' <<<"$flagged")
    local per; per=$(P ".leases.per_run_usd.T3_per_model.$p")
    run_tier "$p" T3 2 prev,new "$flagged" "$(( per * n ))" "$t1_keep" "$pd/T3" "$prev" "$new" "${rel[@]}"
    case $? in 0) last_verdict[$p]=$pd/T3/verdict.json ;; 20) lease_skip "$p" "$next" ;; *) incomplete "$p" "T3 could not be decided" "the run log"; return ;; esac
    if [ "$next" = bisect ] && [ "$(jq -r .status "${last_verdict[$p]}")" = REGRESSION ]; then
      local t3args=("${decide_last[@]}") bis
      jq -c --arg sha "$new" --arg v "$(jq -r .new.version "$pd/release.json")" 'if (.[-1].sha // "") == $sha then . else . + [{tag: "stable", version: $v, sha: $sha}] end' "$pd/range.json" > "$pd/bisect-range.json"
      local lo=-1 hi=$(( $(jq length "$pd/bisect-range.json") - 1 )) mid msha mver note="" ok=1
      while [ $(( hi - lo )) -gt 1 ]; do
        mid=$(( (lo + hi) / 2 )); msha=$(jq -r ".[$mid].sha" "$pd/bisect-range.json"); mver=$(jq -r ".[$mid].version" "$pd/bisect-range.json")
        last_verdict[$p]=$pd/T2/verdict.json
        run_tier "$p" "T3-bisect-$mid" 2 prev,new "$flagged" "$(( per * n ))" "$t1_keep" "$pd/bisect-$mid" "$prev" "$msha" \
          --prev-sha "$prev" --prev-version "$(jq -r .prev.version "$pd/release.json")" --new-sha "$msha" --new-version "$mver"
        case $? in 0) ;; 20) note="not run: the lease could not cover bisect step $mver"; ok=0; break ;; *) note="not run: bisect step $mver failed"; ok=0; break ;; esac
        if [ "$(jq -r .status "$pd/bisect-$mid/verdict.json")" = REGRESSION ]; then hi=$mid; else lo=$mid; fi
      done
      last_verdict[$p]=$pd/T3/verdict.json
      if [ $ok -eq 1 ]; then bis=$(jq -c --argjson i "$hi" '{first_bad: .[$i].version, note: "binary search with T3-size comparisons against the previous release"}' "$pd/bisect-range.json")
      else bis=$(jq -c -n --arg n "$note" '{first_bad: null, note: $n}'); fi
      bun "$here/decide.ts" "${t3args[@]}" --bisect "$bis" --out "$pd/T3" >/dev/null 2>>"$out/run.log" || log "could not record the bisect result"
      decide_last=("${t3args[@]}" --bisect "$bis")
    fi
  fi
  # a stable ref that moved while the product ran voids the reading; lease notes go into the last decision
  local final=("${notes[@]}")
  if [ "$kind" != baseline ] && [ ${#decide_last[@]} -gt 0 ]; then
    local now_sha; now_sha=$(bun "$here/releases.ts" current 2>>"$out/run.log" | jq -r --arg p "$p" '.[$p].sha')
    [ -z "$now_sha" ] || [ "$now_sha" = "$(jq -r --arg p "$p" '.[$p].sha' "$out/releases.json")" ] || final+=(--ref-moved)
  fi
  if [ ${#final[@]} -gt 0 ] && [ ${#decide_last[@]} -gt 0 ]; then
    bun "$here/decide.ts" "${decide_last[@]}" "${final[@]}" --out "$pd/final" >/dev/null 2>>"$out/run.log" && last_verdict[$p]=$pd/final/verdict.json
  fi
  cp "${last_verdict[$p]}" "$pd/verdict.json"
  if [ "$(jq -r .status "$pd/verdict.json")" = OK ]; then bun "$here/alert.ts" ok --verdict "$pd/verdict.json" > "$pd/alert.md"; else bun "$here/alert.ts" alert --verdict "$pd/verdict.json" > "$pd/alert.md"; fi
  spend[$p]=$(find "$pd" -name trials.jsonl -exec cat {} + | jq -s 'map(.usage.usd // 0) | add // 0')
}

# ---- what to run -------------------------------------------------------------------------------------------------------
step=plan
declare -A pending_in=()
todo=()
quiet_line="" quiet_note=""
for p in "${plist[@]}"; do
  cur=$(jq -r --arg p "$p" '.[$p].sha' "$out/releases.json")
  if [ "$mode" = baseline ]; then
    [ -n "${pin[$p-prev]:-}" ] && [ -n "${pin[$p-new]:-}" ] || fail_run "--baseline needs --$p-prev and --$p-new" "the baseline command line"
    todo+=("$p baseline ${pin[$p-prev]} ${pin[$p-new]}"); continue
  fi
  screened=$(jq -r --arg p "$p" '.products[$p].screened.sha // empty' "$out/state.json")
  if [ -z "$screened" ]; then incomplete "$p" "no screened $p release on canary-receipts" "run scripts/canary/run.sh --baseline first"; continue; fi
  pend=$(jq -r --arg p "$p" --arg m "$month" '.products[$p] | if .pending != null and .pending_month != $m then .pending else empty end' "$out/state.json")
  [ -z "$pend" ] || pending_in[$p]=$pend
  if [ "$cur" != "$screened" ]; then todo+=("$p moved $screened $cur"); continue; fi
  due=$(jq -r --arg p "$p" --arg now "$now" --argjson d "$(P '.tiers.T2.every_days // 30')" '.products[$p] | if .last_t2_at == null or (($now | fromdate) - (.last_t2_at | fromdate) >= $d * 86400) then "yes" else "" end' "$out/state.json")
  sprev=$(jq -r --arg p "$p" '.products[$p].screened_prev.sha // empty' "$out/state.json")
  if { [ -n "$due" ] || [ -n "$pend" ]; } && [ -n "$sprev" ]; then todo+=("$p due $sprev $screened"); fi
done
if [ ${#todo[@]} -eq 0 ]; then
  if ls "$out"/*/verdict.json >/dev/null 2>&1; then finish; fi
  quiet_line=$(bun -e 'import { renderNoMove } from "'"$here"'/alert.ts"; console.log(renderNoMove(JSON.parse(await Bun.file(process.argv[1]).text())))' "$out/releases.json" 2>>"$out/run.log")
  quiet_note="no stable move, no T2 due, nothing pending"
  plist=()
  finish
fi
for item in "${todo[@]}"; do
  read -r p kind prev new <<<"$item"
  run_product "$p" "$kind" "$prev" "$new"
done
step=finish
finish
