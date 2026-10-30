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
import { buildInstaller, bundleDigest, compiledTokens, fileEntries, HERMES_ALLOWLIST_LOCK, hermesHookRule, INSTALLER_BLOCK_BEGIN, keptSlugs, listFiles, verifyFiles, viewFiles, type InstallManifest, type InstallerRecord } from '../gbrain/build-install.ts';
import { EMBEDDING_MODELS, keylessEnv } from '../gbrain/build-brain.ts';
import { gbrainImageCommit, gbrainImageInputs, imageCommitProblem, installerHookProblem } from '../runner/trial/gbrain.ts';
import { publicImageProblem, sealedImageProblem, sealedImageTag, type OpeningReceipt } from '../runner/heldout/sealed.ts';

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

// gbrain#7489 at 10949a15: build-install records the per-turn rule from the Hermes hook command so gbrain-check can find it in the
// hook files; the command is gbrain's own shape, `/bin/echo '{"context": <rule>}'` with a quote in the rule written as \u0027.
test('hermesHookRule reads the rule out of the Hermes pre_llm_call command and answers null for any other shape', () => {
  const rule = 'GBrain: before answering this turn, check GBrain first (`search` or `query` on the `gbrain` MCP server). Then answer and finish the task.';
  expect(hermesHookRule(`/bin/echo '${JSON.stringify({ context: rule })}'`)).toBe(rule);
  // A quote inside the rule cannot sit inside the single-quoted shell argument; gbrain writes it as \u0027 and the rule gets it back.
  expect(hermesHookRule(`/bin/echo '{"context":"the requester\\u0027s scope"}'`)).toBe("the requester's scope");
  expect(hermesHookRule('echo \'{"context":"x"}\'')).toBeNull();
  expect(hermesHookRule('/bin/echo \'{"context":"x"}\' | cat')).toBeNull();
  expect(hermesHookRule('/bin/echo \'{"context":42}\'')).toBeNull();
  expect(hermesHookRule('/bin/echo \'{"rule":"x"}\'')).toBeNull();
  expect(hermesHookRule('/bin/echo \'not json\'')).toBeNull();
  expect(hermesHookRule('')).toBeNull();
});

// preflight's image-commit gate (internal-task, the installer-hook run): a counted run's sidecar image must record the pinned gbrain commit;
// scripts/gbrain-check.ts names its candidate with --gbrain-commit instead.
test('gbrainImageCommit reads gbrain_commit from the image; a failed cat, bad JSON or a missing key is null', () => {
  const PIN = 'a'.repeat(40);
  expect(gbrainImageCommit('img', (argv) => { expect(argv).toEqual(['run', '--rm', '--entrypoint', 'cat', 'img', '/opt/sidecar/image.json']); return { status: 0, stdout: JSON.stringify({ gbrain_commit: PIN, gbrain_version: '0.60.457.0' }) }; })).toBe(PIN);
  expect(gbrainImageCommit('img', () => ({ status: 1, stdout: '' }))).toBeNull();
  expect(gbrainImageCommit('img', () => ({ status: 0, stdout: 'not json' }))).toBeNull();
  expect(gbrainImageCommit('img', () => ({ status: 0, stdout: '{"gbrain_version":"0.60.457.0"}' }))).toBeNull();
});

