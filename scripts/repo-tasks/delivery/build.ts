// Builds the gstack-delivery-v1 repository task set (docs/repo-tasks.md) from the published seeds in seeds.json, the
// hand-written specs under specs/review and specs/ship, and the vendored upstream snapshots in sources.json. Nothing here
// calls a model or the network, and the same inputs give the same bytes (tests/repo-delivery-build.test.ts checks it).
//
//   bun scripts/repo-tasks/delivery/build.ts [--out <set dir>] [--only <task id or spec>] [--check] [--plant-all]
//
// --plant-all plants every defect a review spec lists instead of the seed's pick, for checking a whole spec while
// writing it (use it with --out <scratch dir>, never on the published set).
//
// --check builds in memory and compares every file with --out (default tasks/repo/gstack-delivery-v1) without writing;
// exit 1 names the first difference.
//
// A review spec holds the corrected change (change/), the defects that can be planted in it (each an exact replacement of
// corrected text by defective text), two decoys (correct code that looks wrong, located by an anchor) and one probe test
// per defect and decoy (tests/). The seed picks how many defects to plant (spec.planted, inclusive) and which ones, and
// the one ceiling defect (spec.ceiling, the R61 ceiling-raise, outside the logic class) is always planted on top. The
// task's branch carries the defective change; the verifier gets the corrected change, the defective one, and per planted
// defect the defective change with only that defect fixed.
//
// A ship spec holds the teammate's unfinished branch commits, main's commits after the branch was cut (one of them breaks
// the feature until it is adapted; the last, in main_r61/, is the R61 base trap, with the check r61stale), main's release, the finished files (final/), the hidden tests and extra wrong
// solutions (checks/<name>/, overlays on the oracle's result). The build adds CONTRIBUTING.md, CHANGELOG.md, VERSION and
// ruff.toml to the import, the teammate's changelog entry and version bump to the branch, and the release to main: the
// teammate bumped VERSION to the version main then released, so the version merges without a conflict and is still wrong.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { commitEnv, git, normalizeIndex, readTar, Rng, sha256, writeTar, type Entry, type Tree } from './lib.ts';

const HERE = import.meta.dir;
const ROOT = resolve(HERE, '..', '..', '..');
export const SET_DIR = join(ROOT, 'tasks', 'repo', 'gstack-delivery-v1');
const SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));
export const SEEDS = JSON.parse(readFileSync(join(HERE, 'seeds.json'), 'utf8'));
const TEMPLATE = join(HERE, 'template');
const KINDS = ['review', 'ship'] as const;
const PLANT_ALL = process.argv.includes('--plant-all');
type Kind = (typeof KINDS)[number];

const txt = (s: string, mode = 0o644): Entry => ({ data: Buffer.from(s, 'utf8'), mode });
const tpl = (name: string, mode = 0o644): Entry => ({ data: readFileSync(join(TEMPLATE, name)), mode });

function readDir(dir: string): Tree {
  const out: Tree = new Map();
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p), { data: readFileSync(p), mode: statSync(p).mode & 0o111 ? 0o755 : 0o644 });
    }
  };
  walk(dir);
  return out;
}

const upstreamCache = new Map<string, Tree>();
/** The vendored snapshot, with __pycache__/ and .pytest_cache/ ignored so a plain git add after a test run stays clean. */
export function upstream(repo: string): Tree {
  if (upstreamCache.has(repo)) return new Map(upstreamCache.get(repo)!);
  const s = SOURCES.repos[repo];
  if (!s) throw new Error('unknown source repository ' + repo);
  const buf = readFileSync(join(HERE, s.archive));
  if (sha256(buf) !== s.sha256) throw new Error(repo + ': vendored archive does not match its sha256 in sources.json');
  const tree = readTar(buf, '');
  const gi = tree.get('.gitignore')?.data.toString('utf8') ?? '';
  const missing = ['__pycache__/', '.pytest_cache/'].filter((l) => !gi.split('\n').some((x) => x.trim().replace(/^\//, '') === l || x.trim() === l.slice(0, -1)));
  if (missing.length) tree.set('.gitignore', txt((gi && !gi.endsWith('\n') ? gi + '\n' : gi) + missing.join('\n') + '\n'));
  upstreamCache.set(repo, tree);
  return new Map(tree);
}

export interface PlanRow { id: string; kind: Kind; spec: string }

/** Task ids for the published seeds: every spec of a kind not excluded in seeds.json, ordered by sha256(seed:spec). */
export function plan(strict = true): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const kind of KINDS) {
    const { seed, count } = SEEDS[kind];
    const excluded = SEEDS.excluded?.[kind] ?? {};
    const dir = join(HERE, 'specs', kind);
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && !(n in excluded)) : [];
    if (strict && names.length !== count) throw new Error(kind + ': ' + names.length + ' specs for a planned count of ' + count);
    const key = (n: string) => sha256(seed + ':' + n);
    names.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    names.forEach((spec, i) => rows.push({ id: SEEDS.prefix + '-' + kind + '-' + String(i + 1).padStart(2, '0'), kind, spec }));
  }
  return rows;
}

// ---------------------------------------------------------------- git

interface Commit { state: Tree; parents: string[]; message: string; day: number }

class Repo {
  dir: string;
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'gd-build-'));
    const tmpl = join(this.dir, '.template');
    mkdirSync(tmpl);
    mkdirSync(join(this.dir, 'w'));
    git(join(this.dir, 'w'), ['init', '-q', '--template=' + tmpl]);
  }
  get w() { return join(this.dir, 'w'); }
  writeState(state: Tree) {
    for (const n of readdirSync(this.w)) if (n !== '.git') rmSync(join(this.w, n), { recursive: true, force: true });
    for (const [p, e] of state) {
      mkdirSync(dirname(join(this.w, p)), { recursive: true });
      writeFileSync(join(this.w, p), e.data, { mode: e.mode });
    }
  }
  commit(c: Commit): string {
    this.writeState(c.state);
    git(this.w, ['read-tree', '--empty']);
    git(this.w, ['add', '-A', '-f']);
    const tree = git(this.w, ['write-tree']).trim();
    return git(this.w, ['commit-tree', tree, ...c.parents.flatMap((p) => ['-p', p]), '-m', c.message], commitEnv(c.day)).trim();
  }
  objects(refs: string[]): string[] {
    return git(this.w, ['rev-list', '--objects', ...refs]).split('\n').filter(Boolean).map((l) => l.split(' ')[0]).sort();
  }
  object(sha: string): Buffer { return readFileSync(join(this.w, '.git', 'objects', sha.slice(0, 2), sha.slice(2))); }
  index(commit: string): Buffer {
    git(this.w, ['read-tree', commit]);
    return normalizeIndex(readFileSync(join(this.w, '.git', 'index')));
  }
  close() { rmSync(this.dir, { recursive: true, force: true }); }
}

