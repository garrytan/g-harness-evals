import json
d=json.load(open('/home/user/.capy/work/harness-evals/harn20/calibration/design-options.json'))
f=lambda x:f"{x:.0f}%" if False else f"{100*x:.0f}%"
lines=[]
lines.append('| Design | Pooled MDD | Per-pair MDD (cc / oc / he / cx) | Pass CI half-width, pooled | Main run in full: spend / lease | Grid only: spend / lease | Joint-cut: spend / lease | Total leases + smokes, full / grid only | Against $467.61 |')
lines.append('|---|---|---|---|---|---|---|---|---|')
for o in d['designs']:
    s=o['spend'];pp=o['per_pair']
    fits=('fits ($%.2f spare)'%s['headroom_full']) if s['headroom_full']>=0 else ('over by $%.2f; grid only %s'%(-s['headroom_full'],('fits ($%.2f spare)'%s['headroom_grid_only']) if s['headroom_grid_only']>=0 else 'over by $%.2f'%(-s['headroom_grid_only'])))
    lines.append(f"| ({o['design']}) {o['label']} | {o['pooled']['mdd_points']:.1f} | {' / '.join('%.1f'%x['mdd_points'] for x in pp)} | {o['pooled']['pass_halfwidth_points']:.1f} | ${s['main_full']:.2f} / ${s['main_full_lease']:.2f} | ${s['main_grid_only']:.2f} / ${s['main_grid_only_lease']:.2f} | ${s['jointcut']:.2f} / ${s['jointcut_lease']:.2f} | ${s['total_leases_plus_smokes_full']:.2f} / ${s['total_leases_plus_smokes_grid_only']:.2f} | {fits} |")
lines.append('')
lines.append('| Design | Pair | P(pass CI lower bound above -10), true delta 0 | P(cost CI excludes 0), effect = minimal | P(cost CI excludes 0), effect = minimal / 7 | P(cut reachable), effect = minimal / 7 |')
lines.append('|---|---|---|---|---|---|')
for o in d['designs']:
    lines.append(f"| ({o['design']}) | pooled rates | {f(o['pooled']['p_pass_lb_above_minus10'])} | | | |")
    for x in o['per_pair']:
        r=lambda v:'%s to %s'%(f(v[0]),f(v[1])) if abs(v[0]-v[1])>0.005 else f(v[0])
        lines.append(f"| ({o['design']}) | {x['pair']} | {f(x['p_pass_lb_above_minus10'])} | {r(x['p_cost_excludes0_minimal_effect'])} | {r(x['p_cost_excludes0_one_seventh'])} | {r(x['p_cut_one_seventh'])} |")
print('\n'.join(lines))
