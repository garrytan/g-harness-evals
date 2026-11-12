# Lines the preregistration names that compare-models.ts does not compute: the non-inferiority line, per-arm counts of
# rate limits, upstream 429s, effort mismatches, infra errors, time limits and harness errors, refused attempts, and the
# recognition and compaction counts. Run from this run's results/ directory: python3 analysis-full/prereg-lines.py
import json,collections
out={'note':'Lines the preregistration names that compare-models.ts does not compute. Sources: merged/trials.jsonl, analysis-full/analysis.json, analysis-full-norefusal/refusals.json and analysis-recognition/recognition-<arm>.json.'}
an=json.load(open('analysis-full/analysis.json'))
out['non_inferiority']=[]
for p in an['pairs']:
    b=sorted(p['difference']['bootstrap'])
    out['non_inferiority'].append({'pair':p['b']+' minus '+p['a'],'delta_points':round(p['difference']['delta']*100,1),'one_sided_95_lower_bound_points':round(b[int(0.05*len(b))]*100,1),'within_10_points':b[int(0.05*len(b))]>-0.10})
rows=[json.loads(l) for l in open('merged/trials.jsonl')]
c=collections.defaultdict(collections.Counter)
for r in rows:
    a=r['cell'].split('-')[0]; f=r.get('frontier') or {}
    c[a]['trials']+=1
    c[a]['termination_'+r['termination']]+=1
    c[a]['rate_limited']+=f.get('infra_class')=='rate_limited'
    c[a]['effort_mismatch']+=f.get('infra_class')=='effort_mismatch'
    c[a]['infra_error']+=r['termination']=='infra_error'
    c[a]['upstream_429']+=f.get('upstream_429') or 0
    c[a]['lease_refusals']+=f.get('lease_refusals') or 0
    e=f.get('efforts_agent_loop') or {}
    c[a]['agent_loop_requests']+=e.get('requests') or 0
    c[a]['agent_loop_requests_matching_effort']+=e.get('matching') or 0
out['counts_by_arm']={a:dict(v) for a,v in sorted(c.items())}
ref=json.load(open('analysis-full-norefusal/refusals.json'))
by=collections.Counter(); bp=collections.Counter()
for cell,v in ref['by_cell'].items(): by[cell.split('-')[0]]+=v['trials']; bp[cell.split('-')[0]]+=v['pass']
out['refused_trials_by_arm']={a:{'trials':by[a],'passed':bp[a]} for a in sorted(by)}
out['recognition_by_arm']={}
for a in ('fable52','fable51','opus55'):
    s=json.load(open(f'analysis-recognition/recognition-{a}.json'))
    t=s['trials']; pk=[x['peak_context_tokens'] for x in t if x['peak_context_tokens'] is not None]
    out['recognition_by_arm'][a]={'trials':len(t),'unrecognized_model_trials':sum(1 for x in t if x['unrecognized_lines']>0),'compacted_trials':sum(1 for x in t if x['compactions']),'compaction_pre_tokens':sorted(p for x in t for p in x['compactions']),'unreadable_compactions':sum(x['unreadable_compactions'] for x in t),'stops':sum(1 for x in t if x['stops']),'max_peak_context_tokens':max(pk) if pk else None,'trials_over_200k':sum(1 for p in pk if p>200000)}
json.dump(out,open('analysis-full/prereg-lines.json','w'),indent=1)
print(json.dumps(out))
