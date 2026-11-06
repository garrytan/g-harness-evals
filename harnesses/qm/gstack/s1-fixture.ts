// The S1 probe's fixture repository (docs/benchmarks/2026-11-03-qm-s1-gstack-probe, gate 3), staged at
// /root/workspace/repo in both arms' sandbox images. Invented: a tiny Node project with a tag, work after the tag and a
// feature branch whose last commit breaks the login test, so requests 1 (investigate), 2 (review) and 4
// (document-release) have something to work on.
//
// Deterministic: every blob, tree, commit and tag object is written with git hash-object from fixed text, so the
// commit ids are the same on every machine and no git identity, config or clock is read. tree_sha256 is the sha256 of
// sha256sum lines over the checked-out files (outside .git), sorted by path: the same pipeline the probe's preflight
// runs inside each image (FIXTURE_TREE_COMMAND).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

export const FIXTURE_PATH = '/root/workspace/repo';
export const FIXTURE_BRANCH = 'feature/session-timeout';
export const FIXTURE_TAG = 'v0.1.0';
/** Run in the repository: prints one line, the tree sha256. */
export const FIXTURE_TREE_COMMAND = "find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | while IFS= read -r f; do sha256sum \"$f\"; done | sha256sum | cut -d' ' -f1";
/** Run in the repository: one line per ref, "<object> <refname>", sorted, then the checked-out branch. */
export const FIXTURE_REFS_COMMAND = 'git for-each-ref --format="%(objectname) %(refname)" | LC_ALL=C sort; git symbolic-ref HEAD';

const AUTHOR = 'Dana Okafor <dana@example.test>';
type Files = Record<string, string>;

const PACKAGE = JSON.stringify({ name: 'acme-auth', version: '0.1.0', private: true, scripts: { test: 'node test/login.test.js && node test/retry.test.js' } }, null, 2) + '\n';
const AUTH_V1 = `const crypto = require('node:crypto');

const users = new Map([['dana', hash('correct horse')]]);

function hash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function login(username, password) {
  const stored = users.get(username);
  if (!stored) return { ok: false, reason: 'no such user' };
  return stored === hash(password) ? { ok: true } : { ok: false, reason: 'wrong password' };
}

module.exports = { login, hash };
`;
const AUTH_TRIM = AUTH_V1.replace('const stored = users.get(username);', 'const stored = users.get(username.trim());');
const AUTH_BROKEN = `const crypto = require('node:crypto');
const { startSession } = require('./session');

const users = new Map([['dana', hash('correct horse')]]);

function hash(password) {
  return crypto.createHash('sha256').update(password.trim()).digest('base64');
}

function login(username, password) {
  console.log('login attempt', username, password);
  const stored = users.get(username.trim());
  if (!stored) return { ok: false, reason: 'no such user' };
  if (stored !== crypto.createHash('sha256').update(password).digest('hex')) return { ok: false, reason: 'wrong password' };
  return { ok: true, session: startSession(username) };
}

module.exports = { login, hash };
`;
const LOGIN_TEST = `const assert = require('node:assert');
const { login } = require('../src/auth');

assert.strictEqual(login('dana', 'correct horse').ok, true, 'dana logs in with her password');
assert.strictEqual(login('dana', 'wrong').ok, false, 'a wrong password is refused');
assert.strictEqual(login('nobody', 'x').ok, false, 'an unknown user is refused');
console.log('login tests passed');
`;
const RETRY = `async function retry(fn, { times = 3, delayMs = 50 } = {}) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(i); } catch (e) { last = e; await new Promise((r) => setTimeout(r, delayMs)); }
  }
  throw last;
}

module.exports = { retry };
`;
const RETRY_TEST = `const assert = require('node:assert');
const { retry } = require('../src/retry');

let calls = 0;
retry(async () => { calls++; if (calls < 2) throw new Error('flaky'); return 'ok'; }, { delayMs: 1 })
  .then((v) => { assert.strictEqual(v, 'ok'); console.log('retry tests passed'); });
`;
const SESSION = `const TIMEOUT_MS = 15 * 60 * 1000;
const sessions = new Map();

function startSession(username) {
  const id = Math.random().toString(36).slice(2);
  sessions.set(id, { username, expires: Date.now() + TIMEOUT_MS });
  return id;
}

module.exports = { startSession, TIMEOUT_MS };
`;
const README_V1 = '# acme-auth\n\nLogin for the acme internal tools. Run the tests with ' + '`npm test`' + '.\n';
const README_RESET = README_V1 + '\n## Password reset\n\nAsk an admin to reset your password; self-service reset is not built yet.\n';

