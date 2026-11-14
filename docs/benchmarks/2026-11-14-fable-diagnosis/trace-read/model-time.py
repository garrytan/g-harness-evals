
# usage: python3 model-time.py <raw run dir> <merged trials.jsonl>
import json,glob,os,statistics as st,collections,datetime,sys
R=sys.argv[1]
rows=[json.loads(l) for l in open(sys.argv[2])]
MM={'anthropic:claude-fable-5-2':'F','anthropic:claude-opus-5-5':'O'}
P=lambda s: datetime.datetime.fromisoformat(s.replace('Z','+00:00'))
agg=collections.defaultdict(list); share=collections.defaultdict(list); pertask=collections.defaultdict(lambda: collections.defaultdict(list))
for r in rows:
    m=MM.get(r['model'])
    if not m: continue
    f=r['frontier']; cell=r['cell']; plan=cell.split('-')[1]
    d=f"{R}/{plan}/{cell}/results/run/jobs/{f['harbor_job']}/{f['harbor_trial']}"
    ss=glob.glob(d+'/agent/sessions/projects/*/*.jsonl')
    if not ss: continue
    ev=[]
    for s in ss:
        for line in open(s,errors='replace'):
            try: x=json.loads(line)
            except: continue
            if x.get('isSidechain'): continue
            if x.get('timestamp') and x.get('type') in ('user','assistant'):
                ev.append((P(x['timestamp']),x['type'],x))
    ev.sort(key=lambda e:e[0])
    model_s=0; tool_s=0; prev=None; seen=set(); out=0
    for ts,ty,x in ev:
        if prev:
            dt=(ts-prev[0]).total_seconds()
            if ty=='assistant' and prev[1]=='user': model_s+=dt
            elif ty=='user' and prev[1]=='assistant': tool_s+=dt
            elif ty=='assistant' and prev[1]=='assistant': model_s+=dt
        if ty=='assistant':
            mid=(x.get('message') or {}).get('id')
            if mid not in seen:
                seen.add(mid); out+=((x['message'].get('usage') or {}).get('output_tokens') or 0)
        prev=(ts,ty)
    tot=model_s+tool_s
    if tot<30: continue
    agg[m].append(model_s); share[m].append(model_s/tot)
    pertask[r['task']][m].append(model_s/60)
for m in 'FO':
    print(m,'tries',len(agg[m]),'median model-wait min',round(st.median(agg[m])/60,1),'median share of session waiting on model',round(st.median(share[m]),2))
rat=[st.median(v['F'])/st.median(v['O']) for k,v in pertask.items() if v['F'] and v['O'] and st.median(v['O'])>0]
print('per-task model-time ratio F/O median',round(st.median(rat),2),'F more on',sum(r>1 for r in rat),'of',len(rat))

