#!/usr/bin/env bun
// gstack-on-QM smoke (internal-task plan v3, M1 step 6): registers the raw gstack
// repository as a QM org skill pack at a pinned commit, reads its catalog and
// imports it, through QM core's admin API as harness-admin, and writes the
// outcome (every response, and the refusal QM records in lastImport.error) as
// a JSON receipt. Keyless: core runs from the rig images with a dummy model key
// pointed at scripts/gsta-135/fake-anthropic.ts; no paid call can happen.
//
//   env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/smoke.ts \
//     [--gstack ~/.local/share/gstack] [--ref <sha>] [--out <work>/smoke-b6786d67.json]
//     [--work ~/.capy/work/qm-gstack-smoke] [--core-url <url> --secret-file <file>] [--core-port 58080] [--pg-port 55432]
//
// --gstack is a git checkout of gstack; --ref defaults to its HEAD and is the
// commit QM is asked to import (it must exist on github.com/garrytan/gstack).
// --core-url with --secret-file targets a core that is already running instead
// of starting the rig stack. Inputs and outputs: harnesses/qm/gstack/README.md.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DUMMY_KEY_PREFIX, ROOT, imageInfo, lockHost, qmClient, upStack, type Call, type QmCall } from './qm-stack.ts';
import { startFakeAnthropic } from '../../../scripts/gsta-135/fake-anthropic.ts';

/** The body gstack's own QM target sends (gstack lib/harness-qm.ts GSTACK_REPO_URL, QM_PACK_CONFIG). */
export const GSTACK_REPO_URL = 'https://github.com/garrytan/gstack';
export const PACK_CONFIG = { skillGlobs: ['*/SKILL.md'] };
/** QM's git fetcher defaults at b6786d67 (src/skills/pack-fetcher.ts:155-157). */
export const QM_FETCH_LIMITS = { timeoutMs: 60_000, files: 5000, bytes: 32 * 1024 * 1024 };

export type Refusal = 'bytes_cap' | 'files_cap' | 'clone_timeout' | 'other' | 'none';

/** Which QM limit an error string names (pack-fetcher.ts messages). */
export function classifyRefusal(error: string | null | undefined): Refusal {
  if (!error) return 'none';
  if (/pack exceeds max bytes/.test(error)) return 'bytes_cap';
  if (/pack exceeds max files/.test(error)) return 'files_cap';
  if (/git \w+ timed out after \d+ms/.test(error)) return 'clone_timeout';
  return 'other';
}

/** Files and bytes QM's readTree would walk at ref: regular files only (it skips symlinks and .git). */
export function packSize(checkout: string, ref: string): { files: number; bytes: number; symlinks: number } {
  const r = spawnSync('git', ['-C', checkout, 'ls-tree', '-r', '-l', ref], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('git ls-tree failed at ' + ref + ': ' + r.stderr);
  let files = 0, bytes = 0, symlinks = 0;
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [mode, type, , size] = line.split(/\s+/);
    if (mode === '120000') { symlinks++; continue; }
    if (type !== 'blob') continue;
    files++; bytes += Number(size);
  }
  return { files, bytes, symlinks };
}

type Pack = { id?: string; lastImport?: { status?: string; error?: string; commit?: string; at?: number }; [k: string]: unknown };
const packOf = (c: Call): Pack | null => (c.body && typeof c.body === 'object' && 'pack' in (c.body as object) ? (c.body as { pack: Pack }).pack : null);
const listed = (c: Call, id: string): Pack | null => {
  const packs = (c.body as { packs?: Pack[] } | null)?.packs;
  return Array.isArray(packs) ? packs.find(p => p.id === id) ?? null : null;
};

export interface SmokeCalls { register: Call; catalog: Call | null; import: Call | null; listAfterRegister: Call; listAfterImport: Call | null; packId: string | null }

