// scripts/canary/receipts.sh publish staging the run dir, keyless: a local bare repository as the receipts remote, a run
// dir with a raw trial tree, a capture file and a verdict, and a stub cp (tests/fixtures/canary-core/stub-cp.sh) first on
// PATH that logs every call and can refuse hard links or fail as a full disk does. Every process runs under env -i with an
// allowlist.
//
// Value: protects=publishing a large run dir (a gbrain baseline is about 10 GB) without copying it first, by staging it
// with hard links that receipts.ts prepare only reads, a copy of only what could not be linked, and a staging failure
// that names disk space and exits 8; fails_when=publish copies the whole run dir again (baseline-2026-11-13-a3 filled the
// disk), a file that could not be linked goes missing from the receipts, staging changes or removes a source file, or a
// full disk ends in a bare cp error; seam=the stub cp and a bare remote; no_claim=a real second filesystem or a full disk.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'canary-receipts-staging-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function setup(mode = '') {
  const base = mkdtempSync(join(tmp, 'case-'));
  const home = join(base, 'home'), bin = join(base, 'bin'), dir = join(base, 'run'), remote = join(base, 'receipts.git');
  for (const d of [home, bin, join(dir, 'gstack/T2/shard/trials/t1'), join(dir, 'gstack/T2')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = canary fixture\n\temail = fixture@example.invalid\n[init]\n\tdefaultBranch = main\n');
  copyFileSync(join(ROOT, 'tests/fixtures/canary-core/stub-cp.sh'), join(bin, 'cp'));
  spawnSync('chmod', ['755', join(bin, 'cp')]);
  const files: Record<string, string> = {
    'verdict.json': '{"status":"OK"}\n',
    'gstack/T2/trials.jsonl': '{"trial_id":"t1"}\n',
    'gstack/T2/shard/trials/t1/agent.log': 'a raw trial tree that stays on the run machine\n',
    'gstack/T2/proxy-requests.ndjson': '{"seq":1,"prev":"","route":"/v1/messages","body":"captured"}\n',
  };
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  writeFileSync(join(base, 'history.add'), '{"schema":"canary-history/1","run_id":"r1","status":"OK"}\n');
  const env = { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home, CANARY_PREGATE: '/nonexistent', STUB_CP_DIR: base, STUB_REAL_CP: Bun.which('cp')!, STUB_CP_MODE: mode };
  spawnSync('git', ['init', '-q', '--bare', remote], { env });
  const publish = () => spawnSync('bash', [join(ROOT, 'scripts/canary/receipts.sh'), 'publish', '--remote', remote, '--run-id', 'r1', '--dir', dir, '--history', join(base, 'history.add')], { env, encoding: 'utf8' });
  const tree = () => spawnSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'canary-receipts'], { env, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const staging = () => readFileSync(join(base, 'calls'), 'utf8').split('\n').filter((l) => l.endsWith(`r1/`));
  return { dir, files, publish, tree, staging };
}

describe('receipts publish stages the run dir with hard links', () => {
  test('a run dir is staged by hard links alone, published as before, and every source file is left as it was', () => {
    const s = setup();
    const r = s.publish();
    expect(r.stderr).toContain('published runs/r1');
    expect(r.status).toBe(0);
    expect(s.staging()).toEqual([expect.stringMatching(/^-al .*\/run\/\. .*\/runs\/r1\/$/)]);
    expect(s.tree()).toEqual(expect.arrayContaining(['runs/r1/verdict.json', 'runs/r1/gstack/T2/trials.jsonl', 'runs/r1/capture-manifest.json', 'runs/r1/omitted-manifest.json']));
    expect(s.tree().some((p) => p.includes('shard/trials') || p.endsWith('proxy-requests.ndjson'))).toBe(false);
    for (const [rel, text] of Object.entries(s.files)) {
      expect(readFileSync(join(s.dir, rel), 'utf8')).toBe(text);
      expect(statSync(join(s.dir, rel)).nlink).toBe(1);
    }
  });
  test('files that cannot be hard-linked are copied, on another filesystem or one by one, and none goes missing', () => {
    for (const mode of ['cross-device', 'partial']) {
      const s = setup(mode);
      const r = s.publish();
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('receipts: could not hard-link every file of the run dir (cp: cannot create hard link');
      expect(s.staging()).toEqual([expect.stringMatching(/^-al /), expect.stringMatching(/^-R --update=none /)]);
      expect(s.tree()).toEqual(expect.arrayContaining(['runs/r1/verdict.json', 'runs/r1/gstack/T2/trials.jsonl', 'runs/r1/omitted-manifest.json']));
      for (const [rel, text] of Object.entries(s.files)) expect(readFileSync(join(s.dir, rel), 'utf8')).toBe(text);
    }
  });
  test('a staging failure says so, names disk space, exits 8 and pushes nothing', () => {
    const s = setup('nospace');
    const r = s.publish();
    expect(r.status).toBe(8);
    const last = r.stderr.split('\n').filter((l) => l.trim()).at(-1)!;
    expect(last).toMatch(/^receipts: could not stage the run dir for publishing: cp: error writing '.*verdict\.json': No space left on device; check free disk space under \S+$/);
    expect(s.tree()).toEqual([]);
  });
});
