
import glob,json,collections
arm_cut=collections.Counter(); arm_cut_usd=collections.Counter(); arm_calls=collections.Counter(); arm_usd=collections.Counter()
cut_by_key=collections.defaultdict(float); examples=[]
for f in glob.glob('run*/*/*/results/proxy-usage.ndjson'):
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
                if len(examples)<6: examples.append((shard,k,a['at'],b['at'],ta,a['output_tokens'],b['output_tokens'],round(a['actual_usd'],3)))
for a in arm_calls: print(a,'calls',arm_calls[a],'usd',round(arm_usd[a],2),'dup-prompt pairs',arm_cut[a],'usd of first of pair',round(arm_cut_usd[a],2))
for e in examples: print(e)
json.dump({f'{s}|{k}':v for (s,k),v in cut_by_key.items()},open('cut_by_key.json','w'))
