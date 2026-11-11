
import glob,json,collections
from datetime import datetime
def t(s): return datetime.fromisoformat(s.replace('Z','+00:00'))
cuts={}; stalls={}; rows_out=[]
for f in glob.glob('/home/user/.capy/work/HARN-69/run*/*/*/results/proxy-usage.ndjson'):
    shard=f.split('/')[-3]; arm=shard.split('-')[0]
    recs=[json.loads(l) for l in open(f)]
    by=collections.defaultdict(list)
    for r in recs:
        if r.get('outcome')=='forwarded': by[r['key']].append(r)
    for k,rs in by.items():
        rs.sort(key=lambda r:r['at'])
        for a,b in zip(rs,rs[1:]):
            ta=a['input_tokens']+a['cached_tokens']+a['cache_write_tokens']; tb=b['input_tokens']+b['cached_tokens']+b['cache_write_tokens']
            if ta==tb and a['model']==b['model']:
                gap=(t(b['at'])-t(a['at'])).total_seconds()
                kind='cut15' if gap<60 else 'stall'
                d=cuts if kind=='cut15' else stalls
                d[shard+'|'+k]=d.get(shard+'|'+k,0)+a['actual_usd']
                rows_out.append((arm,kind,round(gap,1),round(a['actual_usd'],3),a['output_tokens'],a.get('charged_reservation'),round(a['reserved_usd'],3)))
c=collections.Counter(); u=collections.Counter()
for arm,kind,gap,usd,ot,cr,res in rows_out: c[(arm,kind)]+=1; u[(arm,kind)]+=usd
for k in c: print(k,c[k],round(u[k],2))
for r in rows_out:
    if r[1]=='stall': print(r)
print('gaps cut15',sorted({r[2] for r in rows_out if r[1]=='cut15'}))
json.dump(cuts,open('/home/user/.capy/work/HARN-69/cut15_by_key.json','w'))
rows=[json.loads(l) for l in open('/home/user/.capy/work/HARN-69/merged/trials-full.jsonl')]
with open('/home/user/.capy/work/HARN-69/merged/trials-full-nocut15.jsonl','w') as o:
    for r in rows:
        k=r['cell']+'|'+((r.get('frontier') or {}).get('harbor_trial') or '')
        if k in cuts and r.get('usage'): r['usage']['usd']-=cuts[k]
        o.write(json.dumps(r)+'\n')
