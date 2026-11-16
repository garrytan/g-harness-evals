# usage: python3 blind-export.py <cut_result> <cut_call>
# Exports the 4 tries per differing task with model names, costs and token counts removed.
import json, glob, os, re, random, sys, datetime
W = os.path.expanduser('~/.capy/work/internal-task')
OUT = f'{W}/blind'
CR = int(sys.argv[1]) if len(sys.argv) > 1 else 1500
CC = int(sys.argv[2]) if len(sys.argv) > 2 else 1500
D = json.load(open(f'{W}/pack/differ.json'))
rows = [json.loads(l) for l in open(f'{W}/results-repo/docs/benchmarks/2026-11-14-fable-diagnosis/results/merged/trials.jsonl')]
M = {'anthropic:claude-fable-5-2': 'F', 'anthropic:claude-opus-5-5': 'O'}
MODEL = re.compile(r'(?i)(claude[-_ ]?(fable|opus|sonnet|haiku|mythos)[-_ .0-9a-z\[\]]*|claude[-_ ]?\d[\d.-]*|(fable|opus|mythos)[-_ ]?\d*([.-]\d+)?|anthropic:[a-z0-9-]+)')
SEC = [re.compile(r'sk-ant-[A-Za-z0-9_\-]+'), re.compile(r'sk-[A-Za-z0-9_\-]{20,}'),
       re.compile(r'(?i)((api[_-]?key|auth[_-]?token|authorization|x-api-key|bearer)["\x27]?\s*[=:]\s*["\x27]?)[^\s"\x27,}]+')]
COST = re.compile(r'(?i)(\\?"(total_cost_usd|costUSD|cost_usd|contextWindow|maxOutputTokens|context_window|input_tokens|output_tokens|prompt_tokens|completion_tokens)\\?"\s*:\s*)[0-9.eE+-]+')


def scrub(s):
    s = MODEL.sub('[MODEL]', str(s))
    s = COST.sub(lambda m: m.group(1) + '0', s)
    s = SEC[0].sub('[REDACTED]', s)
    s = SEC[1].sub('[REDACTED]', s)
    return SEC[2].sub(lambda m: m.group(1) + '[REDACTED]', s)


def cut(s, n):
    s = str(s)
    if len(s) <= n:
        return s
    h = int(n * 0.6)
    return s[:h] + f'\n...[{len(s) - n} chars cut]...\n' + s[-(n - h):]


def ts(x):
    return datetime.datetime.fromisoformat(x.replace('Z', '+00:00'))


EXC = {'AgentTimeoutError': 'the harness time limit was reached and the agent was stopped', None: 'none'}


def render(r, label):
    g = glob.glob(f"{W}/pack/dest/*/results/{r['paths']['trial_dir']}/harbor/agent/trajectory.json")
    d = json.load(open(g[0]))
    steps = d['steps']
    t0 = ts(steps[0]['timestamp'])
    f = r['frontier']
    body = []
    ntool = 0
    final = ''
    for i, s in enumerate(steps):
        el = f"[{(ts(s['timestamp']) - t0).total_seconds() / 60:5.1f}m]"
        side = ' (subagent)' if (s.get('extra') or {}).get('is_sidechain') else ''
        if s['source'] == 'user':
            if i == 0:
                continue
            body.append(f'{el} USER{side}: {scrub(cut(s.get("message", ""), CR))}')
            continue
        if s.get('reasoning_content'):
            body.append(f'{el} THINKING{side}: {scrub(cut(s["reasoning_content"], 800))}')
        msg = s.get('message')
        if isinstance(msg, list):
            msg = '\n'.join(str(z.get('text', '')) if isinstance(z, dict) else str(z) for z in msg)
        if msg:
            body.append(f'{el} ASSISTANT{side}: {scrub(cut(msg, 2500))}')
            if not side:
                final = msg
        for tc in s.get('tool_calls') or []:
            ntool += 1
            body.append(f'{el} TOOL CALL{side} {tc["function_name"]}: {scrub(cut(json.dumps(tc.get("arguments"), ensure_ascii=False), CC))}')
        for x in (s.get('observation') or {}).get('results', []):
            err = ' (error)' if (x.get('extra') or {}).get('tool_result_is_error') else ''
            c = x.get('content')
            if isinstance(c, list):
                c = '\n'.join(str(z.get('text', '')) if isinstance(z, dict) else str(z) for z in c)
            body.append(f'{el} TOOL RESULT{side}{err}: {scrub(cut(c, CR))}')
    L = [f'# {r["task"]}, try {label}', '',
         f'- Outcome: {"PASS" if r["grade"] == "pass" else "FAIL"} (verifier reward {f.get("reward")})',
         f'- Harness ending: {r["termination"]}; exception: {EXC.get(f.get("exception"), f.get("exception"))}',
         f'- Wall time: {r["wall_ms"] / 60000:.1f} min; tool calls: {ntool}',
         '', '## Instruction given to the agent', '', scrub(steps[0].get('message', '')),
         '', '## Session trace', '', '\n\n'.join(body),
         '', '## Final message', '', scrub(cut(final, 6000)) if final else '(no final message)', '']
    return '\n'.join(L)


mapping = {}
for k in D:
    rng = random.Random(f'20261114:{k}')
    labs = ['X', 'Y']
    rng.shuffle(labs)
    mapping[k] = {'fable52': labs[0], 'opus55': labs[1], 'tries': {}}
    os.makedirs(f'{OUT}/{k}', exist_ok=True)
    for r in rows:
        if r['task'] != k or r['model'] not in M:
            continue
        lab = labs[0] if M[r['model']] == 'F' else labs[1]
        a = r['trial_id'].rsplit('/', 1)[1]
        name = f'{lab}-{a}'
        open(f'{OUT}/{k}/{name}.md', 'w').write(render(r, name))
        mapping[k]['tries'][name] = {'trial_id': r['trial_id'], 'grade': r['grade'], 'termination': r['termination'], 'wall_min': round(r['wall_ms'] / 60000, 1)}
json.dump(mapping, open(f'{OUT}/mapping.json', 'w'), indent=1)
os.chmod(f'{OUT}/mapping.json', 0o600)
print(len(mapping), 'tasks')
