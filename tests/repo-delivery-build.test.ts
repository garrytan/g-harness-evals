import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSet, buildTask, diffTrees, plan, readSet, SEEDS, SET_DIR, treeDigest } from '../scripts/repo-tasks/delivery/build.ts';
import { git, normalizeIndex, readTar, Rng, writeTar, type Tree } from '../scripts/repo-tasks/delivery/lib.ts';

// The gstack-delivery-v1 build (internal-task, scripts/repo-tasks/delivery/README.md): the published seeds give the planned
// counts, the build is byte-reproducible and matches the committed set, and every task follows the repository task format.
const DELIVERY = join(import.meta.dir, '..', 'scripts', 'repo-tasks', 'delivery');
const DEV = join(SET_DIR, 'dev');
const MARKERS = [/gstack/i, /\bautoplan\b/i, /garrytan/i, /\/home\/user/, /\bcapy\b/i];
const SLASH_SKILL = /(^|[\s(`])\/(investigate|review|qa|ship|office-hours|autoplan|browse|careful|retro)\b/;
const STARTUP_FILES = /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules)$|(^|\/)\.(claude|cursor|github)\//;
const env = { PATH: '/usr/bin:/bin', HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const rows = plan();
const toml = (id: string) => Bun.TOML.parse(readFileSync(join(DEV, id, 'task.toml'), 'utf8')) as any;
const acceptance = existsSync(join(DEV, 'ACCEPTANCE.json')) ? JSON.parse(readFileSync(join(DEV, 'ACCEPTANCE.json'), 'utf8')) : { tasks: {} };

describe('gstack-delivery-v1 build', () => {
  test('the published seeds give the planned counts', () => {
    for (const kind of ['review', 'ship']) {
      const ids = rows.filter((r) => r.kind === kind).map((r) => r.id);
      expect(ids.length).toBe(SEEDS[kind].count);
      expect(ids).toEqual(Array.from({ length: SEEDS[kind].count }, (_, i) => SEEDS.prefix + '-' + kind + '-' + String(i + 1).padStart(2, '0')));
    }
    expect(SEEDS.review.count).toBe(16);
    expect(SEEDS.ship.count).toBe(16);
    expect(new Set(rows.map((r) => r.spec)).size).toBe(rows.length);
  });

  test('the committed set is exactly what the build writes', () => {
    const built = buildSet();
    const diff = diffTrees(built, readSet(SET_DIR));
    expect(diff).toEqual([]);
    expect(readdirSync(DEV).filter((n) => n !== 'ACCEPTANCE.json').sort()).toEqual(rows.map((r) => r.id).sort());
  }, 600_000);

  test('a task builds to the same bytes twice', () => {
    for (const kind of ['review', 'ship']) {
      const row = rows.find((r) => r.kind === kind)!;
      expect(treeDigest(buildTask(row))).toBe(treeDigest(buildTask(row)));
    }
  }, 300_000);

  test('the seed decides the plan: another seed orders the specs differently', () => {
    const key = (seed: string, n: string) => new Bun.CryptoHasher('sha256').update(seed + ':' + n).digest('hex');
    const specs = rows.filter((r) => r.kind === 'review').map((r) => r.spec);
    const resorted = specs.slice().sort((a, b) => (key('another seed', a) < key('another seed', b) ? -1 : 1));
    expect(resorted).not.toEqual(specs);
    expect(specs.slice().sort((a, b) => (key(SEEDS.review.seed, a) < key(SEEDS.review.seed, b) ? -1 : 1))).toEqual(specs);
  });
});

describe('gstack-delivery-v1 build helpers', () => {
  test('the tar writer is deterministic and round-trips', () => {
    const tree: Tree = new Map([['b/x.py', { data: Buffer.from('print(1)\n'), mode: 0o644 }], ['a', { data: Buffer.from('#!/bin/sh\n'), mode: 0o755 }], ['d/' + 'n'.repeat(70) + '/' + 'm'.repeat(70) + '/f', { data: Buffer.alloc(700, 1), mode: 0o644 }]]);
    const a = writeTar(tree), b = writeTar(new Map([...tree].reverse()));
    expect(a.equals(b)).toBe(true);
    expect(a.length % 10240).toBe(0);
    const back = readTar(a);
    expect([...back.keys()].sort()).toEqual([...tree.keys()].sort());
    for (const [p, e] of tree) { expect(back.get(p)!.data.equals(e.data)).toBe(true); expect(back.get(p)!.mode).toBe(e.mode); }
    const x = mkdtempSync(join(tmpdir(), 'gd-tar-'));
    try {
      writeFileSync(join(x, 't.tar'), a);
      expect(spawnSync('tar', ['-tvf', join(x, 't.tar')]).stdout.toString()).toContain('0/0');
    } finally { rmSync(x, { recursive: true, force: true }); }
  });

  test('the generator is a function of the seed', () => {
    expect(new Rng('s').hex(12)).toBe(new Rng('s').hex(12));
    expect(new Rng('s').hex(12)).not.toBe(new Rng('t').hex(12));
    expect(new Rng('s').shuffle([1, 2, 3, 4, 5, 6])).toEqual(new Rng('s').shuffle([1, 2, 3, 4, 5, 6]));
  });

  test('a normalized index has no stat data and a valid checksum', () => {
    const x = mkdtempSync(join(tmpdir(), 'gd-index-'));
    try {
      const w = join(x, 'w');
      mkdirSync(w);
      git(w, ['init', '-q']);
      writeFileSync(join(w, 'f.txt'), 'hello\n');
      git(w, ['add', 'f.txt']);
      git(w, ['commit', '-q', '-m', 'one'], { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.com' });
      const idx = normalizeIndex(readFileSync(join(w, '.git', 'index')));
      expect(idx.readUInt32BE(12)).toBe(0);
      expect(idx.readUInt32BE(12 + 8)).toBe(0);
      expect(idx.readUInt32BE(12 + 36)).toBe(6);
      writeFileSync(join(w, '.git', 'index'), idx);
      expect(git(w, ['status', '--porcelain'])).toBe('');
      expect(git(w, ['ls-files'])).toBe('f.txt\n');
    } finally { rmSync(x, { recursive: true, force: true }); }
  });

  test('the steps oracle fails closed on a step it has no action for', () => {
    const x = mkdtempSync(join(tmpdir(), 'gd-steps-'));
    try {
      for (const kind of ['review', 'ship']) {
        const card = JSON.parse(readFileSync(join(DELIVERY, 'steps', kind + '.json'), 'utf8'));
        card.steps.push({ id: 'something-new', text: 'A step the oracle cannot perform.' });
        writeFileSync(join(x, 'card.json'), JSON.stringify(card));
        writeFileSync(join(x, 'params.json'), JSON.stringify({ kind }));
        const r = spawnSync('python3', [join(DELIVERY, 'steps_oracle.py'), join(x, 'card.json'), join(x, 'params.json')], { env });
        expect(r.status).toBe(2);
        expect(r.stdout.toString()).toContain('no action for something-new');
        writeFileSync(join(x, 'params.json'), JSON.stringify({ kind: kind === 'review' ? 'ship' : 'review' }));
        card.steps.pop();
        writeFileSync(join(x, 'card.json'), JSON.stringify(card));
        expect(spawnSync('python3', [join(DELIVERY, 'steps_oracle.py'), join(x, 'card.json'), join(x, 'params.json')], { env }).status).toBe(2);
      }
    } finally { rmSync(x, { recursive: true, force: true }); }
  });

  test('the CONTRIBUTING check wants a well-formed entry and the next version after main', () => {
    const x = mkdtempSync(join(tmpdir(), 'gd-contrib-'));
    const w = join(x, 'w');
    const ident = { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@example.com' };
    const commit = (files: Record<string, string>, msg: string) => {
      for (const [p, s] of Object.entries(files)) writeFileSync(join(w, p), s);
      git(w, ['add', '-A']); git(w, ['commit', '-q', '-m', msg], ident);
    };
    const log = (u: string[]) => ['# Changelog', '', '## Unreleased', '', ...u, ...(u.length ? [''] : []), '## 1.4.0', '', '- Fixed: Old. (feature/aaaaaa)', ''].join('\n');
    const check = () => spawnSync('python3', [join(DELIVERY, 'template', 'contrib_check.py'), w, 'main', 'HEAD', 'feature/abc123'], { env }).status;
    try {
      mkdirSync(w);
      git(w, ['init', '-q', '-b', 'main']);
      commit({ 'CHANGELOG.md': log([]), VERSION: '1.4.0\n' }, 'base');
      git(w, ['checkout', '-q', '-b', 'feature/abc123']);
      commit({ 'CHANGELOG.md': log(['- Added: A thing. (feature/abc123)']), VERSION: '1.5.0\n' }, 'ok');
      expect(check()).toBe(0);
      commit({ VERSION: '1.4.0\n' }, 'stale version');
      expect(check()).toBe(1);
      commit({ VERSION: '1.4.1\n' }, 'patch for an Added entry');
      expect(check()).toBe(1);
      commit({ 'CHANGELOG.md': log(['- Fixed: A thing. (feature/abc123)']) }, 'fixed entry, patch version');
      expect(check()).toBe(0);
      commit({ 'CHANGELOG.md': log(['- Fixed a thing']) }, 'malformed');
      expect(check()).toBe(1);
      commit({ 'CHANGELOG.md': log(['- Fixed: A thing. (feature/abc123)']).replace('- Fixed: Old. (feature/aaaaaa)\n', '') }, 'dropped a released entry');
      expect(check()).toBe(1);
    } finally { rmSync(x, { recursive: true, force: true }); }
  });
});

describe('gstack-delivery-v1 tasks', () => {
  for (const row of rows) {
    const t = join(DEV, row.id);
    test(row.id + ' follows the format', () => {
      const tt = toml(row.id);
      const tj = JSON.parse(readFileSync(join(t, 'verifier', 'task.json'), 'utf8'));
      expect(tt.id).toBe(row.id);
      expect(tt.kind).toBe(row.kind);
      expect(tt.skill).toBe(row.kind);
      expect(tj.kind).toBe(row.kind);
      expect(tt.workdir).toBe('/work/repo');
      expect(tt.artifacts).toEqual(['/work']);
      expect(tt.source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(tt.source.license).toBe('MIT');
      expect(existsSync(join(SET_DIR, 'LICENSES', tt.source.repo + '.txt'))).toBe(true);
      if (row.kind === 'review') {
        expect(tt.score.planted_hunks.length).toBeGreaterThanOrEqual(4);
        expect(tt.score.planted_hunks.length).toBeLessThanOrEqual(5);
        expect(tt.score.decoys.length).toBe(2);
        expect(tt.score.planted_hunks).toEqual(tj.planted_hunks.map((h: any) => ({ file: h.file, start: h.start, end: h.end })));
        expect(tt.score.max_false_reports).toBe(tj.max_false_reports);
        for (const h of tj.planted_hunks) expect(existsSync(join(t, 'verifier', 'trees', h.tree))).toBe(true);
      } else {
        expect(tt.score.allowed_paths).toEqual(tj.allowed_paths);
        expect(tt.score.allowed_paths).toContain('CHANGELOG.md');
        expect(tt.score.allowed_paths).toContain('VERSION');
        expect(tj.repo_tests_min).toBeGreaterThan(1);
        expect(tj.repo_skips_max).toBeGreaterThanOrEqual(0);
        expect(existsSync(join(t, 'verifier', 'hidden', 'tests_gn', 'test_ship.py'))).toBe(true);
      }
      const instruction = readFileSync(join(t, 'instruction.md'), 'utf8');
      for (const m of MARKERS) expect(instruction).not.toMatch(m);
      expect(instruction).not.toMatch(SLASH_SKILL);
      for (const d of ['environment', 'verifier']) {
        const df = readFileSync(join(t, d, 'Dockerfile'), 'utf8');
        for (const f of df.split('\n').filter((l) => l.startsWith('FROM '))) expect(f).toMatch(/^FROM [a-z0-9._/-]+@sha256:[0-9a-f]{64}$/);
        expect(df).toContain('--require-hashes');
        expect(df).toContain('snapshot.debian.org/archive/debian/');
        for (const m of MARKERS) expect(df).not.toMatch(m);
      }
      for (const s of ['oracle/solve.sh', 'oracle/steps.sh', 'verifier/verify.sh', ...readdirSync(join(t, 'checks')).filter((f) => f.endsWith('.sh')).map((f) => 'checks/' + f)]) {
        expect(statSync(join(t, s)).mode & 0o111).toBeGreaterThan(0);
      }
      expect(JSON.parse(readFileSync(join(t, 'oracle', 'steps.json'), 'utf8')).kind).toBe(row.kind);
    });

    test(row.id + ' working tree carries no identity, host path, reflog or agent startup file', () => {
      const x = mkdtempSync(join(tmpdir(), 'gd-work-'));
      try {
        const tree = readTar(readFileSync(join(t, 'environment', 'work.tar')));
        for (const p of tree.keys()) expect(p).not.toMatch(STARTUP_FILES);
        for (const p of tree.keys()) expect(p).not.toMatch(/\.git\/logs\//);
        expect(spawnSync('tar', ['-xf', join(t, 'environment', 'work.tar'), '-C', x]).status).toBe(0);
        const gitDirs = ['repo/.git', 'remote.git'].map((d) => join(x, d)).filter((d) => existsSync(d));
        expect(gitDirs.length).toBe(row.kind === 'ship' ? 2 : 1);
        for (const gd of gitDirs) {
          const log = spawnSync('git', ['--git-dir', gd, 'log', '--all', '--format=%an %ae %cn %ce%n%B'], { env }).stdout.toString();
          expect(log).toContain('Maintainer maintainer@example.com');
          for (const m of MARKERS) expect(log).not.toMatch(m);
          expect(readFileSync(join(gd, 'config'), 'utf8')).not.toMatch(/\/home\//);
          expect(spawnSync('git', ['--git-dir', gd, 'fsck', '--no-progress', '--no-dangling'], { env }).status).toBe(0);
        }
        expect(spawnSync('git', ['-C', join(x, 'repo'), 'status', '--porcelain'], { env }).stdout.toString()).toBe('');
        for (const [p, e] of tree) {
          if (p.includes('.git/') || !/\.(md|rst|txt|toml|cfg|json|sh|py)$/.test(p)) continue;
          const s = e.data.toString('utf8');
          for (const m of [/gstack/i, /garrytan/i, /\/home\/user/, /\bcapy\b/i]) expect(s).not.toMatch(m);
        }
      } finally {
        rmSync(x, { recursive: true, force: true });
      }
    });

    test(row.id + ' has an accepted matrix: oracle and steps-followed oracle 1, start and every check 0, 5 of 5', () => {
      const m = acceptance.tasks[row.id];
      expect(m).toBeDefined();
      expect(m.ok).toBe(true);
      expect(m.kind).toBe(row.kind);
      expect(m.rows[0]).toEqual({ scenario: 'oracle', expected: 1, got: [1, 1, 1, 1, 1] });
      expect(m.rows[1]).toEqual({ scenario: 'steps', expected: 1, got: [1, 1, 1, 1, 1] });
      const checks = readdirSync(join(t, 'checks')).filter((f) => f.endsWith('.sh')).map((f) => 'check:' + f.replace(/\.sh$/, '')).sort();
      expect(m.rows.slice(2).map((r: any) => r.scenario).sort()).toEqual(['start', ...checks].sort());
      for (const r of m.rows.slice(2)) expect(r.got).toEqual([0, 0, 0, 0, 0]);
    });
  }
});
