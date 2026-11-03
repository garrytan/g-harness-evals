
import json, os
W='/workspace/he-cal'
man=json.load(open(W+'/harnesses/ablation/manifest.json'))['maps']
def m(h,wire): return [x for x in man if x['harness']==h and x['wire']==wire][0]
def layers(f):
    d=json.load(open(W+'/harnesses/ablation/'+f))
    s=set()
    def walk(o):
        if isinstance(o,dict):
            if 'layer' in o and isinstance(o['layer'],str): s.add(o['layer'])
            for v in o.values(): walk(v)
        elif isinstance(o,list):
            for v in o: walk(v)
    walk(d); return sorted(s)
pairs=[('claude-code','opus','anthropic:claude-opus-5-5','anthropic-messages'),('openclaw','opus','anthropic:claude-opus-5-5','anthropic-messages'),('hermes','opus','anthropic:claude-opus-5-5','anthropic-messages'),('codex','sol','openai:gpt-6.1-sol','openai-responses')]
cells=[]
for h,short,model,wire in pairs:
    mm=m(h,wire); L=layers(mm['file'])
    for arm,lay in (('full',[]),('minimal',L)):
        cells.append({'id':f'{h}-{short}-{arm}-mu-v03-dev','harness':h,'model':model,'slice':'multiuser','split':'dev','task_set':'v0.3','repetitions':1,'ceiling':{'input_tokens':80000,'output_tokens':6000},'network':'internal','ablation':{'map':'harnesses/ablation/'+mm['file'],'map_sha256':mm['sha256'],'layers':lay}})
p={'schema_version':1,'run_id':'prompt-archaeology-calib-2026-11','question':'internal-task calibration, uncounted: full (ablation bound, zero layers removed) and minimal (every removable layer of the committed map removed) on the 20 public v0.3 multi-user dev tasks, one repetition, for Claude Code, OpenClaw and Hermes Agent on anthropic:claude-opus-5-5 and Codex on openai:gpt-6.1-sol at reasoning effort medium; no gstack, no gbrain. It sets the counted run\'s tasks (the v0.3 pilot\'s 10 to 90 percent family rule on the full cells) and leases (plan decisions 6 and 7). Scratch preregistration, never counted.','tasks':{},'cells':cells,'wall_clock_s':{'multiuser':1500},'spend_cap_usd':45,'drop_order':[],'minimum_v01':[c['id'] for c in cells]}
d=os.path.expanduser('~/.capy/work/harness-evals/harn20/calib-run'); os.makedirs(d,exist_ok=True)
json.dump(p,open(d+'/prereg.json','w'),indent=1)
leases={'claude-code':11.5,'openclaw':14,'hermes':12,'codex':7.5}
names={'claude-code':'cc','openclaw':'oc','hermes':'he','codex':'cx'}
fan={'commit':'1c497ae69e9b44e07c9bc76ecff37d050d337541','prereg':d+'/prereg.json','dest':d+'/shards','size':'standard-16','options':['--pre-smoke','scripts/ablation-golden.sh'],
 'shards':[{'name':names[h],'cells':f'{h}-{s}-full-mu-v03-dev,{h}-{s}-minimal-mu-v03-dev','lease_usd':leases[h]} for h,s,_,_ in pairs]}
json.dump(fan,open(d+'/fanout.json','w'),indent=1)
for c in cells: print(c['id'], c['ablation']['layers'])
print(sum(leases.values()))
