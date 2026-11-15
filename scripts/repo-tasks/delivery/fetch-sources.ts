// Vendors the upstream repositories named in sources.json: clones each at its pinned commit, drops the pruned paths and
// writes upstream/<name>-<commit 12>.tar (a deterministic tar from lib.ts) and its sha256 back into sources.json. Needs
// network access to GitHub; the build itself reads only the vendored archives. A symlink becomes a regular file holding
// its target's bytes (Harbor's path check refuses links in a task tree).
//
//   bun scripts/repo-tasks/delivery/fetch-sources.ts [--only <name>]
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, sha256, writeTar, type Tree } from './lib.ts';

const HERE = import.meta.dir;
const SOURCES = join(HERE, 'sources.json');

export function globRe(g: string): RegExp {
  const re = g.split('**/').map((part) => part.split('**').map((p) => p.split('*').map((s) => s.replace(/[.+?^\${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')).join('(?:.*/)?');
  return new RegExp('^' + re + '$');
}

export function pruned(path: string, globs: string[]): boolean {
  return globs.some((g) => globRe(g).test(path));
}

if (import.meta.main) {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const s = JSON.parse(readFileSync(SOURCES, 'utf8'));
  mkdirSync(join(HERE, 'upstream'), { recursive: true });
  for (const [name, r] of Object.entries<any>(s.repos)) {
    if (only && name !== only) continue;
    const dir = mkdtempSync(join(tmpdir(), 'upstream-'));
    try {
      git(dir, ['init', '-q']);
      git(dir, ['fetch', '-q', '--depth', '1', r.url, r.commit]);
      git(dir, ['checkout', '-q', r.commit]);
      const tree: Tree = new Map();
      const globs = [...s.prune, ...r.prune];
      let dropped = 0;
      for (const line of git(dir, ['ls-files', '-s', '-z']).split('\0').filter(Boolean)) {
        const [meta, path] = line.split('\t');
        const mode = meta.split(' ')[0];
        if (pruned(path, globs)) { dropped++; continue; }
        tree.set(path, { data: readFileSync(join(dir, path)), mode: mode === '100755' ? 0o755 : 0o644 });
      }
      if (!tree.has(r.license)) throw new Error(name + ': license file missing: ' + r.license);
      const tar = writeTar(tree, '');
      const file = name + '-' + r.commit.slice(0, 12) + '.tar';
      writeFileSync(join(HERE, 'upstream', file), tar);
      r.archive = 'upstream/' + file; r.sha256 = sha256(tar); r.files = tree.size;
      console.log('SOURCE: ' + name + ' files=' + tree.size + ' dropped=' + dropped + ' bytes=' + tar.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  writeFileSync(SOURCES, JSON.stringify(s, null, 1) + '\n');
}