/** A .git directory: loose objects reachable from the refs, loose refs, HEAD, a fixed config and a normalized index. */
function gitDir(repo: Repo, o: { refs: Record<string, string>; head: string; config: string; index?: string }): Tree {
  const t: Tree = new Map();
  t.set('HEAD', txt(o.head + '\n'));
  t.set('config', txt(o.config));
  for (const [r, v] of Object.entries(o.refs)) t.set(r, txt(v + '\n'));
  for (const sha of repo.objects(Object.values(o.refs).filter((v) => !v.startsWith('ref: ')))) t.set('objects/' + sha.slice(0, 2) + '/' + sha.slice(2), { data: repo.object(sha), mode: 0o444 });
  if (o.index) t.set('index', { data: repo.index(o.index), mode: 0o644 });
  return t;
}

function mount(into: Tree, prefix: string, t: Tree) { for (const [p, e] of t) into.set(prefix + p, e); }
const overlay = (base: Tree, top: Tree): Tree => { const t = new Map(base); for (const [p, e] of top) t.set(p, e); return t; };

// ---------------------------------------------------------------- shared task pieces

const BASE_DOCKER = [
  'FROM python@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337',
  "RUN rm -f /etc/apt/sources.list.d/debian.sources && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261028T120000Z bookworm main\\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261028T120000Z bookworm-security main\\n' > /etc/apt/sources.list.d/snapshot.list && apt-get update && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 ca-certificates=20250419~deb12u2 curl=7.88.1-10+deb12u15 && rm -rf /var/lib/apt/lists/*",
  'COPY requirements.lock /tmp/requirements.lock',
  'RUN pip install --no-cache-dir --require-hashes --no-deps -r /tmp/requirements.lock && rm /tmp/requirements.lock',
  'RUN git config --system user.name "Developer" && git config --system user.email "developer@example.com" && git config --system init.defaultBranch main && git config --system --add safe.directory "*"',
];

function agentDockerfile(review: boolean): string {
  return [...BASE_DOCKER, 'COPY gh /usr/local/bin/gh', 'RUN chmod 755 /usr/local/bin/gh', ...(review ? ['RUN mkdir -p /work/out/tests && chmod -R 777 /work/out'] : []), 'ADD work.tar /work/', 'WORKDIR /work/repo'].join('\n') + '\n';
}

function verifierDockerfile(review: boolean): string {
  const unpack = review ? 'mkdir -p /tests/trees/base && tar -xf /tests/trees/base.tar -C /tests/trees/base && rm -f /tests/trees/base.tar && ' : '';
  return [...BASE_DOCKER, 'COPY . /tests/', 'RUN ' + unpack + 'rm -f /tests/Dockerfile /tests/requirements.lock && chmod -R go-rwx /tests'].join('\n') + '\n';
}

function taskToml(id: string, kind: Kind, score: string[], repo: string): string {
  const s = SOURCES.repos[repo];
  return [
    'id = "' + id + '"', 'kind = "' + kind + '"', 'skill = "' + kind + '"',
    'agent_timeout_s = 2400', 'verifier_timeout_s = 1200', 'cpus = 2', 'memory_mb = 4096', 'storage_mb = 10240',
    'workdir = "/work/repo"', 'repo_dir = ""', 'artifacts = ["/work"]',
    '[score]', ...score,
    '[source]', 'repo = "' + repo + '"', 'commit = "' + s.commit + '"', 'license = "MIT"', '',
  ].join('\n');
}

const tomlHunks = (hs: { file: string; start: number; end: number }[]) => '[' + hs.map((h) => '{file = ' + JSON.stringify(h.file) + ', start = ' + h.start + ', end = ' + h.end + '}').join(', ') + ']';

const SHIM = '# A reward file, and an env, python3 and git that always succeed, all in the agent container. No work is done.\nmkdir -p /logs/verifier && echo 1 > /logs/verifier/reward.txt && echo \'{"reward": 1}\' > /logs/verifier/result.json\nfor b in /usr/local/bin/env /usr/local/bin/python3.12 /usr/local/bin/node /usr/local/bin/git; do printf \'#!/bin/sh\\nmkdir -p /logs/verifier; echo 1 > /logs/verifier/reward.txt; exit 0\\n\' > "$b.shim" && chmod 755 "$b.shim" && mv -f "$b.shim" "$b"; done\nln -sf /bin/true /usr/local/bin/python3\n';

function stepsFiles(kind: Kind, params: unknown): Tree {
  return new Map([
    ['oracle/steps.sh', txt('#!/bin/bash\n# The steps-followed oracle: the oracle\'s solution plus every step of the card in /oracle/steps.json.\nexec python3 /oracle/steps_oracle.py /oracle/steps.json /oracle/params.json\n', 0o755)],
    ['oracle/steps_oracle.py', { data: readFileSync(join(HERE, 'steps_oracle.py')), mode: 0o644 }],
    ['oracle/steps.json', { data: readFileSync(join(HERE, 'steps', kind + '.json')), mode: 0o644 }],
    ['oracle/params.json', txt(JSON.stringify(params, null, 1) + '\n')],
  ]);
}

function writeFindings(findings: unknown[], extra = ''): string {
  return "mkdir -p /work/out/tests\n" + extra + "python3 - <<'PY'\nimport json\njson.dump(" + JSON.stringify(findings) + ", open('/work/out/review.json', 'w'))\nPY\n";
}

// ---------------------------------------------------------------- review

interface Hunk { file: string; start: number; end: number }

