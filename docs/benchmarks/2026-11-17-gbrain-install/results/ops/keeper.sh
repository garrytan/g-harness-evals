#!/usr/bin/env bash
# Keeps the machine awake while the detached fan-out runs, and every 10 minutes trims package caches from finished trials' state/ on this owner's VMs (prune-state.sh) and gbrain clone packs (prune-packs-vm.sh), so each pull stays small. It deletes nothing on this machine.
G=$HOME/.capy/work/gst-2715/run
R=$HOME/.capy/work/gst-2715/run-wt/scripts/ubicloud/ubi-runner.sh
export UBI_OWNER=HARN-98 UBI_TTL_HOURS=12 UBI_QUOTA_VCPUS=464
n=$1; [ -n "$n" ] || n=20000
end=$(( $(date +%s) + n )); last=0
while [ "$(date +%s)" -lt "$end" ]; do
  if [ $(( $(date +%s) - last )) -ge 600 ]; then
    last=$(date +%s)
    for vm in $(timeout 120 bash $R list --mine 2>/dev/null | awk '{print $2}' | grep '^ubirun-'); do
      echo "$(date -u +%FT%TZ) $vm $(timeout 600 bash $R ssh $vm 'bash -s' < $G/prune-state.sh 2>/dev/null | tail -1) $(timeout 900 bash $R ssh $vm 'bash -s' < $G/prune-packs-vm.sh 2>/dev/null | tail -1)" >> $G/prune.log
    done
  fi
  pgrep -f "fanout.sh --manifest $G/fanout[0-9].manifest.json" >/dev/null || pgrep -f "run-shard.sh" >/dev/null || { echo "fan-out ended $(date -u +%FT%TZ)"; df -h / | tail -1; exit 0; }
  sleep 60
done
echo "keeper timer ended $(date -u +%FT%TZ)"; df -h / | tail -1
