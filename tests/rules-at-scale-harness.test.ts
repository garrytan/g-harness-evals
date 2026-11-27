// Rules-at-scale harness wiring (internal-task wave 0, lane C), keyless: the pin and its check, the arms each harness can
// run, the container plan per harness and arm (where the files go, the cut-lifting settings, Hermes's named
// context_length, the hook route), the Harbor classes on the frontier stand-in (placement, clean-arm probes, version
// check, watcher before the agent), the hook script, lane B's materializer through its manifest and delivery_map.py on a
// synthetic run.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPin, pinProblems, sampleOutput, versionMatches, HARNESSES } from '../scripts/rules-at-scale/pin-check.ts';

const ROOT = join(import.meta.dir, '..');
const RS = join(ROOT, 'scripts/rules-at-scale');
const MATERIALIZE = join(RS, 'materialize.ts');
const RULES: Record<string, string> = Object.fromEntries(JSON.parse(readFileSync(join(RS, 'rules.json'), 'utf8')).rules.map((r: { id: string; text: string }) => [r.id, r.text]));
const TASK = join(RS, 'map/stub-task');
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', PYTHONDONTWRITEBYTECODE: '1' };
const tmp = mkdtempSync(join(tmpdir(), 'rules-at-scale-'));
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { env: ENV, encoding: 'utf8', cwd: ROOT });
let made = 0;
const materialize = (harness: string, arm: string) => {
  const out = join(tmp, 'm', String(++made), harness, arm);
  const r = run('bun', [MATERIALIZE, '--task', TASK, '--arm', arm, '--harness', harness, '--out', out]);
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
};
const plan = (harness: string, arm: string, dir: string, model?: string) => {
  const r = run('python3', [join(RS, 'rules_wiring.py'), 'plan', harness, arm, dir, ...(model ? [model] : [])]);
  return JSON.parse(r.stdout);
};

describe('pin.json and pin-check.ts', () => {
  const pin = loadPin();
  test('every harness has a version, an integrity and a version check that matches its own release', () => {
    expect(pinProblems(pin)).toEqual([]);
    expect(Object.keys(pin.harnesses).sort()).toEqual([...HARNESSES].sort());
  });
  test('an installed version matches only its pin, in pin-check.ts and in rules_wiring.py alike', () => {
    for (const h of HARNESSES) {
      const good = h === 'hermes' ? pin.harnesses[h]!.commit! : sampleOutput(h, pin.harnesses[h]!.version);
      expect(versionMatches(pin, h, good)).toBe(true);
      expect(run('python3', [join(RS, 'rules_wiring.py'), 'version', h, good]).status).toBe(0);
    }
    expect(versionMatches(pin, 'codex', 'codex-cli 0.165.0')).toBe(false);
    expect(run('python3', [join(RS, 'rules_wiring.py'), 'version', 'codex', 'codex-cli 0.165.0']).status).toBe(1);
    expect(versionMatches(pin, 'hermes', 'f97608f178d1ffeca59860195ab7da295f7c8e5f')).toBe(false);
  });
});

