
# usage: python3 export-blind.py <raw run dir with r1h1/... shard folders> <merged trials.jsonl> <out dir>
import json,glob,os,re,random,collections,sys
R=sys.argv[1]
OUT=os.path.join(sys.argv[3],'blind'); KEY=os.path.join(sys.argv[3],'key.json')
os.makedirs(OUT,exist_ok=True)
rows=[json.loads(l) for l in open(sys.argv[2])]
M={'anthropic:claude-fable-5-2':'F','anthropic:claude-opus-5-5':'O'}
t=collections.defaultdict(lambda: collections.defaultdict(list))
for r in rows:
    if r['model'] in M: t[r['task']][M[r['model']]].append(r)
tasks=[k for k in sorted(t) if not all(x['grade']=='pass' for m in 'FO' for x in t[k][m])]
MODEL=re.compile(r'(?i)(claude[-_ ]?(fable|opus|sonnet|haiku)[-_ .0-9a-z\[\]]*|\b(fable|opus|sonnet|haiku)\b([ -]?\d+([.-]\d+)?)?|fable5[12]|opus55|fable51)')
SEC=[re.compile(r'sk-ant-[A-Za-z0-9_\-]+'),re.compile(r'sk-[A-Za-z0-9_\-]{20,}'),re.compile(r'(?i)((api[_-]?key|auth[_-]?token|authorization|x-api-key|bearer)["\x27]?\s*[=:]\s*["\x27]?)[^\s"\x27,}]+')]
COST=re.compile(r'(?i)(\\?"(total_cost_usd|costUSD|cost_usd|contextWindow|maxOutputTokens|context_window)\\?"\s*:\s*)[0-9.eE+-]+')
def scrub(s):
    s=MODEL.sub('[MODEL]',s); s=COST.sub(lambda m:m.group(1)+'0',s)
    s=SEC[0].sub('[REDACTED]',s); s=SEC[1].sub('[REDACTED]',s); s=SEC[2].sub(lambda m:m.group(1)+'[REDACTED]',s)
    return s
def cut(s,n):
    s=str(s)
    if len(s)<=n: return s
    h=int(n*0.65); return s[:h]+f'\n...[{len(s)-n} chars cut]...\n'+s[-(n-h):]
def jobdir(r):
    f=r['frontier']; cell=r['cell']; plan=cell.split('-')[1]
    d=f"{R}/{plan}/{cell}/results/run/jobs/{f['harbor_job']}/{f['harbor_trial']}"
    if os.path.isdir(d): return d
    g=glob.glob(f"{R}/**/{f['harbor_trial']}",recursive=True)
    return g[0] if g else None
