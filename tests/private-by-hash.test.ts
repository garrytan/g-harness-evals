// The private-by-hash result class (runner/prereg/private-by-hash.ts) over a temporary repository and a synthetic private
// root: the preregistration pins outputs and no hash, the results attestation names the unchanged preregistration and
// the pinned outputs, CI's check catches each way that breaks, and the private verifier refuses a substituted ledger or
// usage log. Every ledger and log here is synthetic.
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { ATTESTATION_MAP_PATH, ATTESTED, LEDGER_PATH, MAPPED, type ManifestEntry } from '../runner/prereg/prereg.ts';
import { attest, attestationPath, checkPrivateByHash, parsePins, type Pins, type ResultsAttestation, verify } from '../runner/prereg/private-by-hash.ts';
import { buildManifest } from '../scripts/receipts-manifest.ts';

const tmp = mkdtempSync(join(tmpdir(), 'private-by-hash-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const RUN_DIR = 'docs/benchmarks/2026-01-05-synthetic-billing';
const PREREG = RUN_DIR + '/PREREGISTRATION.md';
const RUN_ID = 'synthetic-billing-2026-01';
const PINS: Pins = {
  run_id: RUN_ID,
  billing_protocol: 'metering proxy, one ledger lease per shard, reserve worst case then settle to usage',
  cap_usd: 10,
  outputs: [
    { name: 'ledger', schema: 'ledger-sqlite/1', location: 'private/spend/runs/synthetic-billing-2026-01/ledger.sqlite' },
    { name: 'usage', schema: 'proxy-usage-ndjson/1', location: 'private/spend/runs/synthetic-billing-2026-01/proxy-usage.ndjson' },
  ],
  verification: 'bun runner/prereg/private-by-hash.ts verify --preregistration docs/benchmarks/2026-01-05-synthetic-billing/PREREGISTRATION.md --root <private repository>',
};
const prereg = (pins: object, extra = '') => `# Synthetic billing run\n\nPrivate billing outputs:\n\n\`\`\`json private-by-hash\n${JSON.stringify(pins, null, 2)}\n\`\`\`\n${extra}`;
const ENTRY: ManifestEntry = { id: RUN_ID, preregistration: PREREG, results: [RUN_DIR + '/results/**'], result_class: 'private-by-hash' };

/** A lease ledger in runner/ledger/budget-ledger.ts's shape: one lease and one settled entry per given amount. */
function ledger(path: string, runId: string, amounts: number[]): Buffer {
  rmSync(path, { force: true });
  const db = new Database(path);
  db.exec(`CREATE TABLE runs (run_id TEXT PRIMARY KEY, runner TEXT NOT NULL, budget_usd REAL NOT NULL, estimate_usd REAL, started_at TEXT NOT NULL, finished_at TEXT, committed_usd REAL NOT NULL DEFAULT 0, overshoot_usd REAL NOT NULL DEFAULT 0);
    CREATE TABLE entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, description TEXT NOT NULL, reserved_usd REAL NOT NULL, actual_usd REAL, status TEXT NOT NULL, created_at TEXT NOT NULL);`);
  db.query('INSERT INTO runs VALUES (?, ?, ?, NULL, ?, NULL, ?, 0)').run(runId, 'synthetic', 10, '2026-01-05T00:00:00Z', amounts.reduce((a, b) => a + b, 0));
  amounts.forEach((a, i) => db.query('INSERT INTO entries (id, run_id, description, reserved_usd, actual_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('e' + i, runId, 'synthetic request', a, a, 'reconciled', '2026-01-05T00:00:01Z'));
  db.close();
  return readFileSync(path);
}
const usage = (runId: string, n: number) => Array.from({ length: n }, (_, i) => JSON.stringify({ at: '2026-01-05T00:00:0' + i + 'Z', key: `sk-trial-${runId}/cell/task/r${i}`, outcome: 'forwarded' })).join('\n') + '\n';

function repo(): { dir: string; root: string; g: (...a: string[]) => string; commit: (files: Record<string, string>, msg: string) => void } {
  const dir = mkdtempSync(join(tmp, 'repo-'));
  const root = mkdtempSync(join(tmp, 'private-root-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  const commit = (files: Record<string, string>, msg: string) => {
    for (const [f, body] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), body); g('add', f); }
    g('commit', '-q', '-m', msg);
  };
  mkdirSync(join(root, 'private/spend/runs', RUN_ID), { recursive: true });
  ledger(join(root, PINS.outputs[0]!.location), RUN_ID, [0.5, 0.25]);
  writeFileSync(join(root, PINS.outputs[1]!.location), usage(RUN_ID, 2));
  return { dir, root, g, commit };
}
/** A repository whose preregistration is committed, then its trials and its results attestation in a later commit. */
function finished() {
  const r = repo();
  r.commit({ [PREREG]: prereg(PINS) }, 'Preregister the synthetic billing run');
  const att = attest(PREREG, r.root, r.dir, new Date('2026-01-06T00:00:00Z'));
  r.commit({ [RUN_DIR + '/results/trials.jsonl']: JSON.stringify({ trial_id: RUN_ID + '/cell/task/r1', cell: 'cell' }) + '\n', [attestationPath(PREREG)]: JSON.stringify(att, null, 2) + '\n' }, 'Results');
  return { ...r, att };
}
const problems = (dir: string, entry: ManifestEntry = ENTRY) => checkPrivateByHash([entry], dir).map((p) => p.problem);

describe('the preregistration pins', () => {
  test('pins name run identity, billing protocol, cap, each private output and the verification procedure', () => {
    expect(parsePins(prereg(PINS))).toEqual({ pins: PINS, problems: [] });
  });

  test('a pin of any artifact hash is refused: the artifacts do not exist before the run', () => {
    const early = { ...PINS, outputs: [{ ...PINS.outputs[0]!, sha256: sha('not yet') }, PINS.outputs[1]!] };
    expect(parsePins(prereg(early)).problems).toEqual(['the private-by-hash block pins a sha256 before the run; artifact hashes go only in the results attestation, after the run']);
  });

  test('a missing field, an unknown schema, a location outside private/ and a second block are each refused', () => {
    const { cap_usd: _c, ...noCap } = PINS;
    expect(parsePins(prereg(noCap)).problems).toEqual(['the private-by-hash block needs cap_usd, a number above 0']);
    expect(parsePins(prereg({ ...PINS, outputs: [{ ...PINS.outputs[0]!, schema: 'csv/1' }] })).problems[0]).toContain('has schema "csv/1"');
    expect(parsePins(prereg({ ...PINS, outputs: [{ ...PINS.outputs[0]!, location: 'docs/benchmarks/x/ledger.sqlite' }] })).problems).toEqual(['output ledger needs a location under private/ in the private repository']);
    expect(parsePins(prereg({ ...PINS, outputs: [{ ...PINS.outputs[0]!, location: 'private/../docs/ledger.sqlite' }] })).problems).toEqual(['output ledger needs a location under private/ in the private repository']);
    expect(parsePins(prereg(PINS, prereg(PINS))).problems).toEqual(['the preregistration has 2 `json private-by-hash` blocks; it needs exactly one']);
  });
});

describe('CI check of a private-by-hash experiment', () => {
  test('a preregistered run with no trials yet passes; trials without an attestation fail', () => {
    const r = repo();
    r.commit({ [PREREG]: prereg(PINS) }, 'Preregister');
    expect(problems(r.dir)).toEqual([]);
    r.commit({ [RUN_DIR + '/results/trials.jsonl']: '{}\n' }, 'Trials');
    expect(problems(r.dir)).toEqual([`the run has trials but no ${attestationPath(PREREG)}`]);
  });

  test('a finished run with its attestation passes, and the receipts manifest lists the attested artifacts', () => {
    const r = finished();
    expect(problems(r.dir)).toEqual([]);
    expect(r.att.artifacts.map((a) => [a.name, a.rows])).toEqual([['ledger', 2], ['usage', 2]]);
    expect(JSON.stringify(r.att)).not.toMatch(/_usd/);
    const row = buildManifest(r.dir).runs[0]!;
    expect([row.result_class, row.private_artifacts!.map((a) => a.sha256)]).toEqual(['private-by-hash', r.att.artifacts.map((a) => a.sha256)]);
  });

  test('a preregistration changed after the attestation fails: the attestation is linked to the unchanged preregistration', () => {
    const r = finished();
    r.commit({ [PREREG]: prereg(PINS, '\nAn edit after the run.\n') }, 'Edit the preregistration');
    expect(problems(r.dir)).toEqual([
      `${attestationPath(PREREG)} attests a different preregistration: the preregistration changed after the run or the attestation names another file`,
      expect.stringContaining('but the preregistration was last changed in'),
      expect.stringContaining('not after the preregistration\'s last change'),
    ]);
  });

  test('an attestation committed with the preregistration, one that names other outputs, one that carries spend, and a committed ledger each fail', () => {
    const r = repo();
    r.commit({ [PREREG]: prereg(PINS) }, 'Preregister');
    const v1 = r.g('rev-parse', 'HEAD');
    const v2 = prereg(PINS, '\nChanged in the same commit as the attestation.\n');
    const together = { ...attest(PREREG, r.root, r.dir), preregistration_sha256: sha(v2) };
    r.commit({ [PREREG]: v2, [attestationPath(PREREG)]: JSON.stringify(together) }, 'Preregistration change and attestation together');
    const head = r.g('rev-parse', 'HEAD');
    expect(problems(r.dir)).toEqual([
      `${attestationPath(PREREG)} names preregistration commit ${v1.slice(0, 12)}, but the preregistration was last changed in ${head.slice(0, 12)}`,
      `${attestationPath(PREREG)} was added in ${head.slice(0, 12)}, not after the preregistration's last change ${head.slice(0, 12)}`,
    ]);

    const f = finished();
    const file = attestationPath(PREREG);
    f.commit({ [file]: JSON.stringify({ ...f.att, artifacts: [f.att.artifacts[0]], cap_usd: 1, artifacts_committed_usd: 0.75 }) }, 'Tamper');
    expect(problems(f.dir)).toEqual([
      `${file}'s artifacts are not exactly the outputs the preregistration pins (name, schema, location, in order)`,
      `${file} carries spend (cap_usd); spend stays in the private artifacts`,
      `${file} carries spend (artifacts_committed_usd); spend stays in the private artifacts`,
    ]);
    const g = finished();
    ledger(join(g.dir, RUN_DIR, 'results', 'ledger.sqlite'), RUN_ID, [0.5]);
    g.g('add', '-A'); g.g('commit', '-q', '-m', 'Commit the ledger by mistake');
    expect(problems(g.dir)).toEqual([`${RUN_DIR}/results/ledger.sqlite is committed; a private-by-hash run publishes its billing artifacts only by hash`]);
  });

  test('prereg.ts runs the check in both modes and fails on a broken attestation', () => {
    const r = finished();
    const ledger = { schema_version: 1, note: 'synthetic', label: ATTESTED, cutover: '2000-01-01T00:00:00.000Z', experiments: [] };
    const attestations = { schema_version: 1, note: 'synthetic', label: MAPPED, attestations: {}, exceptions: [] };
    r.commit({ 'docs/benchmarks/preregistrations.json': JSON.stringify({ schema_version: 1, experiments: [ENTRY] }), [LEDGER_PATH]: JSON.stringify(ledger), [ATTESTATION_MAP_PATH]: JSON.stringify(attestations) }, 'Register');
    const run = (...a: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, '..', 'runner', 'prereg', 'prereg.ts'), ...a], { cwd: r.dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp }, stdout: 'pipe', stderr: 'pipe' });
    const ok = run();
    expect([ok.exitCode, ok.stdout.toString()]).toEqual([0, expect.stringContaining('prereg-private-by-hash: 1 experiments, 0 problems')]);
    r.commit({ [attestationPath(PREREG)]: JSON.stringify({ ...r.att, run_id: 'another-run' }) }, 'Tamper');
    for (const mode of [[], ['--public']]) {
      const bad = run(...mode);
      expect([mode, bad.exitCode, bad.stderr.toString()]).toEqual([mode, 1, expect.stringContaining(`prereg-private-by-hash: ${RUN_ID}: ${attestationPath(PREREG)} names run another-run`)]);
    }
  });

  test('an experiment without the class is not checked, so already-public runs are unchanged', () => {
    const r = repo();
    r.commit({ [PREREG]: '# a public run\n', [RUN_DIR + '/results/trials.jsonl']: '{}\n' }, 'Public run');
    const { result_class: _rc, ...publicEntry } = ENTRY;
    expect(problems(r.dir, publicEntry)).toEqual([]);
  });

  test('an attestation for an experiment registered without the class fails, so the manifest and CI agree on the class', () => {
    const r = finished();
    const { result_class: _rc, ...publicEntry } = ENTRY;
    expect(problems(r.dir, publicEntry)).toEqual([`${attestationPath(PREREG)} exists, but the experiment is not registered with result_class private-by-hash`]);
  });

  test('a ledger or usage log committed anywhere in the run folder fails, not only under results/', () => {
    const r = finished();
    for (const d of ['smoke-measurement', 'probe']) mkdirSync(join(r.dir, RUN_DIR, d), { recursive: true });
    ledger(join(r.dir, RUN_DIR, 'smoke-measurement', 'cc-cli.ledger.sqlite'), RUN_ID, [0.5]);
    writeFileSync(join(r.dir, RUN_DIR, 'probe', 'probe-cc.proxy-usage.ndjson'), usage(RUN_ID, 1));
    r.g('add', '-A'); r.g('commit', '-q', '-m', 'Commit a smoke ledger and a probe log');
    expect(problems(r.dir)).toEqual([
      `${RUN_DIR}/probe/probe-cc.proxy-usage.ndjson is committed; a private-by-hash run publishes its billing artifacts only by hash`,
      `${RUN_DIR}/smoke-measurement/cc-cli.ledger.sqlite is committed; a private-by-hash run publishes its billing artifacts only by hash`,
    ]);
  });

  test('a ledger committed under a folder with a non-ASCII name fails too: paths are read unquoted', () => {
    const r = finished();
    mkdirSync(join(r.dir, RUN_DIR, 'probe-é'), { recursive: true });
    ledger(join(r.dir, RUN_DIR, 'probe-é', 'ledger.sqlite'), RUN_ID, [0.5]);
    r.g('add', '-A'); r.g('commit', '-q', '-m', 'Commit a ledger under a non-ASCII folder');
    expect(problems(r.dir)).toEqual([`${RUN_DIR}/probe-é/ledger.sqlite is committed; a private-by-hash run publishes its billing artifacts only by hash`]);
  });
});

