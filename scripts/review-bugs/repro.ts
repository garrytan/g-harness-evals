#!/usr/bin/env bun
// Repros for the real-bug review eval's kept bugs (plan internal-task, "Reinjection" and the S3 inclusion rule; build step 1).
//
//   bun scripts/review-bugs/repro.ts plan    --work <dir> [--stage s3|kept]
//   bun scripts/review-bugs/repro.ts run     --work <dir> [--vms 3] [--parallel 4] [--ttl-hours 8] [--limit <jobs>]
//   bun scripts/review-bugs/repro.ts collect --work <dir>
//
// plan --stage s3 runs before the screen, on every S3 candidate bug: an escaped bug counts only with a failing regression
// test, so the screen pays only for S3 bugs whose repro confirmed them. plan --stage kept (the default) runs after it, on
// the S1 and S2 bugs it kept, for the repro-confirmed sensitivity line. Each plan adds to jobs.json.
//
// For each bug whose fix changed a test file, one job: check out the unit head, lay the fix's
// versions of those test files over it, run them (the test names the fix added when it added any, else the files), then
// run the same at the fix commit. A bug is repro_confirmed when the tests fail at the head with a test failure (not a
// build or install error) and pass at the fix. A kept bug whose fix touched no test gets status no-test, and the S3 rule
// (an escaped bug counts only with a failing regression test or a scripted repro) drops it in build-suite.ts; scripted
// repros are not built. Reinjection is planned only for candidates whose pre-fix commit is gone; the screen skips those
// (it needs a head to read), so none reach this step, and the job list says so.
//
// run: splits the jobs by repository across --vms Ubicloud VMs and runs each through scripts/ubicloud/ubi-runner.sh run
// (UBI_OWNER=internal-task, UBI_TTL_HOURS above the expected wall time), which creates the VM, syncs the job bundle, runs the
// setup and the jobs, pulls the logs back and destroys the VM on every exit. Each test runs in a stock language image
// (golang, rust, python, node) under docker as root; no key or token goes to the VM.
//
// collect: classifies each job from its two logs and exit codes and writes <work>/repro/results.jsonl, one line per
// bug with status confirmed, not-confirmed (passes at the head), inconclusive (build, install or runner trouble, or a
// timeout) or no-test, and the sha256 of the job's logs.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { git } from './git.ts';
import { cloneDir, readJsonl, type Candidate } from './mine.ts';
import type { ScreenLine } from './screen.ts';

export type Lang = 'go' | 'rust' | 'python' | 'ts';
export interface Job { id: string; unit: string; bug: number; repo: string; lang: Lang; head: string; fix: string; tests: string[]; image: string; script: string }
export interface ReproLine { unit: string; bug: number; status: 'confirmed' | 'not-confirmed' | 'inconclusive' | 'no-test'; log_sha256: string | null; detail: string }

export const IMAGES: Readonly<Record<Lang, string>> = { go: 'golang:1.25', rust: 'rust:1', python: 'python:3.12', ts: 'node:24' };
export const PHASE_TIMEOUT_S = 1500;
const RUNNER = join(import.meta.dir, '..', 'ubicloud', 'ubi-runner.sh');
const sh = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export function langOf(path: string): Lang | null {
  if (path.endsWith('.go')) return 'go';
  if (path.endsWith('.rs')) return 'rust';
  if (path.endsWith('.py')) return 'python';
  if (/\.[cm]?[jt]sx?$/.test(path)) return 'ts';
  return null;
}

