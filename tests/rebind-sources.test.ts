// internal-task: gbrain/rebind-sources.ts against a stand-in gbrain src tree (HE_GBRAIN_SRC), keyless and without docker. The image
// test (tests/gbrain-image.test.ts) runs it against the real gbrain; this one covers its refusals: a checkout outside GBRAIN_HOME,
// an accept that is not active, and stopping at the first failing source.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '..', 'gbrain', 'rebind-sources.ts');
const tmp = mkdtempSync(join(tmpdir(), 'he-rebind-'));
const src = join(tmp, 'src');
const home = join(tmp, 'home');
const calls = join(tmp, 'calls.log');
mkdirSync(join(src, 'core', 'persistence'), { recursive: true });
mkdirSync(home);
writeFileSync(join(src, 'core', 'config.ts'), 'export const loadConfig = () => ({});\nexport const toEngineConfig = (c: unknown) => c;\n');
writeFileSync(join(src, 'core', 'persistence', 'local-client.ts'), 'export const persistenceConfigForBrain = () => ({});\n');
writeFileSync(join(src, 'core', 'engine-factory.ts'), 'export const createEngine = async () => ({ connect: async () => undefined, disconnect: async () => undefined });\n');
writeFileSync(join(src, 'core', 'persistence', 'administration.ts'), `import { appendFileSync } from 'node:fs';
const home = process.env.GBRAIN_HOME!;
export async function runPersistenceAdministration(_e: unknown, op: string, p: Record<string, any>) {
  appendFileSync(process.env.STUB_CALLS!, op + ' ' + p.source_id + '\\n');
  const id = p.source_id as string;
  const path = id === process.env.STUB_OUTSIDE ? '/elsewhere/' + id : home + '/sources/' + id;
  if (op === 'writer_status') return { admin_state: 's', bindings: [{ source_id: id, local_path: path }] };
  if (op === 'writer_transfer_prepare') return { owner_epoch: 2, manifest: { digest: 'd', file_count: 3 } };
  if (op === 'writer_transfer_accept') return { transferred: true, binding: { state: id === process.env.STUB_INACTIVE ? 'pending' : 'active', local_path: p.path, owner_epoch: 3 } };
  throw new Error('unexpected ' + op);
}
`);

const run = (ids: string[], extra: Record<string, string> = {}) => {
  writeFileSync(calls, '');
  const r = Bun.spawnSync(['bun', SCRIPT, ...ids], { env: { PATH: process.env.PATH!, HOME: tmp, HE_GBRAIN_SRC: src, GBRAIN_HOME: home, STUB_CALLS: calls, ...extra } });
  return { exit: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString(), calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) };
};

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('rebind-sources (stand-in gbrain src)', () => {
  test('re-stamps every named source in order and exits 0', () => {
    const r = run(['default', 's1']);
    expect(r.exit).toBe(0);
    expect(r.out.trim().split('\n')).toEqual([
      `default re-stamped at ${home}/sources/default (owner epoch 3, 3 files)`,
      `s1 re-stamped at ${home}/sources/s1 (owner epoch 3, 3 files)`,
    ]);
    expect(r.err).toBe('');
  });

  test('refuses a checkout outside GBRAIN_HOME and stops at the first failing source', () => {
    const r = run(['s1', 's2'], { STUB_OUTSIDE: 's1' });
    expect(r.exit).toBe(1);
    expect(r.err).toContain('rebind-sources: s1: error: its checkout /elsewhere/s1 is not inside GBRAIN_HOME');
    expect(r.out).toBe('');
    expect(r.calls.some((c) => c.endsWith(' s2'))).toBe(false);
    expect(r.calls.some((c) => c.startsWith('writer_transfer_accept'))).toBe(false);
  });

  test('refuses an accept that does not leave the binding active', () => {
    const r = run(['s1'], { STUB_INACTIVE: 's1' });
    expect(r.exit).toBe(1);
    expect(r.err).toContain('rebind-sources: s1: error: transfer accept returned');
  });

  test('exits 2 without GBRAIN_HOME and calls nothing', () => {
    writeFileSync(calls, '');
    const r = Bun.spawnSync(['bun', SCRIPT, 's1'], { env: { PATH: process.env.PATH!, HOME: tmp, HE_GBRAIN_SRC: src, STUB_CALLS: calls } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString().trim()).toBe('rebind-sources: GBRAIN_HOME is not set');
    expect(readFileSync(calls, 'utf8')).toBe('');
  });
});