// internal-task phase 3 (adversarial review): a run with no sealed root refuses a gbrain image built from one, and a sealed run's
// default image is the tag the sealed build gets.
test('gbrainImageInputs reads the sealed flag from image.json, and from the harness-eval.sealed label when image.json has none', () => {
  const W = 'a'.repeat(64), C = 'b'.repeat(64);
  const fake = (imageJson: object, label: string) => (argv: string[]) => (argv[0] === 'run' ? { status: 0, stdout: JSON.stringify(imageJson) } : (expect(argv).toEqual(['image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.sealed"}}', 'img']), { status: 0, stdout: label + '\n' }));
  expect(gbrainImageInputs('img', fake({ world_sha256: W, heldout_corpus_sha256: C, sealed: true }, 'false'))).toEqual({ world_sha256: W, heldout_corpus_sha256: C, sealed: true });
  expect(gbrainImageInputs('img', fake({ world_sha256: W, heldout_corpus_sha256: null, sealed: false }, 'true'))).toEqual({ world_sha256: W, heldout_corpus_sha256: null, sealed: false });
  expect(gbrainImageInputs('img', fake({ gbrain_commit: 'x' }, 'true'))).toEqual({ world_sha256: null, heldout_corpus_sha256: null, sealed: true });
  expect(gbrainImageInputs('img', fake({ gbrain_commit: 'x' }, '<no value>'))).toEqual({ world_sha256: null, heldout_corpus_sha256: null, sealed: false });
  expect(gbrainImageInputs('img', () => ({ status: 1, stdout: '' }))).toBeNull();
  expect(gbrainImageInputs('img', () => ({ status: 0, stdout: 'not json' }))).toBeNull();
  // an unreadable image.json still leaves the label: a sealed build is never read as public
  const unreadable = (status: number, stdout: string, label: string) => (argv: string[]) => (argv[0] === 'run' ? { status, stdout } : { status: 0, stdout: label + '\n' });
  expect(gbrainImageInputs('img', unreadable(1, '', 'true'))).toEqual({ world_sha256: null, heldout_corpus_sha256: null, sealed: true });
  expect(gbrainImageInputs('img', unreadable(0, 'not json', 'true'))).toEqual({ world_sha256: null, heldout_corpus_sha256: null, sealed: true });
  expect(publicImageProblem('img', gbrainImageInputs('img', unreadable(1, '', 'true')))).toContain('was built from a sealed root');
  expect(gbrainImageInputs('img', unreadable(1, '', '<no value>'))).toBeNull();
});

test('publicImageProblem: a run with no sealed root refuses an image that says sealed or records a held-out corpus; a public image passes', () => {
  expect(publicImageProblem('img', { world_sha256: 'a'.repeat(64), heldout_corpus_sha256: null, sealed: false } as never)).toBeNull();
  expect(publicImageProblem('img', null)).toBeNull();
  expect(publicImageProblem('harness-eval/gbrain:sealed-r1', { heldout_corpus_sha256: null, sealed: true })).toContain('gbrain image harness-eval/gbrain:sealed-r1 was built from a sealed root (image.json says sealed) and this run has no sealed root');
  expect(publicImageProblem('img', { heldout_corpus_sha256: 'c'.repeat(64), sealed: false })).toContain(`image.json records held-out corpus ${'c'.repeat(12)}`);
});

test('sealedImageTag is the tag the sealed build gets, and HE-SEALED-005 names exactly that tag', () => {
  const receipt = { run_id: 'syn-r1', world_sha256: 'a'.repeat(64), heldout_corpus_sha256: 'b'.repeat(64) } as OpeningReceipt;
  expect(sealedImageTag(receipt)).toBe('harness-eval/gbrain:sealed-syn-r1');
  const fix = 'fix: scripts/build-gbrain-image.sh --sealed-root <the sealed root> on this machine, which tags harness-eval/gbrain:sealed-syn-r1, then run without --gbrain-image (or pass --gbrain-image harness-eval/gbrain:sealed-syn-r1)';
  expect(sealedImageProblem('harness-eval/gbrain:dev', { world_sha256: 'f'.repeat(64), heldout_corpus_sha256: null }, receipt)).toContain(fix);
  expect(sealedImageProblem('harness-eval/gbrain:dev', null, receipt)).toContain(fix);
  expect(sealedImageProblem('img', { world_sha256: receipt.world_sha256, heldout_corpus_sha256: receipt.heldout_corpus_sha256 }, receipt)).toBeNull();
});

test('sealedImageProblem: a sealed-labelled image whose image.json gives no digest says so, not "unrecorded" or "public"', () => {
  const receipt = { run_id: 'syn-r1', world_sha256: 'a'.repeat(64), heldout_corpus_sha256: 'b'.repeat(64) } as OpeningReceipt;
  const unreadable = gbrainImageInputs('img', (argv) => (argv[0] === 'run' ? { status: 1, stdout: '' } : { status: 0, stdout: 'true\n' }));
  expect(unreadable).toEqual({ world_sha256: null, heldout_corpus_sha256: null, sealed: true });
  const problem = sealedImageProblem('img', unreadable, receipt)!;
  expect(problem).toContain('gbrain image img carries the harness-eval.sealed=true label but no readable /opt/sidecar/image.json digests');
  expect(problem).toContain('which tags harness-eval/gbrain:sealed-syn-r1');
  expect(problem).not.toContain('unrecorded');
  expect(problem).not.toContain('public');
  // a readable image.json from another root still names both digests
  expect(sealedImageProblem('img', { world_sha256: 'f'.repeat(64), heldout_corpus_sha256: null, sealed: true }, receipt)).toContain(`was built from world ${'f'.repeat(12)} and held-out corpus public`);
});

