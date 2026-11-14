// The web-tools ruling on the frontier Harbor path (Captain, 2026-11-09, after internal-task), keyless: every harness's rendered
// settings turn model-callable web search and web fetch off; the web-tools check reads a smoke's captured requests and
// fails a shard whose harness was offered a web tool (exit 4, HE-FRONTIER-011), reports Cursor as a documented exception,
// and raises no false alarm on tool lists captured from real harnesses (docs/harness-anatomy/receipts); vm-shard.sh runs
// it after the smoke and before the counted run.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { unpack } from '../scripts/anatomy/store.ts';
import { EXEMPT, offeredTools, webReason } from '../scripts/frontier-harbor/web-tools-check.ts';

const ROOT = resolve(import.meta.dir, '..');
const HERE = join(ROOT, 'scripts/frontier-harbor');
const PATH = process.env.PATH ?? '/usr/bin:/bin';
const tmp = mkdtempSync(join(tmpdir(), 'frontier-web-tools-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = (name: string) => { const d = join(tmp, name + '-' + ++n); mkdirSync(d, { recursive: true }); return d; };
const settings = (harness: string, model: string) => {
  const r = spawnSync('python3', [join(HERE, 'frontier_settings.py'), harness, model, 'http://172.17.0.1:8790/trial-1/' + model.split(':')[0], 'trial-token:trial-1.' + 'c'.repeat(32)], { env: { PATH }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as { harbor_kwargs: Record<string, any>; config?: any; settings: Record<string, any> };
};

describe('web search and web fetch off in every harness (rendered settings)', () => {
  test('Hermes: web.keyless_fallback false and the web and browser toolsets disabled, on every provider', () => {
    for (const m of ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol', 'particle:particle-1']) {
      const r = settings('hermes', m);
      expect(r.config.web).toEqual({ keyless_fallback: false });
      expect(r.config.agent.disabled_toolsets).toEqual(['web', 'browser']);
      expect(r.settings.tools.hosted_web_search).toStartWith('off: web.keyless_fallback false and agent.disabled_toolsets [web, browser]');
      expect(r.settings.tools.disabled).toEqual(['web_search', 'web_extract', 'browser toolset']);
      expect(r.settings.tools.hosted_web_search).not.toContain('need a search backend key');
    }
  });
  test('OpenClaw: group:web and browser denied, tools.web.search and tools.web.fetch disabled, Harbor disable_web_search kept', () => {
    for (const m of ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol', 'particle:particle-1']) {
      const r = settings('openclaw', m);
      expect(r.config.tools).toEqual({ deny: ['group:web', 'browser'], web: { search: { enabled: false }, fetch: { enabled: false } } });
      expect(r.harbor_kwargs.disable_web_search).toBe(true);
      expect(r.settings.tools.disabled).toEqual(['group:web', 'browser', 'message']);
    }
  });
  test('Claude Code and Codex keep their switches: WebSearch and WebFetch disallowed and denied; web_search disabled', () => {
    const cc = settings('claude-code', 'anthropic:claude-opus-5-5');
    expect(cc.harbor_kwargs.disallowed_tools).toBe('WebSearch,WebFetch');
    expect(cc.config.permissions.deny).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
    const codex = settings('codex', 'openai:gpt-6.1-sol');
    expect(codex.harbor_kwargs.web_search).toBe('disabled');
    expect(codex.config.web_search).toBe('disabled');
    expect(codex.config.tools.web_search).toBe(false);
    expect(codex.config.model_providers['he-proxy'].capabilities.external_web_access).toBe(false);
  });
  test('Pi and mini-swe-agent ship no web tool, and their records say so', () => {
    expect(settings('pi', 'anthropic:claude-opus-5-5').settings.tools.hosted_web_search).toStartWith('none: Pi 1.5.0 ships no web tool');
    expect(settings('mini-swe-agent', 'openai:gpt-6.1-sol').settings.tools).toMatchObject({ hosted_web_search: 'none: one bash tool', enabled: ['bash'] });
  });
  test('DeepSeek Harness renders its multi-user web-off rows into the Harbor profile; Cursor (Harbor class FrontierCursor) keeps web fetch off and is the documented exception', () => {
    expect(readFileSync(join(HERE, 'agents.py'), 'utf8')).toMatch(/class FrontierDsh\(/);
    expect(readFileSync(join(HERE, 'agents.py'), 'utf8')).toMatch(/class FrontierCursor\(/);
    for (const m of ['anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol', 'particle:particle-1']) {
      const r = settings('dsh', m);
      for (const id of ['web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web']) expect(r.config).toContain('- id: ' + id + '\n  disabled: true\n');
      expect(r.settings.tools.disabled).toEqual(['web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web']);
    }
    const dsh = readFileSync(join(ROOT, 'harnesses/dsh/config/base.patch.yml'), 'utf8');
    for (const id of ['web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'tool-web']) expect(dsh).toContain('- id: ' + id + '\n  disabled: true\n');
    const cursor = JSON.parse(readFileSync(join(ROOT, 'harnesses/cursor/config/cli-config.json'), 'utf8'));
    expect(cursor.permissions.deny).toContain('WebFetch(*)');
    expect(cursor.autoAcceptWebSearch).toBe(false);
    expect(JSON.parse(readFileSync(join(ROOT, 'harnesses/cursor/pin.json'), 'utf8')).web_tools.web_search).toStartWith('no documented switch turns it off');
    expect(EXEMPT.cursor).toStartWith('web tools not disableable (documented), audit applies');
  });
});

type Cell = { id: string; harness: string; model: string };
type Smoke = Cell & { bodies: Array<Record<string, unknown>> };
const anthropic = (...tools: Array<[string, string]>) => ({ model: 'm', tools: tools.map(([name, description]) => ({ name, description, input_schema: { type: 'object' } })) });
const chat = (...tools: Array<[string, string]>) => ({ model: 'm', tools: tools.map(([name, description]) => ({ type: 'function', function: { name, description, parameters: {} } })) });
const CLEAN: Smoke[] = [
  { id: 'cc-opus', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', bodies: [anthropic(['Bash', 'Executes a given bash command and returns its output.'], ['Agent', 'Launch a new agent. Reach for this when you have independent work to run in parallel.'], ['ToolSearch', 'Fetches full schema definitions for deferred tools so they can be called.']), anthropic(['Bash', 'x'])] },
  { id: 'codex-sol', harness: 'codex', model: 'openai:gpt-6.1-sol', bodies: [{ model: 'gpt-6.1-sol', input: [{ type: 'additional_tools', role: 'developer', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec', description: 'Run JavaScript code to orchestrate tool calls' }, { type: 'function', name: 'wait', description: 'Wait for a cell' }] }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }] }] },
  { id: 'hermes-opus', harness: 'hermes', model: 'anthropic:claude-opus-5-5', bodies: [{ model: 'm', messages: [] }, anthropic(['terminal', 'Execute shell commands on a Linux environment.'], ['execute_code', 'Run Python that calls Hermes tools programmatically. Available via from hermes_tools import ...: read_file(path), terminal(command)'])] },
  { id: 'openclaw-opus', harness: 'openclaw', model: 'anthropic:claude-opus-5-5', bodies: [anthropic(['exec', 'Run shell commands.'], ['read', 'Read a file.'], ['computer', 'Control the Gateway desktop. Window and browser inputs bind to their observationId.'])] },
  { id: 'pi-particle', harness: 'pi', model: 'particle:particle-1', bodies: [chat(['read', 'Read a file'], ['bash', 'Run a command'], ['edit', 'Edit a file'], ['write', 'Write a file'])] },
  { id: 'mswe-sol', harness: 'mini-swe-agent', model: 'openai:gpt-6.1-sol', bodies: [chat(['bash', 'Execute a bash command'])] },
];
const smokeDir = (cells: Smoke[]) => {
  const dir = fresh('smoke');
  const run = join(dir, 'agents', 'run');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'binds.jsonl'), cells.map((c) => JSON.stringify({ at: '2026-11-09T00:00:00Z', trial: 'task__' + c.id, cell: c.id, attempt: 1, harness: c.harness, model: c.model, models: [c.model], job: c.id + '__a1' }) + '\n').join(''));
  for (const c of cells) {
    const file = join(run, 'jobs', c.id + '__a1', 'task__' + c.id, 'proxy-capture', 'proxy-requests.ndjson');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, c.bodies.map((body, seq) => JSON.stringify({ seq, prev: '', route: '/v1/messages', body }) + '\n').join(''));
  }
  return dir;
};
const prereg = (cells: Cell[]) => {
  const f = join(fresh('prereg'), 'prereg.json');
  writeFileSync(f, JSON.stringify({ schema: 'frontier-harbor/1', run_id: 'web-tools-test', cells: cells.map((c) => ({ ...c, attempts: 1, tasks: { from: 0, to: 1 } })), shards: [{ name: 's1', cells: cells.map((c) => c.id), lease_usd: 1 }] }));
  return f;
};
const check = (smoke: string, cells: Cell[], name = 's1') => {
  const r = spawnSync('bun', [join(HERE, 'web-tools-check.ts'), '--smoke', smoke, '--prereg', prereg(cells), '--name', name], { env: { PATH }, encoding: 'utf8' });
  let json: any = null;
  try { json = JSON.parse(readFileSync(join(smoke, 'web-tools.json'), 'utf8')); } catch { json = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
};

describe('the web-tools check on captured-request fixtures', () => {
  test('a clean smoke passes, and the JSON beside it lists tool names per cell (no description, no body)', () => {
    const smoke = smokeDir(CLEAN);
    const r = check(smoke, CLEAN);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('WEB_TOOLS: ok shard=s1 cells=6 pass=6 exempt=0 fail=0');
    expect(r.json.cells.map((c: any) => [c.cell, c.status, c.tools])).toEqual([
      ['cc-opus', 'pass', ['Bash', 'Agent', 'ToolSearch']],
      ['codex-sol', 'pass', ['functions.exec', 'functions.wait']],
      ['hermes-opus', 'pass', ['terminal', 'execute_code']],
      ['openclaw-opus', 'pass', ['exec', 'read', 'computer']],
      ['pi-particle', 'pass', ['read', 'bash', 'edit', 'write']],
      ['mswe-sol', 'pass', ['bash']],
    ]);
    expect(r.json.cells.find((c: any) => c.cell === 'hermes-opus').requests_read).toBe(2);
    const text = readFileSync(join(smoke, 'web-tools.json'), 'utf8');
    for (const s of ['Executes a given bash command', 'Run Python', 'input_schema', 'input_text']) expect(text).not.toContain(s);
  });
  test('a smoke whose Hermes cell was offered web_search fails with exit 4, naming the cell and the tool', () => {
    const cells = CLEAN.map((c) => c.id === 'hermes-opus' ? { ...c, bodies: [anthropic(['terminal', 'Execute shell commands.'], ['web_search', 'Search the web for information.'], ['web_extract', 'Extract content from web page URLs.'])] } : c);
    const r = check(smokeDir(cells), cells);
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('HE-FRONTIER-011 web-tools check: cell hermes-opus (hermes, anthropic:claude-opus-5-5) offers the web tool web_search (name has the web word "web"); web search and web fetch are off in every codegen cell, so no counted trial runs\n');
    expect(r.stdout).toContain('offers the web tool web_extract');
    expect(r.stdout).toEndWith('WEB_TOOLS: fail shard=s1 cells=6 pass=5 exempt=0 fail=1\n');
    expect(r.json.pass).toBe(false);
    expect(r.json.cells.find((c: any) => c.cell === 'hermes-opus')).toMatchObject({ status: 'fail', tools: ['terminal', 'web_search', 'web_extract'], web_tools: [{ name: 'web_search' }, { name: 'web_extract' }] });
  });
  test('a tool from a keyless web MCP fails too, by its server name or by the vendor its description names', () => {
    const cells = CLEAN.map((c) => c.id === 'openclaw-opus' ? { ...c, bodies: [anthropic(['exec', 'Run shell commands.']), anthropic(['exec', 'Run shell commands.'], ['mcp__exa__search', 'Search.'], ['lookup', 'Look things up through the keenable free tier.'])] } : c);
    const r = check(smokeDir(cells), cells);
    expect(r.status).toBe(4);
    expect(r.stdout).toContain('cell openclaw-opus (openclaw, anthropic:claude-opus-5-5) offers the web tool mcp__exa__search (name has the web word "exa")');
    expect(r.stdout).toContain('offers the web tool lookup (description names the web vendor keenable)');
    expect(r.json.cells.find((c: any) => c.cell === 'openclaw-opus').tools).toEqual(['exec', 'mcp__exa__search', 'lookup']);
  });
  test('a Cursor cell is reported as the documented exception, not passed silently and not failed', () => {
    const cells: Cell[] = [...CLEAN, { id: 'cursor-opus', harness: 'cursor', model: 'anthropic:claude-opus-5-5' }];
    const r = check(smokeDir(CLEAN), cells);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('web-tools check: cell cursor-opus (cursor, anthropic:claude-opus-5-5): web tools not disableable (documented), audit applies\n');
    expect(r.stdout).toEndWith('WEB_TOOLS: ok shard=s1 cells=7 pass=6 exempt=1 fail=0\n');
    expect(r.json.cells.at(-1)).toMatchObject({ cell: 'cursor-opus', status: 'exempt', tools: null, note: EXEMPT.cursor });
  });
  test('a shard cell takes the smoke cell of its harness and provider; one with no smoke slot, or no smoke at all, fails with exit 4', () => {
    const astra = check(smokeDir(CLEAN), [{ id: 'codex-astra', harness: 'codex', model: 'openai:gpt-6-astra' }]);
    expect(astra.status).toBe(0);
    expect(astra.json.cells[0]).toMatchObject({ status: 'pass', smoke_cell: 'codex-sol' });
    const sol = check(smokeDir(CLEAN), [{ id: 'pi-sol', harness: 'pi', model: 'openai:gpt-6.1-sol' }]);
    expect(sol.status).toBe(4);
    expect(sol.stdout).toContain('HE-FRONTIER-011 web-tools check: cell pi-sol (pi, openai:gpt-6.1-sol) has no captured tool list: the smoke bound no pi slot on openai; no counted trial runs');
    const none = check(fresh('empty'), [{ id: 'cc-opus', harness: 'claude-code', model: 'anthropic:claude-opus-5-5' }]);
    expect(none.status).toBe(4);
    expect(none.stdout).toContain('(the smoke did not run, or --no-smoke)');
    expect(check(smokeDir(CLEAN), CLEAN, 'nope').status).toBe(2);
  });
});

describe('the classifier', () => {
  test('names, hosted types and descriptions that mean web search or fetch are caught', () => {
    const t = (name: string, description = '', type?: string) => webReason({ name, description, ...(type ? { type } : {}) });
    for (const name of ['WebSearch', 'WebFetch', 'web_search', 'web_fetch', 'search_web', 'fetch_url', 'websearch', 'x_search', 'browser_navigate', 'mcp__parallel__search', 'mcp_keenable_query', 'tavily_search', 'http_get']) expect(t(name)).not.toBeNull();
    expect(t('web_search', '', 'web_search_20250305')).not.toBeNull();
    expect(t('search', '', 'web_search_preview')).toBe('hosted type has the web word "web"');
    expect(t('fetch', 'Fetches a URL from the internet and extracts its contents as markdown.')).toBe('its first sentence describes web search, web fetch or a web browser');
    expect(t('lookup', 'Search the web for current information.')).not.toBeNull();
    expect(t('execute_code', 'Run Python. Available via hermes_tools: web_search(query: str) -> dict')).toBe('description names web_search');
    expect(t('find', 'Find pages through parallel.ai.')).toBe('description names the web vendor parallel.ai');
  });
  test.skipIf(!existsSync(join(ROOT, 'publication/manifest.json')))('every tool in the committed anatomy captures of Claude Code, Codex, OpenClaw, QM and Harness Zero passes; the multi-user Hermes ones are caught (private repository only: the public export leaves out the Claude Code anatomy blobs)', () => {
    const root = join(ROOT, 'docs/harness-anatomy/receipts');
    const seen: Record<string, { tools: Set<string>; web: Set<string> }> = {};
    for (const d of readdirSync(root).filter((x) => x.startsWith('anatomy-capture-'))) {
      const harness = ['claude-code', 'codex', 'openclaw', 'qm', 'harness-zero', 'hermes'].find((h) => d.startsWith('anatomy-capture-' + h + '-'));
      if (!harness) continue;
      const s = (seen[harness] ??= { tools: new Set(), web: new Set() });
      for (const line of unpack(join(root, d)).split('\n').filter(Boolean)) {
        const row = JSON.parse(line) as { body?: Record<string, unknown> };
        for (const tool of offeredTools(row.body ?? {})) { s.tools.add(tool.name); if (webReason(tool)) s.web.add(tool.name); }
      }
    }
    for (const h of ['claude-code', 'codex', 'openclaw', 'qm', 'harness-zero']) {
      expect(seen[h]!.tools.size).toBeGreaterThan(0);
      expect([h, [...seen[h]!.web]]).toEqual([h, []]);
    }
    expect(seen.codex!.tools.has('functions.exec')).toBe(true);
    expect([...seen.hermes!.web].sort()).toEqual(['browser_exec', 'browser_vault_enter_code', 'browser_vault_fill', 'browser_vault_list', 'browser_vault_save_login', 'browser_vault_unlock', 'execute_code', 'web_extract', 'web_search']);
  }, 60_000);
});

describe('vm-shard.sh wiring', () => {
  test('the frontier-harbor lane runs the web-tools check after the smoke and stops the shard with exit 4 before vm-run.sh', () => {
    const sh = readFileSync(join(ROOT, 'scripts/ubicloud/vm-shard.sh'), 'utf8');
    const smoke = sh.indexOf('log "smoke: scripts/frontier-harbor/install-check.sh (keyless, fake upstream)"');
    const check = sh.indexOf('bun scripts/frontier-harbor/web-tools-check.ts --smoke "$shard/smoke/results" --prereg "$prereg" --name "$name"');
    const gate = sh.indexOf('[ "$web_tools_ok" -eq 0 ] || { log "web-tools check failed (exit $web_tools_ok); the counted run does not start"; finish 4; }');
    const run = sh.indexOf('bash scripts/frontier-harbor/vm-run.sh --prereg "$prereg"');
    expect(smoke).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(smoke);
    expect(gate).toBeGreaterThan(check);
    expect(run).toBeGreaterThan(gate);
    expect(sh.slice(check - 60, check)).toContain('env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC"');
  });
});
