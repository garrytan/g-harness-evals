/**
 * The private-by-hash result class: a counted run whose billing artifacts (its lease ledger and its proxy usage log) stay
 * private, while everything else it publishes stays public (docs/private-by-hash.md).
 *
 * - The preregistration carries one fenced `json private-by-hash` block that pins, before the run: the run identity
 *   (run_id), the billing protocol, the cap, each private output (name, schema, location under private/ in the private
 *   repository) and the verification procedure. It never pins an artifact hash: those artifacts do not exist yet, so a
 *   64-hex value anywhere in the block fails the check.
 * - After the run, `attest` writes results/private-by-hash.json beside the preregistration: the run id, the
 *   preregistration's path, sha256 and last commit (the preregistration it attests, unchanged since), and per output its
 *   sha256 and row count. It carries no spend. receipts-manifest.ts lists these artifacts for the run.
 * - `checkPrivateByHash` runs with runner/prereg/prereg.ts in CI over every registered experiment of this class: the
 *   pins parse and pin no hash, a run with trials has an attestation, the attestation names the unchanged preregistration
 *   and was added after its last change, its artifacts are exactly the pinned outputs, and no ledger or usage log of the
 *   run is committed.
 * - `verify` runs in the private lane, where the artifacts are: the attestation must name exactly the pinned outputs, each file must hash to the attested sha256, so a
 *   substituted ledger or log is refused, and must match its schema, its row count and the run identity; the ledger's
 *   committed spend must be within the preregistered cap.
 *
 *   bun runner/prereg/private-by-hash.ts attest --preregistration <PREREGISTRATION.md> --root <private repository> [--out <file>]
 *   bun runner/prereg/private-by-hash.ts verify --preregistration <PREREGISTRATION.md> --root <private repository>
 *
 * Exit 0: done or verified. 1: a check failed. 2: usage error. It prints digests and counts, never spend.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PRIVATE_BY_HASH_FILE, ledgerSpend, readLedger } from '../../scripts/receipts-manifest.ts';
import { firstAddCommits, type ManifestEntry } from './prereg.ts';

export const RESULT_CLASS = 'private-by-hash';
export const ATTESTATION_SCHEMA = 'harness-evals-private-by-hash-attestation/1';
export const SCHEMAS = ['ledger-sqlite/1', 'proxy-usage-ndjson/1'] as const;
export type ArtifactSchema = (typeof SCHEMAS)[number];
export interface Output { name: string; schema: ArtifactSchema; location: string }
export interface Pins { run_id: string; billing_protocol: string; cap_usd: number; outputs: Output[]; verification: string }
export interface AttestedArtifact extends Output { sha256: string; rows: number }
export interface ResultsAttestation {
  schema: typeof ATTESTATION_SCHEMA;
  run_id: string;
  preregistration: string;
  preregistration_sha256: string;
  preregistration_commit: string;
  artifacts: AttestedArtifact[];
  attested_at: string;
}

const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const HEX64 = /\b[0-9a-f]{64}\b/i;
const BLOCK = /^```json private-by-hash\n([\s\S]*?)\n```$/gm;
const shape = (a: Output) => JSON.stringify([a.name, a.schema, a.location]);
const git = (cwd: string, args: string[]) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).trim(); } catch { return null; } };

/** The results attestation's path for a preregistration: results/private-by-hash.json in the same run folder. */
export const attestationPath = (preregistration: string) => join(dirname(preregistration), 'results', PRIVATE_BY_HASH_FILE);