test('imageCommitProblem: the pinned commit passes, another commit or no image.json is HE-GBRAIN-002 naming both, --gbrain-commit replaces the pin', () => {
  const PIN = 'a'.repeat(40), OTHER = 'b'.repeat(40);
  expect(imageCommitProblem({ image: 'img', built: PIN, pin: PIN })).toBeNull();
  expect(imageCommitProblem({ image: 'img', built: OTHER, pin: PIN })).toBe(`image img records gbrain ${OTHER}, gbrain/pin.json pins ${PIN}; fix: scripts/build-gbrain-image.sh --gbrain ${PIN} --tag img, or --gbrain-image <the image built at that commit>`);
  expect(imageCommitProblem({ image: 'img', built: null, pin: PIN })).toContain('records gbrain no commit (no /opt/sidecar/image.json), gbrain/pin.json pins');
  expect(imageCommitProblem({ image: 'img', built: OTHER, pin: PIN, flag: OTHER })).toBeNull();
  expect(imageCommitProblem({ image: 'img', built: PIN, pin: PIN, flag: OTHER })).toContain(`--gbrain-commit names ${OTHER}`);
});

// gbrain#7989 takes Hermes's own flock during gbrain setup hermes and leaves home/shell-hooks-allowlist.json.lock beside the allowlist.
// build-install drops it when present (the Hermes adapter refuses a view path with no documented destination) and needs nothing
// when it is absent (every commit before #7989). A stand-in gbrain writes what setup hermes writes, with and without the lock.
test('buildInstaller (hermes): the allowlist lock gbrain#7989 leaves is dropped from the bundle when present and not required when absent', () => {
  const fake = join(tmp, 'fake-gbrain.ts');
  const command = "/bin/echo '" + JSON.stringify({ context: 'Search the brain first.' }) + "'";
  writeFileSync(fake, [
    "import { appendFileSync, existsSync, writeFileSync } from 'node:fs';",
    "const home = process.env.HERMES_HOME!;",
    "appendFileSync(home + '/SOUL.md', " + JSON.stringify('\n' + INSTALLER_BLOCK_BEGIN + '\n<!-- gbrain brain-first v2: x -->\nUse the brain.\n') + ");",
    "writeFileSync(home + '/config.yaml', " + JSON.stringify('# gbrain:turn-rule:begin\nhooks:\n  pre_llm_call:\n    - command: ' + JSON.stringify(command) + '\n# gbrain:turn-rule:end\n') + ");",
    "writeFileSync(home + '/shell-hooks-allowlist.json', " + JSON.stringify(JSON.stringify({ approvals: [{ event: 'pre_llm_call', command }] })) + ");",
    "if (existsSync(" + JSON.stringify(join(tmp, 'fake-lock')) + ")) writeFileSync(home + '/shell-hooks-allowlist.json.lock', '');",
    "console.log(JSON.stringify({ turn_hook: { action: 'write', path: home + '/config.yaml', detail: 'pre_llm_call hook' } }));",
  ].join('\n'));
  const soul = join(tmp, 'seed-SOUL.md');
  writeFileSync(soul, 'You are Hermes.\n');
  const build = (lock: boolean) => {
    if (lock) writeFileSync(join(tmp, 'fake-lock'), ''); else rmSync(join(tmp, 'fake-lock'), { force: true });
    const out = join(tmp, lock ? 'out-lock' : 'out-nolock');
    const lines: string[] = [];
    const r = buildInstaller({ out, gbrain: [process.execPath, fake], brains: tmp, commit: 'f'.repeat(40), scratch: join(tmp, lock ? 'scratch-lock' : 'scratch-nolock'), brainHome: tmp, hermesSoul: soul, log: (l) => lines.push(l) }, out, 'hermes', (l) => lines.push(l));
    return { record: r.record as InstallerRecord, out, lines };
  };
  const expected = ['hermes/installer/home/SOUL.md', 'hermes/installer/home/config.yaml', 'hermes/installer/home/shell-hooks-allowlist.json'];
  for (const lock of [false, true]) {
    const { record, out, lines } = build(lock);
    expect(record.files).toEqual(expected);
    expect(record.turn_hook?.files).toEqual(['hermes/installer/home/config.yaml', 'hermes/installer/home/shell-hooks-allowlist.json']);
    expect(record.turn_hook?.rule).toBe('Search the brain first.');
    expect(existsSync(join(out, 'hermes', 'installer', HERMES_ALLOWLIST_LOCK))).toBe(false);
    expect(listFiles(join(out, 'hermes', 'installer'))).toEqual(['home/SOUL.md', 'home/config.yaml', 'home/shell-hooks-allowlist.json']);
    expect(lines.some((l) => l.includes('dropped Hermes\'s allowlist lock'))).toBe(lock);
  }
});