EXC={'AgentTimeoutError':'the harness time limit was reached and the agent was stopped','AgentSafetyRefusalError':'the API returned a safety-refusal stop and the harness ended the session','UnknownApiError':'the API returned an error and the harness ended the session',None:'none'}
def render(r,label,taskdir):
    d=jobdir(r); f=r['frontier']; L=[]
    A=L.append
    A(f'# {r["task"]}, try {label}')
    A('')
    A(f'- Outcome: {"PASS" if r["grade"]=="pass" else "FAIL"} (verifier reward {f.get("reward")})')
    A(f'- Harness ending: {r["termination"]}; exception: {EXC.get(f.get("exception"),f.get("exception"))}')
    A(f'- Wall time: {r["wall_ms"]/60000:.1f} min; API requests: {r["usage"]["requests"]}; output tokens: {r["usage"]["output_tokens"]}; input tokens (incl. cached): {r["usage"]["input_tokens"]}')
    if d is None:
        A('- TRACE MISSING'); return '\n'.join(L), {'missing':True}
    res=json.load(open(d+'/result.json')) if os.path.exists(d+'/result.json') else {}
    ei=res.get('exception_info') or {}
    if ei: A(f'- Exception message: {scrub(cut(ei.get("exception_message",""),1200))}')
    sess=sorted(glob.glob(d+'/agent/sessions/projects/*/*.jsonl'))+sorted(glob.glob(d+'/agent/sessions/projects/*/*/subagents/*.jsonl'))
    peak=0; t0=None; body=[]; seen=set(); ntool=0
    for sp in sess:
        for line in open(sp,errors='replace'):
            try: x=json.loads(line)
            except: continue
            ts=x.get('timestamp')
            if ts and t0 is None:
                import datetime; t0=datetime.datetime.fromisoformat(ts.replace('Z','+00:00'))
            el=''
            if ts and t0:
                import datetime; el=f'[{(datetime.datetime.fromisoformat(ts.replace("Z","+00:00"))-t0).total_seconds()/60:5.1f}m]'
            side=' (sidechain)' if x.get('isSidechain') else ''
            m=x.get('message')
            if x.get('type')=='assistant' and isinstance(m,dict):
                u=m.get('usage') or {}
                ctx=(u.get('input_tokens') or 0)+(u.get('cache_read_input_tokens') or 0)+(u.get('cache_creation_input_tokens') or 0)
                peak=max(peak,ctx)
                for b in m.get('content') or []:
                    ty=b.get('type')
                    if ty=='text': body.append(f'{el} ASSISTANT{side} (context {ctx//1000}K): {scrub(cut(b.get("text",""),2500))}')
                    elif ty=='thinking' and b.get('thinking'): body.append(f'{el} THINKING{side}: {scrub(cut(b["thinking"],1200))}')
                    elif ty=='tool_use':
                        ntool+=1; body.append(f'{el} TOOL CALL{side} {b.get("name")}: {scrub(cut(json.dumps(b.get("input"),ensure_ascii=False),1500))}')
            elif x.get('type')=='user' and isinstance(m,dict):
                c=m.get('content')
                if isinstance(c,str):
                    if (not body): body.append(f'{el} USER PROMPT{side}: {scrub(cut(c,4000))}')
                    else: body.append(f'{el} USER{side}: {scrub(cut(c,1500))}')
                elif isinstance(c,list):
                    for b in c:
                        if b.get('type')=='tool_result':
                            cc=b.get('content')
                            if isinstance(cc,list): cc='\n'.join(str(z.get('text','')) for z in cc if isinstance(z,dict))
                            body.append(f'{el} TOOL RESULT{side}{" (error)" if b.get("is_error") else ""}: {scrub(cut(cc,1500))}')
                        elif b.get('type')=='text' and body: body.append(f'{el} USER{side}: {scrub(cut(b.get("text",""),1500))}')
            elif x.get('type')=='system' and x.get('content'):
                body.append(f'{el} SYSTEM{side}: {scrub(cut(x.get("content"),800))}')
    A(f'- Tool calls: {ntool}; peak context: {peak//1000}K tokens')
    A('')
    A('## Session trace')
    A('')
    A('\n\n'.join(body) if body else '(no session transcript recorded)')
    cc=d+'/agent/claude-code.txt'
    if os.path.exists(cc):
        s=open(cc,errors='replace').read()
        A(''); A('## Last 2,500 characters of the harness console log'); A(''); A('~~~'); A(scrub(s[-2500:])); A('~~~')
    v=d+'/verifier/test-stdout.txt'
    A(''); A('## Verifier output (tail)'); A(''); A('~~~')
    A(scrub(cut(open(v,errors='replace').read(),4000)) if os.path.exists(v) else '(verifier did not run or wrote nothing)')
    A('~~~')
    return '\n'.join(L), {'peak_ctx':peak,'tool_calls':ntool,'dir':d}
rng=random.Random(20261114)
key={}; stats={}
for k in tasks:
    os.makedirs(f'{OUT}/{k}',exist_ok=True)
    tr=[x for x in t[k]['F']+t[k]['O'] if x['grade']=='pass'][:1] or (t[k]['F']+t[k]['O'])
    tdir=glob.glob(f'{R}/*/*/results/run/tasks/{k}')
    td=tdir[0]
    parts=[f'# Task: {k}','','## Instruction given to the agent','',scrub(open(td+'/instruction.md').read())]
    if os.path.exists(td+'/task.toml'): parts+=['','## task.toml','','~~~',scrub(open(td+'/task.toml').read()),'~~~']
    for tf in sorted(glob.glob(td+'/tests/*'))[:6]:
        if os.path.isfile(tf) and os.path.getsize(tf)<200000:
            parts+=['',f'## Grader file {os.path.basename(tf)}','','~~~',scrub(cut(open(tf,errors='replace').read(),6000)),'~~~']
    open(f'{OUT}/{k}/task.md','w').write('\n'.join(parts)+'\n')
    labs=['X','Y']; rng.shuffle(labs)
    key[k]={'F':labs[0],'O':labs[1]}
    for m in 'FO':
        for i,r in enumerate(sorted(t[k][m],key=lambda r:r['trial_id']),1):
            txt,st=render(r,f'{key[k][m]}-{i}',td)
            open(f'{OUT}/{k}/{key[k][m]}-{i}.md','w').write(txt+'\n')
            stats[f'{k}/{key[k][m]}-{i}']={'model':m,'trial_id':r['trial_id'],'grade':r['grade'],'termination':r['termination'],'exception':r['frontier'].get('exception'),'usd':r['usage']['usd'],'wall_min':r['wall_ms']/60000,**{a:b for a,b in st.items() if a!='dir'}}
json.dump({'seed':20261114,'labels':key,'tries':stats},open(KEY,'w'),indent=1)
print(len(tasks),tasks)
EOF_MARK=1

