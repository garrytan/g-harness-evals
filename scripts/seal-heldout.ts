// Seal the held-out task bodies: write <set>/MANIFEST.json with the sha256 of every file under the set's held-out
// tree (the manifest itself excluded), the world seed manifest hash the tasks were authored against, and the
// generation time. tests/heldout-manifest.test.ts fails when a tree and its manifest disagree, so a change to a
// held-out task is visible in review and in the receipts.
//
// internal-task: the manifest also carries the set's openings ledger: opening_budget (confirmatory openings allowed),
// alpha_per_opening, status (open, spent, retired), openings[] (one row per registered experiment that runs a held-out
// cell of the set: run_id, status, label, reason, candidate_sha256) and exposures[] (access that is not a run). The
// ledger stores no opening numbers; runner/heldout/openings.ts derives them from preregistration order on main. The
// ledger sits outside the tree digest, so editing it never changes tree_sha256, and resealing carries it through.
//
// internal-task phase 3: a set can be held in sealed custody (docs/sealed-custody.md). Its held-out directory then holds only
// MANIFEST.json with "custody": "sealed" and a "sealed" block of commitments (bundle_sha256, world_slice_sha256,
// heldout_corpus_sha256, task_count, the age recipient and the bundle's path on the custody branch); tree_sha256 is the
// digest the plaintext tree had when scripts/sealed/seal.ts sealed it, and files and tasks stay empty so no task name is
// public. --check verifies a sealed set keyless: the commitments are present and well formed and no plaintext is in the
// tree. Resealing a sealed set goes through scripts/sealed/seal.ts, never this script.
//
// Task sets: v0.1 is tasks/multiuser/heldout (the default); any other set name is tasks/multiuser/<set>/heldout.
//
//   bun scripts/seal-heldout.ts [--task-set v0.2]    write that set's manifest
//   bun scripts/seal-heldout.ts --check              check every sealed set, and refuse an unsealed tree; exit 1 on any problem
//   bun scripts/seal-heldout.ts --check --task-set v0.2   check one set

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const WORLD_MANIFEST = join(ROOT, 'world', 'seed', 'MANIFEST.json');
export const DEFAULT_SET = 'v0.1';

export interface HeldoutSet {
  name: string;
  /** The held-out directory of the set. */
  dir: string;
  /** <dir>/MANIFEST.json. */
  manifest: string;
}

export const OPENING_STATUSES = ['planned', 'opened', 'withdrawn', 'superseded'] as const;
export const OPENING_LABELS = ['confirmatory', 'dev'] as const;
export const SET_STATUSES = ['open', 'spent', 'retired'] as const;

/** One registered experiment that runs a held-out cell of the set. No opening number: runner/heldout/openings.ts derives it. */
export interface OpeningRow {
  run_id: string;
  /** planned (registered, no counted trial yet), opened, withdrawn or superseded (listed, never counted). */
  status: (typeof OPENING_STATUSES)[number];
  label: (typeof OPENING_LABELS)[number];
  /** Required for a dev, withdrawn or superseded row: why this opening is not confirmatory, or why it never opened. */
  reason?: string;
  /** sha256 of the candidate (gbrain commit, preamble, adapter config); null for rows backfilled before internal-task. */
  candidate_sha256: string | null;
}

/** Access to the set that is not a run: committed transcripts, held-out-derived content sent to a system under test. */
export interface Exposure {
  date: string;
  kind: string;
  recipient: string;
  what: string;
  source: string;
}

/** The openings ledger, outside the tree digest. */
export interface OpeningsLedger {
  opening_budget: number;
  alpha_per_opening: number;
  status: (typeof SET_STATUSES)[number];
  openings: OpeningRow[];
  exposures: Exposure[];
}