describe('arms each harness can run', () => {
  const cant = JSON.parse(run('python3', [join(RS, 'rules_wiring.py'), 'cant-run']).stdout);
  test('Pi and Gemini CLI have no hook arm; only Codex, OpenClaw and Hermes have a cut to lift; QM runs its seven arms', () => {
    expect(cant['pi hook'].code).toBe('HE-RULES-003');
    expect(cant['gemini-cli hook'].code).toBe('HE-RULES-003');
    for (const h of ['claude-code', 'pi', 'gemini-cli']) expect(cant[h + ' cutlift'].code).toBe('HE-RULES-003');
    for (const h of ['codex', 'openclaw', 'hermes']) expect(cant[h + ' cutlift']).toBeUndefined();
    for (const h of ['claude-code', 'codex', 'hermes', 'openclaw']) expect(cant[h + ' hook']).toBeUndefined();
    expect(cant['codex qm-top'].code).toBe('HE-RULES-003');
    for (const a of ['none', 'qm-repo', 'short', 'b8k', 'b28k', 'b80k', 'qm-top']) expect(cant['qm ' + a]).toBeUndefined();
    for (const a of ['b160k', 'split', 'hook', 'cutlift']) expect(cant['qm ' + a].code).toBe('HE-RULES-003');
  });
  test('QM helpers: the SOUL admin call takes up to 100,000 characters as QM counts them (UTF-16), fails above and never cuts; proof is the captured request', () => {
    const py = [
      'import json, sys',
      'sys.path.insert(0, ' + JSON.stringify(RS) + ')',
      'import rules_wiring as rw',
      'ok = rw.qm_soul_call("x" * 100000)',
      'try:',
      '    rw.qm_soul_call("x" * 100001); over = None',
      'except rw.RulesRefused as e:',
      '    over = e.code',
      'astral_ok = len(rw.qm_soul_call("\\U0001F600" * 50000)["body"]["content"])',
      'try:',
      '    rw.qm_soul_call("\\U0001F600" * 50000 + "x"); astral_over = None',
      'except rw.RulesRefused as e:',
      '    astral_over = e.code',
      'try:',
      '    rw.resolve("qm", {"arm": "none"}, "particle:particle-1"); particle = None',
      'except rw.RulesRefused as e:',
      '    particle = e.code',
      'from pathlib import Path',
      'repo = rw.load_files({"arm": "qm-repo", "hooktext": False}, "qm", Path(' + JSON.stringify(materialize('qm', 'qm-repo')) + '))',
      'b8k = rw.load_files({"arm": "b8k", "hooktext": False}, "qm", Path(' + JSON.stringify(materialize('qm', 'b8k')) + '))',
      'p = "# This session\\n## Organization instructions\\nR1 text here\\n# QM"',
      'print(json.dumps({"ok": [ok["name"], ok["method"], ok["path"], len(ok["body"]["content"])], "over": over, "astral": [astral_ok, astral_over], "particle": particle,' +
        ' "whole": rw.qm_soul_delivered(p, "R1 text here"), "absent": rw.qm_soul_delivered(p, "R2 text"),' +
        ' "unscorable": rw.qm_soul_delivered("# QM", "R1 text here"), "none": rw.qm_soul_text("none", {}),' +
        ' "repo": [rw.qm_soul_text("qm-repo", repo), [f["path"] for f in repo["files"]]], "b8k": [rw.qm_soul_text("b8k", b8k), b8k["files"]]}))',
    ].join('\n');
    const r = run('python3', ['-c', py]);
    expect(r.status).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.ok).toEqual(['soul', 'PUT', '/v1/admin/scopes/org:harness-eval/soul', 100000]);
    expect(o.over).toBe('HE-RULES-011');
    expect(o.astral).toEqual([50000, 'HE-RULES-011']);
    expect(o.particle).toBe('HE-RULES-003');
    expect([o.whole, o.absent, o.unscorable, o.none, o.repo]).toEqual(['whole', 'absent', 'unscorable', null, ['', ['AGENTS.md']]]);
    expect(o.b8k[1]).toEqual([]);
    for (const t of Object.values(RULES)) expect(o.b8k[0]).toContain(t);
  });
  test('Hermes cutlift is refused on Opus: at the real 1M window the default cap (240,000 characters) is above the 160 KB file', () => {
    const p = plan('hermes', 'cutlift', materialize('hermes', 'cutlift'));
    expect(p.refused).toBe('HE-RULES-003');
    expect(p.message).toContain('240000 characters');
  });
});

