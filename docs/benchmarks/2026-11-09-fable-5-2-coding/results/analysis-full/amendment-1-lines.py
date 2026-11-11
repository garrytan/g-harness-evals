
import json,collections,sys
D='/workspace/harness-evals/docs/benchmarks/2026-11-09-fable-5-2-coding/results'
out={'note':'Lines amendment 1 promised that compare-models.ts does not compute. The rules were fixed in amendment 1 before any data; this script was written after the data. Source: merged/trials-full.jsonl, analysis-full/analysis.json and analysis-full-norefusal/refusals.json.'}
an=json.load(open(D+'/analysis-full/analysis.json'))
out['non_inferiority']=[]
for p in an['pairs']:
    b=sorted(p['difference']['bootstrap'])
    out['non_inferiority'].append({'pair':p['b']+' minus '+p['a'],'delta_points':round(p['difference']['delta']*100,1),'one_sided_95_lower_bound_points':round(b[int(0.05*len(b))]*100,1),'within_10_points':b[int(0.05*len(b))]>-0.10})
rows=[json.loads(l) for l in open(D+'/merged/trials-full.jsonl')]
rl=collections.Counter(); u=collections.Counter(); n=collections.Counter()
for r in rows:
    a=r['cell'].split('-')[0]; n[a]+=1; f=r.get('frontier') or {}
    rl[a]+=f.get('infra_class')=='rate_limited'; u[a]+=f.get('upstream_429') or 0
out['rate_limited']={a:{'trials':n[a],'rate_limited':rl[a],'upstream_429':u[a]} for a in n}
ref=json.load(open(D+'/analysis-full-norefusal/refusals.json'))
by=collections.Counter()
for c,v in ref['by_cell'].items(): by[c.split('-')[0]]+=v['trials']
out['refused_trials_by_arm']=dict(by)
json.dump(out,open(D+'/analysis-full/amendment-1-lines.json','w'),indent=1)
print(json.dumps(out))
