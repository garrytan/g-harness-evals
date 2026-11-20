// Vendors the inputs of the rules-fix-v1 build named in sources.json. For each task it fetches the upstream base commit
// (the fix commit's parent) and the fix commit, writes upstream/<repo>-<base 12>.tar.gz (the base tree, with the paths in
// prune dropped: documentation, images, CI files and agent rules files such as AGENTS.md and CLAUDE.md), and
// upstream/<repo>-<fix 12>.fix.tar.gz (only the files the fix changed, at the fix commit), both gzipped so the suite's
// text scans never read third-party source as if it were ours. It also fetches the linked
// issue and writes its title and body to issues/<repo>-<number>.md with usernames, @mentions, HTML comments and home
// folder names removed. Each file's sha256 goes back into sources.json. Needs network access to GitHub and the gh CLI
// for the issue text; the build itself reads only the vendored files.
//
//   bun scripts/repo-tasks/rules-fix/fetch-sources.ts [--only <repo or task key>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { git, sha256, writeTar, type Tree } from '../delivery/lib.ts';
import { pruned } from '../delivery/fetch-sources.ts';

const HERE = import.meta.dir;
const SOURCES = join(HERE, 'sources.json');
export const RULES_FILES = /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.hermes\.md|\.cursorrules|copilot-instructions\.md)$|(^|\/)\.(claude|cursor)\//;
const BT = String.fromCharCode(96);

/** Removes what identifies people from an issue's text: HTML comments, @mentions outside code, profile links and
 * home folder names in paths. A handle listed in keep (a decorator name written without backticks) stays. */
export function sanitize(text: string, keep: string[] = []): string {
  let t = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/https?:\/\/github\.com\/[A-Za-z0-9-]+\/?(?=[\s)\]]|$)/g, '');
  t = t.replace(/(\/Users\/|\/home\/|[A-Za-z]:\\+Users\\+)([^/\\\s'"]+)/g, (_m, a) => a + 'user');
  const fenceRe = new RegExp('^\\s*(' + BT + BT + BT + '|~~~)');
  const codeRe = new RegExp('(' + BT + '[^' + BT + ']*' + BT + ')');
  let fence = false;
  const out = t.split('\n').map((line) => {
    if (fenceRe.test(line)) { fence = !fence; return line; }
    if (fence) return line;
    return line.split(codeRe).map((part) => part.startsWith(BT) ? part : part.replace(/(^|[^\w@./-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![\w.(-])/g, (m, pre, h) => keep.includes(h) ? m : pre + 'a user')).join('');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function treeAt(dir: string, sha: string, filter: (p: string) => boolean): { tree: Tree; dropped: string[] } {
  git(dir, ['checkout', '-q', '-f', sha]);
  const tree: Tree = new Map();
  const dropped: string[] = [];
  for (const line of git(dir, ['ls-files', '-s', '-z']).split('\0').filter(Boolean)) {
    const [meta, path] = line.split('\t');
    const mode = meta.split(' ')[0];
    if (mode === '160000' || mode === '120000' || !filter(path)) { dropped.push(path); continue; }
    tree.set(path, { data: readFileSync(join(dir, path)), mode: mode === '100755' ? 0o755 : 0o644 });
  }
  return { tree, dropped };
}

if (import.meta.main) {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  const s = JSON.parse(readFileSync(SOURCES, 'utf8'));
  for (const d of ['upstream', 'issues']) mkdirSync(join(HERE, d), { recursive: true });
  for (const task of s.tasks) {
    const r = s.repos[task.repo];
    const key = task.repo + '@' + task.fix.slice(0, 12);
    if (only && only !== task.repo && only !== key) continue;
    const dir = mkdtempSync(join(tmpdir(), 'rules-fix-src-'));
    try {
      git(dir, ['init', '-q']);
      git(dir, ['fetch', '-q', '--depth', '2', r.url, task.fix]);
      const parent = git(dir, ['rev-parse', 'FETCH_HEAD^']).trim();
      if (parent !== task.base) throw new Error(key + ': base is not the fix commit\'s first parent');
      const changed = git(dir, ['diff', '--name-only', '--no-renames', task.base, task.fix]).split('\n').filter(Boolean);
      const fixFiles = [...task.src_files, ...task.test_files].sort();
      const extra = changed.filter((p) => !fixFiles.includes(p) && !/\.(rst|md|txt)$/i.test(p) && !/^docs?\//.test(p) && !/^(CHANGE|HISTORY|AUTHORS|NEWS)/i.test(p));
      if (extra.length) throw new Error(key + ': the fix changes files outside src_files and test_files: ' + extra.join(', '));
      const globs = [...s.prune, ...r.prune].filter((g) => !(r.keep ?? []).includes(g));
      const base = treeAt(dir, task.base, (p) => !pruned(p, globs));
      const lic = task.license_file ?? r.license_file;
      if (!base.tree.has(lic)) throw new Error(key + ': license file missing: ' + lic);
      task.stripped = base.dropped.filter((p) => RULES_FILES.test(p)).sort();
      const baseTar = gzipSync(writeTar(base.tree, ''), { level: 9 });
      const baseName = 'upstream/' + task.repo + '-' + task.base.slice(0, 12) + '.tar.gz';
      writeFileSync(join(HERE, baseName), baseTar);
      const fixTree = treeAt(dir, task.fix, (p) => fixFiles.includes(p)).tree;
      const fixTar = gzipSync(writeTar(fixTree, ''), { level: 9 });
      const fixName = 'upstream/' + task.repo + '-' + task.fix.slice(0, 12) + '.fix.tar.gz';
      writeFileSync(join(HERE, fixName), fixTar);
      const [owner, name] = r.url.replace(/\/$/, '').split('/').slice(-2);
      const issueNo = Number(task.issue.split('/').pop());
      const query = 'query($o: String!, $n: String!, $i: Int!) { repository(owner: $o, name: $n) { issue(number: $i) { title body } } }';
      const args = ['api', 'graphql', '-f', 'query=' + query, '-f', 'o=' + owner, '-f', 'n=' + name, '-F', 'i=' + issueNo];
      let gh = spawnSync('gh', args, { encoding: 'utf8' });
      for (let i = 0; i < 3 && gh.status !== 0; i++) {
        Bun.sleepSync(5000);
        gh = spawnSync('gh', args, { encoding: 'utf8' });
      }
      if (gh.status !== 0) throw new Error(key + ': issue fetch failed');
      const issue = JSON.parse(gh.stdout).data?.repository?.issue;
      if (!issue) throw new Error(key + ': ' + task.issue + ' is not an issue');
      const md = '# ' + sanitize(issue.title).trim() + '\n\n' + sanitize(issue.body ?? '', task.keep_at ?? []);
      const issueName = 'issues/' + task.repo + '-' + issueNo + '.md';
      writeFileSync(join(HERE, issueName), md);
      task.archive = baseName; task.archive_sha256 = sha256(baseTar);
      task.fix_archive = fixName; task.fix_archive_sha256 = sha256(fixTar);
      task.issue_text = issueName; task.issue_text_sha256 = sha256(md);
      console.log('SOURCE: ' + key + ' base_files=' + base.tree.size + ' fix_files=' + fixTree.size + ' stripped=' + task.stripped.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  writeFileSync(SOURCES, JSON.stringify(s, null, 1) + '\n');
}
