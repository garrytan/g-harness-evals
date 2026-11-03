# Exposure MDD at 80% power for installer minus told, per host, from the told cells' per-task exposure rates in
# comparisons.gbrain.json (scope all): each told trial is redrawn at its task's rate, each installer trial at that rate
# plus a uniform shift, and the exact two-sided sign-flip test on the 17 per-task deltas must give p < 0.05 with a positive sum.
# 300 draws per 5-point step, seed 7. Usage: python3 exposure-mdd.py <results dir>  (prints JSON)
import json, random, itertools, sys, os
d=json.load(open(os.path.join(sys.argv[1],'comparisons.gbrain.json')))
out={}
sc=[x for x in d['scopes'] if x['scope']=='all'][0]
for p in sc['endpoints']['exposure']['comparisons']:
    h=p['harness']
    told=[t['base']/3 for t in p['per_task']]
    pertask=[(t['task'],t['base'],t['rung']) for t in p['per_task']]
    pos=sum(1 for t in pertask if t[2]>t[1]); neg=sum(1 for t in pertask if t[2]<t[1])
    def pval(deltas):
        nz=[x for x in deltas if x!=0]
        if not nz: return 1.0
        obs=abs(sum(nz)); m=len(nz); cnt=0
        for signs in itertools.product((1,-1),repeat=m):
            if abs(sum(s*abs(x) for s,x in zip(signs,nz)))>=obs-1e-12: cnt+=1
        return cnt/2**m
    random.seed(7)
    res={}
    for step in range(1,21):
        dd=step*0.05; hits=0; R=300
        for _ in range(R):
            deltas=[]
            for r in told:
                b=sum(random.random()<r for _ in range(3)); a=sum(random.random()<min(1,r+dd) for _ in range(3))
                deltas.append((a-b)/3)
            if pval(deltas)<0.05 and sum(deltas)>0: hits+=1
        res[round(dd*100)]=hits/R
        if hits/R>=0.8: break
    out[h]={'tasks_up':pos,'tasks_down':neg,'power_by_points':res,'mdd_points_80':next((k for k,v in res.items() if v>=0.8),None)}
print(json.dumps(out))
