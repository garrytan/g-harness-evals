#!/usr/bin/env bun
// internal-task Step 0: how QM (main@90e4ced7, Pi) lists a skill catalog in the first model request. Keyless, $0.
//
//   env -i PATH=$PATH HOME=$HOME bun scripts/skill-resolver/step0/qm/qm-listing.ts --catalog <catalog dir>
//       [--configs native,names-only,no-bundled] [--providers anthropic,openai] [--out ~/.capy/work/internal-task/step0]
//
// Per (config, provider) cell: one fresh QM stack (harnesses/qm/gstack/qm-stack.ts upStack: Postgres and core only, no
// world, no task container) on the probe image harness-eval/qm:harn52-<config> (Dockerfile.qm-catalog: the catalog as a
// filesystem deployment layer), behind the metering proxy in capture mode, whose upstreams are the repository's fakes
// (scripts/gsta-135/fake-anthropic.ts, tests/fixtures/fake-responses.ts). The fakes refuse any credential that is not the
// capture dummy, so nothing can be paid. After the org's skills settle, one DM turn as U1; the first agent request's
// `## Skills` block is cut out and measured. The anthropic native cell also tries the API route, PUT /v1/deployment-layer
// with the catalog's text files, and records the answer. Writes <out>/qm-<provider>-<config>/: fake.ndjson (every model
// request of the cell), skills-block.txt, first-request.json, admin-skills.json, llm-turn0.json, capture.json, summary.json,
// and <out>/step0-qm-cells.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { RunProxy, summarizeUsage, trialKey, trialSlug, trialToken } from '../../../../runner/trial/proxy.ts';
import { CAPTURE_DUMMY_KEYS } from '../../../../runner/trial/capture.ts';
import { startFakeAnthropic, type FakeAnthropic } from '../../../gsta-135/fake-anthropic.ts';
import { startFakeResponses, type FakeResponses } from '../../../../tests/fixtures/fake-responses.ts';
import { DUMMY_KEY_PREFIX, ORG_SCOPE, imageInfo, qmClient, upStack } from '../../../../harnesses/qm/gstack/qm-stack.ts';

const PIN = 'main@90e4ced7 (90e4ced75dba0f711e9737e5bb2f2d718870fb0f)';
const MODELS = {
  anthropic: { model: 'anthropic:claude-opus-5-5', housekeeping: 'anthropic:claude-haiku-5-5' },
  openai: { model: 'openai:gpt-6.1-sol', housekeeping: 'openai:gpt-5.6-luna' },
} as const;
type Provider = keyof typeof MODELS;
/** What each configuration changes, read from QM's source at 90e4ced7. */
const CONFIG_NOTES: Record<string, string> = {
  native: 'Catalog as a filesystem deployment layer (env DEPLOYMENT_LAYER=/opt/catalog-layer; src/config.ts:652, src/wiring.ts:648-683); every other setting at its shipped default, so QM seed skills (SKILLS_SEED_DIR default ./skills-seed) and plugin skills (PLUGIN_SKILLS_DIRS default ./plugins/*/skills) install too.',
  'names-only': 'Native, on a catalog copy whose SKILL.md descriptions equal the skill name (scripts/skill-resolver/step0/qm/names-only.ts). Listing limits raised: none, because QM has no setting for them: SKILLS_INDEX_BUDGET = 12_000 and MIN_DESCRIPTION = 60 are module constants (src/skills/materialize.ts:127-128) and the only caller passes no budget (src/core/orchestrator.ts:1226).',
  'no-bundled': 'Native plus SKILLS_SEED_DIR=/opt/no-bundled-skills (a missing directory, so installSeedSkills installs nothing; src/config.ts:650, src/skills/seed.ts) and PLUGIN_SKILLS_DIRS=false (src/config.ts:651 and csvPaths :292-300). SEED_SKILLS=false is not usable: it also turns off the deployment layer install (src/wiring.ts:671, :2983).',
};
const MEMBER = 'U1', SCOPE = 'personal:' + MEMBER, PROJECT = 'qm-harn52-step0';
const TURN_TEXT = 'Hi, what can you help me with today?';
/** QM hides a skill with one of these names unless its provider is configured or app connections are on
 *  (CONNECTOR_SKILLS and filterConnectorSkills, src/core/orchestrator/turn-helpers.ts:44-67 at 90e4ced7). */