/** The history, oldest first (dates are seconds since the epoch with a Pacific offset). Each commit lists only the files it
 *  changes; the feature branch forks from the last main commit, the day before the probe's requests were written. */
export const FIXTURE_COMMITS: Array<{ ref: string; date: string; message: string; files: Files; tag?: string }> = [
  { ref: 'main', date: '1792483200 -0700', message: 'Add login with hashed passwords', files: { 'README.md': README_V1, 'package.json': PACKAGE, 'src/auth.js': AUTH_V1, 'test/login.test.js': LOGIN_TEST } },
  { ref: 'main', date: '1792656000 -0700', message: 'Add retry helper for flaky network calls', files: { 'src/retry.js': RETRY, 'test/retry.test.js': RETRY_TEST }, tag: FIXTURE_TAG },
  { ref: 'main', date: '1793088000 -0700', message: 'Document password reset', files: { 'README.md': README_RESET } },
  { ref: 'main', date: '1793433600 -0700', message: 'Trim whitespace around usernames at login', files: { 'src/auth.js': AUTH_TRIM } },
  { ref: FIXTURE_BRANCH, date: '1793638800 -0800', message: 'Add a 15-minute session timeout to login', files: { 'src/auth.js': AUTH_BROKEN, 'src/session.js': SESSION } },
];

export const gitEnv = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' });

export function git(dir: string, args: string[], input?: string): string {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', input, env: gitEnv() });
  if (r.status !== 0) throw new Error('fixture: git ' + args.join(' ') + ' failed: ' + r.stderr);
  return r.stdout.trim();
}

/** A tree object for a path map, built bottom-up with mktree. */
export function writeTree(dir: string, files: Files): string {
  const entries: string[] = [];
  const subdirs = new Map<string, Files>();
  for (const [path, text] of Object.entries(files)) {
    const slash = path.indexOf('/');
    if (slash < 0) { entries.push('100644 blob ' + git(dir, ['hash-object', '-w', '--stdin'], text) + '\t' + path); continue; }
    const sub = subdirs.get(path.slice(0, slash)) ?? {};
    sub[path.slice(slash + 1)] = text;
    subdirs.set(path.slice(0, slash), sub);
  }
  for (const [name, sub] of subdirs) entries.push('040000 tree ' + writeTree(dir, sub) + '\t' + name);
  return git(dir, ['mktree'], entries.join('\n') + '\n');
}

export interface Fixture { path: string; head: string; branch: string; refs: string[]; tree_sha256: string; files: number }

/** Builds the fixture at dir (replacing it), checked out on the feature branch, and returns its identity. */
export function buildFixture(dir: string): Fixture {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '--initial-branch=main']);
  const tips: Record<string, { commit: string; files: Files }> = {};
  for (const c of FIXTURE_COMMITS) {
    const parent = tips[c.ref] ?? tips.main;
    const files = { ...parent?.files, ...c.files };
    const body = ['tree ' + writeTree(dir, files), ...(parent ? ['parent ' + parent.commit] : []), 'author ' + AUTHOR + ' ' + c.date, 'committer ' + AUTHOR + ' ' + c.date, '', c.message, ''].join('\n');
    const commit = git(dir, ['hash-object', '-t', 'commit', '-w', '--stdin'], body);
    tips[c.ref] = { commit, files };
    git(dir, ['update-ref', 'refs/heads/' + c.ref, commit]);
    if (!c.tag) continue;
    const tag = git(dir, ['hash-object', '-t', 'tag', '-w', '--stdin'], ['object ' + commit, 'type commit', 'tag ' + c.tag, 'tagger ' + AUTHOR + ' ' + c.date, '', 'Release ' + c.tag, ''].join('\n'));
    git(dir, ['update-ref', 'refs/tags/' + c.tag, tag]);
  }
  git(dir, ['checkout', '-q', FIXTURE_BRANCH]);
  const tree = spawnSync('sh', ['-c', FIXTURE_TREE_COMMAND], { cwd: dir, encoding: 'utf8' });
  const refs = spawnSync('sh', ['-c', FIXTURE_REFS_COMMAND], { cwd: dir, encoding: 'utf8', env: gitEnv() });
  if (tree.status !== 0 || refs.status !== 0) throw new Error('fixture: identity commands failed: ' + tree.stderr + refs.stderr);
  const head = tips[FIXTURE_BRANCH]!;
  return { path: FIXTURE_PATH, head: head.commit, branch: FIXTURE_BRANCH, refs: refs.stdout.trim().split('\n'), tree_sha256: tree.stdout.trim(), files: Object.keys(head.files).length };
}