test('installerHookProblem: with the pin expecting a hook, an installer view without installer.turn_hook is refused; a hooked view, a docs view or a block-only pin pass', () => {
  const hooked = { harness: 'openclaw', install: 'gbrain-installer' as const, installer: { argv: [], files: ['openclaw/installer/workspace/AGENTS.md'], block_version: 'v2', turn_hook: { files: ['x'], action: 'print', detail: '' } } as never };
  const blockOnly = { harness: 'openclaw', install: 'gbrain-installer' as const, installer: { argv: [], files: ['openclaw/installer/workspace/AGENTS.md'], block_version: 'v1' } as never };
  const expecting = { install: { installer: { turn_hook_expected: true } } };
  expect(installerHookProblem(hooked, expecting)).toBeNull();
  expect(installerHookProblem(blockOnly, expecting)).toContain('the openclaw installer view carries no per-turn hook (installer.turn_hook) and gbrain/pin.json says the pinned installer writes one');
  expect(installerHookProblem({ ...blockOnly, installer: { unavailable: 'no setup target' } }, expecting)).toContain('carries no per-turn hook');
  expect(installerHookProblem({ harness: 'openclaw', install: 'gbrain-docs', installer: null }, expecting)).toBeNull();
  expect(installerHookProblem(blockOnly, { install: { installer: { turn_hook_expected: false } } })).toBeNull();
  expect(installerHookProblem(blockOnly, {})).toBeNull();
  // A candidate named by --gbrain-commit (gbrain-check) is not held to the pin's expectation.
  expect(installerHookProblem(blockOnly, expecting, 'cd9da1ce170ecae739fa28855e9133b6c60b78c2')).toBeNull();
  // internal-task: the committed pin is gbrain#7744's head (81692dc6, on master at beb49f32), which has no gbrain setup target, so the pin does
  // not expect a hook and an installer cell at this pin fails preflight on the unavailable view (HE-GBRAIN-006), not on the hook gate.
  const pin = JSON.parse(readFileSync(join(ROOT, 'gbrain', 'pin.json'), 'utf8')) as { gbrain: { commit: string }; install: { installer: { turn_hook_expected: boolean } } };
  expect(pin.gbrain.commit).toBe('81692dc623f3e220d1ea04b078b3aed903bd086f');
  expect(pin.install.installer.turn_hook_expected).toBe(false);
});