describe('container plan per harness and arm', () => {
  test('the root rules file goes to /work/repo under each harness\'s own name', () => {
    for (const [h, name] of [['claude-code', 'CLAUDE.md'], ['codex', 'AGENTS.md'], ['hermes', 'AGENTS.md'], ['openclaw', 'AGENTS.md'], ['pi', 'AGENTS.md'], ['gemini-cli', 'GEMINI.md']]) {
      const p = plan(h!, 'b8k', materialize(h!, 'b8k'));
      expect(p.files.map((f: any) => f.path)).toEqual(['/work/repo/' + name]);
      expect(p.record.rules_file).toBe(name);
      expect(p.commands[0]).toContain('/work/repo/.git/info/exclude');
    }
  });
  test('split places the per-folder files and, on Claude Code, docs/conventions.md; hooktext.md is never placed in the repository', () => {
    const p = plan('claude-code', 'split', materialize('claude-code', 'split'));
    expect(p.files.map((f: any) => f.path).sort()).toEqual(['/work/repo/CLAUDE.md', '/work/repo/docs/CLAUDE.md', '/work/repo/docs/conventions.md', '/work/repo/stubpkg/CLAUDE.md', '/work/repo/tests/CLAUDE.md']);
    const h = plan('codex', 'hook', materialize('codex', 'hook'));
    expect(h.files.map((f: any) => f.path)).toEqual(['/work/repo/AGENTS.md', '/tmp/he-rules/hooktext.md', '/tmp/he-rules/rules-hook.py', '/tmp/codex-home/hooks.json']);
  });
  test('cutlift settings and Hermes\'s named context_length', () => {
    expect(plan('codex', 'cutlift', materialize('codex', 'cutlift')).record.cutlift).toEqual({ project_doc_max_bytes: 262144 });
    expect(plan('openclaw', 'cutlift', materialize('openclaw', 'cutlift')).record.cutlift).toEqual({ agents: { defaults: { bootstrapMaxChars: 200000, bootstrapTotalMaxChars: 300000 } } });
    expect(plan('hermes', 'b160k', materialize('hermes', 'b160k')).record.named_settings).toEqual({ 'model.context_length': 1000000, default_context_file_cap_chars: 240000 });
    expect(plan('hermes', 'b160k', materialize('hermes', 'b160k'), 'particle:particle-1').record.named_settings['model.context_length']).toBe(1048576);
  });
  test('a manifest for another harness or arm, or a file whose bytes changed, is refused', () => {
    const dir = materialize('claude-code', 'b8k');
    expect(plan('codex', 'b8k', dir).refused).toBe('HE-RULES-002');
    writeFileSync(join(dir, 'CLAUDE.md'), 'changed\n');
    expect(plan('claude-code', 'b8k', dir).refused).toBe('HE-RULES-002');
  });
  test('placement decides what reaches the repository: hook text never does, and an unknown or missing placement is refused', () => {
    const hook = plan('codex', 'hook', materialize('codex', 'hook'));
    expect(hook.files.map((f: any) => f.path).filter((p: string) => p.startsWith('/work/repo/'))).toEqual(['/work/repo/AGENTS.md']);
    expect(hook.files.map((f: any) => f.path)).toContain('/tmp/he-rules/hooktext.md');
    for (const placement of ['elsewhere', undefined]) {
      const dir = materialize('codex', 'b8k');
      const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      man.files[0].placement = placement;
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(man));
      expect(plan('codex', 'b8k', dir).refused).toBe('HE-RULES-002');
    }
    const dir = materialize('codex', 'b8k');
    const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    man.files[0].placement = 'hook';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(man));
    expect(plan('codex', 'b8k', dir).refused).toBe('HE-RULES-002');
  });
});

const wiring = (() => {
  const dir = join(tmp, 'agents');
  mkdirSync(dir, { recursive: true });
  const r = run('python3', [join(ROOT, 'tests/fixtures/rules-at-scale/agents_rules_check.py'), dir, MATERIALIZE]);
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as Record<string, any>;
})();