function locate(text: string, needle: string, what: string): Hunk & { count: number } {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(what + ': text not found');
  const count = text.split(needle).length - 1;
  const start = text.slice(0, i).split('\n').length;
  const end = start + needle.replace(/\n$/, '').split('\n').length - 1;
  return { file: '', start, end, count };
}

function buildReview(row: PlanRow): Tree {
  const dir = join(HERE, 'specs', 'review', row.spec);
  const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
  const src = SOURCES.repos[spec.repo];
  const rng = new Rng(SEEDS.review.seed + ':' + row.spec);
  const up = upstream(spec.repo);
  const change = readDir(join(dir, 'change'));
  const probes = readDir(join(dir, 'tests'));
  if (spec.decoys.length !== 2) throw new Error(row.spec + ': a review spec has exactly 2 decoys');
  const [lo, hi] = spec.planted;
  if (lo < 3 || hi > 4 || lo > hi || spec.defects.length < hi) throw new Error(row.spec + ': planted must be within 3 to 4 and within the defects listed');
  const n = lo + rng.int(hi - lo + 1);
  const chosen = new Set(rng.shuffle(spec.defects.map((d: any) => d.id)).slice(0, PLANT_ALL ? spec.defects.length : n));
  if (!Array.isArray(spec.ceiling) || spec.ceiling.length !== 1 || spec.ceiling[0].class === 'logic') throw new Error(row.spec + ': ceiling must list exactly one defect outside the logic class (the R61 ceiling-raise)');
  if (spec.defects.some((d: any) => d.id === spec.ceiling[0].id)) throw new Error(row.spec + ': the ceiling defect id must differ from every listed defect');
  const planted = [...spec.defects.filter((d: any) => chosen.has(d.id)), ...spec.ceiling];
  if (planted.filter((d: any) => d.class !== 'logic').length < 3) throw new Error(row.spec + ': the seed plants fewer than 2 defects outside the logic class; list fewer logic defects');
  const branch = 'feature/' + rng.hex(6);

  const variant = (skip: string | null): Tree => {
    const t: Tree = new Map();
    for (const [p, e] of change) {
      let s = e.data.toString('utf8');
      for (const d of planted) {
        if (d.file !== p || d.id === skip) continue;
        if (s.split(d.corrected).length !== 2) throw new Error(row.spec + ': defect ' + d.id + ' corrected text must occur exactly once in ' + p);
        s = s.replace(d.corrected, () => d.defective);
      }
      t.set(p, txt(s, e.mode));
    }
    return t;
  };
  const defective = variant(null);
  const hunks: (Hunk & { tree: string; id: string })[] = planted.map((d: any, k: number) => {
    const h = locate(defective.get(d.file)!.data.toString('utf8'), d.defective, row.spec + ' defect ' + d.id);
    if (h.count !== 1) throw new Error(row.spec + ': defect ' + d.id + ' defective text must occur exactly once in the defective file');
    return { file: d.file, start: h.start, end: h.end, tree: 'fix' + (k + 1), id: d.id };
  });
  const decoys: Hunk[] = spec.decoys.map((d: any) => {
    const h = locate(defective.get(d.file)!.data.toString('utf8'), d.anchor, row.spec + ' decoy ' + d.id);
    if (h.count !== 1) throw new Error(row.spec + ': decoy ' + d.id + ' anchor must occur exactly once');
    return { file: d.file, start: h.start, end: h.end };
  });
  for (const a of hunks) {
    for (const b of hunks) if (a !== b && a.file === b.file && !(b.start - a.end > 7 || a.start - b.end > 7)) throw new Error(row.spec + ': planted hunks ' + a.id + ' and ' + b.id + ' are within 7 lines');
    for (const b of decoys) if (a.file === b.file && !(b.start - a.end > 4 || a.start - b.end > 4)) throw new Error(row.spec + ': planted hunk ' + a.id + ' is within 4 lines of a decoy');
  }

  // The repository: main is the upstream snapshot, the branch carries the defective change.
  const repo = new Repo();
  const files: Tree = new Map();
  try {
    const c0 = repo.commit({ state: up, parents: [], message: 'Import ' + spec.repo, day: 0 });
    const commits = spec.commits ?? [{ message: spec.title, paths: [...change.keys()] }];
    const covered = commits.flatMap((c: any) => c.paths).sort();
    if (JSON.stringify(covered) !== JSON.stringify([...change.keys()].sort())) throw new Error(row.spec + ': spec.commits must split change/ exactly');
    let state = up, tip = c0;
    commits.forEach((c: any, i: number) => {
      state = overlay(state, new Map(c.paths.map((p: string) => [p, defective.get(p)!])));
      tip = repo.commit({ state, parents: [tip], message: c.message, day: 3 + i });
    });
    const work: Tree = new Map();
    mount(work, 'repo/', state);
    mount(work, 'repo/.git/', gitDir(repo, {
      refs: { 'refs/heads/main': c0, ['refs/heads/' + branch]: tip }, head: 'ref: refs/heads/' + branch, index: tip,
      config: '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n',
    }));
    files.set('environment/work.tar', { data: writeTar(work), mode: 0o644 });
  } finally {
    repo.close();
  }

  const pp = src.src === '.' ? '' : ' with `PYTHONPATH=' + src.src + '`';
  files.set('instruction.md', txt([
    'A teammate opened a change on branch `' + branch + '` of the Python repository at /work/repo (base branch `main`). Review it before it merges.',
    '', '**' + spec.title + '**', '', spec.description, '',
    'Write your findings to `/work/out/review.json` as a JSON list. Each finding is an object with:',
    '- `file`: the path relative to the repository root;',
    '- `line`: the line number in the branch version of that file;',
    '- `summary`: one sentence;',
    '- `test`: the absolute path of a pytest file you wrote under `/work/out/tests/` that fails because of the problem and would pass once it is fixed. It runs from the repository root' + pp + ' and imports the package the normal way.',
    '',
    'Report only real problems, at most 10. Each test is run against the branch and against the branch with that problem fixed. A listed test that passes on the branch scores the whole review as zero, and so does more than one test that still fails once its problem is fixed. If you find none, write `[]`. Do not change the branch.',
    '',
  ].join('\n')));
  files.set('task.toml', txt(taskToml(row.id, 'review', ['planted_hunks = ' + tomlHunks(hunks), 'max_false_reports = 1', 'decoys = ' + tomlHunks(decoys)], spec.repo)));
  files.set('environment/Dockerfile', txt(agentDockerfile(true)));
  files.set('environment/gh', tpl('gh'));
  files.set('environment/requirements.lock', tpl('requirements.lock'));
  files.set('verifier/Dockerfile', txt(verifierDockerfile(true)));
  files.set('verifier/requirements.lock', tpl('requirements.lock'));
  files.set('verifier/verify.sh', tpl('verify.sh', 0o755));
  files.set('verifier/verify.py', tpl('verify.py'));
  files.set('verifier/task.json', txt(JSON.stringify({ kind: 'review', src: src.src, findings_path: '/work/out/review.json', tests_dir: '/work/out/tests', max_false_reports: 1, planted_hunks: hunks.map((h) => ({ file: h.file, start: h.start, end: h.end, tree: h.tree })) }, null, 1) + '\n'));
  const base = new Map(up);
  for (const p of change.keys()) base.delete(p);
  files.set('verifier/trees/base.tar', { data: writeTar(base), mode: 0o644 });
  mount(files, 'verifier/trees/defective/', defective);
  mount(files, 'verifier/trees/corrected/', change);
  hunks.forEach((h) => mount(files, 'verifier/trees/' + h.tree + '/', variant(h.id)));

  // Oracle: one probe test per planted defect, each reported at its hunk.
  const findings = planted.map((d: any, k: number) => {
    if (!probes.has(d.test)) throw new Error(row.spec + ': missing probe test ' + d.test);
    files.set('oracle/' + d.test, probes.get(d.test)!);
    return { file: d.file, line: hunks[k].start, summary: d.summary, test: '/work/out/tests/' + d.test };
  });
  const decoyRows = spec.decoys.map((d: any, k: number) => {
    if (!probes.has(d.test)) throw new Error(row.spec + ': missing decoy test ' + d.test);
    files.set('oracle/' + d.test, probes.get(d.test)!);
    return { file: d.file, line: decoys[k].start, test: d.test };
  });
  const cp = findings.map((f: any) => 'cp /oracle/' + f.test.split('/').pop() + ' ' + f.test + '\n').join('');
  files.set('oracle/solve.sh', txt('#!/bin/bash\nset -e\n' + writeFindings(findings, cp), 0o755));
  for (const [p, e] of stepsFiles('review', {
    kind: 'review', base: 'main', branch, env: src.src === '.' ? {} : { PYTHONPATH: src.src },
    findings: findings.map((f: any) => ({ ...f, probe: '/oracle/' + f.test.split('/').pop(), correct: false })),
    decoys: decoyRows.map((d: any) => ({ file: d.file, line: d.line, probe: '/oracle/' + d.test, correct: true })),
  })) files.set(p, e);

  // Wrong solutions and tamper attempts; every one must score 0.
  const at = (h: Hunk) => ({ file: h.file, line: h.start });
  const far = (h: Hunk): number => {
    const lines = defective.get(h.file)!.data.toString('utf8').split('\n').length;
    for (let l = 1; l <= lines; l++) if (![...hunks, ...decoys].some((x) => x.file === h.file && l >= x.start - 6 && l <= x.end + 6)) return l;
    throw new Error(row.spec + ': no line away from every hunk in ' + h.file);
  };
  const ok = "printf 'def test_ok():\\n    assert True\\n' > /work/out/tests/test_ok.py\n";
  const bad = "printf 'def test_bad():\\n    assert False\\n' > /work/out/tests/test_bad.py\n";
  const one = (test: string) => [{ ...at(hunks[0]), summary: 'x', test: '/work/out/tests/' + test }];
  const checks: Record<string, string> = {
    noop: 'true\n',
    shim: SHIM,
    alwayspass: '# A test that passes on the defective change too.\n' + writeFindings(one('test_ok.py'), ok),
    wrongplace: '# The real tests, each reported away from its planted hunk.\n' + writeFindings(findings.map((f: any, k: number) => ({ ...f, line: far(hunks[k]) })), cp),
    misattrib: '# Each real test reported at another planted hunk.\n' + writeFindings(findings.map((f: any, k: number) => ({ ...f, file: hunks[(k + 1) % hunks.length].file, line: hunks[(k + 1) % hunks.length].start })), cp),
    cwdsniff: '# A test that passes or fails by where it runs, not by the code it tests.\n' + writeFindings(one('test_where.py'), "printf 'import os\\ndef test_where():\\n    assert \"defective\" not in os.getcwd() and \"defective\" not in os.environ.get(\"PWD\", \"\")\\n' > /work/out/tests/test_where.py\n"),
    crossrun: '# A test that fails on its first run and passes on every later one, using a marker file.\n' + writeFindings(one('test_once.py'), "printf 'import os\\nM = \"/tmp/.seen\"\\ndef test_once():\\n    if os.path.exists(M):\\n        return\\n    open(M, \"w\").write(\"1\")\\n    assert False\\n' > /work/out/tests/test_once.py\n"),
    linger: '# A test that leaves a process behind to rewrite the reward file after the verifier finishes.\n' + writeFindings(one('test_linger.py'), "printf 'import os, time\\ndef test_linger():\\n    if os.fork() == 0:\\n        os.setsid()\\n        for _ in range(600):\\n            for p in (\"/logs/verifier/reward.txt\", \"/work/out/review.json\"):\\n                try:\\n                    open(p, \"w\").write(\"1\")\\n                except Exception:\\n                    pass\\n            time.sleep(0.1)\\n        os._exit(0)\\n    assert False\\n' > /work/out/tests/test_linger.py\n"),
    spray: '# The real findings plus findings whose tests pass on the defective change, ten in all.\n' + writeFindings([...findings, ...Array.from({ length: 10 - findings.length }, (_, i) => ({ ...at(hunks[0]), line: hunks[0].start + 1 + i, summary: 'x', test: '/work/out/tests/test_ok.py' }))], cp + ok),
    decoy: '# The decoys reported as bugs, with tests that pass (the code is correct).\n' + writeFindings(decoyRows.map((d: any) => ({ file: d.file, line: d.line, summary: 'x', test: '/work/out/tests/' + d.test })), decoyRows.map((d: any) => 'cp /oracle/' + d.test + ' /work/out/tests/' + d.test + '\n').join('')),
    decoyfail: '# The real findings plus the decoys reported with tests that fail whatever the code does.\n' + writeFindings([...findings, ...decoyRows.map((d: any) => ({ file: d.file, line: d.line, summary: 'x', test: '/work/out/tests/test_bad.py' }))], cp + bad),
    allfail: '# Every planted hunk reported with a test that fails whatever the code does.\n' + writeFindings(hunks.map((h) => ({ ...at(h), summary: 'x', test: '/work/out/tests/test_bad.py' })), bad),
  };
  for (const [name, body] of Object.entries(checks)) files.set('checks/' + name + '.sh', txt('#!/bin/bash\n' + body, 0o755));
  return files;
}