const CONNECTOR_SKILLS: Record<string, string> = { dropbox: 'dropbox', 'email-draft-in-voice': 'google', 'email-voice-profile': 'google', 'google-drive-sheets': 'google', 'google-workspace': 'google', linear: 'linear', 'morning-digest': 'x', 'slack-drafts': 'slack', x: 'x', zoom: 'zoom' };
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Every string in a request body that holds the Skills heading, with its JSON path and the block's offsets in it. */
export function findSkillsBlocks(body: unknown): Array<{ path: string; start: number; end: number; field_chars: number; block: string }> {
  const found: Array<{ path: string; start: number; end: number; field_chars: number; block: string }> = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      for (let at = v.indexOf('## Skills\n'); at >= 0; at = v.indexOf('## Skills\n', at + 1)) {
        if (at > 0 && v[at - 1] !== '\n') continue;
        const next = v.indexOf('\n## ', at + 1);
        const tag = v.indexOf('\n</', at + 1);
        const end = [next, tag, v.length].filter((x) => x >= 0).reduce((a, b) => Math.min(a, b));
        found.push({ path, start: at, end, field_chars: v.length, block: v.slice(at, end) });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? path + '.' + k : k);
  };
  walk(body, '');
  return found;
}

/** The Skills block's entries: `- name — description` or `- name`. */
export function parseBlock(block: string): { preamble: string; entries: Array<{ name: string; desc: string | null }> } {
  const lines = block.split('\n');
  const entries = lines.slice(2).filter((l) => l.startsWith('- ')).map((l) => {
    const i = l.indexOf(' — ');
    return i < 0 ? { name: l.slice(2), desc: null } : { name: l.slice(2, i), desc: l.slice(i + 3) };
  });
  return { preamble: lines[1] ?? '', entries };
}

/** QM's fit for the listed skills, recomputed with its formula (fitDescriptions, src/skills/materialize.ts:130-141): the
 *  per-description cap, and the block size by that formula with no descriptions and with whole ones, from the descriptions
 *  QM installed (admin-skills.json). */
function qmFit(names: string[], desc: (n: string) => string) {
  const heads = names.map((n) => '- ' + n), ds = names.map((n) => desc(n).trim());
  const size = (cap: number) => heads.reduce((s, h, i) => s + h.length + 1 + Math.min(ds[i]!.length, cap) + 4, 0);
  let low = 0, high = Math.max(0, ...ds.map((d) => d.length));
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (size(mid) <= 12_000) low = mid; else high = mid - 1; }
  return { budget: 12_000, min_description: 60, cap: low, shortened: ds.filter((d) => d.length > low).length, size_no_descriptions: size(0), size_whole_descriptions: size(Number.MAX_SAFE_INTEGER) };
}

function listCatalog(dir: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const name of readdirSync(join(dir, 'skills')).sort()) m.set(name, readFileSync(join(dir, 'skills', name, 'SKILL.md'), 'utf8'));
  return m;
}

/** The body QM's CLI would PUT for this catalog (cli/src/deployment-layer.ts deploymentLayerBundle at 90e4ced7: text files
 *  under skills/, sorted by path; binary files make the CLI stop, so they are counted and left out here). */
function layerBody(catalog: string): { body: string; files: number; binary: number } {
  const skills: Array<{ path: string; content: string; executable?: true }> = [];
  let binary = 0;
  const walk = (abs: string, rel: string) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (/^(?:\.DS_Store|Thumbs\.db|\._.*)$/.test(e.name)) continue;
      const p = join(abs, e.name), r = rel + '/' + e.name;
      if (e.isDirectory()) { walk(p, r); continue; }
      const bytes = readFileSync(p);
      if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) { binary++; continue; }
      skills.push({ path: 'skills' + r, content: bytes.toString('utf8'), ...((statSync(p).mode & 0o111) ? { executable: true as const } : {}) });
    }
  };
  walk(join(catalog, 'skills'), '');
  skills.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { body: JSON.stringify({ contract: 1, tools: [], skills }), files: skills.length, binary };
}