/** The public commitments of a sealed set (scripts/sealed/seal.ts writes them; scripts/sealed/open.ts and runner/run.ts check them). */
export interface SealedCommitments {
  /** sha256 of the age ciphertext of the bundle (a reproducible tar of the task tree, the world slice and its corpus pages). */
  bundle_sha256: string;
  /** sha256 of the bundle's world/slice.json: the set's held-out world records. */
  world_slice_sha256: string;
  /** Digest of the bundle's corpus/ pages, as runner/heldout/sealed.ts corpusDigest computes it (the gbrain image checks the same). */
  heldout_corpus_sha256: string;
  task_count: number;
  /** The public age recipient (age1...) the bundle is encrypted to (sealed/recipient.txt when sealed). */
  recipient: string;
  /** The private repository and the ref (refs/heads/custody) holding the ciphertext, the escrow and the access log, and the bundle's path there. */
  custody_repo: string;
  custody_ref: string;
  bundle: string;
  sealed_at: string;
  /** Extra files the bundle carries under extras/ (seal.ts --include), each bundle path to the sha256 of its bytes. */
  extras?: Record<string, string>;
}

export interface HeldoutManifest extends Partial<OpeningsLedger> {
  schema_version: 1;
  /** Absent for a plaintext set; "sealed" when the set is held in sealed custody. */
  custody?: 'sealed';
  sealed?: SealedCommitments;
  generated_at: string;
  world_manifest_sha256: string;
  world_json_sha256: string;
  tasks: string[];
  files: Record<string, string>;
  tree_sha256: string;
}

const LEDGER_KEYS = ['opening_budget', 'alpha_per_opening', 'status', 'openings', 'exposures'] as const;

/** The held-out directory and manifest path of a task set, under the repository at root. */
export function heldoutSet(name = DEFAULT_SET, root = ROOT): HeldoutSet {
  const multiuser = join(root, 'tasks', 'multiuser');
  const dir = name === DEFAULT_SET ? join(multiuser, 'heldout') : join(multiuser, name, 'heldout');
  return { name, dir, manifest: join(dir, 'MANIFEST.json') };
}

/** Every task set with a held-out tree: v0.1 and each tasks/multiuser/<set>/heldout that exists. */
export function heldoutSets(root = ROOT): HeldoutSet[] {
  const multiuser = join(root, 'tasks', 'multiuser');
  if (!existsSync(multiuser)) return [];
  const named = readdirSync(multiuser, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !['dev', 'heldout', '_shared'].includes(d.name) && existsSync(join(multiuser, d.name, 'heldout')))
    .map((d) => d.name).sort();
  return [heldoutSet(DEFAULT_SET, root), ...named.map((n) => heldoutSet(n, root))];
}

/** The openings ledger of a manifest, or undefined when the set has none yet. */
export function openingsLedger(m: HeldoutManifest | undefined): OpeningsLedger | undefined {
  if (!m || m.opening_budget === undefined) return undefined;
  return { opening_budget: m.opening_budget, alpha_per_opening: m.alpha_per_opening!, status: m.status!, openings: m.openings ?? [], exposures: m.exposures ?? [] };
}