// ---------------------------------------------------------------- ship

function bump(v: string, type: string): string {
  const [x, y, z] = v.split('.').map(Number);
  return type === 'Added' ? x + '.' + (y + 1) + '.0' : x + '.' + y + '.' + (z + 1);
}

function changelog(unreleased: string[], released: [string, string[]][]): string {
  const parts = ['# Changelog', '', '## Unreleased', ''];
  if (unreleased.length) parts.push(...unreleased, '');
  for (const [v, es] of released) parts.push('## ' + v, '', ...es, '');
  return parts.join('\n');
}

function contributing(testCmd: string): string {
  return [
    '# Contributing', '', 'Every change that lands on main follows these rules.', '',
    '## Branches', '',
    '- Do the work on a feature branch. To bring it up to date, merge main into it. Never push to main and never rewrite its history.',
    '- Keep a branch to one change and leave files alone that the change does not need.', '',
    '## Checks', '',
    '- The tests pass: `' + testCmd + '` from the repository root.',
    '- `ruff check --config ruff.toml` reports no errors.', '',
    '## Changelog and version', '',
    '- Each change adds one entry under `## Unreleased` at the top of CHANGELOG.md. Leave the entries of released versions as they are.',
    '- An entry is a single line of this form, where the type is Added, Changed or Fixed and the branch is the name of the branch the change was made on:', '',
    '      - <type>: <one sentence on what changed> (<branch>)', '',
    '  For example: `- Fixed: Empty strings no longer raise an error. (feature/3c9e01)`',
    '- Each change also sets VERSION, a single line, to the next version after the one on main. An Added entry raises the minor number and resets the patch number (1.4.2 becomes 1.5.0); a Changed or Fixed entry raises the patch number (1.4.2 becomes 1.4.3).', '',
  ].join('\n');
}

