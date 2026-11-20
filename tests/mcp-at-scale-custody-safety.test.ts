import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealSet } from '../scripts/mcp-at-scale/requests/seal.ts';
import type { TItem } from '../scripts/mcp-at-scale/requests/sets.ts';

test('a blocked catalog scan reports only metadata and leaves no report or sums', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-scan-'));
  try {
    const scriptDir = join(tmp, 'scripts', 'mcp-at-scale', 'catalog');
    const catalog = join(tmp, 'tasks', 'mcp-at-scale', 'catalog');
    mkdirSync(scriptDir, { recursive: true });
    mkdirSync(catalog, { recursive: true });
    const script = join(scriptDir, 'scan.ts');
    copyFileSync(join(import.meta.dir, '../scripts/mcp-at-scale/catalog/scan.ts'), script);
    const fixture = ['sk', 'syntheticFixture1234567890'].join('-');
    writeFileSync(join(catalog, 'capture.txt'), `synthetic fixture\n${fixture}\n`);
    const digest = createHash('sha256').update(fixture).digest('hex').slice(0, 12);

    for (const args of [[], ['--check']]) {
      const p = Bun.spawnSync([process.execPath, script, ...args], { cwd: tmp, env: { HOME: tmp }, stdout: 'pipe', stderr: 'pipe' });
      expect(p.exitCode).toBe(1);
      expect(existsSync(join(catalog, 'leak-scan.json'))).toBe(false);
      expect(existsSync(join(catalog, 'SHA256SUMS'))).toBe(false);
      expect((p.stdout.toString() + p.stderr.toString()).includes(fixture)).toBe(false);
      expect(p.stderr.toString().trim()).toBe(`BLOCKED capture.txt:2 openai-or-anthropic-key sha256:${digest}`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

const items: TItem[] = ['a', 'b'].map((id) => ({ id, set: 'T', kind: 'tool', text: `Synthetic item ${id}`, fixtures: [], end_state: { fired: [] }, acceptable: [] }));

test('a new sealed directory inside another Git worktree is refused before any output is created', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-seal-worktree-'));
  try {
    const repo = join(tmp, 'repo');
    const p = Bun.spawnSync(['git', 'init', '-q', repo], { env: { HOME: tmp, PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
    expect(p.exitCode).toBe(0);
    const alias = join(tmp, 'alias');
    symlinkSync(repo, alias, 'dir');
    const out = join(tmp, 'public');
    for (const parent of [repo, alias, join(repo, '.git')]) {
      const missing = join(parent, 'new');
      expect(() => sealSet({ set: 'T', items, out, sealedDir: join(missing, 'sealed') })).toThrow('inside a git work tree');
      expect(existsSync(missing)).toBe(false);
      expect(existsSync(out)).toBe(false);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('sealed plaintext stays owner-only when written or replaced', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-seal-mode-'));
  try {
    const sealedDir = join(tmp, 'sealed');
    const out = join(tmp, 'public');
    const file = join(sealedDir, 'set-t-sealed.jsonl');
    sealSet({ set: 'T', items, out, sealedDir });
    expect(statSync(sealedDir).mode & 0o077).toBe(0);
    expect(statSync(file).mode & 0o077).toBe(0);
    rmSync(file);
    writeFileSync(file, 'old fixture', { mode: 0o644 });
    sealSet({ set: 'T', items, out, sealedDir });
    expect(statSync(file).mode & 0o077).toBe(0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