/** The admin API sequence: register, list, catalog, import, list. Each list reads lastImport, since catalog and import answer a fetch failure with a bare 500. */
export async function runSmokeCalls(call: QmCall, ref: string): Promise<SmokeCalls> {
  const register = await call('POST', '/v1/admin/skill-packs', { url: GSTACK_REPO_URL, ref, config: PACK_CONFIG, trustTier: 'third-party' });
  const packId = packOf(register)?.id ?? null;
  const listAfterRegister = await call('GET', '/v1/admin/skill-packs');
  if (!packId) return { register, catalog: null, import: null, listAfterRegister, listAfterImport: null, packId };
  const catalog = await call('GET', '/v1/admin/skill-packs/' + encodeURIComponent(packId) + '/catalog');
  const imported = await call('POST', '/v1/admin/skill-packs/' + encodeURIComponent(packId) + '/import', { selected: 'all' });
  const listAfterImport = await call('GET', '/v1/admin/skill-packs');
  return { register, catalog, import: imported, listAfterRegister, listAfterImport, packId };
}

/** The receipt's outcome block from the calls. */
export function outcome(calls: SmokeCalls) {
  const afterRegister = calls.packId ? listed(calls.listAfterRegister, calls.packId) : null;
  const afterImport = calls.packId && calls.listAfterImport ? listed(calls.listAfterImport, calls.packId) : null;
  const registerError = afterRegister?.lastImport?.error ?? packOf(calls.register)?.lastImport?.error ?? null;
  const importError = afterImport?.lastImport?.error ?? null;
  const imported = calls.import?.http === 200 && afterImport?.lastImport?.status === 'ok';
  const refusal = imported ? null : importError ?? registerError;
  return {
    registered: calls.register.http === 200 && !!calls.packId,
    pack_id: calls.packId,
    register_http: calls.register.http,
    register_last_import_error: registerError,
    catalog_http: calls.catalog?.http ?? null,
    import_http: calls.import?.http ?? null,
    imported,
    last_import: afterImport?.lastImport ?? afterRegister?.lastImport ?? null,
    refusal,
    refusal_kind: classifyRefusal(refusal),
  };
}

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).stdout.trim();

