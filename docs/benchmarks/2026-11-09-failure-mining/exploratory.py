# Exploratory numbers in report.md (not preregistered): the scope table, unscoped-search sub-causes,
# the paired overall failure difference, wrong_place session_carryover counts and scoping_impossible by harness.
# Usage, from this folder: python3 exploratory.py <corpus manifest.jsonl> <particle-1 labels.jsonl>
import json,collections,random,sys
MANIFEST,LABELS=sys.argv[1],sys.argv[2]
M={}
for l in open(MANIFEST):
    m=json.loads(l); M[m['trial_id']]=m
L={}
for l in open(LABELS):
    d=json.loads(l); L[d['trial_id']]=d
RUNS={'2026-10-31-v03-opus-dev','2026-11-01-installer-cc-codex','2026-11-03-qm-c4-told-live','2026-11-06-harness-zero-h2h'}
TAGS=['scoping_unused','scoping_impossible','scope_dropped','unneeded_lookup']
fr=lambda xs: sum(x['grade']!='pass' for x in xs)/len(xs)
# 1. scope table and sub-causes
c=collections.defaultdict(lambda:[0,0,0,collections.Counter()])
cells=collections.defaultdict(lambda: collections.defaultdict(list))
for m in M.values():
    if m['run'] not in RUNS or m['population']!='default' or m['kind']!='multiuser': continue
    g=m['gbrain']; arm='brain' if g.get('present') else 'none'
    cells[(m['run'],m['harness'],m['model'])][(m['task'],arm)].append(m)
    k=(g.get('brain'),g.get('scope'),g.get('install')+('/'+g['route'] if g.get('route') else '')) if g.get('present') else ('no brain','','')
    e=c[k]; e[0]+=1
    if m['grade']!='pass':
        e[1]+=1; lab=L.get(m['trial_id'],{})
        if lab.get('root_cause')=='unscoped_brain_search':
            e[2]+=1; e[3][next((t for t in TAGS if t in lab.get('note','')),'untagged')]+=1
print('scope table: brain|scope|install|trials|failed%|unscoped%|subcauses')
for k,(n,f,u,s) in sorted(c.items(),key=str): print(k,n,'%.1f'%(100*f/n),'%.1f'%(100*u/n),dict(s))
# 2. sub-causes over paired brain arms (tasks run in both arms)
sub=collections.Counter(); unitd=[]
for key in sorted(cells):
    cc=cells[key]
    both=sorted(t for t in {t for (t,a) in cc} if (t,'brain') in cc and (t,'none') in cc)
    unitd+=[fr(cc[(t,'brain')])-fr(cc[(t,'none')]) for t in both]
    for t in both:
        for x in cc[(t,'brain')]:
            lab=L.get(x['trial_id'],{})
            if x['grade']!='pass' and lab.get('root_cause')=='unscoped_brain_search':
                sub[next((s for s in TAGS if s in lab.get('note','')),'untagged')]+=1
print('paired brain-arm unscoped sub-causes',dict(sub),'total',sum(sub.values()))
# 3. overall failure difference per unit
random.seed(1)
mean=sum(unitd)/len(unitd)
bs=sorted(sum(random.choice(unitd) for _ in unitd)/len(unitd) for _ in range(5000))
print('overall failure diff per unit %.1f [%.1f, %.1f] units %d worse %d better %d'%(100*mean,100*bs[125],100*bs[4875],len(unitd),sum(d>0 for d in unitd),sum(d<0 for d in unitd)))
# 4. wrong_place session_carryover
wp=[l for l in L.values() if l.get('root_cause')=='wrong_place' and M[l['trial_id']]['population']=='default']
sc=[l for l in wp if 'session_carryover' in l.get('note','')]
print('wrong_place',len(wp),'session_carryover',len(sc),'no-brain',sum(not M[l['trial_id']]['gbrain'].get('present') for l in sc))
print('carryover by harness',dict(collections.Counter(M[l['trial_id']]['harness'] for l in sc)))
print('wrong_place top task x harness',collections.Counter((M[l['trial_id']]['harness'],M[l['trial_id']]['task']) for l in wp).most_common(6))
print('scoping_impossible by harness',dict(collections.Counter(M[l['trial_id']]['harness'] for l in L.values() if l.get('root_cause')=='unscoped_brain_search' and 'scoping_impossible' in l.get('note','') and M[l['trial_id']]['population']=='default')))
