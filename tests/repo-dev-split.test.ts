import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The public dev split of the gstack-native-v1 repository task set (internal-task, docs/repo-tasks.md).
const SET = join(import.meta.dir, '..', 'tasks', 'repo', 'gstack-native-v1');
const DEV = join(SET, 'dev');
const KIND_SKILL: Record<string, string> = { fix: 'investigate', review: 'review', qa: 'qa', ship: 'ship' };
const MARKERS = [/gstack/i, /\bautoplan\b/i, /garrytan/i, /\/home\/user/, /\bcapy\b/i];
const SLASH_SKILL = /(^|[\s(`])\/(investigate|review|qa|ship|office-hours|autoplan|browse|careful|retro)\b/;
const ids = readdirSync(DEV).filter((n) => statSync(join(DEV, n)).isDirectory()).sort();
const acceptance = JSON.parse(readFileSync(join(DEV, 'ACCEPTANCE.json'), 'utf8'));
const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { out.push(p + '/'); walk(p, out); } else out.push(p); }
  return out;
};
const toml = (id: string) => Bun.TOML.parse(readFileSync(join(DEV, id, 'task.toml'), 'utf8')) as any;
const env = { PATH: '/usr/bin:/bin', HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

describe('gstack-native-v1 dev split', () => {
  test('holds two tasks of each kind', () => {
    expect(ids.length).toBe(8);
    expect(ids.map((id) => toml(id).kind).sort()).toEqual(['fix', 'fix', 'qa', 'qa', 'review', 'review', 'ship', 'ship']);
  });

  test('every task has an accepted matrix', () => {
    expect(Object.keys(acceptance.tasks).sort()).toEqual(ids);
    for (const id of ids) {
      const m = acceptance.tasks[id];
      expect(m.ok).toBe(true);
      expect(m.rows[0]).toEqual({ scenario: 'oracle', expected: 1, got: [1, 1, 1, 1, 1] });
      const checks = readdirSync(join(DEV, id, 'checks')).filter((f) => f.endsWith('.sh')).map((f) => 'check:' + f.replace(/\.sh$/, '')).sort();
      expect(m.rows.slice(1).map((r: any) => r.scenario).sort()).toEqual(['start', ...checks].sort());
      for (const r of m.rows.slice(1)) expect(r.got).toEqual([0, 0, 0, 0, 0]);
    }
  });

  for (const id of ids) {
    const t = join(DEV, id);
    test(id + ' follows the format', () => {
      const tt = toml(id);
      const tj = JSON.parse(readFileSync(join(t, 'verifier', 'task.json'), 'utf8'));
      expect(tt.id).toBe(id);
      expect(KIND_SKILL[tt.kind]).toBe(tt.skill);
      expect(tj.kind).toBe(tt.kind);
      expect(tt.workdir).toBe('/work/repo');
      expect(tt.artifacts).toEqual(['/work']);
      for (const k of ['agent_timeout_s', 'verifier_timeout_s', 'cpus', 'memory_mb', 'storage_mb']) expect(tt[k]).toBeGreaterThan(0);
      if (tt.kind === 'qa') {
        expect(tt.score.planted_bugs).toBe(tj.bugs.length);
        expect(tt.score.max_false_reports).toBe(tj.max_false_reports);
        expect(tt.repeat.repro_runs).toBe(tj.repro_runs);
      }
      if (tt.kind === 'review') expect(tt.score.planted_hunks).toEqual(tj.planted_hunks.map((h: any) => ({ file: h.file, start: h.start, end: h.end })));
      if (tt.kind === 'ship') {
        expect(tt.score.allowed_paths).toEqual(tj.allowed_paths);
        expect(new Set(tt.score.allowed_paths).size).toBe(tt.score.allowed_paths.length);
      }
      if (tt.kind !== 'qa') { expect(tt.source.commit).toMatch(/^[0-9a-f]{40}$/); expect(existsSync(join(SET, 'LICENSES', tt.source.repo + '.txt'))).toBe(true); }
      if (tt.kind === 'fix' || tt.kind === 'ship') { expect(tj.repo_tests_min).toBeGreaterThan(0); expect(tj.repo_skips_max).toBeGreaterThanOrEqual(0); }

      const instruction = readFileSync(join(t, 'instruction.md'), 'utf8');
      for (const m of MARKERS) expect(instruction).not.toMatch(m);
      expect(instruction).not.toMatch(SLASH_SKILL);

      const df = readFileSync(join(t, 'environment', 'Dockerfile'), 'utf8');
      const vdf = readFileSync(join(t, 'verifier', 'Dockerfile'), 'utf8');
      for (const d of [df, vdf]) {
        const froms = d.split('\n').filter((l) => l.startsWith('FROM '));
        expect(froms.length).toBeGreaterThan(0);
        for (const f of froms) expect(f).toMatch(/^FROM [a-z0-9._/-]+@sha256:[0-9a-f]{64}( AS [a-z]+)?$/);
        expect(d).toContain('--require-hashes');
        expect(d).toContain('snapshot.debian.org/archive/debian/');
        for (const m of MARKERS) expect(d).not.toMatch(m);
      }
      expect(df).toContain('ADD work.tar /work/');
      expect(vdf).not.toContain('work.tar');
      expect(vdf).toContain('COPY . /tests/');

      for (const p of walk(t)) {
        if (p.endsWith('.sh')) expect(statSync(p).mode & 0o111).toBeGreaterThan(0);
        expect(p).not.toMatch(/\/\.git\/$/);
      }
    });

    test(id + ' working tree carries no identity, host path or reflog', () => {
      const x = mkdtempSync(join(tmpdir(), 'repo-dev-'));
      try {
        expect(spawnSync('tar', ['-xf', join(t, 'environment', 'work.tar'), '-C', x]).status).toBe(0);
        const files = walk(x);
        const gitDirs = files.filter((p) => p.endsWith('/') && existsSync(join(p, 'HEAD')) && existsSync(join(p, 'objects')));
        if (toml(id).kind !== 'qa') expect(gitDirs.length).toBeGreaterThan(0);
        for (const gd of gitDirs) {
          expect(existsSync(join(gd, 'logs'))).toBe(false);
          const log = spawnSync('git', ['--git-dir', gd, 'log', '--all', '--format=%an %ae %cn %ce%n%B'], { env }).stdout.toString();
          expect(log.length).toBeGreaterThan(0);
          for (const m of MARKERS) expect(log).not.toMatch(m);
          expect(readFileSync(join(gd, 'config'), 'utf8')).not.toMatch(/\/home\//);
        }
        for (const p of files) {
          if (p.endsWith('/') || p.includes('/.git/') || /\/remote\.git\//.test(p) || !/\.(md|rst|txt|toml|cfg|json|sh|html|js|py)$/.test(p)) continue;
          const s = readFileSync(p, 'utf8');
          for (const m of [/gstack/i, /garrytan/i, /\/home\/user/, /\bcapy\b/i]) expect(s).not.toMatch(m);
        }
      } finally {
        rmSync(x, { recursive: true, force: true });
      }
    });
  }
});
