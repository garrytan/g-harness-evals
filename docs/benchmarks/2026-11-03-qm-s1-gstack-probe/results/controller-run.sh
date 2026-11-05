#!/usr/bin/env bash
# Controller of the HARN-38 S1 counted run (qm-s1-gstack-probe-2026-11) at f5491d7d. One VM at a time; a fresh VM
# resumes the same run (same ledger lease, same results dir) when the TTL would end within 20 minutes. Pulls the
# results after every turn and mirrors them to the drive every ~20 minutes after a token scan.
. "$HOME/.capy/work/harn38-s1/bin/lib.sh"
RD=$W/run; mkdir -p "$RD/pulled"; LOG=$RD/controller.log
clog() { echo "$(ts) $*" | tee -a "$LOG"; }
VM=""; vmn=0; last_drive=0
[ -f "$RD/vmn" ] && vmn=$(cat "$RD/vmn")

pull_all() {
  local tmp=$RD/pull.tmp
  rm -rf "$tmp"; mkdir -p "$tmp"
  bash "$RUNNER" pull "$VM" s1/results "$tmp" >>"$LOG" 2>&1 || return 1
  rm -rf "$RD/pulled/results.prev"; [ -d "$RD/pulled/results" ] && mv "$RD/pulled/results" "$RD/pulled/results.prev"
  mv "$tmp/results" "$RD/pulled/results" && rm -rf "$RD/pulled/results.prev"
  mkdir -p "$RD/pulled/vm$vmn"
  for f in loop.log driver.log loop.out meter-summary.txt state est; do
    bash "$RUNNER" pull "$VM" "s1/$f" "$RD/pulled/vm$vmn" >/dev/null 2>&1 || true
  done
  return 0
}

drive_copy() {
  local stage=$RD/drive-stage
  rm -rf "$stage"; mkdir -p "$stage"
  cp -a "$RD/pulled/results" "$stage/results"
  for d in "$RD"/pulled/vm*; do [ -d "$d" ] && cp -a "$d" "$stage/"; done
  [ -f "$RD/restarts.jsonl" ] && cp "$RD/restarts.jsonl" "$stage/"
  if bash "$W/bin/scan.sh" "$stage" >>"$LOG" 2>&1; then
    mkdir -p "$DRIVE_RUNS"
    rm -rf "$DRIVE_RUNS/results.new" && cp -a "$stage/results" "$DRIVE_RUNS/results.new" && rm -rf "$DRIVE_RUNS/results" && mv "$DRIVE_RUNS/results.new" "$DRIVE_RUNS/results"
    for d in "$stage"/vm*; do [ -d "$d" ] && rm -rf "$DRIVE_RUNS/$(basename "$d")" && cp -a "$d" "$DRIVE_RUNS/"; done
    [ -f "$stage/restarts.jsonl" ] && cp "$stage/restarts.jsonl" "$DRIVE_RUNS/"
    clog "drive: copied ($(grep -c . "$RD/pulled/results/turns.jsonl" 2>/dev/null || echo 0) turn records) to $DRIVE_RUNS"
    last_drive=$(date +%s)
    return 0
  fi
  clog "drive: SCAN HIT, not copied; see $LOG"
  echo scan_hit >"$RD/scan-hit"
  last_drive=$(date +%s)
  return 1
}

prepare_vm() {
  local steps=$RD/vm$vmn-steps.jsonl
  step up "$steps" "$LOG" do_up || return 1
  VM=$(cat "$W/current-vm"); vm_record up "\"phase\":\"run\",\"vm_index\":$vmn"
  step sync "$steps" "$LOG" do_sync || return 1
  step bootstrap "$steps" "$LOG" do_bootstrap || return 1
  step docker_group_reentry "$steps" "$LOG" do_group || return 1
  step checkout "$steps" "$LOG" do_checkout || return 1
  step bun_install "$steps" "$LOG" do_install || return 1
  step build_core "$steps" "$LOG" do_build_core || return 1
  step build_sandbox "$steps" "$LOG" do_build_sandbox || return 1
  step host_clean "$steps" "$LOG" do_host_clean || return 1
  step image_ids "$steps" "$LOG" do_image_ids
  return 0
}

trap 'clog "controller exiting"; [ -n "$VM" ] && { pull_all; do_down >>"$LOG" 2>&1; vm_record down "\"phase\":\"run\",\"vm_index\":$vmn,\"reason\":\"controller exit\""; }; bash "$RUNNER" list --mine >>"$LOG" 2>&1' EXIT

