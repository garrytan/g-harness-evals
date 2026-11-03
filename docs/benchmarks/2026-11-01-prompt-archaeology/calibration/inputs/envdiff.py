import json,sys
def env(p):
    for line in open(p):
        r=json.loads(line)
        b=r.get('body')
        if r.get('method')!='POST' or not isinstance(b,dict) or 'messages' not in b: continue
        for m in b['messages']:
            if m.get('role')=='system':
                c=m['content']; t=c if isinstance(c,str) else c[0]['text']
                i=t.find('# Environment\nYou'); return t[i:i+10000]
for p in sys.argv[1:]:
    open(p+'.env.txt','w').write(env(p) or 'NONE')
