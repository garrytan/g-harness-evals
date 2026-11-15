// internal-task delivery arms on the frontier Harbor path (scripts/frontier-harbor/delivery.py), keyless: the pins, every
// harness and arm's container plan, the default (no delivery kwarg) left byte-identical, the agent classes' wiring on a
// Harbor stand-in (health checks refuse before the agent starts, d12), the fake upstream's tool-call mode (a tool
// follow-up per session, d1) and delivery_smoke.py's checks on synthetic trials.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_EXEC_SOURCE, hasToolResult, PROBE_COMMAND, PROBE_OUTPUT, reply, shellTool } from '../scripts/frontier-harbor/fake-upstream.ts';

const ROOT = join(import.meta.dir, '..');
const HERE = join(ROOT, 'scripts/frontier-harbor');
const FIX = join(ROOT, 'tests/fixtures/frontier-delivery');
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(join(tmpdir(), 'frontier-delivery-'));
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONPATH: HERE, PYTHONDONTWRITEBYTECODE: '1' };
const py = (code: string): any => {
  const r = spawnSync('python3', ['-c', code], { env: ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const pin = JSON.parse(readFileSync(join(HERE, 'delivery-pin.json'), 'utf8'));
const CARD_PATH = 'tests/fixtures/frontier-delivery/review-card.md';
const CARD = readFileSync(join(ROOT, CARD_PATH));
const PLACEBO = readFileSync(join(ROOT, 'harnesses/routes/placebo.md'));
const HARNESSES = ['claude-code', 'codex', 'hermes', 'openclaw', 'pi'];
const ARMS = ['none', 'skill', 'hook', 'startup', 'placebo'];
const INSTRUCTION = 'Review the change in /work/repo and write /work/out/review.json.';

describe('pins', () => {
  test('the told sentences and the placebo are the pinned bytes', () => {
    for (const h of HARNESSES) for (const k of ['review', 'ship']) expect(sha(pin.told[h][k])).toBe(pin.told_sha256[pin.told[h][k]]);
    expect(sha(PLACEBO)).toBe('b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34');
    expect(pin.gstack.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

const plans = py(`
import json, delivery as dl
out = {}
for h in dl.HARNESSES:
    for arm in dl.ARMS:
        try:
            r = dl.resolve(h, {"arm": arm, "cards": {"review": "${CARD_PATH}"}, "kinds": {"t": "review"}})
        except dl.DeliveryRefused as e:
            out[h + " " + arm] = {"refused": e.code, "message": str(e)}
            continue
        p = dl.plan(h, r, "review")
        out[h + " " + arm] = {"files": [{k: f[k] for k in ("path", "sha256", "bytes", "mode")} for f in p["files"]], "commands": p["commands"], "health": p["health"], "record": p["record"], "env": p["env"]}
print(json.dumps(out))`);

describe('arm plans (delivery.py plan)', () => {
  test('only OpenClaw startup is refused, with HE-DELIVERY-004', () => {
    const refused = Object.entries(plans).filter(([, p]: any) => p.refused).map(([k, p]: any) => [k, p.refused]);
    expect(refused).toEqual([['openclaw startup', 'HE-DELIVERY-004']]);
    expect(plans['openclaw startup'].message).toContain("can't run (startup file only in the workspace)");
  });
  test('every file an arm writes is outside /work (d8)', () => {
    for (const p of Object.values(plans) as any[]) for (const f of p.files ?? []) expect(f.path === '/work' || f.path.startsWith('/work/')).toBe(false);
  });
  test('none writes and runs nothing; skill installs gstack and writes no card', () => {
    for (const h of HARNESSES) {
      expect(plans[h + ' none']).toMatchObject({ files: [], commands: [], health: [], env: {} });
      const s = plans[h + ' skill'];
      expect(s.files).toEqual([]);
      expect(s.commands.join('\n')).toContain(pin.gstack.commit);
      expect(s.env).toEqual(pin.gstack.session);
      expect(s.record.route.told).toBe(pin.told[h].review);
    }
    expect(plans['pi skill'].record.route.label).toBe('manual install, not a gstack route');
    expect(plans['claude-code skill'].record.route.label).toBeUndefined();
  });
  test('hook and placebo differ only in the text: the card on hook, harnesses/routes/placebo.md on placebo', () => {
    for (const h of HARNESSES) {
      const hook = plans[h + ' hook'], placebo = plans[h + ' placebo'];
      const card = (p: any) => p.files.find((f: any) => f.path === '/tmp/he-delivery/card.md');
      expect(card(hook)).toMatchObject({ sha256: sha(CARD), bytes: CARD.length });
      expect(card(placebo)).toMatchObject({ sha256: sha(PLACEBO), bytes: PLACEBO.length });
      const rest = (p: any) => p.files.filter((f: any) => f.path !== '/tmp/he-delivery/card.md');
      expect(rest(hook)).toEqual(rest(placebo));
      expect(hook.health.length).toBeGreaterThan(1);
      for (const c of hook.health) expect(c.expect.length).toBeGreaterThan(0);
      expect(hook.record.route.evidence.length).toBeGreaterThan(0);
    }
  });
  test('startup writes the card bytes into the harness global startup file', () => {
    const where: Record<string, string> = { 'claude-code': '/logs/agent/sessions/CLAUDE.md', codex: '/tmp/codex-home/AGENTS.md', pi: '/tmp/harbor-pi-agent/AGENTS.md' };
    for (const [h, path] of Object.entries(where)) expect(plans[h + ' startup'].files).toEqual([{ path, sha256: sha(CARD), bytes: CARD.length, mode: '0644' }]);
    const hermes = plans['hermes startup'];
    expect(hermes.commands[0]).toContain(pin.hermes_soul_seed_sha256);
    expect(hermes.health[0].expect).toBe(pin.hermes_soul_seed_sha256 + '\n' + sha(CARD));
  });
  test('Codex hooks.json carries both events and the hook arm bypasses hook trust; nothing else does', () => {
    expect(plans['codex hook'].files.map((f: any) => f.path)).toContain('/tmp/codex-home/hooks.json');
    const k = py(`
import json, delivery as dl
r = lambda arm: dl.resolve("codex", {"arm": arm, "cards": {"review": "${CARD_PATH}"}, "kinds": {"t": "review"}})
print(json.dumps({"hooks": json.loads(dl.codex_hooks_json()), **{a: dl.harbor_kwargs("codex", r(a)) for a in dl.ARMS}}))`);
    expect(Object.keys(k.hooks.hooks).sort()).toEqual(['PostToolUse', 'UserPromptSubmit']);
    expect(k).toMatchObject({ hook: { dangerously_bypass_hook_trust: true }, placebo: { dangerously_bypass_hook_trust: true }, none: {}, skill: {}, startup: {} });
  });
  test('refusals: a moved card, an oversized card, a bad arm, no kinds, a file under /work, a harness with no per-step hook', () => {
    const codes = py(`
import json, delivery as dl
def code(f):
    try:
        f()
        return None
    except dl.DeliveryRefused as e:
        return [e.code, str(e)]
ok = {"arm": "hook", "cards": {"review": "${CARD_PATH}"}, "kinds": {"t": "review"}}
def big():
    dl.CARD_LIMIT, limit = 10, dl.CARD_LIMIT
    try:
        return dl.resolve("pi", ok)
    finally:
        dl.CARD_LIMIT = limit
def under_work():
    dl.STARTUP_FILE["pi"] = "/work/AGENTS.md"
    return dl.plan("pi", dl.resolve("pi", {**ok, "arm": "startup"}), "review")
print(json.dumps({
    "sha": code(lambda: dl.resolve("pi", {**ok, "card_sha256": {"review": "0" * 64}})),
    "big": code(big),
    "arm": code(lambda: dl.resolve("pi", {**ok, "arm": "both"})),
    "kinds": code(lambda: dl.resolve("pi", {**ok, "kinds": {}})),
    "outside": code(lambda: dl.resolve("pi", {**ok, "cards": {"review": "../../etc/passwd"}})),
    "work": code(under_work),
    "nohook": dl.cant_run("mini-swe-agent", "hook"),
    "trial": code(lambda: dl.kind_of(dl.resolve("pi", ok), "other-task__abc1234")),
}))`);
    for (const k of ['sha', 'big', 'arm', 'kinds', 'outside']) expect(codes[k][0]).toBe('HE-DELIVERY-001');
    expect(codes.work[0]).toBe('HE-DELIVERY-002');
    expect(codes.nohook).toMatchObject({ code: 'HE-DELIVERY-003', label: "can't run (no per-step hook)" });
    expect(codes.trial[0]).toBe('HE-DELIVERY-007');
  });
  test('the cant-run CLI lists each refusal with pinned evidence', () => {
    const r = spawnSync('python3', [join(HERE, 'delivery.py'), 'cant-run'], { env: ENV, encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    expect(Object.keys(out)).toEqual(['openclaw startup']);
    expect(out['openclaw startup'].evidence.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the default arm is byte-identical (no delivery kwarg)', () => {
  test('delivery.py returns every input unchanged without an arm, and only skill changes the instruction', () => {
    const r = py(`
import json, delivery as dl
s = {"permissions": {"deny": ["WebSearch", "WebFetch"]}}
c = {"model": {"provider": "anthropic"}}
x = ${JSON.stringify(INSTRUCTION)}
res = {"claude": dl.claude_settings(s, None) is s, "hermes": dl.hermes_config(c, None) is c, "openclaw": dl.openclaw_config(None),
       "kwargs": [dl.harbor_kwargs(h, None) for h in dl.HARNESSES], "instruction": [dl.instruction(h, None, None, x) for h in dl.HARNESSES],
       "env": dl.skill_env(None)}
for arm in dl.ARMS:
    r = dl.resolve("pi", {"arm": arm, "cards": {"review": "${CARD_PATH}"}, "kinds": {"t": "review"}})
    res[arm] = dl.instruction("pi", r, "review", x)
    res[arm + "_claude"] = dl.claude_settings(s, r) is s
print(json.dumps(res))`);
    expect(r).toMatchObject({ claude: true, hermes: true, openclaw: {}, env: {}, none_claude: true, skill_claude: true, startup_claude: true, hook_claude: false, placebo_claude: false });
    expect(r.kwargs).toEqual(HARNESSES.map(() => ({})));
    expect(r.instruction).toEqual(HARNESSES.map(() => INSTRUCTION));
    for (const arm of ['none', 'hook', 'startup', 'placebo']) expect(r[arm]).toBe(INSTRUCTION);
    expect(r.skill).toBe(pin.told.pi.review + '\n\n' + INSTRUCTION);
  });
});

const wiring = (() => {
  const dir = join(tmp, 'agents');
  mkdirSync(dir, { recursive: true });
  const r = spawnSync('python3', [join(FIX, 'agents_check.py'), dir], { env: { PATH: ENV.PATH, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as Record<string, any>;
})();

describe('agents.py wiring on a Harbor stand-in (tests/fixtures/frontier-delivery)', () => {
  test('without the kwarg each class runs exactly what it ran before: no delivery command, file, setting or instruction change', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, 'harnesses/claude-code/config/settings.json'), 'utf8'));
    for (const h of HARNESSES) {
      const c = wiring[h + ' default'];
      expect(c.code).toBeUndefined();
      expect(c.launched).toBe(true);
      expect(c.commands.some((x: string) => x.includes('he-delivery') || x.includes('gstack'))).toBe(false);
      expect(c.settings.delivery).toBeUndefined();
      expect(c.launch_command).toContain(h === 'hermes' ? '"$HARBOR_INSTRUCTION"' : INSTRUCTION);
    }
    expect(wiring['claude-code default'].config).toEqual(settings);
    expect(wiring['codex default'].config).toBeNull();
    expect(wiring['openclaw default'].openclaw_config.plugins).toBeUndefined();
  });
  test('each arm that can run passes its health checks, records the /work hash at agent start and starts the agent', () => {
    for (const h of HARNESSES) for (const arm of ARMS) {
      const c = wiring[h + ' ' + arm];
      if (h === 'openclaw' && arm === 'startup') { expect(c).toMatchObject({ refused_at: 'init', code: 'HE-DELIVERY-004' }); continue; }
      expect(c.code).toBeUndefined();
      expect(c.launched).toBe(true);
      const d = c.settings.delivery;
      expect(d).toMatchObject({ arm, kind: 'review', harness: h, work_tree_sha256_setup: 'work-hash-1', work_tree_sha256_at_launch: 'work-hash-1' });
      expect(d.launch_health).toBeUndefined();
      expect((d.health ?? []).every((x: any) => x.ok)).toBe(true);
      expect(d.gstack_found_before).toEqual([]);
      if (arm === 'skill') expect(d.gstack_found_after_install.length).toBeGreaterThan(0);
      expect(c.extra_env_keys.includes('GSTACK_SESSION_KIND')).toBe(arm === 'skill');
      if (h !== 'hermes') expect(c.launch_command.includes(pin.told[h].review)).toBe(arm === 'skill');
    }
    expect(wiring['claude-code hook'].config.hooks).toHaveProperty('PostToolUse');
    expect(wiring['claude-code hook'].config.hooks.PostToolUseFailure).toEqual([{ matcher: '*', hooks: [expect.objectContaining({ command: expect.stringContaining('card-hook.py PostToolUseFailure') })] }]);
    expect(wiring['claude-code hook'].config.hooks).toHaveProperty('UserPromptSubmit');
    expect(wiring['claude-code startup'].config.hooks).toBeUndefined();
    expect(wiring['openclaw hook'].openclaw_config.plugins.entries['he-steps-card']).toMatchObject({ enabled: true, hooks: { allowConversationAccess: true } });
    expect(wiring['openclaw none'].openclaw_config.plugins).toBeUndefined();
    expect(wiring['pi startup ship'].settings.delivery.kind).toBe('ship');
  });
  test('a route that does not report loaded and healthy refuses before the agent starts (HE-DELIVERY-005), at setup or at launch', () => {
    for (const k of ['pi hook broken', 'codex hook broken', 'openclaw hook broken at launch', 'hermes hook broken at launch']) {
      expect(wiring[k]).toMatchObject({ code: 'HE-DELIVERY-005', launched: false });
      expect(wiring[k].settings.delivery.health.some((x: any) => !x.ok)).toBe(true);
    }
  });
  test('a gstack skill file in a control arm refuses the trial (HE-DELIVERY-006)', () => {
    expect(wiring['claude-code none planted']).toMatchObject({ code: 'HE-DELIVERY-006', launched: false });
  });
  test("Claude Code's skill arm drops gstack's skill links after the run; the other arms leave them", () => {
    const drop = 'SKILL_LINKS_DROPPED';
    expect(wiring['claude-code skill'].commands.filter((c: string) => c.includes(drop))).toHaveLength(1);
    expect(wiring['claude-code skill'].settings.install_checks.skill_links_dropped).toBe(2);
    for (const arm of ['none', 'hook', 'startup', 'placebo']) {
      expect(wiring['claude-code ' + arm].commands.some((c: string) => c.includes(drop))).toBe(false);
      expect(wiring['claude-code ' + arm].settings.install_checks).not.toHaveProperty('skill_links_dropped');
    }
  });
});

const body = (tools: string[], extra: Record<string, unknown>) => ({ model: 'm', tools: tools.map((name) => ({ name })), ...extra });
describe('fake upstream --tool-call (one tool follow-up per session)', () => {
  test('the probe output is not in the probe command, and bash prints it', () => {
    expect(PROBE_COMMAND.includes(PROBE_OUTPUT)).toBe(false);
    expect(spawnSync('bash', ['-c', PROBE_COMMAND], { env: { PATH: ENV.PATH }, encoding: 'utf8' }).stdout.trim()).toBe(PROBE_OUTPUT);
  });
  test('Messages: a shell tool and no tool result gets one tool_use; a follow-up gets text', async () => {
    const first = await reply('/t/anthropic/v1/messages', body(['Read', 'Bash'], { messages: [{ role: 'user', content: 'hi' }] }), 1, { toolCall: true }).json() as any;
    expect(first).toMatchObject({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', input: { command: PROBE_COMMAND } }] });
    const follow = body(['Bash'], { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: PROBE_OUTPUT }] }] });
    expect(hasToolResult(follow)).toBe(true);
    expect((await reply('/t/anthropic/v1/messages', follow, 2, { toolCall: true }).json() as any).content[0].type).toBe('text');
  });
  test('Messages streaming carries the call as input_json_delta', async () => {
    const sse = await reply('/t/anthropic/v1/messages', body(['bash'], { stream: true, messages: [{ role: 'user', content: 'hi' }] }), 1, { toolCall: true }).text();
    expect(sse).toContain('input_json_delta');
    expect(sse).toContain(JSON.stringify(JSON.stringify({ command: PROBE_COMMAND })).slice(1, -1));
  });
  test('Responses and Chat Completions', async () => {
    const r = await reply('/t/openai/v1/responses', body(['exec_command'], { input: [{ role: 'user', content: 'hi' }] }), 1, { toolCall: true }).json() as any;
    expect(r.output[0]).toMatchObject({ type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: PROBE_COMMAND }) });
    expect(hasToolResult({ input: [{ type: 'function_call_output', call_id: 'c', output: 'x' }] })).toBe(true);
    const chat = await reply('/t/anthropic/v1/chat/completions', { model: 'm', tools: [{ type: 'function', function: { name: 'terminal' } }], messages: [{ role: 'user', content: 'hi' }] }, 1, { toolCall: true }).json() as any;
    expect(chat.choices[0]).toMatchObject({ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'terminal', arguments: JSON.stringify({ command: PROBE_COMMAND }) } }] } });
    expect(hasToolResult({ messages: [{ role: 'tool', content: 'x' }] })).toBe(true);
  });
  test('Codex: tools in an additional_tools input item, and its freeform exec gets a custom_tool_call running exec_command', async () => {
    const codex = { model: 'm', input: [{ type: 'additional_tools', role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec' }, { type: 'function', name: 'wait' }] }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] };
    expect(shellTool(codex)).toEqual({ name: 'exec', custom: true });
    const r = await reply('/t/openai/v1/responses', codex, 1, { toolCall: true }).json() as any;
    expect(r.output[0]).toMatchObject({ type: 'custom_tool_call', name: 'exec', input: CODEX_EXEC_SOURCE });
    expect(CODEX_EXEC_SOURCE).toContain(JSON.stringify(PROBE_COMMAND));
    expect(hasToolResult({ input: [{ type: 'custom_tool_call_output', call_id: 'c', output: 'x' }] })).toBe(true);
  });
  test('a request with no shell tool, or no --tool-call, gets the text reply as before', async () => {
    expect(shellTool(body(['Read'], {}))).toBeNull();
    expect((await reply('/t/anthropic/v1/messages', body(['Read'], { messages: [] }), 1, { toolCall: true }).json() as any).stop_reason).toBe('end_turn');
    expect((await reply('/t/anthropic/v1/messages', body(['Bash'], { messages: [] }), 1).json() as any).stop_reason).toBe('end_turn');
  });
});

describe('delivery_smoke.py on synthetic trials', () => {
  test('the card in request 1, a fresh copy after the tool call, nothing on none, the /work hash across arms', () => {
    const out = join(tmp, 'smoke');
    const card = CARD.toString().trim();
    const placebo = PLACEBO.toString().trim();
    const lines: string[] = [];
    let n = 0;
    const trial = (job: string, id: string, kind: string, arm: string, first: string[], after: string[], hash = 'h1') => {
      const dir = join(out, 'jobs', job, id);
      mkdirSync(join(dir, 'agent'), { recursive: true });
      writeFileSync(join(dir, 'config.json'), '{}');
      writeFileSync(join(dir, 'result.json'), '{}');
      writeFileSync(join(dir, 'agent/harness_settings.json'), JSON.stringify({ delivery: { arm, kind, harness: 'pi', health: [{ name: 'x', ok: true }], gstack_found_before: [], gstack_found_at_launch: [], work_tree_sha256_at_launch: hash } }));
      const user = { role: 'user', content: [{ type: 'text', text: INSTRUCTION }, ...first.map((text) => ({ type: 'text', text }))] };
      const call = { role: 'assistant', content: [{ type: 'tool_use', id: 'u', name: 'bash', input: { command: PROBE_COMMAND } }] };
      const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u', content: PROBE_OUTPUT }, ...after.map((text) => ({ type: 'text', text }))] };
      for (const messages of [[user], [{ role: 'user', content: [{ type: 'text', text: INSTRUCTION }] }, call, result]]) lines.push(JSON.stringify({ n: ++n, path: '/' + id + '/anthropic/v1/messages', body: JSON.stringify({ model: 'm', tools: [{ name: 'bash' }], messages }) }));
    };
    trial('pi__hook', 'gn-dev-review-01__aaaaaaa', 'review', 'hook', [card], [card]);
    trial('pi__placebo', 'gn-dev-review-01__bbbbbbb', 'review', 'placebo', [placebo], []);
    trial('pi__none', 'gn-dev-review-01__ccccccc', 'review', 'none', [], [], 'h2');
    writeFileSync(join(out, 'fake-upstream-bodies.jsonl'), lines.join('\n') + '\n');
    for (const arm of ['hook', 'placebo', 'none']) writeFileSync(join(out, 'pi__' + arm + '.json'), JSON.stringify({ agents: [{ kwargs: { delivery: { arm, cards: { review: CARD_PATH }, kinds: { 'gn-dev-review-01': 'review' } } } }] }));
    const r = spawnSync('python3', [join(HERE, 'delivery_smoke.py'), out], { env: ENV, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const rep = JSON.parse(readFileSync(join(out, 'delivery-smoke.json'), 'utf8'));
    expect(rep.cells['pi hook'][0]).toMatchObject({ pass: true, text_in_request_1: true, fresh_copy_after_tool_call: true, copies_per_request: [1, 1] });
    expect(rep.cells['pi placebo'][0]).toMatchObject({ pass: false, text_in_request_1: true, fresh_copy_after_tool_call: false });
    expect(rep.cells['pi none'][0]).toMatchObject({ pass: true, card_in_any_request: false });
    expect(rep.work_tree_same_across_arms).toEqual({ pi: { 'gn-dev-review-01': false } });
    expect(rep.pass).toBe(false);
  });
});
