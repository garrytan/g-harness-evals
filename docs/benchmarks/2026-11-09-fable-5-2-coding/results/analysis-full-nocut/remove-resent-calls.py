
import json
cut=json.load(open('cut_by_key.json'))
n=0; tot=0
with open('merged/trials-full-nocut.jsonl','w') as o:
    for l in open('merged/trials-full.jsonl'):
        r=json.loads(l); k=r['cell']+'|'+((r.get('frontier') or {}).get('harbor_trial') or '')
        if k in cut and r.get('usage'):
            r['usage']['usd']-=cut[k]; n+=1; tot+=cut[k]
        o.write(json.dumps(r)+'\n')
print('trials adjusted',n,'usd removed',round(tot,2),'keys',len(cut))
