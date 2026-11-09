// The public-safety CLI end to end (scripts/public-safety/check.ts): range and PR-text modes, exit codes, the private
// pack, the output boundary, allowlist entries and a cold start from a copy of the gate folder alone.
//
// Value: protects=no object new in a push reaches the public repository with a key, a public marker, a private pack
// value, a non-noreply identity, a spend file, an unclassified path or a bad ref, and matched text never reaches stdout,
// stderr, --json or a trace; fails_when=an intermediate blob deleted before head passes, a secret in a file or member name
// is printed, a tag passes with an empty range, an exit code drifts from the table, a scanner throw is not PS-INTERNAL,
// a missing or mismatched pack does not exit 3, or the gate needs publication/ or scripts/public-export/;
// why_new=public-first moves the export's checks in front of every push; seam=bun check.ts under a scrubbed environment
// on synthetic repositories with synthetic canaries; no_claim=the hook and doctor (tests/public-safety-hook.test.ts).
import { afterAll, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { blobId, treeIdOfDir } from '../scripts/public-safety/lib/git.ts';
import { tarOf } from '../scripts/public-safety/lib/tools.ts';
import { buildPack, check, GATE, gitleaksReady, keyCanary, rand, repo, ROOT, tokenCanary, writePack } from './public-safety-fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const READY = gitleaksReady();
const drive = () => '/home/user/' + '.capy/drive' + '/x/' + rand(6) + '.md';
let n = 0;
const fresh = (email?: string) => { const r = repo(join(tmp, 'r' + ++n), email); r.commit({ 'docs/methods.md': '# Methods\n', 'runner/a.ts': 'export const a = 1;\n' }, 'base'); r.g('checkout', '-q', '-b', 'feature'); return r; };
const range = (r: ReturnType<typeof fresh>, extra: string[] = [], env?: Record<string, string>) => check(['--base', 'main', '--head', 'feature', ...extra], { cwd: r.dir, env });

test.skipIf(!READY)('a clean branch passes with one receipt per ref, and --json says pass', () => {
  const r = fresh();
  const head = r.commit({ 'docs/new.md': '# New page\n\nPlain words.\n', 'tests/new.test.ts': 'export {};\n' }, 'add a page');
  const out = range(r, ['--ref', 'refs/heads/feature']);
  expect(out.status).toBe(0);
  expect(out.stdout).toMatch(new RegExp('^PUBLIC_SAFETY: ok ref=refs/heads/feature head=' + head + ' gate=[0-9a-f]{12} pack=none objects=[0-9]+\\n$'));
  const j = JSON.parse(range(r, ['--json']).stdout);
  expect(j).toMatchObject({ schema: 1, result: 'pass', findings: [], gate: treeIdOfDir(GATE), pack: null });
  expect(j.tool).toContain('gitleaks 8.30.1');
}, 120_000);

test.skipIf(!READY)('a key-shaped canary and a gitleaks-only credential in blobs deleted before head are refused, and never printed', () => {
  const r = fresh();
  const key = keyCanary();
  const tok = tokenCanary();
  r.commit({ 'docs/notes.md': 'line\nkey ' + key + '\n', 'docs/cfg.txt': 'a\ngithub_token = "' + tok + '"\n' }, 'add');
  r.commit({ 'docs/notes.md': null, 'docs/cfg.txt': null }, 'remove');
  const out = range(r);
  expect(out.status).toBe(1);
  expect(out.stdout).toContain('PS-KEY-SHAPE docs/notes.md:2 ');
  expect(out.stdout).toContain('PS-GITLEAKS docs/cfg.txt:2 ');
  expect(out.stdout).not.toContain('PUBLIC_SAFETY: ok');
  for (const s of [key, tok, key.slice(-12), tok.slice(-12)]) expect(out.all).not.toContain(s);
  const ci = range(r, [], { GITHUB_ACTIONS: 'true' });
  expect(ci.stdout).toMatch(/^PS-KEY-SHAPE corr=[0-9a-f]{12}$/m);
  expect(ci.stdout).not.toContain('docs/notes.md');
}, 120_000);

test.skipIf(!READY)('gitleaks still reads a range or a PR text whose bytes sniff as a binary type at offset 0, 257 or 32769', () => {
  const r = fresh();
  const tok = tokenCanary();
  r.commit({ 'docs/benchmarks/r1/results/state.sqlite': Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200), Buffer.from('\ngithub_token = "' + tok + '"\n')]) }, 'add a receipt');
  const out = range(r);
  expect(out.status).toBe(1);
  expect(out.stdout).toMatch(/^PS-GITLEAKS docs\/benchmarks\/r1\/results\/state\.sqlite:\d+ /m);
  expect(out.all).not.toContain(tok);
  const dir = join(tmp, 'pdf-text');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pr.md'), '%PDF-1.4\ngithub_token = "' + tok + '"\n');
  const text = check(['--pr-text', join(dir, 'pr.md')], { cwd: dir });
  expect(text.status).toBe(1);
  expect(text.stdout).toContain('PS-GITLEAKS text:2 ');
  expect(text.all).not.toContain(tok);
  const at = (n: number, s: string, rest: string) => s.padStart(n + s.length, '-') + rest;
  const deep = at(228, 'ustar', at(32740 - 233, 'CD001', '\ngithub_token = "' + tok + '"\n'));
  const s = fresh();
  s.commit({ 'docs/deep.md': deep }, 'add a page');
  expect(range(s).stdout).toMatch(/^PS-GITLEAKS docs\/deep\.md:2 /m);
  writeFileSync(join(dir, 'deep.md'), deep);
  expect(check(['--pr-text', join(dir, 'deep.md')], { cwd: dir }).stdout).toContain('PS-GITLEAKS text:2 ');
}, 120_000);