/** The pins of a preregistration's private-by-hash block, with every problem found in them. */
export function parsePins(markdown: string): { pins: Pins | null; problems: string[] } {
  const blocks = [...markdown.matchAll(BLOCK)].map((m) => m[1]!);
  if (blocks.length !== 1) return { pins: null, problems: [`the preregistration has ${blocks.length} \`json private-by-hash\` blocks; it needs exactly one`] };
  if (HEX64.test(blocks[0]!)) return { pins: null, problems: ['the private-by-hash block pins a sha256 before the run; artifact hashes go only in the results attestation, after the run'] };
  let p: Partial<Pins>;
  try { p = JSON.parse(blocks[0]!) as Partial<Pins>; } catch (e) { return { pins: null, problems: [`the private-by-hash block is not JSON: ${(e as Error).message}`] }; }
  const problems: string[] = [];
  for (const k of ['run_id', 'billing_protocol', 'verification'] as const) if (typeof p[k] !== 'string' || !p[k]!.trim()) problems.push(`the private-by-hash block needs a non-empty ${k}`);
  if (typeof p.cap_usd !== 'number' || !(p.cap_usd > 0)) problems.push('the private-by-hash block needs cap_usd, a number above 0');
  if (!Array.isArray(p.outputs) || !p.outputs.length) problems.push('the private-by-hash block needs at least one output');
  for (const o of Array.isArray(p.outputs) ? p.outputs : []) {
    if (typeof o?.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(o.name)) problems.push(`output ${JSON.stringify(o?.name)} needs a lower-case name`);
    if (!(SCHEMAS as readonly string[]).includes(o?.schema)) problems.push(`output ${o?.name} has schema ${JSON.stringify(o?.schema)}; use one of ${SCHEMAS.join(', ')}`);
    if (typeof o?.location !== 'string' || !/^private\/[\w.\/-]+$/.test(o.location) || o.location.split('/').includes('..')) problems.push(`output ${o?.name} needs a location under private/ in the private repository`);
  }
  if (Array.isArray(p.outputs) && new Set(p.outputs.map((o) => o?.name)).size !== p.outputs.length) problems.push('two outputs share a name');
  return problems.length ? { pins: null, problems } : { pins: p as Pins, problems };
}

/** The keys of a JSON value whose name ends in _usd, at any depth. */
const spendKeys = (v: unknown, at = ''): string[] => !v || typeof v !== 'object' ? [] : Object.entries(v).flatMap(([k, x]) => [...(/_usd$/.test(k) ? [at + k] : []), ...spendKeys(x, at + k + '.')]);