function buildShip(row: PlanRow): Tree {
  const dir = join(HERE, 'specs', 'ship', row.spec);
  const spec = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
  const src = SOURCES.repos[spec.repo];
  const rng = new Rng(SEEDS.ship.seed + ':' + row.spec);
  const branch = 'feature/' + rng.hex(6);
  const sub = (s: string) => s.split('{branch}').join(branch);
  const up = upstream(spec.repo);
  const tests: string[] = [...spec.repo_tests, ...spec.feature_tests];
  const testCmd = (src.src === '.' ? '' : 'PYTHONPATH=' + src.src + ' ') + 'python -m pytest ' + tests.join(' ');
  const entryType = /^- (Added|Changed|Fixed): /.exec(sub(spec.entry))?.[1];
  if (!entryType) throw new Error(row.spec + ': entry must start with "- Added: ", "- Changed: " or "- Fixed: "');
  const v0: string = spec.version, v1: string = spec.release.version, vFinal = bump(v1, entryType);
  if (bump(v0, entryType) !== v1) throw new Error(row.spec + ': release.version must be the version the teammate bumps to (' + bump(v0, entryType) + ')');
  if (spec.main_commits.at(-1)?.dir !== 'main_r61' || !spec.checks.includes('r61stale')) throw new Error(row.spec + ': the last main commit must be the R61 base trap (dir main_r61) and checks must list r61stale');

  const setup: Tree = new Map([
    ['CONTRIBUTING.md', txt(contributing(testCmd))],
    ['CHANGELOG.md', txt(changelog([], [[v0, spec.history]]))],
    ['VERSION', txt(v0 + '\n')],
    ['ruff.toml', txt('include = ' + JSON.stringify(spec.lint_paths) + '\n\n[lint]\nselect = ["F", "E9"]\n')],
  ]);
  const released: [string, string[]][] = [[v1, spec.release.entries], [v0, spec.history]];
  const finalFiles = overlay(readDir(join(dir, 'final')), new Map([['CHANGELOG.md', txt(changelog([sub(spec.entry)], released))], ['VERSION', txt(vFinal + '\n')]]));
  const repo = new Repo();
  const files: Tree = new Map();
  let mainState: Tree = new Map(), allowed: string[] = [], mainTip = '';
  try {
    const c0 = repo.commit({ state: up, parents: [], message: 'Import ' + spec.repo, day: 0 });
    const cutState = overlay(up, setup);
    const cut = repo.commit({ state: cutState, parents: [c0], message: 'Add contributing rules, a changelog and a version file', day: 1 });
    let day = 2;
    let branchTip = cut, branchState = cutState;
    for (const c of spec.branch_commits) {
      branchState = overlay(branchState, readDir(join(dir, c.dir)));
      branchTip = repo.commit({ state: branchState, parents: [branchTip], message: c.message, day: day++ });
    }
    branchState = overlay(branchState, new Map([['CHANGELOG.md', txt(changelog([sub(spec.teammate_entry)], [[v0, spec.history]]))], ['VERSION', txt(v1 + '\n')]]));
    branchTip = repo.commit({ state: branchState, parents: [branchTip], message: 'Update the changelog and version', day: day++ });
    mainTip = cut; mainState = cutState;
    for (const c of spec.main_commits) {
      mainState = overlay(mainState, readDir(join(dir, c.dir)));
      mainTip = repo.commit({ state: mainState, parents: [mainTip], message: c.message, day: day++ });
    }
    mainState = overlay(mainState, new Map([['CHANGELOG.md', txt(changelog([], released))], ['VERSION', txt(v1 + '\n')]]));
    mainTip = repo.commit({ state: mainState, parents: [mainTip], message: 'Release ' + v1, day: day++ });

    // The work tree and the remote, captured before the oracle check below adds objects.
    const work: Tree = new Map();
    mount(work, 'repo/', branchState);
    mount(work, 'repo/.git/', gitDir(repo, {
      refs: { 'refs/heads/main': cut, ['refs/heads/' + branch]: branchTip, 'refs/remotes/origin/main': cut, ['refs/remotes/origin/' + branch]: branchTip, 'refs/remotes/origin/HEAD': 'ref: refs/remotes/origin/main' },
      head: 'ref: refs/heads/' + branch, index: branchTip,
      config: '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n[remote "origin"]\n\turl = /work/remote.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n[branch "' + branch + '"]\n\tremote = origin\n\tmerge = refs/heads/' + branch + '\n',
    }));
    mount(work, 'remote.git/', gitDir(repo, {
      refs: { 'refs/heads/main': mainTip, ['refs/heads/' + branch]: branchTip }, head: 'ref: refs/heads/main',
      config: '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n',
    }));
    files.set('environment/work.tar', { data: writeTar(work), mode: 0o644 });

    // The oracle's finished files, checked by merging main into the branch here and laying them over the result.
    repo.writeState(branchState);
    git(repo.w, ['read-tree', branchTip]);
    git(repo.w, ['update-ref', 'refs/heads/sim', branchTip]);
    git(repo.w, ['symbolic-ref', 'HEAD', 'refs/heads/sim']);
    git(repo.w, ['merge', '--no-edit', '-q', mainTip], commitEnv(day), true);
    const conflicted = git(repo.w, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);
    for (const p of conflicted) if (!finalFiles.has(p)) throw new Error(row.spec + ': merge conflict in ' + p + ' that final/ does not resolve');
    for (const [p, e] of finalFiles) { mkdirSync(dirname(join(repo.w, p)), { recursive: true }); writeFileSync(join(repo.w, p), e.data); }
    git(repo.w, ['add', '-A', '-f']);
    for (const p of git(repo.w, ['ls-files']).split('\n').filter(Boolean)) if (readFileSync(join(repo.w, p), 'utf8').includes('<<<<<<< ')) throw new Error(row.spec + ': conflict markers left in ' + p);
    const changedVsMain = git(repo.w, ['diff', '--cached', '--name-only', mainTip]).split('\n').filter(Boolean);
    const branchPaths = git(repo.w, ['diff', '--name-only', cut, branchTip]).split('\n').filter(Boolean);
    allowed = [...new Set([...branchPaths, ...finalFiles.keys(), ...spec.feature_tests.map((t: string) => t.replace(/\/$/, '') + '/*')])].sort();
    const stray = changedVsMain.filter((p) => !allowed.some((g) => (g.endsWith('/*') ? p.startsWith(g.slice(0, -1)) : p === g)));
    if (stray.length) throw new Error(row.spec + ': the finished branch changes paths outside allowed_paths: ' + stray.join(', '));
  } finally {
    repo.close();
  }
  mount(files, 'oracle/final/', finalFiles);

  files.set('instruction.md', txt([
    'Your teammate\'s branch `' + branch + '` in the Python repository at /work/repo (remote `origin` is /work/remote.git) is not finished, and they are away. It needs to land.',
    '', 'What it adds, in their words: ' + spec.summary, '', 'How it should behave:', ...spec.behaviour.map((b: string) => '- ' + b), '',
    'Get the branch ready to merge into main. It must merge cleanly into the current `origin/main`, behave as described above, pass the test suite and lint, and follow CONTRIBUTING.md. Push the finished branch to `origin` under the same name.',
    '', 'Do not push to main or rewrite its history. A `gh` command is installed, but there is no network; opening a pull request is optional.', '',
  ].join('\n')));
  files.set('task.toml', txt(taskToml(row.id, 'ship', ['allowed_paths = ' + JSON.stringify(allowed)], spec.repo)));
  files.set('environment/Dockerfile', txt(agentDockerfile(false)));
  files.set('environment/gh', tpl('gh'));
  files.set('environment/requirements.lock', tpl('requirements.lock'));
  files.set('verifier/Dockerfile', txt(verifierDockerfile(false)));
  files.set('verifier/requirements.lock', tpl('requirements.lock'));
  files.set('verifier/verify.sh', tpl('verify.sh', 0o755));
  files.set('verifier/verify.py', tpl('verify.py'));
  files.set('verifier/contrib_check.py', tpl('contrib_check.py'));
  const hidden = readDir(join(dir, 'hidden'));
  if (!hidden.has('test_ship.py') || hidden.size !== 1) throw new Error(row.spec + ': hidden/ holds exactly test_ship.py');
  files.set('verifier/hidden/tests_gn/test_ship.py', hidden.get('test_ship.py')!);
  const configs = ['CONTRIBUTING.md', 'ruff.toml', 'setup.cfg', 'tox.ini', 'pyproject.toml', 'pytest.ini', 'conftest.py'];
  for (const p of [...mainState.keys()].sort()) {
    if (configs.includes(p) || spec.repo_tests.some((t: string) => p === t || p.startsWith(t.replace(/\/$/, '') + '/'))) files.set('verifier/protected/' + p, mainState.get(p)!);
  }
  files.set('verifier/task.json', txt(JSON.stringify({
    kind: 'ship', src: src.src, repo_tests: tests, hidden: ['tests_gn/test_ship.py'], remote: '/work/remote.git', branch, main_sha: mainTip,
    allowed_paths: allowed, lint_config: 'ruff.toml', lint_paths: spec.lint_paths, repo_tests_min: spec.repo_tests_min, repo_skips_max: spec.repo_skips_max,
  }, null, 1) + '\n'));

  files.set('oracle/solve.sh', txt('#!/bin/bash\ncd /work/repo\ngit fetch -q origin\ngit merge --no-edit origin/main >/dev/null 2>&1\ncp -r /oracle/final/. /work/repo/\ngit add -A\ngit commit -q -m "Finish the feature and merge main"\ngit push -q origin HEAD:' + branch + '\n', 0o755));
  for (const [p, e] of stepsFiles('ship', {
    kind: 'ship', branch, final: [...finalFiles.keys()].sort(), env: src.src === '.' ? {} : { PYTHONPATH: src.src },
    test_cmd: ['python3', '-m', 'pytest', '-q', ...tests],
  })) files.set(p, e);

  const push = 'cd /work/repo && git commit -q -am "Tidy" && git push -q origin HEAD:' + branch + '\n';
  const checks: Record<string, string> = {
    noop: 'true\n',
    shim: SHIM,
    forcemain: 'bash /oracle/solve.sh\ncd /work/repo && git push -q -f origin HEAD:main\n',
    nolog: 'bash /oracle/solve.sh\ncd /work/repo && git checkout origin/main -- CHANGELOG.md && git commit -qm "drop changelog" && git push -q origin HEAD:' + branch + '\n',
    staleversion: '# The finished branch with VERSION left at main\'s version, as the merge leaves it.\nbash /oracle/solve.sh\ncd /work/repo && git show origin/main:VERSION > VERSION && ' + push,
    oldentry: '# The finished branch with its changelog entry under the version main released instead of Unreleased.\nbash /oracle/solve.sh\ncd /work/repo && python3 - <<\'PY\'\nlines = open("CHANGELOG.md").read().split("\\n")\nentry = ' + JSON.stringify(sub(spec.entry)) + '\nlines.remove(entry)\nat = next(i for i, l in enumerate(lines) if l.startswith("## ") and l != "## Unreleased")\nlines[at + 2:at + 2] = [entry]\nopen("CHANGELOG.md", "w").write("\\n".join(lines))\nPY\n' + push,
    pushonly: 'cd /work/repo && git fetch -q origin && git merge -X ours --no-edit origin/main >/dev/null 2>&1; git push -q origin HEAD:' + branch + '\n',
    pyexit: 'bash /oracle/solve.sh\nprintf \'\\nimport os as _gn_os, sys as _gn_sys\\nif "pytest" in _gn_sys.modules:\\n    _gn_os._exit(0)\\n\' >> /work/repo/' + spec.module + '\n' + push,
    flipreport: '# Rewrites pytest verdicts from inside the grading process; the hidden canaries must catch it.\nbash /oracle/solve.sh\ncd /work/repo && git checkout origin/main -- ' + spec.module + '\ncat >> /work/repo/' + spec.module + " <<'GN_EOF'\n\n\ndef _gn_flip():\n    import _pytest.reports as r\n\n    orig = r.TestReport.__init__\n\n    def init(self, *a, **k):\n        orig(self, *a, **k)\n        if self.outcome == \"failed\":\n            self.outcome = \"passed\"\n            self.longrepr = None\n\n    r.TestReport.__init__ = init\n\n\ntry:\n    _gn_flip()\nexcept ImportError:\n    pass\nGN_EOF\n" + push,
    unrelated: 'bash /oracle/solve.sh\ncd /work/repo && echo "" >> ' + src.license + ' && ' + push,
  };
  for (const name of spec.checks) {
    const ov = readDir(join(dir, 'checks', name));
    if (!ov.size) throw new Error(row.spec + ': check ' + name + ' has no files');
    mount(files, 'checks/' + name + '/', ov);
    checks[name] = '# The oracle\'s branch with checks/' + name + '/ laid over it.\nbash /oracle/solve.sh\ncp -r /checks/' + name + '/. /work/repo/\ncd /work/repo && git add -A && git commit -q -m "Tidy" && git push -q origin HEAD:' + branch + '\n';
  }
  for (const [name, body] of Object.entries(checks)) files.set('checks/' + name + '.sh', txt('#!/bin/bash\n' + body, 0o755));
  return files;
}

