import json
A=json.load(open('/home/user/.capy/work/harness-evals/harn20/calib-run/merged/calibration-analysis.json'))
K=A['n_kept']; R=3; T=K*R
pp={p['pair']:p for p in A['per_pair']}
cpt={k:v['full']['usd_per_trial'] for k,v in pp.items()}
codex_ratio=pp['codex/sol']['full']['usd']/pp['codex/sol']['full']['repriced_check_usd']
sol={'openclaw/sol':A['sol_cross_estimate'][0]['sol_usd_per_trial']*codex_ratio,'hermes/sol':A['sol_cross_estimate'][1]['sol_usd_per_trial']*codex_ratio}
grid={k:pp[k]['grid_cells'] for k in pp}
layer={k:grid[k]*T*cpt[k] for k in pp}
solx={k:2*T*v for k,v in sol.items()}
offmin={'claude-code/opus':T*cpt['claude-code/opus'],'codex/sol':T*cpt['codex/sol']}
main=sum(layer.values())+sum(solx.values())+sum(offmin.values())
cells={'claude-code/opus':grid['claude-code/opus']+1,'openclaw/opus':grid['openclaw/opus']+2,'hermes/opus':grid['hermes/opus']+2,'codex/sol':grid['codex/sol']+1}
smoke=cpt['claude-code/opus']*cells['claude-code/opus']+cpt['openclaw/opus']*grid['openclaw/opus']+2*sol['openclaw/sol']+cpt['hermes/opus']*grid['hermes/opus']+2*sol['hermes/sol']+cpt['codex/sol']*cells['codex/sol']
import math
shards={k:math.ceil(v/3) for k,v in cells.items()}
res_opus=2.9214; res_sol=1.4546
resv=sum(shards[k]*(res_sol if k=='codex/sol' else res_opus) for k in shards)
main_lease=main*1.25+resv
joint={k:2*T*cpt[k] for k in pp}
joint_total=sum(joint.values())
joint_smoke=sum(2*cpt[k] for k in pp)
joint_lease=joint_total*1.25+3*res_opus+res_sol
cal_spend=6.6404786+11.2871586+8.0753948+3.7879965+0.4962976+0.9858302+0.5791918+0.2606648+0.2781936
remaining=500-cal_spend
total_leases=main_lease+smoke+joint_lease+joint_smoke
total_proj=main+smoke+joint_total+joint_smoke
sens2=total_leases+resv+3*res_opus+res_sol
out=dict(kept_tasks=K,reps=R,trials_per_cell=T,cost_per_trial_full=cpt,cost_per_trial_minimal={k:v['minimal']['usd_per_trial'] for k,v in pp.items()},sol_cross_per_trial_est=sol,codex_long_context_correction=codex_ratio,layer_grid=layer,layer_grid_total=sum(layer.values()),sol_cross=solx,sol_cross_total=sum(solx.values()),official_minimal=offmin,official_minimal_total=sum(offmin.values()),main_projected=main,cells=cells,shards=shards,n_shards=sum(shards.values()),reservation_opus=res_opus,reservation_sol=res_sol,in_flight_reservations=resv,main_lease=main_lease,smokes_projected=smoke,jointcut_run_projected=joint,jointcut_total=joint_total,jointcut_smokes=joint_smoke,jointcut_lease=joint_lease,calibration_model_spend=cal_spend,remaining_cap=remaining,total_projected_spend=total_proj,total_leases_plus_smokes=total_leases,fits=total_leases<=remaining,headroom=remaining-total_leases,sensitivity_two_reservations_per_shard=sens2,fits_two_reservations=sens2<=remaining,plan_estimate_at_13_tasks={'total':420,'note':'plan decision 7 plus resolution 1 about 451'})
json.dump(out,open('/home/user/.capy/work/harness-evals/harn20/calib-run/merged/projection.json','w'),indent=1)
print(json.dumps({k:(round(v,2) if isinstance(v,float) else ({a:round(b,3) for a,b in v.items()} if isinstance(v,dict) and all(isinstance(b,(int,float)) for b in v.values()) else v)) for k,v in out.items()}))
