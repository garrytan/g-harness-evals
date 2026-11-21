#!/usr/bin/env bash
# Audit 1 driver: for each shard with recalled trials, locate (or extract) each recalled trial's state/.gbrain and dump where the
# brain holds the nonce. Archives are extracted one shard at a time into scratch and deleted after.
set -euo pipefail
A=$HOME/.capy/work/gst-2715/audits
RUN=$HOME/.capy/work/gst-2715/run
S=$A/scratch
OUT=$A/scratch/brains.json
for shard in "$@"; do
  python3 - "$shard" <<'EOF'
import json,sys,os
shard=sys.argv[1]
A=os.path.expanduser('~/.capy/work/gst-2715/audits'); RUN=os.path.expanduser('~/.capy/work/gst-2715/run')
o=[t for t in json.load(open(A+'/scratch/recall-events.json')) if t['shard']==shard]
plain=shard in ('s01','s02','s09')
base=f"{RUN}/dest/{shard}/results/trials" if plain else f"{A}/scratch/x/{shard}/trials"
items=[{'trial_id':t['trial_id'],'nonce':t['nonce'],'gbrain_dir':f"{base}/{t['cell']}/gbrain-install/{t['rn']}/state/.gbrain"} for t in o]
json.dump(items,open(f"{A}/scratch/list-{shard}.json",'w'))
open(f"{A}/scratch/pat-{shard}.txt",'w').write('\n'.join(f"trials/{t['cell']}/gbrain-install/{t['rn']}/state/.gbrain/*" for t in o)+'\n')
print(shard,len(items),'plain' if plain else 'archive')
EOF
  if [ "$shard" != s01 ] && [ "$shard" != s02 ] && [ "$shard" != s09 ]; then
    mkdir -p "$S/x/$shard"
    tar -I zstd -xf "$RUN/dest/$shard/results/trials.tar.zst" -C "$S/x/$shard" --wildcards --exclude='*/.gbrain-ipc-secret' --exclude='*/secret/*' -T "$S/pat-$shard.txt"
    df -h "$HOME" | tail -1
  fi
  (cd "$A/tools" && env -i PATH=/usr/local/bin:/usr/bin:/bin:$HOME/.bun/bin HOME=$HOME bun brain-dump.ts "$S/list-$shard.json" "$OUT" "$S/work")
  rm -rf "$S/x/$shard"
done
df -h "$HOME" | tail -1