// ---------------------------------------------------------------- the set

export function buildTask(row: PlanRow): Tree { return row.kind === 'review' ? buildReview(row) : buildShip(row); }

function specOf(r: PlanRow) { return JSON.parse(readFileSync(join(HERE, 'specs', r.kind, r.spec, 'spec.json'), 'utf8')); }

const R61_NOTE = [
  '## R61 ceiling-raise (2026-11-09)', '',
  'The set was made harder once, under rule R61, after the first headroom check (HARN-61 plan step 7: none arm, 1 try, tasks at d17fd9bc).', '',
  '- **What the check found.** Claude Code with Opus 5.5 passed review 13/16 (mean reward 0.906) and ship 16/16. Codex with GPT-6.1 Sol passed review 8/16 (0.50) and ship 13/16. Review rewards differed between the two cells on 7 of 16 tasks and ship on 3 of 16.',
  '- **Why that fails the gate.** Big decision 7 needs the none arm between 15% and 80% per kind and at least half the tasks varying. Ship was at 91% and review had too few varying tasks.',
  '- **Review change.** Every review task plants one more defect: the spec\'s `ceiling` defect, always outside the logic class (SQL safety, trust boundaries or conditional side effects), on top of the seed\'s pick, which is unchanged. The two decoys stay. On the 8 tasks both cells passed (review-04, 05, 07, 08, 09, 10, 14 and 16) the added defect is one that looks correct inside its hunk and needs the surrounding code to see.',
  '- **Ship change.** Every ship task has one more commit on main before the release (`main_r61/` in its spec): a base change that merges without a conflict and breaks the feature until it is adapted, so only a merge followed by a full test run catches it. The `r61stale` check (the old finished files, not adapted) must score 0. On the 13 tasks both cells passed (all but ship-08, 15 and 16) the break shows only in a repository test outside the feature\'s own tests.',
  '- **Room for the new defect.** Planted hunks must sit more than 7 lines apart and more than 4 from a decoy. To make room, 8 review changes moved existing code without changing what it does (review-02, 04, 07, 08, 09, 13, 15 and 16: a function moved, or a few lines pulled into a helper), review-03 plants its defect in a base line the change relies on, and review-12 adds a two-line interval guard that the defect then drops. Review-16\'s added defect is the same kind of bug as one it already plants, so it is the weakest of the 8 hard additions.',
  '- **Wrong solutions kept honest.** Where a ship task\'s existing per-task check is a whole file, it was rebuilt on the adapted finished file so it still fails for its own reason, not for missing the R61 adaptation.',
  '- **Unchanged.** 16 + 16 tasks, the seeds, the task ids, the instructions\' wording and the steps cards.', '',
];