test.skipIf(!READY)('a ref name goes through gitleaks like a message, and a flagged ref name is never printed', () => {
  const r = fresh();
  r.commit({ 'docs/new.md': '# New\n' }, 'add a page');
  const tok = tokenCanary();
  for (const ref of ['refs/heads/feature-' + tok, 'refs/tags/' + tok]) {
    const outs = [range(r, ['--ref', ref]), range(r, ['--ref', ref, '--json']), range(r, ['--ref', ref], { GITHUB_ACTIONS: 'true' })];
    expect(outs[0]!.status).toBe(1);
    expect(outs[0]!.stdout).toMatch(/^PS-GITLEAKS ref#1:1 /m);
    expect(outs[0]!.stdout).not.toContain('PUBLIC_SAFETY: ok');
    for (const o of outs) for (const s of [tok, tok.slice(4), tok.slice(-12)]) expect(o.all).not.toContain(s);
  }
  expect(range(r, ['--ref', 'refs/tags/' + tok]).stdout).toMatch(/^PS-REF ref#1:0 /m);
}, 120_000);

test.skipIf(!READY)('a file name with a newline cannot forge a seen-cache record that skips a later secret blob', () => {
  const r = fresh();
  const leak = 'k ' + keyCanary() + '\n';
  r.commit({ ['docs/innocent\n' + blobId(Buffer.from(leak)) + '\tdocs/leak.md']: 'plain\n' }, 'add a page');
  range(r);
  r.commit({ 'docs/leak.md': leak }, 'add');
  expect(range(r).stdout).toContain('PS-KEY-SHAPE docs/leak.md:1 ');
}, 120_000);

test.skipIf(!READY)('a credential that only gitleaks recognizes in a file name is never printed, locally or under GitHub Actions', () => {
  const r = fresh();
  const tok = tokenCanary();
  r.commit({ ['docs/' + tok + '.md']: 'plain\n', ['notes/' + tok + '.md']: 'plain\n' }, 'add');
  const out = range(r, ['--json']);
  expect(out.status).toBe(1);
  expect(out.stdout).toContain('PS-GITLEAKS');
  expect(out.stdout).toContain('PS-CLASS');
  expect(out.all).not.toContain(tok);
  expect(range(r, [], { GITHUB_ACTIONS: 'true' }).all).not.toContain(tok);
}, 120_000);

test.skipIf(!READY)('a credential only gitleaks recognizes in a .tar.gz member name is withheld from every other finding on every channel', () => {
  const r = fresh();
  const tok = tokenCanary();
  const member = tarOf([{ name: 'inner/' + tok + '.txt', data: Buffer.from('see ' + drive() + '\n') }]);
  r.commit({ 'docs/benchmarks/r1/results/state.tar.gz': gzipSync(member) }, 'add');
  const outs = [range(r), range(r, ['--json']), range(r, [], { GITHUB_ACTIONS: 'true' })];
  expect(outs[0]!.status).toBe(1);
  expect(outs[0]!.stdout).toMatch(/^PS-GITLEAKS docs\/benchmarks\/r1\/results\/state\.tar\.gz\|gunzip\|names:1 /m);
  expect(outs[0]!.stdout).toMatch(/^PS-DRIVE-PATH obj:[0-9a-f]{12}:1 /m);
  expect(JSON.parse(outs[1]!.stdout).findings.map((f: { code: string }) => f.code)).toContain('PS-DRIVE-PATH');
  expect(outs[2]!.stdout).toMatch(/^PS-GITLEAKS corr=[0-9a-f]{12}$/m);
  for (const o of outs) for (const s of [tok, tok.slice(4), tok.slice(-12)]) expect(o.all).not.toContain(s);
}, 120_000);

test.skipIf(!READY)('a secret in a file name and in a tar member name never reaches stdout, stderr, --json or the trace', () => {
  const r = fresh();
  const key = keyCanary();
  const member = tarOf([{ name: 'inner/' + key + '.txt', data: Buffer.from('see ' + drive() + '\n') }]);
  r.commit({ ['docs/' + key + '.md']: 'plain\n', 'docs/benchmarks/r1/results/state.tar.gz': gzipSync(member) }, 'add');
  const outs = [range(r), range(r, ['--json']), range(r, [], { GITHUB_ACTIONS: 'true' })];
  expect(outs[0]!.status).toBe(1);
  expect(outs[0]!.stdout).toMatch(/^PS-KEY-SHAPE obj:[0-9a-f]{12}:0 /m);
  expect(outs[0]!.stdout).toMatch(/^PS-DRIVE-PATH obj:[0-9a-f]{12}:1 /m);
  const j = JSON.parse(outs[1]!.stdout);
  expect(j.result).toBe('fail');
  expect(j.findings.every((f: { locator: string }) => !f.locator.includes('sk-'))).toBe(true);
  const fault = range(r, [], { PUBLIC_SAFETY_TEST_FAULT: 'gitleaks' });
  expect(fault.status).toBe(3);
  const trace = /trace (\S+trace\.txt)/.exec(fault.stderr)![1]!;
  const text = readFileSync(trace, 'utf8');
  expect(text).toContain('operation gitleaks');
  for (const o of [...outs, fault, { all: text }]) { expect(o.all).not.toContain(key); expect(o.all).not.toContain(key.slice(0, 16)); }
}, 120_000);

test.skipIf(!READY)('tags and other namespaces are refused even when the range is empty; a branch ref with an empty range passes', () => {
  const r = fresh();
  for (const ref of ['refs/tags/v1', 'refs/notes/commits', 'refs/pull/1/head', 'refs/heads/a..b']) {
    const out = check(['--base', 'main', '--head', 'main', '--ref', ref], { cwd: r.dir });
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/^PS-REF ref:/m);
  }
  const ok = check(['--base', 'main', '--head', 'main', '--ref', 'refs/heads/main'], { cwd: r.dir });
  expect(ok.status).toBe(0);
  expect(ok.stdout).toContain('objects=0');
}, 120_000);

test.skipIf(!READY)('exit codes: 2 names the bad argument and prints the usage, 3 for a missing base, and a scanner throw is 3 PS-INTERNAL', () => {
  const r = fresh();
  r.commit({ 'docs/x.md': 'x\n' });
  for (const [args, named] of [[['--bogus'], '--bogus'], [['--base', 'main'], '--head is missing'], [['--doctor', '--pr-text', 'x'], 'choose one mode'], [[], 'no mode given'], [['--base'], '--base needs a value']] as const) {
    const out = check([...args], { cwd: r.dir });
    expect(out.status).toBe(2);
    expect(out.stdout).toMatch(/^PS-USAGE /m);
    expect(out.stderr).toContain(named);
    expect(out.stderr).toContain('usage:');
  }
  const base = check(['--base', 'f'.repeat(40), '--head', 'feature'], { cwd: r.dir });
  expect(base.status).toBe(3);
  expect(base.stdout).toMatch(/^PS-BASE op:refs:0 /m);
  for (const stage of ['commits', 'paths', 'blobs']) {
    const out = range(r, [], { PUBLIC_SAFETY_TEST_FAULT: stage });
    expect(out.status).toBe(3);
    expect(out.stdout).toContain('PS-INTERNAL op:' + stage + ':0 ');
    expect(out.stderr).toContain('tool public-safety/1');
    expect(existsSync(/trace (\S+)/.exec(out.stderr)![1]!)).toBe(true);
  }
  expect(JSON.parse(range(r, ['--json'], { PUBLIC_SAFETY_TEST_FAULT: 'blobs' }).stdout)).toMatchObject({ result: 'error', findings: [{ code: 'PS-INTERNAL', locator: 'op:blobs' }] });
}, 120_000);

test.skipIf(!READY)('spend files, unclassified and denied paths, disallowed formats and over-budget files are refused', () => {
  const r = fresh();
  r.commit({
    'docs/benchmarks/r1/results/ledger.sqlite': 'rows\n',
    'docs/benchmarks/r1/results/proxy-usage-1.ndjson': '{}\n',
    'docs/benchmarks/r1/results/spend-reconciliation.json': '{}\n',
    'random/file.txt': 'x\n',
    'publication/scrub-table.json': '{}\n',
    'docs/archive.md': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]),
    'sealed/backups.json': 'x'.repeat(2 ** 20 + 1),
  }, 'add');
  r.commit({ 'docs/benchmarks/r1/results/ledger.sqlite': null }, 'remove the ledger');
  const out = range(r);
  expect(out.status).toBe(1);
  for (const p of ['ledger.sqlite', 'proxy-usage-1.ndjson', 'spend-reconciliation.json']) expect(out.stdout).toContain('PS-SPEND-PATH docs/benchmarks/r1/results/' + p + ':0');
  expect(out.stdout).toContain('PS-CLASS random/file.txt:0');
  expect(out.stdout).toContain('PS-CLASS publication/scrub-table.json:0');
  expect(out.stdout).toContain('PS-FORMAT docs/archive.md:0');
  expect(out.stdout).toContain('PS-SIZE sealed/backups.json:0');
}, 120_000);

