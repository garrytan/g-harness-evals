# merged/trials.jsonl with the first call of every duplicate-prompt pair taken out of the trial's usage.usd.
import json,sys
cut=json.load(open(sys.argv[1]))['by_key']
n=0; tot=0
with open(sys.argv[3],'w') as o:
    for l in open(sys.argv[2]):
        r=json.loads(l); k=r['cell']+'|'+((r.get('frontier') or {}).get('harbor_trial') or '')
        if k in cut and r.get('usage'):
            r['usage']['usd']-=cut[k]; n+=1; tot+=cut[k]
        o.write(json.dumps(r)+'\n')
print('trials adjusted',n,'usd removed',round(tot,2),'keys',len(cut))
