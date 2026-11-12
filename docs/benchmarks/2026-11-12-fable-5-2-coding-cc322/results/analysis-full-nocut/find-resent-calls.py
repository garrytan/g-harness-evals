# Duplicate-prompt pairs (a forwarded call followed by a call with the same prompt size on the same trial key): the egress
# sidecar's 15-second cut and the stalled-stream full-reservation charge alike. Adapted from the 2.1.312 run's script of
# the same name; run on the run's controller from the folder that holds run/<plan>/<shard>/ (it reads each shard's proxy-usage.ndjson).
import glob,json,collections
arm_cut=collections.Counter(); arm_cut_usd=collections.Counter(); arm_calls=collections.Counter(); arm_usd=collections.Counter()
cut_by_key=collections.defaultdict(float)
for f in sorted(glob.glob('run/r*/*/results/proxy-usage.ndjson')):
    shard=f.split('/')[2]; arm=shard.split('-')[0]
    recs=[json.loads(l) for l in open(f)]
    by=collections.defaultdict(list)
    for r in recs:
        if r.get('outcome')!='forwarded': continue
        arm_calls[arm]+=1; arm_usd[arm]+=r['actual_usd']
        by[r['key']].append(r)
    for k,rs in by.items():
        rs.sort(key=lambda r:r['at'])
        for a,b in zip(rs,rs[1:]):
            ta=a['input_tokens']+a['cached_tokens']+a['cache_write_tokens']; tb=b['input_tokens']+b['cached_tokens']+b['cache_write_tokens']
            if ta==tb and a['model']==b['model']:
                arm_cut[arm]+=1; arm_cut_usd[arm]+=a['actual_usd']; cut_by_key[(shard,k)]+=a['actual_usd']
summary={a:{'calls':arm_calls[a],'usd':round(arm_usd[a],2),'dup_prompt_pairs':arm_cut[a],'usd_first_of_pair':round(arm_cut_usd[a],2)} for a in sorted(arm_calls)}
print(json.dumps(summary))
json.dump({'by_arm':summary,'by_key':{f'{s}|{k}':v for (s,k),v in sorted(cut_by_key.items())}},open('analysis/resent-calls.json','w'),indent=1)