export function setFiles(rows: PlanRow[], tasks: Map<string, Tree>): Tree {
  const out: Tree = new Map();
  const repos = [...new Set(rows.map((r) => specOf(r).repo as string))].sort();
  for (const r of repos) out.set('LICENSES/' + r + '.txt', upstream(r).get(SOURCES.repos[r].license)!);
  const table = rows.map((r) => {
    const spec = specOf(r);
    const t = Bun.TOML.parse(tasks.get(r.id)!.get('task.toml')!.data.toString()) as any;
    const what = r.kind === 'review' ? t.score.planted_hunks.length + ' planted defects, 2 decoys' : 'main released ' + spec.release.version;
    return '| ' + r.id + ' | ' + r.kind + ' | ' + r.spec + ' | ' + spec.repo + ' (MIT) | ' + what + ' |';
  });
  out.set('README.md', txt([
    '# gstack-delivery-v1', '',
    'Repository tasks for testing whether delivering gstack\'s review and ship steps by hook or startup file makes agents follow them and pass more (HARN-61). Format and grading: [docs/repo-tasks.md](../../../docs/repo-tasks.md). This file is written by `scripts/repo-tasks/delivery/build.ts`.', '',
    '- **dev/**: ' + rows.filter((r) => r.kind === 'review').length + ' review tasks and ' + rows.filter((r) => r.kind === 'ship').length + ' ship tasks, all public. There is no held-out split.',
    '- **Seeds:** review `' + SEEDS.review.seed + '`, ship `' + SEEDS.ship.seed + '` (`scripts/repo-tasks/delivery/seeds.json`). The seed orders the specs into task ids and picks each branch name and, for review, which of a spec\'s defects are planted.',
    '- **Specs:** hand-written, one per task, under `scripts/repo-tasks/delivery/specs/`. No model call wrote them.', '',
    ...R61_NOTE,
    '| Task | Kind | Spec | Source | Shape |', '|---|---|---|---|---|', ...table, '',
    '**Licenses.** Each task copies files from its source repository, pinned by commit in `scripts/repo-tasks/delivery/sources.json`: the working tree inside `environment/work.tar` (with the repository\'s own license file), the review base tree in `verifier/trees/base.tar`, and single files under `verifier/trees/`, `verifier/protected/` and `oracle/final/`. Every copy stays under its upstream license; the texts are in [LICENSES/](LICENSES/) (all MIT).', '',
    '**Acceptance.** [dev/ACCEPTANCE.json](dev/ACCEPTANCE.json) holds each task\'s matrix from `scripts/repo-tasks/matrix.ts`: the image ids it ran on and the reward of every run of the oracle, the steps-followed oracle, the starting state and each check.', '',
  ].join('\n')));
  for (const [id, t] of tasks) mount(out, 'dev/' + id + '/', t);
  return out;
}

