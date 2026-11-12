# Splits the duplicate-prompt pairs into the sidecar's 15-second cuts (resent within 60 s) and stalled-stream charges, and
# writes merged/trials.jsonl without the cut calls only. Adapted from the 2.1.312 run's script of the same name; run
# the same name; run on the run's controller from the folder that holds run/<plan>/<shard>/ (it reads each shard's proxy-usage.ndjson).
import glob,json,collections,sys
from datetime import datetime
def t(s): return datetime.fromisoformat(s.replace('Z','+00:00'))
cuts={}; stalls={}; rows_out=[]
for f in sorted(glob.glob('run/r*/*/results/proxy-usage.ndjson')):
    shard=f.split('/')[2]; arm=shard.split('-')[0]
    by=collections.defaultdict(list)
    for l in open(f):
        r=json.loads(l)
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
                rows_out.append({'arm':arm,'kind':kind,'gap_s':round(gap,1),'usd':round(a['actual_usd'],3),'output_tokens':a['output_tokens'],'charged_reservation':a.get('charged_reservation'),'reserved_usd':round(a['reserved_usd'],3)})
c=collections.Counter(); u=collections.Counter()
for r in rows_out: c[(r['arm'],r['kind'])]+=1; u[(r['arm'],r['kind'])]+=r['usd']
summary={f'{a}|{k}':{'pairs':c[(a,k)],'usd':round(u[(a,k)],2)} for (a,k) in sorted(c)}
print(json.dumps(summary))
json.dump({'summary':summary,'cut15_by_key':cuts,'stall_by_key':stalls,'pairs':rows_out},open('analysis/cut15-calls.json','w'),indent=1)
with open(sys.argv[2],'w') as o:
    for l in open(sys.argv[1]):
        r=json.loads(l); k=r['cell']+'|'+((r.get('frontier') or {}).get('harbor_trial') or '')
        if k in cuts and r.get('usage'): r['usage']['usd']-=cuts[k]
        o.write(json.dumps(r)+'\n')