test.skipIf(!READY)('the identity gate refuses a non-noreply author, committer or trailer through the CLI, and never prints the address', () => {
  const bad = 'dev.' + rand(6) + '@example.com';
  const r = fresh();
  r.commit({ 'docs/a.md': 'a\n' }, 'one\n\nCo-authored-by: Helper <' + bad + '>');
  r.commit({ 'docs/b.md': 'b\n' }, 'two', ['-c', 'user.email=' + bad]);
  const out = range(r);
  expect(out.status).toBe(1);
  expect(out.stdout).toMatch(/^PS-IDENTITY commit:[0-9a-f]{12}:co-authored-by#1:0 /m);
  expect(out.stdout).toMatch(/^PS-IDENTITY commit:[0-9a-f]{12}:author:0 /m);
  expect(out.stdout).toMatch(/^PS-IDENTITY commit:[0-9a-f]{12}:committer:0 /m);
  expect(out.all).not.toContain(bad);
  const good = fresh();
  good.commit({ 'docs/a.md': 'a\n' }, 'one\n\nCo-authored-by: Bot <49699333+dependabot[bot]@users.noreply.github.com>\nSigned-off-by: T <noreply@github.com>');
  expect(range(good).status).toBe(0);
}, 120_000);

test.skipIf(!READY)('the private pack: missing or mismatched exits 3, and a pack value in a blob is refused as not allowlistable', () => {
  const r = fresh();
  const secret = 'PRIVATE-' + rand(24);
  r.commit({ 'docs/a.md': 'intro\nhere ' + secret + ' end\n' });
  const p = buildPack({ gateTree: treeIdOfDir(GATE), values: [secret] });
  const files = writePack(join(tmp, 'pack' + n), p);
  expect(range(r, ['--private-pack', join(tmp, 'absent.json'), '--pin', files.pin]).stdout).toMatch(/^PS-PACK-MISSING /m);
  expect(range(r, ['--private-pack', join(tmp, 'absent.json'), '--pin', files.pin]).status).toBe(3);
  expect(range(r, ['--private-pack', files.pack, '--pin', join(tmp, 'absent.sha256')]).status).toBe(3);
  writeFileSync(join(tmp, 'wrong.sha256'), 'a'.repeat(64) + '\n');
  const mismatch = range(r, ['--private-pack', files.pack, '--pin', join(tmp, 'wrong.sha256')]);
  expect(mismatch.status).toBe(3);
  expect(mismatch.stdout).toMatch(/^PS-PACK-SHA /m);
  const out = range(r, ['--private-pack', files.pack, '--pin', files.pin]);
  expect(out.status).toBe(1);
  expect(out.stdout).toMatch(/^PS-PRIVATE-VALUE docs\/a\.md:2 fix: Not allowlistable; see the private record\. /m);
  expect(out.all).not.toContain(secret);
  const ci = range(r, ['--private-pack', files.pack, '--pin', files.pin], { GITHUB_ACTIONS: '1' });
  expect(ci.stdout.trim()).toMatch(/^PS-PRIVATE-VALUE corr=[0-9a-f]{12}$/);
  const clean = fresh();
  clean.commit({ 'docs/a.md': 'fine\n' });
  expect(range(clean, ['--private-pack', files.pack, '--pin', files.pin]).stdout).toContain('pack=' + p.sha.slice(0, 12));
}, 120_000);

test.skipIf(!READY)('--pr-text: lint only without a pack, an ok line with the text sha256 with one, the Agent notes exemption, and shingles', () => {
  const dir = join(tmp, 'text');
  mkdirSync(dir, { recursive: true });
  const file = (name: string, body: string) => { writeFileSync(join(dir, name), body); return join(dir, name); };
  const clean = file('clean.md', '## Summary\n\nAdds a page.\n');
  expect(check(['--pr-text', clean], { cwd: dir })).toMatchObject({ status: 0, stdout: 'not authorizing\n' });
  const chatter = 'the ' + 'needs' + '_you report';
  const bad = file('bad.md', '## Summary\n\n' + chatter + '\n');
  const out = check(['--pr-text', bad], { cwd: dir });
  expect(out.status).toBe(1);
  expect(out.stdout).toContain('PS-CREW-CHATTER text:3 ');
  expect(out.stdout).toContain('not authorizing');
  const notes = file('notes.md', '## Summary\n\nAdds a page.\n\n<details><summary>Agent notes</summary>\n\n' + chatter + '\n\n</details>\n');
  expect(check(['--pr-text', notes], { cwd: dir }).status).toBe(0);
  const words = Array.from({ length: 40 }, (_, i) => 'w' + i + rand(4)).join(' ');
  const p = buildPack({ gateTree: treeIdOfDir(GATE), shingleText: words });
  const f = writePack(join(dir, 'pack'), p);
  const ok = check(['--pr-text', clean, '--private-pack', f.pack, '--pin', f.pin], { cwd: dir });
  expect(ok.status).toBe(0);
  expect(ok.stdout.trim()).toBe('PUBLIC_SAFETY: ok text=' + new Bun.CryptoHasher('sha256').update(readFileSync(clean)).digest('hex'));
  const copied = check(['--pr-text', file('copied.md', 'Intro.\n\n' + words + '\n'), '--private-pack', f.pack, '--pin', f.pin], { cwd: dir });
  expect(copied.status).toBe(1);
  expect(copied.stdout).toMatch(/^PS-PRIVATE-SHINGLE text:3 /m);
  expect(check(['--pr-text', join(dir, 'absent.md')], { cwd: dir }).status).toBe(2);
}, 120_000);

test.skipIf(!READY)('--allow writes a blob-bound entry that admits that file only until it changes, and refuses private codes', () => {
  const iso = join(tmp, 'allow-gate');
  cpSync(GATE, join(iso, 'scripts', 'public-safety'), { recursive: true });
  const script = join(iso, 'scripts', 'public-safety', 'check.ts');
  const r = fresh();
  r.commit({ 'docs/a.md': 'see ' + drive() + '\n' });
  expect(check(['--base', 'main', '--head', 'feature'], { cwd: r.dir, script }).status).toBe(1);
  const entry = check(['--allow', 'PS-DRIVE-PATH', 'docs/a.md:1', '--reason', 'a quoted example'], { cwd: r.dir, script });
  expect(entry.status).toBe(0);
  const e = JSON.parse(entry.stdout);
  expect(e).toMatchObject({ code: 'PS-DRIVE-PATH', path: 'docs/a.md', line: 1, reason: 'a quoted example' });
  expect(e.blob).toBe(r.g('rev-parse', 'HEAD:docs/a.md'));
  expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const allowFile = join(iso, 'scripts', 'public-safety', 'allow.json');
  const allow = JSON.parse(readFileSync(allowFile, 'utf8'));
  allow.entries.push(e);
  writeFileSync(allowFile, JSON.stringify(allow));
  expect(check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir, script }).status).toBe(0);
  r.commit({ 'docs/a.md': 'see ' + drive() + '\nmore\n' });
  expect(check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir, script }).status).toBe(1);
  for (const code of ['PS-PRIVATE-VALUE', 'PS-IDENTITY', 'PS-NOPE']) expect(check(['--allow', code, 'docs/a.md:1', '--reason', 'x'], { cwd: r.dir, script }).status).toBe(2);
}, 120_000);

