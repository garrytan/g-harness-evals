// The sidecar image for the install ladder (internal-task; docs/gbrain-arm.md): the install bundle's manifest helpers, the
// pins the ladder and gbrain-check rely on, and, with HE_GBRAIN_IMAGE naming an image built from this checkout
// (scripts/build-gbrain-image.sh --tag <tag>), the image itself: tools/list per surface, the bundle's digests, the
// exported views, the entrypoint's refusals, and, when an embedded brain directory is at HE_GBRAIN_EMBEDDED_BRAIN
// (built keylessly against a fake embedder, as scripts/build-gbrain-image.sh builds it against the proxy), a search through a relocated embedded brain whose query
// embedding leaves through OPENAI_BASE_URL. Without the variables the docker cases skip; CI's docker job sets them.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bundleDigest, compiledTokens, fileEntries, keptSlugs, listFiles, verifyFiles, viewFiles, type InstallManifest } from '../gbrain/build-install.ts';
import { EMBEDDING_MODELS, keylessEnv } from '../gbrain/build-brain.ts';

const ROOT = resolve(import.meta.dir, '..');
const pin = JSON.parse(readFileSync(join(ROOT, 'gbrain', 'pin.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-image-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

test('keptSlugs reads the page headings compile-context writes; compiledTokens reads its summary line', () => {
  const md = '<!-- gbrain:compiled-context digest=sha256:de81 target=hermes budget=4000 -->\n\n## Moss: digest (brain://heldout/agent-notes/2025-03-10-strategic-digest)\nupdated: 2026-10-24\n\nHello.\n\n## #inc (brain://heldout/chats/inc-vtg-hartford)\n\ntext\n';
  expect(keptSlugs(md)).toEqual(['heldout/agent-notes/2025-03-10-strategic-digest', 'heldout/chats/inc-vtg-hartford']);
  expect(keptSlugs('<!-- header -->\n')).toEqual([]);
  expect(compiledTokens('264 migration(s) applied\ncompile-context: wrote 25 entries (933 tokens, budget 4000) → /x/.hermes.md')).toBe(933);
  expect(compiledTokens('nothing')).toBeNull();
});

test('the bundle digest is sha256 over "<path> <sha256>\\n" in byte order of path, the same rule export-install.sh applies with jq and sha256sum', () => {
  const dir = join(tmp, 'bundle');
  mkdirSync(join(dir, 'openclaw', 'workspace', 'skills', 'b'), { recursive: true });
  mkdirSync(join(dir, 'hermes', 'dev'), { recursive: true });
  mkdirSync(join(dir, 'hermes', 'workspace', 'skills', 'a'), { recursive: true });
  writeFileSync(join(dir, 'openclaw', 'workspace', 'skills', 'b', 'SKILL.md'), 'B');
  writeFileSync(join(dir, 'hermes', 'workspace', 'skills', 'a', 'SKILL.md'), 'A');
  writeFileSync(join(dir, 'hermes', 'dev', '.hermes.md'), '## t (brain://dev/x)\n');
  const files = fileEntries(dir, listFiles(dir));
  expect(files.map((f) => f.path)).toEqual(['hermes/dev/.hermes.md', 'hermes/workspace/skills/a/SKILL.md', 'openclaw/workspace/skills/b/SKILL.md']);
  const expected = sha(files.map((f) => `${f.path} ${f.sha256}\n`).join(''));
  expect(bundleDigest([...files].reverse())).toBe(expected);
  const viaShell = spawnSync('bash', ['-c', 'printf "%s" "$1" | sha256sum | cut -d" " -f1', '_', files.map((f) => `${f.path} ${f.sha256}\n`).join('')], { encoding: 'utf8' });
  expect(viaShell.stdout.trim()).toBe(expected);
  const manifest = { files } as InstallManifest;
  expect(viewFiles(manifest, 'openclaw', 'dev').map((f) => f.path)).toEqual(['openclaw/workspace/skills/b/SKILL.md']);
  expect(viewFiles(manifest, 'hermes', 'dev').map((f) => f.path)).toEqual(['hermes/dev/.hermes.md', 'hermes/workspace/skills/a/SKILL.md']);
  expect(viewFiles(manifest, 'hermes', 'heldout').map((f) => f.path)).toEqual(['hermes/workspace/skills/a/SKILL.md']);
  expect(verifyFiles(dir, files)).toEqual({ ok: true, missing: [], changed: [] });
  writeFileSync(join(dir, 'hermes', 'dev', '.hermes.md'), 'changed');
  rmSync(join(dir, 'openclaw', 'workspace', 'skills', 'b', 'SKILL.md'));
  expect(verifyFiles(dir, files)).toEqual({ ok: false, missing: ['openclaw/workspace/skills/b/SKILL.md'], changed: ['hermes/dev/.hermes.md'] });
});

test('pin.json: the two surfaces with their tool counts, recall on both, the embedding model and its timeout, the install commands, the exclusions', () => {
  expect(pin.surfaces.starter.tools).toBe(33);
  expect(pin.surfaces.verbs.tools).toBe(7);
  expect(pin.surfaces.verbs.names).toEqual(['remember', 'entity', 'synthesize', 'forget', 'recall', 'context_pack', 'delta']);
  expect(pin.surfaces.verbs.search_tool).toBe('recall');
  expect(pin.surfaces.starter.search_tool).toBe('search');
  expect(EMBEDDING_MODELS).toContain(pin.embeddings.model);
  expect(pin.embeddings.dimensions).toBe(1536);
  expect(pin.embeddings.query_embed_timeout_ms).toBeGreaterThan(6000);
  expect(pin.embeddings.route).toMatch(/OPENAI_BASE_URL/);
  expect(pin.embeddings.route).toMatch(/no key in the container or the build/);
  expect(pin.install.openclaw.commands).toEqual(['gbrain skillpack scaffold --harness openclaw --workspace <workspace> --json']);
  expect(pin.install.hermes.commands).toEqual(['gbrain skillpack scaffold --all --workspace <workspace> --json', 'gbrain compile-context --target hermes --include-core --out <workspace>/.hermes.md']);
  expect(pin.install.excluded.openclaw_context_engine_plugin).toMatch(/bypasses the world tap/);
  expect(pin.install.excluded.qm).toMatch(/no install path/);
  const dockerfile = readFileSync(join(ROOT, 'gbrain', 'Dockerfile'), 'utf8');
  expect(dockerfile).toContain(`ARG GBRAIN_COMMIT=${pin.gbrain.commit}`);
  expect(dockerfile).toContain('ARG GBRAIN_VERSION=');
  expect(dockerfile).toMatch(/FROM keyword AS embedded/);
  expect(dockerfile.trimEnd().endsWith('FROM keyword')).toBe(true);
  const entrypoint = readFileSync(join(ROOT, 'gbrain', 'entrypoint.sh'), 'utf8');
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'VOYAGE_API_KEY']) expect(entrypoint).toContain(k);
  expect(entrypoint).toContain('--surface "$HE_GBRAIN_SURFACE"');
  expect(entrypoint).not.toMatch(/\$OPENAI_API_KEY|\$\{OPENAI_API_KEY/);
});

test('keylessEnv passes the embedding route and its timeout through, never a key', () => {
  const saved = { ...process.env };
  process.env.OPENAI_BASE_URL = 'http://host.docker.internal:1/slot/openai';
  process.env.GBRAIN_QUERY_EMBED_TIMEOUT_MS = '20000';
  process.env.OPENAI_API_KEY = 'sk-should-not-pass';
  try {
    const env = keylessEnv('/tmp/x');
    expect(env.OPENAI_BASE_URL).toBe('http://host.docker.internal:1/slot/openai');
    expect(env.GBRAIN_QUERY_EMBED_TIMEOUT_MS).toBe('20000');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    for (const k of Object.keys(env)) expect(k).not.toMatch(/API_KEY|_KEY$|TOKEN|SECRET/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

// ---- the image, when one built from this checkout is named ---------------------------------------------------------

const IMAGE = process.env.HE_GBRAIN_IMAGE;
const EMBEDDED_BRAIN = process.env.HE_GBRAIN_EMBEDDED_BRAIN;
const haveDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const haveImage = !!IMAGE && haveDocker && spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0;
if (IMAGE && !haveImage) throw new Error(`HE_GBRAIN_IMAGE=${IMAGE} is set but the image is not present (docker image inspect failed)`);

const uidGid = () => `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
const dockerOut = (args: string[], timeoutMs = 120_000) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

interface Sidecar { port: number; token: string; out: string; name: string; stop(): string }
async function startSidecar(name: string, env: Record<string, string>, extra: string[] = []): Promise<Sidecar> {
  const out = join(tmp, name);
  mkdirSync(out, { recursive: true });
  dockerOut(['rm', '-f', name]);
  const args = ['run', '-d', '--name', name, '--user', uidGid(), '-p', `127.0.0.1:0:3131`, '-v', `${out}:/he-gbrain`, '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', `HE_TRIAL_ID=${name}`, ...extra];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  const run = dockerOut([...args, IMAGE!]);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.err}`);
  const port = Number(dockerOut(['port', name, '3131/tcp']).out.trim().split('\n')[0]!.split(':').pop());
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok && existsSync(join(out, 'token'))) break; } catch { /* starting */ }
    const state = dockerOut(['inspect', '-f', '{{.State.Status}}', name]).out.trim();
    if (state === 'exited') throw new Error(`sidecar ${name} exited: ${dockerOut(['logs', name]).err}`);
    await Bun.sleep(250);
  }
  const token = readFileSync(join(out, 'token'), 'utf8').trim();
  return { port, token, out, name, stop: () => { const logs = dockerOut(['logs', name]); dockerOut(['rm', '-f', name]); return logs.out + logs.err; } };
}

async function mcp(s: Sidecar, method: string, params: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${s.port}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await res.text();
  const data = text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? text;
  return JSON.parse(data);
}

describe.skipIf(!haveImage)(`the sidecar image ${IMAGE ?? '(HE_GBRAIN_IMAGE unset)'} built from this checkout`, () => {
  test('image.json names the pinned commit and version; the install bundle is complete and its digests hold inside the image', () => {
    const image = JSON.parse(dockerOut(['run', '--rm', '--entrypoint', 'cat', IMAGE!, '/opt/sidecar/image.json']).out) as { gbrain_commit: string; gbrain_version: string };
    expect(image.gbrain_commit).toBe(pin.gbrain.commit);
    expect(image.gbrain_version).toBe(pin.gbrain.version);
    const manifest = JSON.parse(dockerOut(['run', '--rm', '--entrypoint', 'cat', IMAGE!, '/install/manifest.json']).out) as InstallManifest;
    expect(manifest.gbrain_commit).toBe(pin.gbrain.commit);
    expect(manifest.files.length).toBeGreaterThan(100);
    expect(manifest.digest).toBe(bundleDigest(manifest.files));
    for (const h of ['openclaw', 'hermes'] as const) {
      expect(manifest.harnesses[h].workspace_entries).toEqual(['skills']);
      expect(manifest.harnesses[h].skills).toBeGreaterThan(10);
      expect(manifest.files.some((f) => f.path === `${h}/workspace/skills/brain-ops/SKILL.md`)).toBe(true);
    }
    for (const split of ['dev', 'heldout'] as const) {
      const c = manifest.harnesses.hermes.context![split];
      expect(c.bytes).toBeGreaterThan(200);
      expect(c.kept_slugs.length).toBeGreaterThan(0);
      for (const s of c.kept_slugs) expect(s.startsWith(`${split}/`)).toBe(true);
    }
    const check = dockerOut(['run', '--rm', '--entrypoint', 'bash', IMAGE!, '-c', 'cd /install && jq -r \'.files[] | "\\(.sha256)  \\(.path)"\' manifest.json | sha256sum -c --quiet - && echo DIGESTS-OK']);
    expect(check.out.trim()).toBe('DIGESTS-OK');
  }, 120_000);

  test('export-install.sh writes each harness and split view with a manifest that verifies on the host; a bad harness is HE-GBRAIN-006', () => {
    for (const h of ['openclaw', 'hermes'] as const) for (const split of ['dev', 'heldout'] as const) {
      const dest = join(tmp, 'view', h, split);
      mkdirSync(dest, { recursive: true });
      const r = dockerOut(['run', '--rm', '--user', uidGid(), '-v', `${dest}:/out`, '--entrypoint', '/opt/sidecar/gbrain/export-install.sh', IMAGE!, h, split, '/out']);
      expect(r.status).toBe(0);
      const view = JSON.parse(readFileSync(join(dest, 'manifest.json'), 'utf8')) as { harness: string; split: string; view_digest: string; files: Array<{ path: string; sha256: string; bytes: number }>; context: { kept_slugs: string[] } | null };
      expect(view.harness).toBe(h);
      expect(view.split).toBe(split);
      expect(verifyFiles(dest, view.files)).toEqual({ ok: true, missing: [], changed: [] });
      expect(view.view_digest).toBe(bundleDigest(view.files.map((f) => ({ ...f, path: f.path === '.hermes.md' ? `hermes/${split}/.hermes.md` : `${h}/${f.path}` }))));
      expect(existsSync(join(dest, 'workspace', 'skills', 'brain-ops', 'SKILL.md'))).toBe(true);
      if (h === 'hermes') { expect(readFileSync(join(dest, '.hermes.md'), 'utf8').length).toBeGreaterThan(200); expect(view.context!.kept_slugs.length).toBeGreaterThan(0); }
      else { expect(existsSync(join(dest, '.hermes.md'))).toBe(false); expect(view.context).toBeNull(); }
    }
    const bad = dockerOut(['run', '--rm', '--entrypoint', '/opt/sidecar/gbrain/export-install.sh', IMAGE!, 'qm', 'dev', '/out']);
    expect(bad.status).toBe(2);
    expect(bad.err).toContain('HE-GBRAIN-006');
  }, 120_000);

  test('tools/list: the starter surface lists 33 tools with search and recall, the verbs surface the 7 pinned names', async () => {
    for (const surface of ['starter', 'verbs'] as const) {
      const s = await startSidecar(`he-gbrain-image-${surface}`, { HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_SURFACE: surface });
      try {
        const tools = (await mcp(s, 'tools/list', {})).result.tools as Array<{ name: string }>;
        expect(tools.length).toBe(pin.surfaces[surface].tools);
        if (surface === 'verbs') expect(tools.map((t) => t.name)).toEqual(pin.surfaces.verbs.names);
        else { expect(tools.some((t) => t.name === 'search')).toBe(true); expect(tools.some((t) => t.name === 'get_page')).toBe(true); expect(tools.some((t) => t.name === 'recall')).toBe(true); }
        const probe = await mcp(s, 'tools/call', { name: pin.surfaces[surface].search_tool, arguments: { query: 'north team', limit: 3 } });
        expect(probe.result.isError).not.toBe(true);
        const body = JSON.parse(probe.result.content[0].text);
        const rows = Array.isArray(body) ? body : body.results;
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(String(r.slug)).toMatch(/^dev\//);
        expect(readFileSync(join(s.out, 'sidecar.log'), 'utf8')).toContain(`--surface ${surface}`);
      } finally { s.stop(); }
    }
  }, 180_000);

  test('the entrypoint refuses a bad surface, embeddings without OPENAI_BASE_URL, embeddings on the keyword image, and a provider key', () => {
    const refused = (env: string[]) => dockerOut(['run', '--rm', '--user', uidGid(), '-v', `${join(tmp, 'refuse')}:/he-gbrain`, '-e', 'HE_GBRAIN_OUT=/he-gbrain', '-e', 'HE_GBRAIN_SPLIT=dev', ...env.flatMap((e) => ['-e', e]), IMAGE!]);
    mkdirSync(join(tmp, 'refuse'), { recursive: true });
    let r = refused(['HE_GBRAIN_SURFACE=full']);
    expect(r.status).toBe(2); expect(r.err).toContain('HE_GBRAIN_SURFACE must be starter or verbs');
    r = refused(['HE_GBRAIN_EMBEDDINGS=openai:text-embedding-3-small']);
    expect(r.status).toBe(2); expect(r.err).toContain('needs OPENAI_BASE_URL');
    r = refused(['HE_GBRAIN_EMBEDDINGS=openai:text-embedding-3-small', 'OPENAI_BASE_URL=http://host.docker.internal:1/x/openai']);
    expect(r.status).toBe(2); expect(r.err).toMatch(/no embedded brain at \/brains\/dev-embedded|was built with embeddings/);
    r = refused(['HE_GBRAIN_EMBEDDINGS=voyage:voyage-4', 'OPENAI_BASE_URL=http://host.docker.internal:1/x/openai']);
    expect(r.status).toBe(2); expect(r.err).toContain('HE_GBRAIN_EMBEDDINGS must be off or openai:text-embedding-3-small');
    r = refused(['OPENAI_API_KEY=sk-not-a-real-key']);
    expect(r.status).toBe(2); expect(r.err).toContain('refusing to start: OPENAI_API_KEY is set');
  }, 120_000);

  const haveEmbedded = !!EMBEDDED_BRAIN && existsSync(join(EMBEDDED_BRAIN!, 'manifest.json'));
  test.skipIf(!haveEmbedded)('an embedded brain built elsewhere is served from /brain and its query embedding leaves through OPENAI_BASE_URL only (fake embedder, no key)', async () => {
    const requests: string[] = [];
    const fake = Bun.serve({ port: 0, hostname: '0.0.0.0', async fetch(req) {
      const url = new URL(req.url);
      requests.push(`${req.method} ${url.pathname} ${req.headers.get('authorization') ?? ''}`);
      if (!url.pathname.endsWith('/v1/embeddings')) return new Response('not found', { status: 404 });
      const body = await req.json() as { input: string | string[]; model: string };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({ object: 'list', model: body.model, data: inputs.map((_, i) => ({ object: 'embedding', index: i, embedding: Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0)) })), usage: { prompt_tokens: 8, total_tokens: 8 } });
    } });
    try {
      const manifest = JSON.parse(readFileSync(join(EMBEDDED_BRAIN!, 'manifest.json'), 'utf8')) as { split: 'dev' | 'heldout'; embeddings: { model: string } };
      const s = await startSidecar('he-gbrain-image-embedded', { HE_GBRAIN_SPLIT: manifest.split, HE_GBRAIN_EMBEDDINGS: manifest.embeddings.model, OPENAI_BASE_URL: `http://host.docker.internal:${fake.port}/trial-slot/openai` },
        ['--add-host', 'host.docker.internal:host-gateway', '-v', `${resolve(EMBEDDED_BRAIN!)}:/brains/${manifest.split}-embedded:ro`]);
      try {
        const probe = await mcp(s, 'tools/call', { name: 'search', arguments: { query: 'north team', limit: 3 } });
        expect(probe.result.isError).not.toBe(true);
        const rows = JSON.parse(probe.result.content[0].text) as Array<{ slug: string }>;
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(r.slug.startsWith(`${manifest.split}/`)).toBe(true);
        expect(requests.filter((r) => r.startsWith('POST /trial-slot/openai/v1/embeddings')).length).toBeGreaterThanOrEqual(1);
        for (const r of requests) expect(r).not.toMatch(/sk-/);
        const log = readFileSync(join(s.out, 'sidecar.log'), 'utf8');
        expect(log).toContain(`copied from /brains/${manifest.split}-embedded`);
        expect(log).toContain('query embeddings leave through OPENAI_BASE_URL=http://host.docker.internal');
        expect(log).toContain(`GBRAIN_QUERY_EMBED_TIMEOUT_MS=${pin.embeddings.query_embed_timeout_ms}`);
      } finally { s.stop(); }
    } finally { fake.stop(true); }
  }, 120_000);
});
