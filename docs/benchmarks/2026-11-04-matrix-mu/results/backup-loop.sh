#!/usr/bin/env bash
set -u
pin=$HOME/.capy/work/mu-pin
run=$HOME/.capy/work/mu-run
drive=<coordinator-drive>/handoffs/HARN-27/run
export UBI_OWNER=HARN-27
mkdir -p "$drive/map"
cp $HOME/.capy/work/mu-fanout.json "$drive/map/fanout.json"
backup() {
  for d in "$run"/*/; do
    s=$(basename "$d"); [ "$s" = merged ] && continue
    mkdir -p "$drive/$s" "$run/.backup/$s"
    [ -f "$d/shard-vm.json" ] && cp "$d/shard-vm.json" "$drive/$s/shard-vm.json" && cp "$d/shard-vm.json" "$drive/map/$s.shard-vm.json"
    [ -f "$d/lane.log" ] && cp "$d/lane.log" "$drive/$s/lane.log"
    vm=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('vm','') if d.get('cleanup')=='pending' else '')" "$d/shard-vm.json" 2>/dev/null)
    if [ -n "$vm" ]; then
      for f in trials.jsonl proxy-usage.ndjson; do timeout 120 bash "$pin/scripts/ubicloud/ubi-runner.sh" pull "$vm" "shard/results/$f" "$run/.backup/$s" >/dev/null 2>&1 || true; done
    fi
    src="$d/results/trials.jsonl"; [ -f "$src" ] || src="$run/.backup/$s/trials.jsonl"
    mkdir -p "$drive/$s/results"
    [ -f "$src" ] && cp "$src" "$drive/$s/results/trials.jsonl"
    [ -f "$run/.backup/$s/proxy-usage.ndjson" ] && cp "$run/.backup/$s/proxy-usage.ndjson" "$drive/$s/results/proxy-usage.ndjson"
  done
  printf '%s backup pass\n' "$(date -u +%FT%TZ)" >> "$run/.backup/loop.log"
}
sleep 240
while pgrep -f 'scripts/ubicloud/run-shard.sh' >/dev/null; do backup; sleep 900; done
backup
echo "backup loop done"
