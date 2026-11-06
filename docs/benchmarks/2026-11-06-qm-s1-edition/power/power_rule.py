
import numpy as np, json, sys
rng=np.random.default_rng(11)
def sim(K,m,delta,inter=0.4,nsim=800,nflip=1000,hetero=0.5,base_sd=1.2,base_mu=-0.2):
    rej_pool=0; rej_full=0; pp=[]
    signs=rng.choice([-1,1],size=(nflip,K))
    for s in range(nsim):
        b=rng.normal(base_mu,base_sd,size=K)
        d=[]; dpp=[]
        for g in range(2):
            bm=b+rng.normal(0,0.5,size=K)
            eff=delta+rng.normal(0,inter)+rng.normal(0,hetero,size=K)
            pN=1/(1+np.exp(-bm)); pE=1/(1+np.exp(-(bm+eff)))
            d.append(rng.binomial(m,pE)/m-rng.binomial(m,pN)/m); dpp.append((pE-pN).mean())
        dd=np.mean(d,axis=0); obs=dd.mean()
        p=(np.abs((signs*dd).mean(axis=1))>=abs(obs)-1e-12).mean()
        ok=p<0.05 and obs>0
        rej_pool+=ok; rej_full+= ok and d[0].mean()>=0 and d[1].mean()>=0
        pp.append(np.mean(dpp))
    return rej_pool/nsim, rej_full/nsim, float(np.mean(pp))
def mdd(res,idx):
    for i,r in enumerate(res):
        if r[idx]>=0.8:
            if i==0: return r[3]
            a=res[i-1]; t=(0.8-a[idx])/(r[idx]-a[idx]); return round(a[3]+t*(r[3]-a[3]),1)
out={}
for K,m in [(36,6),(72,3),(72,4),(72,6),(48,6)]:
  for inter in [0.0,0.4]:
    res=[]
    for delta in [0.2,0.3,0.4,0.5,0.6,0.75,0.9,1.1]:
        a,b,c=sim(K,m,delta,inter=inter); res.append((delta,round(a,3),round(b,3),round(c*100,1)))
    out[f"K{K}_m{m}_inter{inter}"]={"curve":res,"mdd_pooled_test":mdd(res,1),"mdd_full_rule":mdd(res,2)}
    print(K,m,inter,out[f"K{K}_m{m}_inter{inter}"]["mdd_pooled_test"],out[f"K{K}_m{m}_inter{inter}"]["mdd_full_rule"])
json.dump(out,open(sys.argv[1],'w'),indent=1)