test.skipIf(!READY)('a blob already on the base that appears at a new path is checked against the new path\'s class and path rules', () => {
  const spend = (JSON.parse(readFileSync(join(GATE, 'rules.json'), 'utf8')).rules as { id: string; canary: string }[]).find((x) => x.id === 'program-spend-total')!.canary;
  const r = repo(join(tmp, 'r' + ++n));
  const report = '# Report\n\n' + spend + '\n';
  r.commit({ 'docs/benchmarks/r1/report.md': report, 'docs/methods.md': '# Methods\n' }, 'base');
  r.g('checkout', '-q', '-b', 'feature');
  r.commit({ 'docs/copy.md': report }, 'copy');
  const out = range(r, ['--no-cache']);
  expect(out.status).toBe(1);
  expect(out.stdout).toMatch(/^PS-SPEND-TOTAL docs\/copy\.md:3 /m);
  expect(out.stdout).not.toContain('docs/benchmarks/r1/report.md');
  const s = repo(join(tmp, 'r' + ++n));
  s.commit({ 'docs/benchmarks/r1/report.md': report }, 'base');
  s.g('checkout', '-q', '-b', 'feature');
  s.commit({ 'docs/benchmarks/r2/report.md': report }, 'copy within the allowed folder');
  expect(range(s, ['--no-cache']).status).toBe(0);
}, 120_000);