describe('agents_rules.py on the Harbor stand-in (tests/fixtures/frontier-delivery/stub)', () => {
  test('every runnable cell places its files, starts the watcher right before the agent and records the arm', () => {
    for (const h of ['claude-code', 'codex', 'hermes', 'openclaw', 'pi']) {
      for (const arm of ['none', 'b160k', 'split']) {
        const c = wiring[h + ' ' + arm]!;
        expect(c.code).toBeUndefined();
        expect(c.agent_ran).toBe(true);
        expect(c.watch_before_agent).toBe(true);
        expect(c.rules_record.arm).toBe(arm);
        expect(c.rules_record.clean_arm).toEqual({ setup: { gstack: [], gbrain: [] }, launch: { gstack: [], gbrain: [] } });
        expect(c.rules_record.checks.every((k: any) => k.ok)).toBe(true);
      }
      expect(wiring[h + ' b160k']!.placed).toEqual(['/work/repo/' + (h === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md')]);
      expect(wiring[h + ' default']!.watch_started).toBe(false);
    }
  });
  test('hook routes: Claude Code UserPromptSubmit, Codex hooks.json with hook trust bypassed, Hermes pre_llm_call, OpenClaw plugin', () => {
    expect(Object.keys(wiring['claude-code hook']!.claude_hooks)).toEqual(['UserPromptSubmit']);
    expect(wiring['claude-code b160k']!.claude_hooks).toBeFalsy();
    expect(wiring['codex hook']!.bypass_hook_trust).toBe(true);
    expect(wiring['hermes hook']!.hermes_config.hooks.pre_llm_call[0].command).toBe('python3 /tmp/he-rules/rules-hook.py pre_llm_call');
    expect(wiring['hermes hook']!.hermes_config.hooks_auto_accept).toBe(true);
    expect(wiring['openclaw hook']!.openclaw_config.plugins.entries['he-rules-hook']).toEqual({ enabled: true, hooks: { allowConversationAccess: true } });
    expect(wiring['openclaw b160k']!.openclaw_config.plugins).toBeNull();
    expect(wiring['openclaw none']!.setup_command).toBe('. ~/.nvm/nvm.sh && nvm use 24 && openclaw setup --baseline --workspace /tmp/he-rules/openclaw-setup-workspace');
    expect(wiring['openclaw default']!.setup_command).toBeUndefined();
  });
  test('cutlift reaches each harness\'s config, and Hermes always gets the model window as context_length', () => {
    expect(wiring['codex cutlift']!.codex_config).toEqual({ project_doc_max_bytes: 262144, model_context_window: 872000 });
    expect(wiring['codex b160k']!.codex_config).toEqual({ model_context_window: 872000 });
    expect(wiring['openclaw cutlift']!.openclaw_config.defaults).toEqual({ bootstrapMaxChars: 200000, bootstrapTotalMaxChars: 300000 });
    expect(wiring['hermes b160k']!.hermes_config).toEqual({ context_file_max_chars: null, hooks: null, hooks_auto_accept: null, context_length: 1000000 });
    expect(wiring['hermes b160k']!.hermes_config_written).toBe(true);
  });
  test('refusals stop the trial before the agent starts', () => {
    expect(wiring['codex old version']).toMatchObject({ code: 'HE-RULES-010', agent_ran: false });
    expect(wiring['codex job version']).toMatchObject({ code: 'HE-RULES-010', refused_at: 'init' });
    expect(wiring['pi gbrain planted']).toMatchObject({ code: 'HE-RULES-006', agent_ran: false });
    expect(wiring['openclaw extra rules file']).toMatchObject({ code: 'HE-RULES-004', agent_ran: false });
    expect(wiring['claude-code hook broken']).toMatchObject({ code: 'HE-RULES-005', agent_ran: false });
    expect(wiring['pi hook']).toMatchObject({ code: 'HE-RULES-003', refused_at: 'init' });
  });
});

describe('agents_rules_qm.py RulesQm on the Harbor stand-in, with QM itself replaced', () => {
  const soulCall = 'admin PUT /v1/admin/scopes/org:harness-eval/soul';
  test('each arm sets its SOUL after QM starts and before the turn, and the watcher starts before the turn', () => {
    expect(wiring['qm none'].code).toBeUndefined();
    expect(wiring['qm none']).toMatchObject({ events: ['qm_started', 'turn launched=true', 'qm_stopped'], soul_body: null, placed: [], watch_started: true });
    expect(wiring['qm none'].rules_record).toMatchObject({ arm: 'none', soul: null, soul_call: null, rules_file: null });
    for (const arm of ['qm-repo', 'b8k', 'qm-top']) {
      const c = wiring['qm ' + arm]!;
      expect(c.code).toBeUndefined();
      expect(c.events).toEqual(['qm_started', soulCall, 'turn launched=true', 'qm_stopped']);
      expect(c.soul_body).toEqual({ content: c.soul_file });
      expect(c.rules_record.soul_call).toEqual({ http: 200, chars: c.soul_file.length });
      expect(c.rules_record.checks.every((k: any) => k.ok)).toBe(true);
      expect(c.rules_record.pin_file).toBe('harnesses/qm/pin.json');
    }
    expect(wiring['qm qm-repo']).toMatchObject({ soul_file: '', placed: ['/work/repo/AGENTS.md'] });
    expect(wiring['qm b8k'].placed).toEqual([]);
    expect(wiring['qm b8k'].soul_file.length).toBeGreaterThan(1000);
  });
  test('a refused SOUL call or a failed check stops QM before the turn, and an arm QM lacks is refused at init', () => {
    expect(wiring['qm soul refused']).toMatchObject({ code: 'HE-RULES-012', events: ['qm_started', soulCall, 'qm_stopped'] });
    expect(wiring['qm gbrain planted']).toMatchObject({ code: 'HE-RULES-006', events: ['qm_started', 'qm_stopped'], soul_body: null });
    expect(wiring['qm b160k']).toEqual({ arm: 'b160k', refused_at: 'init', code: 'HE-RULES-003' });
  });
  test('QM that failed to start, and stopped itself, is not stopped a second time', () => {
    expect(wiring['qm start fails']).toMatchObject({ code: 'HE-QM-002', events: ['qm_started', 'qm_stopped'], soul_body: null });
  });
  test('a failed launch check stops QM before the turn; a blank SOUL file is refused before any SOUL call', () => {
    expect(wiring['qm launch check fails']).toMatchObject({ code: 'HE-RULES-004', events: ['qm_started', soulCall, 'qm_stopped'] });
    expect(wiring['qm blank soul']).toMatchObject({ code: 'HE-RULES-002', events: ['qm_started', 'qm_stopped'], soul_body: null });
  });
  test('the rules record names the QM commit the class runs, not only the pin file', () => {
    expect(wiring['qm commit override'].rules_record.pin).toEqual({ commit: 'a'.repeat(40) });
  });
});

describe('the hook script', () => {
  test('prints the hook text in each harness\'s shape', () => {
    const dir = join(tmp, 'hook');
    mkdirSync(dir, { recursive: true });
    const text = Object.values(RULES).join('\n') + '\n';
    writeFileSync(join(dir, 'hooktext.md'), text);
    const src = readFileSync(join(RS, 'hooks/rules-hook.py'), 'utf8').replaceAll('/tmp/he-rules/hooktext.md', join(dir, 'hooktext.md')).replaceAll('/logs/agent/he-rules-fires.jsonl', join(dir, 'fires.jsonl'));
    writeFileSync(join(dir, 'rules-hook.py'), src);
    const go = (event: string) => JSON.parse(spawnSync('python3', [join(dir, 'rules-hook.py'), event], { input: '{}', env: ENV, encoding: 'utf8' }).stdout);
    expect(go('UserPromptSubmit')).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } });
    expect(go('pre_llm_call')).toEqual({ context: text });
    expect(readFileSync(join(dir, 'fires.jsonl'), 'utf8').trim().split('\n').length).toBe(2);
  });
});