test('harnesses/openclaw/pin.json gbrain_install says what the docs view lands: /workspace/skills, the five core skills at the pinned gbrain, HE-ADAPTER-006 on failure', () => {
  const pin = JSON.parse(readFileSync(join(ROOT, 'harnesses', 'openclaw', 'pin.json'), 'utf8')) as { gbrain_install: { variables: string; applied_by: string; destinations: string[]; failure: string } };
  expect(pin.gbrain_install.destinations).toEqual(['/workspace/skills']);
  expect(pin.gbrain_install.variables).toContain('HE_GBRAIN_INSTALL=gbrain-docs');
  expect(pin.gbrain_install.applied_by).toContain('the five core skills in 30 files from gbrain 0.60.456.0');
  expect(pin.gbrain_install.failure).toContain('HE-ADAPTER-006');
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
  // internal-task: the installer view is everything under <harness>/installer/, the same for both splits, and none of it is in the docs view.
  const withInstaller = { files: [...files, { path: 'openclaw/installer/workspace/AGENTS.md', sha256: 'f'.repeat(64), bytes: 1002 }, { path: 'hermes/installer/home/SOUL.md', sha256: 'e'.repeat(64), bytes: 1677 }] } as InstallManifest;
  expect(viewFiles(withInstaller, 'openclaw', 'dev', 'gbrain-installer').map((f) => f.path)).toEqual(['openclaw/installer/workspace/AGENTS.md']);
  expect(viewFiles(withInstaller, 'hermes', 'heldout', 'gbrain-installer').map((f) => f.path)).toEqual(['hermes/installer/home/SOUL.md']);
  expect(viewFiles(withInstaller, 'openclaw', 'dev').map((f) => f.path)).toEqual(['openclaw/workspace/skills/b/SKILL.md']);
  expect(viewFiles(withInstaller, 'hermes', 'dev').map((f) => f.path)).toEqual(['hermes/dev/.hermes.md', 'hermes/workspace/skills/a/SKILL.md']);
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
      expect(manifest.files.some((f) => f.path === `${h}/workspace/skills/brain-ops/SKILL.md`)).toBe(true);
    }
    // gbrain's documented defaults at the pin: since 0.60.456.0 (gbrain#7508, change notice openclaw_core_scaffold)
    // `skillpack scaffold --harness openclaw` installs the five brain-first core skills, not the full bundle; Hermes's
    // documented install is `scaffold --all`, the whole bundle.
    const OPENCLAW_CORE_SKILLS = ['brain-ops', 'capture', 'data-loss-gate', 'query', 'resolve-before-asking'];
    const skillNames = (h: string) => [...new Set(manifest.files.map((f) => f.path.match(new RegExp(`^${h}/workspace/skills/([^/_][^/]*)/SKILL\\.md$`))?.[1]).filter((n): n is string => !!n))].sort();
    expect(manifest.harnesses.openclaw.skills).toBe(OPENCLAW_CORE_SKILLS.length);
    expect(skillNames('openclaw')).toEqual(OPENCLAW_CORE_SKILLS);
    expect(manifest.harnesses.hermes.skills).toBeGreaterThan(10);
    expect(skillNames('hermes')).toEqual(expect.arrayContaining(OPENCLAW_CORE_SKILLS));
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
  test.skipIf(!haveEmbedded)('an embedded brain built elsewhere is served from /brain and its query embedding leaves through OPENAI_BASE_URL presenting the proxy slot token (fake embedder, no key)', async () => {
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
      const proxyToken = 'trial-token:image-test.00112233445566778899aabbccddeeff';
      const s = await startSidecar('he-gbrain-image-embedded', { HE_GBRAIN_SPLIT: manifest.split, HE_GBRAIN_EMBEDDINGS: manifest.embeddings.model, OPENAI_BASE_URL: `http://host.docker.internal:${fake.port}/trial-slot/openai`, HE_GBRAIN_PROXY_TOKEN: proxyToken },
        ['--add-host', 'host.docker.internal:host-gateway', '-v', `${resolve(EMBEDDED_BRAIN!)}:/brains/${manifest.split}-embedded:ro`]);
      try {
        const probe = await mcp(s, 'tools/call', { name: 'search', arguments: { query: 'north team', limit: 3 } });
        expect(probe.result.isError).not.toBe(true);
        const rows = JSON.parse(probe.result.content[0].text) as Array<{ slug: string }>;
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) expect(r.slug.startsWith(`${manifest.split}/`)).toBe(true);
        expect(requests.filter((r) => r.startsWith('POST /trial-slot/openai/v1/embeddings')).length).toBeGreaterThanOrEqual(1);
        for (const r of requests) expect(r).not.toMatch(/sk-/);
        for (const r of requests.filter((r) => r.includes('/v1/embeddings'))) expect(r).toEndWith(`Bearer ${proxyToken}`);
        expect(requests.filter((r) => r.includes('/v1/models'))).toEqual([]);
        const log = readFileSync(join(s.out, 'sidecar.log'), 'utf8');
        expect(log).not.toContain(proxyToken);
        expect(log).toContain(`copied from /brains/${manifest.split}-embedded`);
        expect(log).toContain('query embeddings leave through OPENAI_BASE_URL=http://host.docker.internal');
        expect(log).toContain(`GBRAIN_QUERY_EMBED_TIMEOUT_MS=${pin.embeddings.query_embed_timeout_ms}`);
      } finally { s.stop(); }
    } finally { fake.stop(true); }
  }, 120_000);
});