/** Shape problems of a manifest's openings ledger, empty when it has none or it is well formed. */
export function ledgerProblems(m: HeldoutManifest): string[] {
  const present = LEDGER_KEYS.filter((k) => m[k] !== undefined);
  if (!present.length) return [];
  const problems: string[] = [];
  for (const k of LEDGER_KEYS) if (m[k] === undefined) problems.push(`openings ledger: ${k} is missing (a ledger has all of ${LEDGER_KEYS.join(', ')})`);
  if (m.opening_budget !== undefined && !(Number.isInteger(m.opening_budget) && m.opening_budget >= 0)) problems.push(`openings ledger: opening_budget must be a whole number >= 0 (got ${JSON.stringify(m.opening_budget)})`);
  if (m.alpha_per_opening !== undefined && !(typeof m.alpha_per_opening === 'number' && m.alpha_per_opening > 0 && m.alpha_per_opening < 1)) problems.push(`openings ledger: alpha_per_opening must be between 0 and 1 (got ${JSON.stringify(m.alpha_per_opening)})`);
  if (m.status !== undefined && !(SET_STATUSES as readonly string[]).includes(m.status)) problems.push(`openings ledger: status must be one of ${SET_STATUSES.join(', ')} (got ${JSON.stringify(m.status)})`);
  const seen = new Set<string>();
  for (const [i, row] of (Array.isArray(m.openings) ? m.openings : []).entries()) {
    const at = `openings[${i}] (${row?.run_id ?? 'no run_id'})`;
    if (typeof row?.run_id !== 'string' || !row.run_id) { problems.push(`openings ledger: ${at}: run_id is missing`); continue; }
    if (seen.has(row.run_id)) problems.push(`openings ledger: ${at}: run_id appears twice`);
    seen.add(row.run_id);
    if (!(OPENING_STATUSES as readonly string[]).includes(row.status)) problems.push(`openings ledger: ${at}: status must be one of ${OPENING_STATUSES.join(', ')} (got ${JSON.stringify(row.status)})`);
    if (!(OPENING_LABELS as readonly string[]).includes(row.label)) problems.push(`openings ledger: ${at}: label must be one of ${OPENING_LABELS.join(', ')} (got ${JSON.stringify(row.label)})`);
    const needsReason = row.label === 'dev' || row.status === 'withdrawn' || row.status === 'superseded';
    if (needsReason && !(typeof row.reason === 'string' && row.reason.trim())) problems.push(`openings ledger: ${at}: a ${row.label === 'dev' ? 'dev' : row.status} row needs a reason`);
    if (row.candidate_sha256 !== null && !(typeof row.candidate_sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.candidate_sha256))) problems.push(`openings ledger: ${at}: candidate_sha256 must be 64 hex characters or null (got ${JSON.stringify(row.candidate_sha256)})`);
  }
  if (m.openings !== undefined && !Array.isArray(m.openings)) problems.push('openings ledger: openings must be a list');
  for (const [i, e] of (Array.isArray(m.exposures) ? m.exposures : []).entries()) {
    for (const k of ['date', 'kind', 'recipient', 'what', 'source'] as const) if (!(typeof e?.[k] === 'string' && e[k].trim())) problems.push(`openings ledger: exposures[${i}]: ${k} is missing`);
    if (typeof e?.date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) problems.push(`openings ledger: exposures[${i}]: date must be YYYY-MM-DD (got ${e.date})`);
  }
  if (m.exposures !== undefined && !Array.isArray(m.exposures)) problems.push('openings ledger: exposures must be a list');
  return problems;
}

export const HELDOUT_DIR = heldoutSet().dir;
export const MANIFEST_PATH = heldoutSet().manifest;

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (statSync(p).isFile()) out.push(p);
  }
  return out;
}

/** The task directories under a held-out tree (those with a task.toml). */
export function heldoutTasks(set: HeldoutSet = heldoutSet()): string[] {
  if (!existsSync(set.dir)) return [];
  return readdirSync(set.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(set.dir, d.name, 'task.toml'))).map((d) => d.name).sort();
}

/** sha256 of every file under dir (relative path to digest, in walk order), and the tree digest over them: the digest a
 *  held-out MANIFEST.json records as tree_sha256. `skip` leaves one absolute path out (the manifest itself). */
export function treeFiles(dir: string, skip?: string): { files: Record<string, string>; tree_sha256: string } {
  const files: Record<string, string> = {};
  for (const p of existsSync(dir) ? walk(dir) : []) {
    if (p === skip) continue;
    files[relative(dir, p)] = sha256(readFileSync(p));
  }
  return { files, tree_sha256: sha256(Object.entries(files).map(([k, v]) => `${v}  ${k}`).join('\n')) };
}

export const isSealed = (m: HeldoutManifest | undefined): boolean => m?.custody === 'sealed';

/** Problems of a sealed set's manifest and tree, keyless: the commitments are present and well formed, the public manifest
 *  names no file or task, and the held-out directory holds nothing but MANIFEST.json. */