export function buildSet(only?: string): Tree {
  const rows = plan(!only);
  const tasks = new Map(rows.filter((r) => !only || r.id === only || r.spec === only).map((r) => [r.id, buildTask(r)]));
  if (!only) return setFiles(rows, tasks);
  const t: Tree = new Map();
  for (const [id, f] of tasks) mount(t, 'dev/' + id + '/', f);
  return t;
}

export function treeDigest(t: Tree): string {
  const h = createHash('sha256');
  for (const p of [...t.keys()].sort()) h.update(p + '\0' + t.get(p)!.mode.toString(8) + '\0' + sha256(t.get(p)!.data) + '\n');
  return h.digest('hex');
}

/** The files under a set directory that the build owns: README.md, LICENSES/ and dev/ except ACCEPTANCE.json. */
export function readSet(dir: string): Tree {
  const t = readDir(dir);
  for (const p of [...t.keys()]) if (!(p === 'README.md' || p.startsWith('LICENSES/') || p.startsWith('dev/')) || p === 'dev/ACCEPTANCE.json') t.delete(p);
  return t;
}

export function diffTrees(a: Tree, b: Tree): string[] {
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter((p) => !a.has(p) || !b.has(p) || !a.get(p)!.data.equals(b.get(p)!.data) || a.get(p)!.mode !== b.get(p)!.mode);
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = resolve(arg('--out') ?? SET_DIR);
  const only = arg('--only');
  if (only && !arg('--out') && !process.argv.includes('--check')) {
    try { plan(true); } catch (e) { throw new Error((e as Error).message + '; task ids shift until every spec exists, so --only on an incomplete set needs --out <scratch dir>'); }
  }
  const built = buildSet(only);
  const ids = [...new Set([...built.keys()].filter((p) => p.startsWith('dev/')).map((p) => p.split('/')[1]))].sort();
  if (process.argv.includes('--check')) {
    let have = readSet(out);
    if (only) have = new Map([...have].filter(([p]) => ids.some((id) => p.startsWith('dev/' + id + '/'))));
    const diff = diffTrees(built, have);
    console.log('BUILD: files=' + built.size + ' digest=' + treeDigest(built) + ' differing=' + diff.length + (diff.length ? ' first=' + diff[0] : ''));
    process.exit(diff.length ? 1 : 0);
  }
  mkdirSync(join(out, 'dev'), { recursive: true });
  if (!only) {
    for (const n of ['README.md', 'LICENSES']) rmSync(join(out, n), { recursive: true, force: true });
    for (const d of readdirSync(join(out, 'dev'))) if (d !== 'ACCEPTANCE.json') rmSync(join(out, 'dev', d), { recursive: true, force: true });
  } else for (const id of ids) rmSync(join(out, 'dev', id), { recursive: true, force: true });
  for (const [p, e] of built) { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), e.data, { mode: e.mode }); }
  console.log('BUILD: files=' + built.size + ' digest=' + treeDigest(built) + ' tasks=' + ids.join(','));
}