while :; do
  vmn=$((vmn+1)); echo "$vmn" >"$RD/vmn"
  clog "vm$vmn: preparing"
  if ! prepare_vm; then clog "vm$vmn: preparation failed"; echo prep_failed >"$RD/final"; exit 1; fi
  created=$(sed -E 's/^ubirun-[a-z0-9]+-([0-9]{10})-.*/\1/' <<<"$VM")
  bash "$RUNNER" ssh "$VM" 'mkdir -p ~/s1/bin ~/s1/results' >>"$LOG" 2>&1
  bash "$RUNNER" ssh "$VM" 'cat > ~/s1/bin/vm-loop.sh' <"$W/bin/vm-loop.sh"
  if [ "$vmn" -eq 1 ] && [ ! -f "$RD/pulled/results/ledger.sqlite" ]; then
    bash "$RUNNER" ssh "$VM" "cd $REPO && $VBIN && LEDGER=\$HOME/s1/results/ledger.sqlite bun -e 'import { BudgetRun } from \"./runner/ledger/budget-ledger.ts\"; BudgetRun.openLease({ runId: \"qm-s1-gstack-probe-2026-11\", leaseUsd: 20, ledgerPath: process.env.LEDGER, runner: \"metering-proxy\", maxOutputTokens: 128000 }); console.log(\"lease qm-s1-gstack-probe-2026-11 opened at \$20, output cap 128000\")'" >>"$LOG" 2>&1 || { clog "ledger init failed"; echo ledger_failed >"$RD/final"; exit 1; }
    clog "vm$vmn: ledger initialised with the run's single \$20 lease"
  else
    tar -C "$RD/pulled" -czf - results | bash "$RUNNER" unpack "$VM" s1 >>"$LOG" 2>&1 || { clog "resume upload failed"; echo resume_failed >"$RD/final"; exit 1; }
    [ -f "$RD/pulled/vm$((vmn-1))/est" ] && bash "$RUNNER" ssh "$VM" 'cat > ~/s1/est' <"$RD/pulled/vm$((vmn-1))/est"
    clog "vm$vmn: uploaded results ($(grep -c . "$RD/pulled/results/turns.jsonl" 2>/dev/null || echo 0) turn records) and the ledger for resume"
  fi
  { for k in ANTHROPIC_API_KEY OPENAI_API_KEY; do if [ -n "${!k:+x}" ]; then printf 'export %s=%q\n' "$k" "${!k}"; fi; done; } | bash "$RUNNER" ssh "$VM" 'umask 077 && cat > ~/.ubirun-env'
  bash "$RUNNER" ssh "$VM" "rm -f ~/s1/state ~/s1/stop; setsid nohup bash ~/s1/bin/vm-loop.sh $created > ~/s1/loop.out 2>&1 < /dev/null & sleep 5; test ! -e ~/.ubirun-env && echo 'key file deleted'" >>"$LOG" 2>&1
  clog "vm$vmn: loop launched on $VM (created $(date -u -d @$created +%Y-%m-%dT%H:%M:%SZ))"
  seen=-1; state=""
  while :; do
    sleep 20
    n=$(bash "$RUNNER" ssh "$VM" 'grep -c . ~/s1/results/turns.jsonl 2>/dev/null || echo 0' 2>/dev/null | tail -1)
    state=$(bash "$RUNNER" ssh "$VM" 'cat ~/s1/state 2>/dev/null' 2>/dev/null | tail -1)
    if [ -n "$n" ] && [ "$n" != "$seen" ]; then
      pull_all && clog "vm$vmn: pulled after $n turn record(s)"; seen=$n
    fi
    [ -n "$state" ] && break
    now=$(date +%s)
    [ $(( now - last_drive )) -ge 1200 ] && [ -f "$RD/pulled/results/turns.jsonl" ] && drive_copy
    if [ $now -ge $(( created + 3*3600 - 8*60 )) ]; then
      clog "vm$vmn: backstop 8 minutes before the TTL; stopping the driver"
      bash "$RUNNER" ssh "$VM" 'touch ~/s1/stop; pkill -TERM -f s1-probe.ts; sleep 60; cat ~/s1/state 2>/dev/null || echo backstop > ~/s1/state' >>"$LOG" 2>&1
      state=$(bash "$RUNNER" ssh "$VM" 'cat ~/s1/state' 2>/dev/null | tail -1); [ -z "$state" ] && state=backstop
      break
    fi
  done
  pull_all; clog "vm$vmn: loop state $state; final pull done"
  done_n=$(grep -c . "$RD/pulled/results/turns.jsonl" 2>/dev/null || echo 0)
  loaded=$(grep -o 'loaded commit [0-9a-f]*' "$RD/pulled/vm$vmn/loop.log" | head -1)
  step down "$RD/vm$vmn-steps.jsonl" "$LOG" do_down
  vm_record down "\"phase\":\"run\",\"vm_index\":$vmn,\"state\":\"$state\",\"turn_records\":$done_n"
  VM=""
  drive_copy
  if [ "$state" = ttl_stop ]; then
    printf '{"at":"%s","from_vm_index":%d,"turn_records":%d,"previous_runner":"%s","next_commit":"%s"}\n' "$(ts)" "$vmn" "$done_n" "$loaded" "$COMMIT" >>"$RD/restarts.jsonl"
    clog "restart: vm$vmn stopped at a turn boundary with $done_n turn records; resuming on a fresh VM at $COMMIT"
    continue
  fi
  echo "$state" >"$RD/final"; clog "run finished: $state"
  break
done