export function sealedProblems(m: HeldoutManifest, set: HeldoutSet): string[] {
  const problems: string[] = [];
  const hex = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const s = m.sealed;
  if (!s || typeof s !== 'object') return ['custody is "sealed" but the manifest has no "sealed" block of commitments (scripts/sealed/seal.ts writes it)'];
  for (const k of ['bundle_sha256', 'world_slice_sha256', 'heldout_corpus_sha256'] as const) if (!hex(s[k])) problems.push(`sealed.${k} must be 64 hex characters (got ${JSON.stringify(s[k])})`);
  if (!hex(m.tree_sha256)) problems.push(`tree_sha256 must be the 64-hex digest of the plaintext tree at sealing (got ${JSON.stringify(m.tree_sha256)})`);
  if (!(Number.isInteger(s.task_count) && s.task_count > 0)) problems.push(`sealed.task_count must be a whole number above 0 (got ${JSON.stringify(s.task_count)})`);
  if (!(typeof s.recipient === 'string' && /^age1[0-9a-z]+$/.test(s.recipient))) problems.push('sealed.recipient must be a public age recipient (age1...)');
  if (!(typeof s.custody_repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(s.custody_repo))) problems.push(`sealed.custody_repo must be owner/repo (got ${JSON.stringify(s.custody_repo)})`);
  if (s.custody_ref !== 'refs/heads/custody') problems.push(`sealed.custody_ref must be refs/heads/custody, the custody branch, never the public main (got ${JSON.stringify(s.custody_ref)})`);
  if (!(typeof s.bundle === 'string' && s.bundle.endsWith('.age') && !s.bundle.startsWith('/') && !s.bundle.split('/').includes('..'))) problems.push(`sealed.bundle must be a relative path ending in .age on the custody branch (got ${JSON.stringify(s.bundle)})`);
  if (s.extras !== undefined && !(s.extras && typeof s.extras === 'object' && !Array.isArray(s.extras) && Object.entries(s.extras).every(([p, h]) => /^extras\/[\x20-\x7e]+$/.test(p) && !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') && hex(h)))) problems.push('sealed.extras must map bundle paths under extras/ to 64-hex sha256 digests');
  if (Object.keys(m.files ?? {}).length || (m.tasks ?? []).length) problems.push('a sealed manifest lists no files and no tasks (files {} and tasks []); the names are part of the sealed bundle');
  const plaintext = (existsSync(set.dir) ? walk(set.dir) : []).filter((p) => p !== set.manifest);
  if (plaintext.length) problems.push(`plaintext in a sealed set: ${plaintext.length} file(s) beside MANIFEST.json under ${relative(ROOT, set.dir)}; a sealed set's tasks live only in the encrypted bundle`);
  return problems;
}

/** The manifest the current tree would produce; `generated_at` is taken from `previous` when the content is unchanged. */
export function buildManifest(previous?: HeldoutManifest, set: HeldoutSet = heldoutSet()): HeldoutManifest {
  const { files, tree_sha256: tree } = treeFiles(set.dir, set.manifest);
  const worldManifest = readFileSync(WORLD_MANIFEST, 'utf8');
  const worldJsonSha = (JSON.parse(worldManifest) as { world_json_sha256?: string }).world_json_sha256 ?? '';
  const tasks = [...new Set(Object.keys(files).map((f) => f.split('/')[0]!))].filter((d) => files[`${d}/task.toml`]);
  const unchanged = previous && previous.tree_sha256 === tree && previous.world_manifest_sha256 === sha256(worldManifest);
  const ledger = Object.fromEntries(LEDGER_KEYS.filter((k) => previous?.[k] !== undefined).map((k) => [k, previous![k]]));
  return {
    schema_version: 1,
    generated_at: unchanged ? previous.generated_at : new Date().toISOString(),
    world_manifest_sha256: sha256(worldManifest),
    world_json_sha256: worldJsonSha,
    tasks,
    files,
    tree_sha256: tree,
    ...ledger,
  };
}

export function readManifest(set: HeldoutSet = heldoutSet()): HeldoutManifest | undefined {
  try {
    return JSON.parse(readFileSync(set.manifest, 'utf8')) as HeldoutManifest;
  } catch {
    return undefined;
  }
}

/** Differences between the committed manifest and the tree, empty when sealed. A tree that holds tasks but no
 *  manifest is unsealed and is a problem; a set with no held-out tree at all is not. */
export function manifestProblems(set: HeldoutSet = heldoutSet()): string[] {
  const committed = readManifest(set);
  const rel = relative(ROOT, set.manifest);
  if (!committed) {
    const n = heldoutTasks(set).length;
    return n ? [`unsealed: ${relative(ROOT, set.dir)} (${n} tasks) has no MANIFEST.json; run bun scripts/seal-heldout.ts${set.name === DEFAULT_SET ? '' : ` --task-set ${set.name}`}`] : [`${rel} is missing; run bun scripts/seal-heldout.ts${set.name === DEFAULT_SET ? '' : ` --task-set ${set.name}`}`];
  }
  if (committed.custody !== undefined && committed.custody !== 'sealed') return [`custody must be "sealed" or absent (got ${JSON.stringify(committed.custody)})`];
  if (isSealed(committed)) {
    const problems = sealedProblems(committed, set);
    if (committed.world_manifest_sha256 !== sha256(readFileSync(WORLD_MANIFEST, 'utf8'))) problems.push('world/seed/MANIFEST.json changed since sealing (the sealed slice is merged into the public world when a set is opened)');
    return [...problems, ...ledgerProblems(committed)];
  }
  const current = buildManifest(committed, set);
  const problems: string[] = [];
  for (const [f, h] of Object.entries(current.files)) {
    if (!committed.files[f]) problems.push(`${f}: not in the manifest`);
    else if (committed.files[f] !== h) problems.push(`${f}: sha256 changed`);
  }
  for (const f of Object.keys(committed.files)) if (!current.files[f]) problems.push(`${f}: in the manifest but not in the tree`);
  if (committed.world_manifest_sha256 !== current.world_manifest_sha256) problems.push('world/seed/MANIFEST.json changed since sealing');
  if (committed.tree_sha256 !== current.tree_sha256) problems.push('tree_sha256 differs');
  problems.push(...ledgerProblems(committed));
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--task-set');
  const setName = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && !setName) { console.error('HE-TASK-SEAL: --task-set wants a set name, for example --task-set v0.2'); process.exit(1); }
  const known = heldoutSets();
  if (setName && !known.some((s) => s.name === setName)) {
    console.error(`HE-TASK-SEAL: unknown task set "${setName}"; looked for ${relative(ROOT, heldoutSet(setName).dir)}/; known sets: ${known.map((s) => s.name).join(', ')} (v0.1 is tasks/multiuser/heldout)`);
    process.exit(1);
  }
  const sets = setName ? [heldoutSet(setName)] : known;
  if (argv.includes('--check')) {
    let failed = false;
    for (const set of sets) {
      const problems = manifestProblems(set);
      if (problems.length) {
        failed = true;
        console.error(`HE-TASK-SEAL: held-out manifest for set ${set.name} does not match the tree:\n  ` + problems.join('\n  '));
        continue;
      }
      const m = readManifest(set)!;
      const ledger = openingsLedger(m);
      const ledgerText = ledger ? `; openings ledger: status ${ledger.status}, budget ${ledger.opening_budget}, ${ledger.openings.length} rows, ${ledger.exposures.length} exposures` : '';
      if (isSealed(m)) console.log(`sealed set matches (set ${set.name}): commitments present (${m.sealed!.task_count} tasks, bundle ${m.sealed!.bundle_sha256.slice(0, 12)}, tree ${m.tree_sha256.slice(0, 12)}), no plaintext in the tree${ledgerText}`);
      else console.log(`held-out manifest matches (set ${set.name}): ${Object.keys(m.files).length} files, ${m.tasks.length} tasks${ledgerText}`);
    }
    if (failed) process.exit(1);
  } else {
    const set = sets[0]!;
    if (isSealed(readManifest(set))) { console.error(`HE-TASK-SEAL: set ${set.name} is in sealed custody; its manifest is written by scripts/sealed/seal.ts from the plaintext outside the checkout (docs/sealed-custody.md)`); process.exit(1); }
    const manifest = buildManifest(readManifest(set), set);
    writeFileSync(set.manifest, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`sealed ${manifest.tasks.length} held-out tasks (set ${set.name}), ${Object.keys(manifest.files).length} files, tree ${manifest.tree_sha256.slice(0, 12)}`);
  }
}
