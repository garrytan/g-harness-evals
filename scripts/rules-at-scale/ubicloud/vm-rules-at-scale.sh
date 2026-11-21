# --- rules-at-scale (spliced in by scripts/rules-at-scale/ubicloud/lane.py from vm-rules-at-scale.sh) ---
# --workload rules-at-scale (scripts/rules-at-scale/run-shard.sh): --prereg is the run's plan (scripts/rules-at-scale/plan.ts
# plan) and --cells the shard's one setup. The smoke is run-shard.sh --smoke --fake-upstream with every key unset (one
# trial of the shard behind the fake upstream, no spend; exit 4 when it fails or its row carries an infra code), into
# ~/shard/smoke/results; then run-shard.sh for the shard under its lease with --out ~/shard/results and the arguments
# after -- passed through, its output in ~/shard/results/run.stdout.log. Sealed flags are refused.
if [ "$workload" = rules-at-scale ]; then
  [ ${#sealed[@]} -eq 0 ] || { log "rules-at-scale takes no sealed flags"; finish 2; }
  if [ "$smoke" -eq 1 ]; then
    mkdir -p "$shard/smoke/results"
    phase smoke_start
    log "smoke: scripts/rules-at-scale/run-shard.sh --smoke --fake-upstream (keyless, one trial)"
    env "${keyless_unset[@]}" bash scripts/rules-at-scale/run-shard.sh --plan "$prereg" --name "$name" --lease-usd "$lease" --out "$shard/smoke/results" --smoke --fake-upstream > "$shard/smoke/results/run.stdout.log" 2>&1
    rc=$?
    phase smoke_end
    [ "$rc" -eq 0 ] || { tail -5 "$shard/smoke/results/run-shard.log" 2>/dev/null; log "smoke failed (exit $rc); the counted run does not start"; finish 4; }
  fi
  mkdir -p "$shard/results"
  phase run_start
  log "run: scripts/rules-at-scale/run-shard.sh --plan $prereg --name $name --lease-usd $lease ${extra[*]-}"
  # The controller's SIGTERM reaches the whole process group; run-shard.sh traps it, drains its meter and writes its rows.
  trap 'log "signal received; waiting for run-shard.sh to write its rows"' TERM HUP
  bash scripts/rules-at-scale/run-shard.sh --plan "$prereg" --name "$name" --lease-usd "$lease" --out "$shard/results" ${extra[@]+"${extra[@]}"} >> "$shard/results/run.stdout.log" 2>&1 &
  child=$!
  while :; do wait "$child"; rc=$?; kill -0 "$child" 2>/dev/null || break; done
  trap - TERM HUP
  phase run_end
  log "run-shard.sh exited $rc"
  finish "$rc"
fi
# --- end rules-at-scale ---