test.skipIf(!READY)('an allowlist entry admits its code at its listed lines only, not every hit of that code in the blob', () => {
  const iso = join(tmp, 'allow-lines-gate');
  cpSync(GATE, join(iso, 'scripts', 'public-safety'), { recursive: true });
  const script = join(iso, 'scripts', 'public-safety', 'check.ts');
  const allowFile = join(iso, 'scripts', 'public-safety', 'allow.json');
  const r = fresh();
  r.commit({ 'docs/a.md': 'see ' + drive() + '\nplain\nand ' + drive() + '\n' });
  const withEntry = (at: string) => {
    const e = JSON.parse(check(['--allow', 'PS-DRIVE-PATH', 'docs/a.md:' + at, '--reason', 'a quoted example'], { cwd: r.dir, script }).stdout);
    writeFileSync(allowFile, JSON.stringify({ schema: 'harness-evals-public-safety-allow/1', entries: [e] }));
    return { e, out: check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir, script }) };
  };
  const one = withEntry('1');
  expect(one.e.line).toBe(1);
  expect(one.out.status).toBe(1);
  expect(one.out.stdout).toMatch(/^PS-DRIVE-PATH docs\/a\.md:3 /m);
  const both = withEntry('1,3');
  expect(both.e.line).toEqual([1, 3]);
  expect(both.out.status).toBe(0);
  writeFileSync(allowFile, JSON.stringify({ schema: 'harness-evals-public-safety-allow/1', entries: [{ ...both.e, line: [] }] }));
  expect(check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir, script }).status).toBe(3);
}, 120_000);