describe('delivery_map.py on a synthetic run', () => {
  test('whole, partial and absent per rule, and byte-identical first requests across arms', () => {
    const out = join(tmp, 'map');
    const bodies: string[] = [];
    const text = (arm: string) => arm === 'b8k' ? Object.values(RULES).join('\n') : RULES.R1 + '\n' + RULES.R2 + '\n' + RULES.R3!.slice(0, 40);
    let n = 0;
    for (const arm of ['b8k', 'b80k', 'b160k']) {
      const trial = 'rs-map-stub-01__' + arm;
      const tdir = join(out, 'jobs', 'codex__' + arm, trial);
      mkdirSync(join(tdir, 'agent'), { recursive: true });
      writeFileSync(join(tdir, 'config.json'), '{}');
      writeFileSync(join(tdir, 'result.json'), '{}');
      writeFileSync(join(tdir, 'agent/harness_settings.json'), JSON.stringify({ rules: { arm, installed_version: 'codex-cli 0.170.0', checks: [{ ok: true }] } }));
      const body = { model: 'gpt-6.1-sol', tools: [{ type: 'function', name: 'exec_command' }], input: [{ role: 'user', content: [{ type: 'input_text', text: 'session ' + crypto.randomUUID() + ' at 2026-11-19T07:00:00Z\n' + text(arm) }] }] };
      bodies.push(JSON.stringify({ n: ++n, path: '/' + trial + '/openai/v1/responses', body: JSON.stringify(body) }));
    }
    writeFileSync(join(out, 'fake-upstream-bodies.jsonl'), bodies.join('\n') + '\n');
    const r = run('python3', [join(RS, 'map/delivery_map.py'), out, 'stub']);
    expect(r.status).toBe(0);
    const m = JSON.parse(readFileSync(join(out, 'delivery-map.json'), 'utf8'));
    expect(Object.fromEntries(Object.entries(m.cells['codex b8k'].rules).map(([k, v]: any) => [k, v.first_request]))).toEqual({ R1: 'whole', R2: 'whole', R3: 'whole', R4: 'whole', R5: 'whole', R6: 'whole' });
    expect(Object.fromEntries(Object.entries(m.cells['codex b160k'].rules).map(([k, v]: any) => [k, v.first_request]))).toEqual({ R1: 'whole', R2: 'whole', R3: 'partial', R4: 'absent', R5: 'absent', R6: 'absent' });
    expect(m.cells['codex b160k'].rules.R1.follow_up).toBe('none_sent');
    expect(m.byte_identical_first_requests.codex).toEqual([['b160k', 'b80k'], ['b8k']]);
    expect(readFileSync(join(out, 'delivery-map.md'), 'utf8')).toContain('codex: b160k = b80k');
  });
});