/** CI's check of every registered private-by-hash experiment (see the file header). */
export function checkPrivateByHash(entries: ManifestEntry[], cwd = process.cwd(), adds: Map<string, string> = firstAddCommits(cwd)): Array<{ id: string; problem: string }> {
  const out: Array<{ id: string; problem: string }> = [];
  for (const e of entries.filter((x) => x.result_class !== RESULT_CLASS && existsSync(join(cwd, attestationPath(x.preregistration))))) out.push({ id: e.id, problem: `${attestationPath(e.preregistration)} exists, but the experiment is not registered with result_class ${RESULT_CLASS}` });
  for (const e of entries.filter((x) => x.result_class === RESULT_CLASS)) {
    const fail = (problem: string) => out.push({ id: e.id, problem });
    if (!existsSync(join(cwd, e.preregistration))) { fail(`${e.preregistration} does not exist`); continue; }
    const text = readFileSync(join(cwd, e.preregistration));
    const { pins, problems } = parsePins(text.toString('utf8'));
    problems.forEach(fail);
    const tracked = (git(cwd, ['ls-files', '-z', '--', dirname(e.preregistration)]) ?? '').split('\0').filter(Boolean);
    for (const f of tracked.filter((x) => /\.sqlite$/.test(x) || /(^|[./-])proxy-usage([.-][^/]*)?\.ndjson$/.test(x.slice(x.lastIndexOf('/') + 1)))) fail(`${f} is committed; a private-by-hash run publishes its billing artifacts only by hash`);
    const file = attestationPath(e.preregistration);
    if (!existsSync(join(cwd, file))) { if (tracked.some((x) => x.endsWith('/trials.jsonl'))) fail(`the run has trials but no ${file}`); continue; }
    let att: ResultsAttestation;
    try { att = JSON.parse(readFileSync(join(cwd, file), 'utf8')) as ResultsAttestation; } catch (err) { fail(`${file} is not JSON: ${(err as Error).message}`); continue; }
    if (att.schema !== ATTESTATION_SCHEMA) fail(`${file} has schema ${att.schema}, expected ${ATTESTATION_SCHEMA}`);
    if (att.preregistration !== e.preregistration) fail(`${file} attests ${att.preregistration}, expected ${e.preregistration}`);
    if (att.preregistration_sha256 !== sha256(text)) fail(`${file} attests a different preregistration: the preregistration changed after the run or the attestation names another file`);
    const last = git(cwd, ['log', '-1', '--format=%H', '--', e.preregistration]);
    if (att.preregistration_commit !== last) fail(`${file} names preregistration commit ${String(att.preregistration_commit).slice(0, 12)}, but the preregistration was last changed in ${String(last).slice(0, 12)}`);
    const added = adds.get(file);
    if (last && added && (added === last || git(cwd, ['merge-base', '--is-ancestor', last, added]) === null)) fail(`${file} was added in ${added.slice(0, 12)}, not after the preregistration's last change ${last.slice(0, 12)}`);
    if (pins && att.run_id !== pins.run_id) fail(`${file} names run ${att.run_id}, the preregistration pins ${pins.run_id}`);
    if (pins && JSON.stringify((att.artifacts ?? []).map(shape)) !== JSON.stringify(pins.outputs.map(shape))) fail(`${file}'s artifacts are not exactly the outputs the preregistration pins (name, schema, location, in order)`);
    for (const a of att.artifacts ?? []) if (!/^[0-9a-f]{64}$/.test(a.sha256) || !Number.isInteger(a.rows) || a.rows < 0) fail(`${file}: artifact ${a.name} needs a sha256 and a row count`);
    for (const k of spendKeys(att)) fail(`${file} carries spend (${k}); spend stays in the private artifacts`);
  }
  return out;
}

/** Row count, with every schema and identity problem, of one private artifact's bytes. Spend is the ledger's committed spend. */
export function inspect(schema: ArtifactSchema, bytes: Buffer, runId: string): { rows: number; problems: string[]; committed_usd?: number } {
  if (schema === 'ledger-sqlite/1') {
    const read = readLedger('', bytes);
    if (read.read_error !== null) return { rows: 0, problems: [`not a lease ledger: ${read.read_error}`] };
    const problems: string[] = [];
    if (!read.leases!.length) problems.push('the ledger has no lease');
    for (const l of read.leases!) if (l.run_id !== runId && !l.run_id.startsWith(runId + '-')) problems.push(`the ledger holds lease ${l.run_id}, not run ${runId}`);
    return { rows: read.requests!, problems, committed_usd: ledgerSpend(bytes).committed_usd };
  }
  const lines = bytes.toString('utf8').split('\n').filter((l) => l.trim());
  const problems: string[] = [];
  lines.forEach((l, i) => {
    let row: { at?: unknown; key?: unknown };
    try { row = JSON.parse(l) as typeof row; } catch { problems.push(`line ${i + 1} is not JSON`); return; }
    if (typeof row.at !== 'string' || typeof row.key !== 'string') problems.push(`line ${i + 1} needs string at and key`);
    else if (!row.key.includes(runId + '/')) problems.push(`line ${i + 1} belongs to another run`);
  });
  return { rows: lines.length, problems };
}