async function main(): Promise<number> {
  const checkout = resolve(arg('--gstack') ?? join(homedir(), '.local', 'share', 'gstack'));
  if (!existsSync(join(checkout, '.git'))) { console.error('smoke: ' + checkout + ' is not a gstack git checkout'); return 2; }
  const ref = git(checkout, 'rev-parse', '--verify', '--quiet', (arg('--ref') ?? 'HEAD') + '^{commit}');
  if (!ref) { console.error('smoke: ' + (arg('--ref') ?? 'HEAD') + ' is not a commit in ' + checkout); return 2; }
  const work = resolve(arg('--work') ?? join(homedir(), '.capy', 'work', 'qm-gstack-smoke'));
  const out = resolve(arg('--out') ?? join(work, 'smoke-b6786d67.json'));
  mkdirSync(work, { recursive: true });
  const unlockWork = lockHost(['work-' + createHash('sha256').update(work).digest('hex').slice(0, 12)]);
  process.on('exit', unlockWork);
  const size = packSize(checkout, ref);
  const gstack = { repo: GSTACK_REPO_URL, ref, version: spawnSync('git', ['-C', checkout, 'show', ref + ':VERSION'], { encoding: 'utf8' }).stdout.trim(), local_checkout_head: git(checkout, 'rev-parse', 'HEAD'), tree_at_ref: { ...size, mib: +(size.bytes / 1048576).toFixed(1) } };
  console.log('smoke: gstack ' + gstack.version + ' at ' + ref + ': ' + size.files + ' files, ' + gstack.tree_at_ref.mib + ' MiB (QM caps ' + QM_FETCH_LIMITS.files + ' files, ' + QM_FETCH_LIMITS.bytes / 1048576 + ' MiB)');

  const fakeLog = join(work, 'fake-requests.ndjson');
  writeFileSync(fakeLog, '');
  let call: QmCall, stopStack = () => {}, stackInfo: Record<string, unknown>, qmCommit: string | null = null;
  const fake = startFakeAnthropic({ host: '127.0.0.1', port: 0, log: fakeLog, requireKeyPrefix: DUMMY_KEY_PREFIX });
  const coreUrl = arg('--core-url');
  if (coreUrl) {
    const secretFile = arg('--secret-file');
    if (!secretFile) { console.error('smoke: --core-url needs --secret-file'); fake.stop(); return 2; }
    call = qmClient(coreUrl.replace(/\/+$/, ''), readFileSync(secretFile, 'utf8').trim());
    stackInfo = { core_url: coreUrl, started_by_smoke: false, unchecked: 'core image, QM commit and model endpoint were not checked; the registered pack is left on that core' };
  } else {
    const stack = await upStack({ out: join(work, 'stack'), project: 'qm-gstack-smoke', modelBaseUrl: fake.url, modelKey: DUMMY_KEY_PREFIX + '-smoke',
      corePort: Number(arg('--core-port') ?? 58080), pgPort: Number(arg('--pg-port') ?? 55432) });
    call = qmClient(stack.url, stack.secret);
    stopStack = stack.down;
    const coreImage = { name: stack.coreImage, ...imageInfo(stack.coreImage) };
    qmCommit = coreImage.qm_commit;
    stackInfo = { started_by_smoke: true, compose: 'harnesses/qm/compose.yaml (pg, core)', core_image: coreImage, core_log: '<work>/stack/core.log' };
  }
  const started = new Date().toISOString();
  let calls: SmokeCalls, whoami: Call;
  try {
    whoami = await call('GET', '/v1/admin/whoami');
    calls = await runSmokeCalls(call, ref);
  } finally {
    stopStack();
    fake.stop();
  }
  const coreLog = !coreUrl && existsSync(join(work, 'stack', 'core.log')) ? readFileSync(join(work, 'stack', 'core.log'), 'utf8') : '';
  const result = outcome(calls);
  const receipt = {
    what: 'gstack-on-QM smoke (internal-task, internal-task plan v3 M1 step 6): raw gstack repository registered, catalogued and imported as a QM org skill pack. ' + (coreUrl ? 'External core: its model endpoint and commit were not checked.' : 'Keyless: the model endpoint was scripts/gsta-135/fake-anthropic.ts, which refuses any key not starting with ' + DUMMY_KEY_PREFIX + '.'),
    command: 'env -i PATH=$PATH HOME=$HOME bun harnesses/qm/gstack/smoke.ts' + process.argv.slice(2).map(a => ' ' + a).join(''),
    started, finished: new Date().toISOString(),
    qm: { commit: qmCommit, fetch_limits: QM_FETCH_LIMITS, limits_source: 'src/skills/pack-fetcher.ts:155-157 at b6786d67' + (coreUrl ? ' (assumed: the external core was not checked)' : '') },
    gstack, stack: stackInfo, admin_actor: 'harness-admin@harness-eval', whoami,
    outcome: result,
    calls: [calls.register, calls.listAfterRegister, calls.catalog, calls.import, calls.listAfterImport].filter(Boolean),
    core_log_lines: coreLog.split('\n').filter(l => /skill|pack|\[server\] 500/i.test(l)).map(l => l.replace(/^\S+\s+\|\s?/, '')).slice(0, 40),
    fake_model_requests: readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean).length,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
  console.log('smoke: registered=' + result.registered + ' catalog=' + result.catalog_http + ' import=' + result.import_http + ' imported=' + result.imported + ' refusal_kind=' + result.refusal_kind);
  console.log('smoke: refusal: ' + (result.refusal ?? 'none'));
  console.log('smoke: receipt ' + out);
  return result.registered ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