test.skipIf(!READY)('cold start: the gate folder alone, with no publication/ or scripts/public-export/, runs and passes a clean range', () => {
  const iso = join(tmp, 'cold');
  cpSync(GATE, join(iso, 'scripts', 'public-safety'), { recursive: true });
  expect(existsSync(join(iso, 'publication'))).toBe(false);
  expect(existsSync(join(iso, 'scripts', 'public-export'))).toBe(false);
  for (const f of ['check.ts', 'lib/scan.ts', 'lib/tools.ts', 'lib/pack.ts', 'lib/doctor.ts']) expect(readFileSync(join(GATE, f), 'utf8')).not.toMatch(/from '\.\.\/\.\.|public-export|publication\//);
  const r = fresh();
  r.commit({ 'docs/a.md': 'a\n' });
  const out = check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir, script: join(iso, 'scripts', 'public-safety', 'check.ts') });
  expect(out.status).toBe(0);
  expect(out.stdout).toContain('gate=' + treeIdOfDir(GATE).slice(0, 12));
  expect(readFileSync(join(ROOT, 'docs', 'public-safety.md'), 'utf8')).toContain('## Exit codes');
}, 120_000);

test.skipIf(!READY)('latency: 50 commits scan cold and warm with the object-id cache, durations and object counts logged', () => {
  const r = fresh();
  for (let i = 0; i < 50; i++) r.commit({ ['docs/p' + (i % 7) + '.md']: '# Page ' + i + '\n\n' + rand(400) + '\n', ['runner/m' + (i % 5) + '.ts']: 'export const v = ' + i + ';\n', ['docs/benchmarks/r1/results/t' + i + '.jsonl']: '{"trial":' + i + '}\n' }, 'commit ' + i);
  const times: number[] = [];
  let log = '';
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const out = range(r, [], { PUBLIC_SAFETY_TIMING: '1' });
    times.push(Date.now() - t0);
    expect(out.status).toBe(0);
    log += out.stderr.split('\n').filter((l) => l.includes('timing')).join(' ') + ' ';
  }
  console.log('public-safety latency: cold ' + times[0] + ' ms, warm ' + times[1] + ' ms; ' + log.trim());
  expect(times[1]!).toBeLessThan(20_000);
  expect(times[0]!).toBeLessThan(60_000);
}, 120_000);