/** The private lane's check: every attested artifact under root hashes, parses and counts as attested, and the ledgers stay within the cap. */
export function verify(att: ResultsAttestation, pins: Pins, root: string): string[] {
  if (JSON.stringify((att.artifacts ?? []).map(shape)) !== JSON.stringify(pins.outputs.map(shape))) return ['the attestation\'s artifacts are not exactly the outputs the preregistration pins (name, schema, location, in order); refusing it'];
  const problems: string[] = [];
  let committed = 0;
  for (const a of att.artifacts) {
    const path = join(root, a.location);
    if (!existsSync(path)) { problems.push(`${a.name}: ${a.location} is missing`); continue; }
    const bytes = readFileSync(path);
    const actual = sha256(bytes);
    if (actual !== a.sha256) { problems.push(`${a.name}: ${a.location} hashes ${actual.slice(0, 12)}, the attestation says ${a.sha256.slice(0, 12)}; refusing a substituted artifact`); continue; }
    const r = inspect(a.schema, bytes, pins.run_id);
    problems.push(...r.problems.map((p) => `${a.name}: ${p}`));
    if (r.rows !== a.rows) problems.push(`${a.name}: ${r.rows} rows, the attestation says ${a.rows}`);
    committed += r.committed_usd ?? 0;
  }
  if (committed > pins.cap_usd + 1e-9) problems.push('the ledgers commit more than the preregistered cap');
  return problems;
}

/** The results attestation for a finished run: the pinned outputs read from root, checked against their schema and the run identity. */
export function attest(preregistration: string, root: string, cwd = process.cwd(), now = new Date()): ResultsAttestation {
  const text = readFileSync(join(cwd, preregistration));
  const { pins, problems } = parsePins(text.toString('utf8'));
  if (!pins) throw new Error(problems.join('; '));
  const commit = git(cwd, ['log', '-1', '--format=%H', '--', preregistration]);
  if (!commit) throw new Error(`${preregistration} is not committed`);
  if (git(cwd, ['status', '--porcelain', '--', preregistration])) throw new Error(`${preregistration} has uncommitted changes`);
  const artifacts = pins.outputs.map((o) => {
    const path = join(root, o.location);
    if (!existsSync(path)) throw new Error(`${o.name}: ${o.location} is missing under ${root}`);
    const bytes = readFileSync(path);
    const r = inspect(o.schema, bytes, pins.run_id);
    if (r.problems.length) throw new Error(`${o.name}: ${r.problems.join('; ')}`);
    return { ...o, sha256: sha256(bytes), rows: r.rows };
  });
  return { schema: ATTESTATION_SCHEMA, run_id: pins.run_id, preregistration, preregistration_sha256: sha256(text), preregistration_commit: commit, artifacts, attested_at: now.toISOString() };
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  const prereg = flag('preregistration'), root = flag('root');
  if (!['attest', 'verify'].includes(cmd ?? '') || !prereg || !root) { console.error('usage: private-by-hash.ts attest|verify --preregistration <PREREGISTRATION.md> --root <private repository> [--out <file>]'); process.exit(2); }
  try {
    if (cmd === 'attest') {
      const att = attest(prereg, resolve(root));
      const out = resolve(flag('out') ?? attestationPath(prereg));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out + '.tmp', JSON.stringify(att, null, 2) + '\n');
      renameSync(out + '.tmp', out);
      console.log(`private-by-hash: attested ${att.run_id}: ${att.artifacts.map((a) => `${a.name} ${a.sha256.slice(0, 12)} (${a.rows} rows)`).join(', ')}`);
    } else {
      const { pins, problems } = parsePins(readFileSync(prereg, 'utf8'));
      if (!pins) throw new Error(problems.join('; '));
      const att = JSON.parse(readFileSync(attestationPath(prereg), 'utf8')) as ResultsAttestation;
      const found = att.run_id !== pins.run_id ? [`the attestation names run ${att.run_id}, the preregistration pins ${pins.run_id}`] : verify(att, pins, resolve(root));
      for (const p of found) console.error(`private-by-hash: ${p}`);
      console.log(`private-by-hash: ${att.run_id}: ${att.artifacts.length} artifacts, ${found.length} problems`);
      process.exit(found.length ? 1 : 0);
    }
  } catch (e) { console.error(`private-by-hash: ${(e as Error).message}`); process.exit(1); }
}
