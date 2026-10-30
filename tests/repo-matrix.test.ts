import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matrixPlan, RESTORE, taskId } from '../scripts/repo-tasks/matrix.ts';

// scripts/repo-tasks/matrix.ts (docs/repo-tasks.md, Acceptance). The docker path runs in the generator and in
// tests/repo-dev-split.test.ts's committed ACCEPTANCE.json; these checks are keyless.
const DEV = join(import.meta.dir, '..', 'tasks', 'repo', 'gstack-native-v1', 'dev');

describe('repo task matrix', () => {
  test('plan: oracle expects 1, the starting state and every check expect 0', () => {
    const plan = matrixPlan(join(DEV, 'gn-dev-fix-01'));
    expect(plan[0]).toEqual(['oracle', '/oracle/solve.sh', 1]);
    expect(plan[1]).toEqual(['start', null, 0]);
    expect(plan.slice(2).every(([n, s, e]) => n.startsWith('check:') && s === '/checks/' + n.slice(6) + '.sh' && e === 0)).toBe(true);
    expect(plan.map((p) => p[0])).toContain('check:shim');
  });

  test('taskId reads task.toml', () => {
    expect(taskId(join(DEV, 'gn-dev-qa-02'))).toBe('gn-dev-qa-02');
  });

  test('restore drops members that would land outside /work', () => {
    const d = mkdtempSync(join(tmpdir(), 'matrix-restore-'));
    try {
      const src = join(d, 'src');
      mkdirSync(join(src, 'repo'), { recursive: true });
      writeFileSync(join(src, 'repo', 'ok.txt'), 'ok');
      symlinkSync('/etc', join(src, 'escape'));
      symlinkSync('../../outside', join(src, 'repo', 'up'));
      expect(spawnSync('tar', ['-C', src, '-cf', join(d, 'state.tar'), '.']).status).toBe(0);
      const work = join(d, 'work');
      const script = RESTORE.split('"/work"').join(JSON.stringify(work)).split('"/tmp/state.tar"').join(JSON.stringify(join(d, 'state.tar')));
      expect(spawnSync('python3', ['-c', script], { env: { PATH: '/usr/bin:/bin' } }).status).toBe(0);
      expect(readFileSync(join(work, 'repo', 'ok.txt'), 'utf8')).toBe('ok');
      expect(existsSync(join(work, 'escape'))).toBe(false);
      expect(existsSync(join(work, 'repo', 'up'))).toBe(false);
      expect(existsSync(join(d, 'state.tar'))).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