describe('private verifier', () => {
  test('the attested ledger and usage log verify', () => {
    const r = finished();
    expect(verify(r.att, PINS, r.root)).toEqual([]);
  });

  test('an attestation that leaves out a pinned output, or names another location, is refused before any hash is read', () => {
    const r = finished();
    const refused = ['the attestation\'s artifacts are not exactly the outputs the preregistration pins (name, schema, location, in order); refusing it'];
    expect(verify({ ...r.att, artifacts: [r.att.artifacts[1]!] }, PINS, r.root)).toEqual(refused);
    expect(verify({ ...r.att, artifacts: [{ ...r.att.artifacts[0]!, location: 'private/spend/runs/other/ledger.sqlite' }, r.att.artifacts[1]!] }, PINS, r.root)).toEqual(refused);
  });

  test('a substituted ledger is refused by hash, even a well-formed one for the same run', () => {
    const r = finished();
    const path = join(r.root, PINS.outputs[0]!.location);
    const before = sha(readFileSync(path));
    const after = sha(ledger(path, RUN_ID, [0.5, 0.25, 0.01]));
    expect(verify(r.att, PINS, r.root)).toEqual([`ledger: ${PINS.outputs[0]!.location} hashes ${after.slice(0, 12)}, the attestation says ${before.slice(0, 12)}; refusing a substituted artifact`]);
  });

  test('a substituted usage log is refused by hash', () => {
    const r = finished();
    writeFileSync(join(r.root, PINS.outputs[1]!.location), usage(RUN_ID, 1));
    expect(verify(r.att, PINS, r.root)[0]).toContain('usage: ');
    expect(verify(r.att, PINS, r.root)[0]).toContain('refusing a substituted artifact');
  });

  test('a ledger and log of another run, re-attested by hash, fail the run identity, and a ledger over the cap fails', () => {
    const r = finished();
    const bytes = ledger(join(r.root, PINS.outputs[0]!.location), 'other-run-2026-01', [0.5, 0.25]);
    writeFileSync(join(r.root, PINS.outputs[1]!.location), usage('other-run-2026-01', 2));
    const swapped: ResultsAttestation = { ...r.att, artifacts: [{ ...r.att.artifacts[0]!, sha256: sha(bytes) }, { ...r.att.artifacts[1]!, sha256: sha(usage('other-run-2026-01', 2)) }] };
    expect(verify(swapped, PINS, r.root)).toEqual(['ledger: the ledger holds lease other-run-2026-01, not run synthetic-billing-2026-01', 'usage: line 1 belongs to another run', 'usage: line 2 belongs to another run']);
    const big = ledger(join(r.root, PINS.outputs[0]!.location), RUN_ID, [6, 6]);
    writeFileSync(join(r.root, PINS.outputs[1]!.location), usage(RUN_ID, 2));
    expect(verify({ ...r.att, artifacts: [{ ...r.att.artifacts[0]!, sha256: sha(big) }, r.att.artifacts[1]!] }, PINS, r.root)).toEqual(['the ledgers commit more than the preregistered cap']);
  });

  test('the CLI attests and verifies under a scrubbed environment, and exits 1 on a substituted ledger', () => {
    const r = repo();
    r.commit({ [PREREG]: prereg(PINS) }, 'Preregister');
    const cli = (...a: string[]) => Bun.spawnSync([process.execPath, join(import.meta.dir, '..', 'runner', 'prereg', 'private-by-hash.ts'), ...a], { cwd: r.dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, TMPDIR: tmp }, stdout: 'pipe', stderr: 'pipe' });
    const made = cli('attest', '--preregistration', PREREG, '--root', r.root);
    expect([made.exitCode, made.stdout.toString()]).toEqual([0, expect.stringContaining('private-by-hash: attested synthetic-billing-2026-01: ledger ')]);
    expect(cli('verify', '--preregistration', PREREG, '--root', r.root).exitCode).toBe(0);
    ledger(join(r.root, PINS.outputs[0]!.location), RUN_ID, [0.1]);
    const bad = cli('verify', '--preregistration', PREREG, '--root', r.root);
    expect([bad.exitCode, bad.stderr.toString()]).toEqual([1, expect.stringContaining('refusing a substituted artifact')]);
    expect(cli('verify').exitCode).toBe(2);
  });
});
