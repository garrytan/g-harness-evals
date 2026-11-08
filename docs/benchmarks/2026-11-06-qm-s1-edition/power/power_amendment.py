
import numpy as np, json, sys, re
src=open(sys.argv[1]).read()
body=src.split("out={}")[0]
out={}
for K,m in [(48,9),(48,6),(24,9),(24,18),(24,12)]:
  for inter in [0.0,0.4]:
    g={}
    exec(body,g)
    res=[]
    for delta in [0.2,0.3,0.4,0.5,0.6,0.75,0.9,1.1,1.3,1.5]:
        a,b,c=g['sim'](K,m,delta,inter=inter); res.append((delta,round(a,3),round(b,3),round(c*100,1)))
    out[f"K{K}_m{m}_inter{inter}"]={"mdd_pooled_test":g['mdd'](res,1),"mdd_full_rule":g['mdd'](res,2)}
    print(K,m,inter,out[f"K{K}_m{m}_inter{inter}"],flush=True)
json.dump(out,open(sys.argv[2],'w'),indent=1)