async function main(): Promise<number> {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const catalog = resolve(arg('--catalog') ?? join(homedir(), '.capy/work/internal-task/catalog'));
  const out = resolve(arg('--out') ?? join(homedir(), '.capy/work/internal-task/step0'));
  const configs = (arg('--configs') ?? 'native,names-only,no-bundled').split(',');
  const providers = (arg('--providers') ?? 'anthropic,openai').split(',') as Provider[];
  const manifest = JSON.parse(readFileSync(join(catalog, 'manifest.json'), 'utf8')) as { catalog_hash: string; skills: Array<{ name: string; pack: string; description: string }> };
  const catalogNames = new Set(manifest.skills.map((s) => s.name));
  mkdirSync(out, { recursive: true });

  let fakeA: FakeAnthropic | null = null, fakeR: FakeResponses | null = null;
  const front = (get: () => string | null) => Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const base = get();
    if (!base) return new Response('no fake model bound', { status: 503 });
    const u = new URL(req.url);
    return fetch(base + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.arrayBuffer() });
  } });
  const frontA = front(() => fakeA ? fakeA.url : null), frontR = front(() => fakeR ? 'http://127.0.0.1:' + fakeR.port : null);
  const allowModels = providers.flatMap((p) => [MODELS[p].model, MODELS[p].housekeeping]);
  const proxy = await RunProxy.start({ runId: 'anatomy-capture-harn52-step0-qm', runDir: out, ledgerPath: join(out, 'ledger.sqlite'), leaseUsd: 20, allowModels, maxOutputTokens: 128_000, reachableFromContainers: false, newRun: true, capture: { upstream: { anthropic: 'http://127.0.0.1:' + frontA.port, openai: 'http://127.0.0.1:' + frontR.port }, dns: null } });
  const cells: unknown[] = [];
  try {
    for (const config of configs) for (const provider of providers) {
      const id = 'qm-' + provider + '-' + config;
      const dir = join(out, id);
      mkdirSync(dir, { recursive: true });
      const log = join(dir, 'fake.ndjson');
      writeFileSync(log, '');
      fakeA?.stop(); fakeR?.stop(); fakeA = null; fakeR = null;
      if (provider === 'anthropic') fakeA = startFakeAnthropic({ host: '127.0.0.1', port: 0, log, requireKeyPrefix: DUMMY_KEY_PREFIX, script: [] });
      else fakeR = startFakeResponses({ host: '127.0.0.1', port: 0, log, requireKeyPrefix: CAPTURE_DUMMY_KEYS.OPENAI_API_KEY, script: [] });
      const image = 'harness-eval/qm:harn52-' + config;
      const cell = MODELS[provider];
      const slot = trialSlug(id), key = trialKey(id), token = trialToken(id);
      await proxy.bind(slot, key, token, [cell.model, cell.housekeeping]);
      const detail: Record<string, unknown> = { id, config, provider, model: cell.model, image, image_info: imageInfo(image), started_at: new Date().toISOString() };
      let error: string | null = null;
      try {
        const stack = await upStack({ out: join(dir, 'stack'), project: PROJECT, modelBaseUrl: proxy.baseUrlFor(slot, provider, false), modelKey: token, modelName: cell.model.split(':')[1], modelProvider: provider, coreImage: image });
        try {
          const call = qmClient(stack.url, stack.secret);
          let skills: unknown = null, last = -1, stable = 0;
          const t0 = Date.now();
          while (Date.now() - t0 < 180_000) {
            const got = await call('GET', '/v1/admin/skills?scope=' + encodeURIComponent(ORG_SCOPE) + '&limit=1000');
            const items = ((got.body as { items?: unknown[]; skills?: unknown[] } | null)?.items ?? (got.body as { skills?: unknown[] } | null)?.skills ?? (Array.isArray(got.body) ? got.body : [])) as unknown[];
            skills = got.body;
            if (got.http === 200 && items.length > 0 && items.length === last) { if (++stable >= 3) break; } else stable = 0;
            last = items.length;
            await Bun.sleep(2000);
          }
          writeFileSync(join(dir, 'admin-skills.json'), JSON.stringify(skills, null, 1) + '\n');
          detail.admin_skills_count = last;
          detail.skills_settled_ms = Date.now() - t0;
          if (config === 'native' && provider === 'anthropic') {
            const lb = layerBody(catalog);
            const put = await call('PUT', '/v1/deployment-layer', JSON.parse(lb.body), { admin: false });
            detail.layer_put = { body_bytes: Buffer.byteLength(lb.body), text_files: lb.files, binary_files_left_out: lb.binary, http: put.http, answer: typeof put.body === 'string' ? put.body.slice(0, 500) : put.body };
            const md = JSON.stringify({ contract: 1, tools: [], skills: [...listCatalog(catalog)].map(([n, c]) => ({ path: 'skills/' + n + '/SKILL.md', content: c })) });
            detail.layer_put_skill_md_only_bytes = Buffer.byteLength(md);
          }
          const turn = await call('POST', '/v1/turns', { surface: 'harness-eval', actor: { externalId: MEMBER, displayName: 'Dana Okafor' }, conversation: { kind: 'dm', threadRef: 'dm:' + MEMBER + ':' + id }, text: TURN_TEXT }, { admin: false, timeoutMs: 300_000 });
          detail.turn = { http: turn.http, status: (turn.body as { status?: string } | null)?.status ?? null, reply: (turn.body as { reply?: string } | null)?.reply ?? null, ms: turn.ms };
          const sessionId = (turn.body as { sessionId?: string } | null)?.sessionId;
          if (sessionId) {
            const llm = await call('GET', '/v1/admin/sessions/' + sessionId + '/llm?scope=' + encodeURIComponent(SCOPE) + '&turnSeq=0');
            writeFileSync(join(dir, 'llm-turn0.json'), JSON.stringify(llm.body, null, 1) + '\n');
          }
        } finally { stack.down(); }
      } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 2000); }
      const meter = await proxy.finalize(key);
      const lines = proxy.usageLines(key);
      await proxy.unbind(slot);
      const usage = summarizeUsage(key, meter, lines).usage;
      detail.usage = usage;
      detail.usage_lines = lines.map((l) => ({ model: l.model, outcome: l.outcome, usd: (l as { usd?: number }).usd ?? null, input_tokens: l.input_tokens ?? null }));
      detail.error = error;
      // The first agent request: the first one for the cell model that carries tools (QM's title call carries none).
      const reqs = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { body?: Record<string, unknown>; status: number });
      const bare = cell.model.split(':')[1]!;
      const agent = reqs.filter((r) => r.body && String(r.body.model ?? '') === bare && Array.isArray(r.body.tools) && (r.body.tools as unknown[]).length > 0);
      detail.requests = { total: reqs.length, agent: agent.length, models: reqs.map((r) => String(r.body?.model ?? '')) };
      const first = agent[0]?.body ?? null;
      if (first) writeFileSync(join(dir, 'first-request.json'), JSON.stringify(first, null, 1) + '\n');
      const blocks = first ? findSkillsBlocks(first) : [];
      const b = blocks[0] ?? null;
      if (b) writeFileSync(join(dir, 'skills-block.txt'), b.block);
      const parsed = b ? parseBlock(b.block) : { preamble: '', entries: [] };
      const names = parsed.entries.map((e) => e.name);
      const listedCatalog = names.filter((n) => catalogNames.has(n));
      const sorted = [...names].sort((x, y) => x.localeCompare(y));
      const descs = parsed.entries.filter((e) => catalogNames.has(e.name)).map((e) => (e.desc ?? '').length);
      const left = /and (\d+) skills are left out/.exec(parsed.preamble);
      const shortened = /(\d+) descriptions are shortened/.exec(parsed.preamble);
      const bundled = names.filter((n) => !catalogNames.has(n));
      const installed = new Map<string, string>(), descOf = new Map<string, string>();
      try { for (const s of (JSON.parse(readFileSync(join(dir, 'admin-skills.json'), 'utf8')) as { skills?: Array<{ name: string; description: string; createdBy: string; status: string }> }).skills ?? []) if (s.status === 'published') { installed.set(s.name, s.createdBy); descOf.set(s.name, s.description); } } catch { /* no skills read */ }
      const summary = {
        harness: 'qm', pin: PIN, provider, config, model: cell.model,
        catalog_hash: manifest.catalog_hash + (config === 'names-only' ? ' (names-only copy)' : ''),
        listing_location: b ? { request: 'first agent request in fake.ndjson (model ' + bare + ', with tools)', json_path: b.path, start: b.start, end: b.end, field_chars: b.field_chars, blocks_found: blocks.length } : null,
        listed_count: listedCatalog.length,
        listed_names: listedCatalog,
        order_rule: names.length && names.every((n, i) => n === sorted[i]) ? 'alphabetical by name (String.localeCompare), catalog and QM skills interleaved' : 'not alphabetical',
        desc_chars: { min: descs.length ? Math.min(...descs) : null, median: median(descs), max: descs.length ? Math.max(...descs) : null },
        listing_chars: b ? b.block.length : 0,
        bundled_listed: bundled,
        eligible_count: manifest.skills.filter((s) => installed.get(s.name) === 'system:deployment-layer' && !CONNECTOR_SKILLS[s.name]).length,
        ineligible: manifest.skills.filter((s) => !names.includes(s.name)).map((s) => ({ name: s.name, reason:
          installed.get(s.name) !== 'system:deployment-layer' ? 'not installed from the catalog layer (org skill by ' + (installed.get(s.name) ?? 'nobody') + ')'
          : CONNECTOR_SKILLS[s.name] ? 'hidden by QM\'s connector-skill filter: the name is a QM connector skill for provider ' + CONNECTOR_SKILLS[s.name] + ', which is not configured (src/core/orchestrator/turn-helpers.ts:44-67)'
          : left ? 'left out of the Skills block by the 12,000-character budget (src/skills/materialize.ts skillsIndex)' : 'not in the Skills block' })),
        installed: { org_skills: installed.size, by_creator: [...installed.values()].reduce((a, c) => ({ ...a, [c]: (a[c] ?? 0) + 1 }), {} as Record<string, number>), non_catalog: [...installed].filter(([, c]) => c !== 'system:deployment-layer').map(([n, c]) => n + ' (' + c + ')') },
        notes: {
          config: CONFIG_NOTES[config] ?? null,
          qm_fit: qmFit(names, (n) => descOf.get(n) ?? ''),
          preamble: parsed.preamble,
          left_out: left ? Number(left[1]) : 0,
          shortened: shortened ? Number(shortened[1]) : 0,
          entries_total: names.length,
          entries_with_description: parsed.entries.filter((e) => e.desc !== null).length,
          error,
        },
      };
      writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
      writeFileSync(join(dir, 'capture.json'), JSON.stringify({ ...detail, fake_log_sha256: sha(readFileSync(log)), turn_text: TURN_TEXT }, null, 1) + '\n');
      console.log(id + ': listed ' + listedCatalog.length + ' catalog + ' + bundled.length + ' other, block ' + summary.listing_chars + ' chars, usd ' + usage.usd + (error ? ', ERROR ' + error.slice(0, 300) : ''));
      cells.push({ id, summary: { listed_count: summary.listed_count, bundled: bundled.length, listing_chars: summary.listing_chars, desc_chars: summary.desc_chars, location: summary.listing_location?.json_path ?? null, preamble: parsed.preamble }, usd: usage.usd, requests: detail.requests, error });
    }
  } finally {
    await proxy.stop();
    fakeA?.stop(); fakeR?.stop(); frontA.stop(true); frontR.stop(true);
  }
  writeFileSync(join(out, 'step0-qm-cells.json'), JSON.stringify(cells, null, 1) + '\n');
  return 0;
}

if (import.meta.main) process.exit(await main());