/** Test names a diff adds, per language: Go TestX funcs, Rust fns, Python test_ defs, JS it/test titles. */
export function addedTestNames(lang: Lang, diff: string): string[] {
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  const re: Record<Lang, RegExp> = {
    go: /^func (Test\w+)\s*\(/,
    rust: /^\s*(?:pub\s+)?(?:async\s+)?fn (\w+)\s*\(/,
    python: /^\s*(?:async\s+)?def (test_\w+)\s*\(/,
    ts: /^\s*(?:it|test)(?:\.\w+)?\(\s*(['"\x60])(.+?)\1/,
  };
  const out = new Set<string>();
  for (const l of added) {
    const m = re[lang].exec(l);
    if (m) out.add(lang === 'ts' ? m[2]! : m[1]!);
  }
  return [...out].slice(0, 20);
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The shell script that runs the tests inside the language image, from /src. */
export function testScript(lang: Lang, tests: string[], names: string[], files: { has: (p: string) => boolean; read: (p: string) => string | null }): string {
  if (lang === 'go') {
    const pkgs = [...new Set(tests.filter((t) => t.endsWith('_test.go')).map((t) => './' + dirname(t)))];
    return 'export GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false; cd /src && go test -count=1 ' + pkgs.map(sh).join(' ') + (names.length ? ' -run ' + sh('^(' + names.join('|') + ')$') : '');
  }
  if (lang === 'rust') {
    const t = tests.find((x) => x.endsWith('.rs'))!;
    let dir = dirname(t);
    while (dir !== '.' && !files.has(dir + '/Cargo.toml')) dir = dirname(dir);
    const manifest = dir === '.' ? 'Cargo.toml' : dir + '/Cargo.toml';
    const target = /(^|\/)tests\/[^/]+\.rs$/.test(t) ? ' --test ' + sh(basename(t, '.rs')) : '';
    return 'export CARGO_TARGET_DIR=/cache/target CARGO_HOME=/cache/cargo PATH=/usr/local/cargo/bin:$PATH; cd /src && cargo test --manifest-path ' + sh(manifest) + target + ' -- ' + names.map(sh).join(' ');
  }
  if (lang === 'python') {
    const py = tests.filter((t) => t.endsWith('.py'));
    let dir = dirname(py[0]!);
    while (dir !== '.' && !files.has(dir + '/pyproject.toml') && !files.has(dir + '/setup.py')) dir = dirname(dir);
    const at = (f: string) => (dir === '.' ? f : dir + '/' + f);
    const setup = files.has(at('uv.lock')) || files.has('uv.lock')
      ? 'pip install -q uv && (uv sync -q --frozen || uv sync -q) && R="uv run"'
      : 'python -m venv /tmp/v && . /tmp/v/bin/activate && pip install -q -U pip && (pip install -q -e ".[test]" || pip install -q -e ".[tests]" || pip install -q -e ".[dev]" || pip install -q -e .); for f in requirements.txt requirements-test.txt requirements-dev.txt requirements/test.txt test-requirements.txt; do [ -f "$f" ] && pip install -q -r "$f"; done; R=""';
    const rel = (t: string) => (dir === '.' ? t : t.slice(dir.length + 1));
    return 'cd /src && cd ' + sh(dir) + ' && ' + setup + '; $R python -m pip install -q pytest >/dev/null 2>&1; $R python -m pytest -q -p no:cacheprovider ' + py.map((t) => sh(rel(t))).join(' ') + (names.length ? ' -k ' + sh(names.join(' or ')) : '');
  }
  const t = tests.find((x) => /\.[cm]?[jt]sx?$/.test(x))!;
  let dir = dirname(t);
  while (dir !== '.' && !files.has(dir + '/package.json')) dir = dirname(dir);
  const pkg = files.read(dir === '.' ? 'package.json' : dir + '/package.json') ?? '';
  const root = files.read('package.json') ?? '';
  const install = files.has('pnpm-lock.yaml') ? 'corepack enable && (pnpm install --frozen-lockfile || pnpm install --frozen-lockfile --ignore-scripts)' : files.has('yarn.lock') ? 'corepack enable && (yarn install --immutable || yarn install --frozen-lockfile || YARN_ENABLE_SCRIPTS=0 yarn install --immutable)' : files.has('bun.lock') || files.has('bun.lockb') ? 'npm i -g bun >/dev/null && (bun install --frozen-lockfile || bun install --frozen-lockfile --ignore-scripts)' : '(npm ci || npm ci --ignore-scripts)';
  const rel = t.slice(dir === '.' ? 0 : dir.length + 1);
  const filter = names.length ? ' -t ' + sh(names.map(escapeRe).join('|')) : '';
  const runner = /"vitest"/.test(pkg + root) ? 'npx --no-install vitest run ' + sh(rel) + filter : 'npx --no-install jest ' + sh(rel) + filter;
  return 'export CI=1 HOME=/tmp/home; mkdir -p $HOME; cd /src && ' + install + ' && cd ' + sh(dir) + ' && ' + runner;
}

const BUILD_ERROR: Record<Lang, RegExp> = {
  go: /\[build failed\]|\[setup failed\]|cannot find package|undefined: |no required module/,
  rust: /error\[E\d+\]|could not compile|error: no test target named/,
  python: /ERROR collecting|ImportError|ModuleNotFoundError|SyntaxError|error: subprocess-exited-with-error|No module named/,
  ts: /Cannot find module|ERR_PNPM|npm ERR!|Transform failed|SyntaxError|No test files? found|command not found/,
};
const TEST_FAILED: Record<Lang, RegExp> = {
  go: /^--- FAIL: /m,
  rust: /test result: FAILED/,
  python: /\b\d+ failed\b/,
  ts: /\b\d+ failed\b|Tests:\s+\d+ failed/,
};
const TESTS_PASSED: Record<Lang, RegExp> = {
  go: /^ok\s/m,
  rust: /test result: ok\. [1-9]\d* passed/,
  python: /\b[1-9]\d* passed\b/,
  ts: /\b[1-9]\d* passed\b/,
};

/** A job's status from its two runs. */
export function classify(lang: Lang, rawHead: { exit: number | null; log: string }, rawFix: { exit: number | null; log: string }): { status: ReproLine['status']; detail: string } {
  const plain = (r: { exit: number | null; log: string }) => ({ exit: r.exit, log: r.log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') });
  const head = plain(rawHead), fix = plain(rawFix);
  if (head.exit === null || fix.exit === null) return { status: 'inconclusive', detail: 'a run did not finish' };
  if (head.exit === 124 || fix.exit === 124) return { status: 'inconclusive', detail: 'a run timed out after ' + PHASE_TIMEOUT_S + ' s' };
  const fixPassed = fix.exit === 0 && TESTS_PASSED[lang].test(fix.log);
  if (!fixPassed) return { status: 'inconclusive', detail: 'the tests did not pass at the fix (exit ' + fix.exit + (BUILD_ERROR[lang].test(fix.log) ? ', build or install error' : '') + ')' };
  if (head.exit === 0) return { status: 'not-confirmed', detail: 'the fix\'s tests pass at the unit head too' };
  if (TEST_FAILED[lang].test(head.log) && !BUILD_ERROR[lang].test(head.log)) return { status: 'confirmed', detail: 'the fix\'s tests fail at the unit head and pass at the fix' };
  return { status: 'inconclusive', detail: 'the run at the unit head failed without a test failure (exit ' + head.exit + (BUILD_ERROR[lang].test(head.log) ? ', build or install error' : '') + ')' };
}

/** The bash a VM runs for one job: fetch both commits, run the head (with the fix's tests laid over it), then the fix. */
export function jobScript(j: Job): string {
  const slug = j.repo.replace('/', '__');
  const src = '$R/src/' + slug;
  return [
    '#!/usr/bin/env bash',
    'set -u',
    'R=$HOME/rr; O=$R/out/' + j.id + '; mkdir -p $O $R/src $R/wt $R/cache/' + j.lang,
    'exec 9>$R/' + slug + '.lock',
    'flock 9',
    '[ -d ' + src + ' ] || git clone -q --filter=blob:none https://github.com/' + j.repo + '.git ' + src,
    'git -C ' + src + ' fetch -q origin ' + j.head + ' ' + j.fix + ' 2>/dev/null || true',
    'flock -u 9',
    'run() { phase=$1; commit=$2; w=$R/wt/' + j.id + '-$phase',
    '  flock 9; git -C ' + src + ' worktree add -q --detach $w $commit >$O/$phase.git.log 2>&1; ok=$?',
    '  [ $ok -eq 0 ] && [ $phase = head ] && git -C $w checkout ' + j.fix + ' -- ' + j.tests.map(sh).join(' ') + ' >>$O/$phase.git.log 2>&1',
    '  flock -u 9',
    '  if [ $ok -ne 0 ]; then echo 125 >$O/$phase.exit; return; fi',
    '  timeout ' + PHASE_TIMEOUT_S + ' sudo docker run --rm -v $w:/src -v $R/cache/' + j.lang + ':/cache ' + j.image + ' bash -c ' + sh(j.script) + ' >$O/$phase.log 2>&1',
    '  echo $? >$O/$phase.exit',
    '  sudo rm -rf $w; flock 9; git -C ' + src + ' worktree prune; flock -u 9',
    '}',
    'run head ' + j.head,
    'run fix ' + j.fix,
    'echo "job ' + j.id + ' head=$(cat $O/head.exit) fix=$(cat $O/fix.exit)"',
    '',
  ].join('\n');
}

/** The bugs a stage repros: s3, every S3 candidate bug before the screen (an S3 bug is screened only once its repro confirms it); kept, the S1 and S2 bugs the screen kept, for the repro-confirmed sensitivity line. */
export function stageRefs(stage: 'kept' | 's3', cands: readonly Candidate[], screen: readonly ScreenLine[]): Array<{ unit: string; bug: number; file: string }> {
  if (stage === 's3') return cands.filter((c) => c.stratum === 'S3' && c.head).flatMap((c) => c.bugs.map((b, i) => ({ unit: c.id, bug: i, file: b.path })));
  const s3 = new Set(cands.filter((c) => c.stratum === 'S3').map((c) => c.id));
  return screen.filter((l) => l.kept && !s3.has(l.unit)).map((l) => ({ unit: l.unit, bug: l.bug, file: l.final!.file }));
}

function planJobs(work: string, stage: 'kept' | 's3'): { jobs: Job[]; noTest: ReproLine[] } {
  const all = readJsonl<Candidate>(join(work, 'candidates.jsonl'));
  const cands = new Map(all.map((c) => [c.id, c]));
  const screenFile = join(work, 'screen', 'screen.jsonl');
  const refs = stageRefs(stage, all, stage === 'kept' ? readJsonl<ScreenLine>(screenFile) : []);
  const jobs: Job[] = [];
  const noTest: ReproLine[] = [];
  for (const l of refs) {
    const c = cands.get(l.unit)!;
    const bug = c.bugs[l.bug]!;
    const dir = cloneDir(work, c.repo);
    const fileLang = langOf(l.file);
    const tests = bug.fix.tests.filter((t) => langOf(t) === fileLang && git(dir, ['cat-file', '-e', bug.fix.commit + ':' + t]).code === 0);
    if (!fileLang || !tests.length) { noTest.push({ unit: l.unit, bug: l.bug, status: 'no-test', log_sha256: null, detail: 'the fix changed no test file in the bug\'s language that exists at the fix' }); continue; }
    const diff = git(dir, ['diff', bug.fix.kind === 'later-pr' ? bug.fix.commit + '^' : c.head!, bug.fix.commit, '--', ...tests]).out;
    const names = addedTestNames(fileLang, diff);
    const files = { has: (p: string) => git(dir, ['cat-file', '-e', c.head! + ':' + p]).code === 0, read: (p: string) => { const r = git(dir, ['show', c.head! + ':' + p]); return r.code === 0 ? r.out : null; } };
    const id = createHash('sha256').update(l.unit + ' ' + l.bug).digest('hex').slice(0, 12);
    jobs.push({ id, unit: l.unit, bug: l.bug, repo: c.repo, lang: fileLang, head: c.head!, fix: bug.fix.commit, tests, image: IMAGES[fileLang], script: testScript(fileLang, tests, names, files) });
  }
  return { jobs, noTest };
}

/** Splits jobs into n groups by repository, balancing job counts. */
export function shard(jobs: readonly Job[], n: number): Job[][] {
  const byRepo = new Map<string, Job[]>();
  for (const j of jobs) byRepo.set(j.repo, [...(byRepo.get(j.repo) ?? []), j]);
  const groups: Job[][] = Array.from({ length: n }, () => []);
  for (const list of [...byRepo.values()].sort((a, b) => b.length - a.length)) groups.sort((a, b) => a.length - b.length)[0]!.push(...list);
  return groups.filter((g) => g.length);
}

function runVm(bundle: string, dest: string, ttl: number, log: string): Promise<number> {
  return new Promise((done) => {
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', UBI_OWNER: 'internal-task', UBI_TTL_HOURS: String(ttl), UBI_IDLE_TIMEOUT: '3600' };
    if (process.env.UBICLOUD_API_KEY) env.UBICLOUD_API_KEY = process.env.UBICLOUD_API_KEY;
    const child = spawn('bash', ['-c', 'exec bash "$0" run -s standard-16 --src "$1" --setup setup.sh --pull "rr/out:$2" -- bash run-all.sh >>"$3" 2>&1', RUNNER, bundle, dest, log], { env, stdio: 'ignore', cwd: bundle });
    child.on('exit', (c) => done(c ?? 1));
  });
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const val = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1]! : d; };
  const work = resolve(val('--work', ''));
  const dir = join(work, 'repro');
  mkdirSync(dir, { recursive: true });
  if (cmd === 'plan') {
    const stage = val('--stage', 'kept') as 'kept' | 's3';
    const fresh = planJobs(work, stage);
    const prev = existsSync(join(dir, 'jobs.json')) ? JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8')) as { jobs: Job[]; no_test: ReproLine[] } : { jobs: [], no_test: [] };
    const jobs = [...new Map([...prev.jobs, ...fresh.jobs].map((j) => [j.id, j])).values()];
    const noTest = [...new Map([...prev.no_test, ...fresh.noTest].map((l) => [l.unit + ' ' + l.bug, l])).values()];
    writeFileSync(join(dir, 'jobs.json'), JSON.stringify({ jobs, no_test: noTest, reinjected: 0, reinject_note: 'Candidates whose pre-fix commit is gone are not screened (the screen needs a head), so none are reinjected.' }, null, 1) + '\n');
    const byLang: Record<string, number> = {};
    for (const j of jobs) byLang[j.lang] = (byLang[j.lang] ?? 0) + 1;
    process.stderr.write('repro: ' + jobs.length + ' jobs (' + JSON.stringify(byLang) + '), ' + noTest.length + ' kept bugs with no test\n');
  } else if (cmd === 'run') {
    const { jobs } = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8')) as { jobs: Job[] };
    const done = new Set(existsSync(join(dir, 'out')) ? readdirSync(join(dir, 'out')).filter((d) => existsSync(join(dir, 'out', d, 'fix.exit'))) : []);
    const groups = shard(jobs.filter((j) => !done.has(j.id)).slice(0, Number(val('--limit', String(jobs.length)))), Number(val('--vms', '3')));
    const parallel = Number(val('--parallel', '4'));
    const ttl = Number(val('--ttl-hours', '8'));
    const codes = await Promise.all(groups.map(async (g, k) => {
      const bundle = join(dir, 'bundle-' + k);
      rmSync(bundle, { recursive: true, force: true });
      mkdirSync(join(bundle, 'jobs'), { recursive: true });
      for (const j of g) { writeFileSync(join(bundle, 'jobs', j.id + '.sh'), jobScript(j)); chmodSync(join(bundle, 'jobs', j.id + '.sh'), 0o755); }
      writeFileSync(join(bundle, 'run-all.sh'), '#!/usr/bin/env bash\nset -u\nmkdir -p $HOME/rr/out\nfor img in ' + [...new Set(g.map((j) => j.image))].join(' ') + '; do sudo docker pull -q $img >/dev/null; done\nls jobs/*.sh | xargs -P ' + parallel + ' -n 1 bash\necho run-all done\n');
      writeFileSync(join(bundle, 'setup.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncommand -v docker >/dev/null || (curl -fsSL https://get.docker.com | sudo sh >/dev/null)\nsudo systemctl start docker\ncommand -v git >/dev/null || sudo apt-get install -y -q git\n');
      const outDir = join(dir, 'pulled-' + k);
      mkdirSync(outDir, { recursive: true });
      process.stderr.write('repro: VM ' + k + ': ' + g.length + ' jobs from ' + new Set(g.map((j) => j.repo)).size + ' repositories\n');
      const code = await runVm(bundle, outDir, ttl, join(dir, 'vm-' + k + '.log'));
      const pulled = existsSync(join(outDir, 'out')) ? join(outDir, 'out') : outDir;
      cpSync(pulled, join(dir, 'out'), { recursive: true });
      process.stderr.write('repro: VM ' + k + ' exited ' + code + '\n');
      return code;
    }));
    if (codes.some((c) => c !== 0)) process.exitCode = 1;
  } else if (cmd === 'collect') {
    const { jobs, no_test } = JSON.parse(readFileSync(join(dir, 'jobs.json'), 'utf8')) as { jobs: Job[]; no_test: ReproLine[] };
    const lines: ReproLine[] = [...no_test];
    for (const j of jobs) {
      const o = join(dir, 'out', j.id);
      const read = (f: string) => (existsSync(join(o, f)) ? readFileSync(join(o, f), 'utf8') : '');
      const exit = (f: string) => { const t = read(f).trim(); return t === '' ? null : Number(t); };
      const head = { exit: exit('head.exit'), log: read('head.log') }, fix = { exit: exit('fix.exit'), log: read('fix.log') };
      const c = classify(j.lang, head, fix);
      lines.push({ unit: j.unit, bug: j.bug, status: c.status, log_sha256: existsSync(o) ? createHash('sha256').update(head.log + '\n----\n' + fix.log).digest('hex') : null, detail: c.detail });
    }
    writeFileSync(join(dir, 'results.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const n = (s: string) => lines.filter((l) => l.status === s).length;
    process.stderr.write('repro: ' + n('confirmed') + ' confirmed, ' + n('not-confirmed') + ' not confirmed, ' + n('inconclusive') + ' inconclusive, ' + n('no-test') + ' no test\n');
  } else { process.stderr.write('usage: see the header of scripts/review-bugs/repro.ts\n'); process.exit(2); }
}
