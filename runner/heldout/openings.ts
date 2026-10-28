/**
 * Held-out openings: the one place opening numbers come from (internal-task).
 *
 * A held-out set's MANIFEST.json carries an openings ledger (scripts/seal-heldout.ts): a budget of confirmatory
 * openings, the set's status, one row per registered experiment that runs a held-out cell of the set (run id, status,
 * label, reason, candidate hash) and the exposures that are not runs. The ledger stores no opening numbers. This module
 * derives them: openings are ordered by the commit that first added each experiment's preregistration on main's
 * first-parent history (up to the checkout's merge base with origin/main, or main); the preregistrations a pull request
 * adds after that merge base come next, at one position as its squash merge will put them, ties broken by run id.
 * Withdrawn and superseded rows (registrations that never ran a trial) are listed but not counted, and every counted
 * row gets its number and, when confirmatory, its place in the budget.
 *
 * Three callers:
 * - `checkPlan` from `runner/run.ts plan` and `dry-run`: refuses a held-out run with HE-HELDOUT-001 to 004
 *   (docs/errors.md). A run's own row is accepted every time it is planned while it is opened or its set is open (CI
 *   keeps a planned confirmatory row off a set that is not open), so shard planning and resume pass; a
 *   preregistration committed before internal-task is on the digest-bound legacy list (legacy-preregistrations.json) and is
 *   matched to its backfilled row whatever the budget says.
 * - `checkOpenings` from `runner/prereg/prereg.ts`, which CI runs on every pull request and on every push to main with
 *   full history: two pull requests that each passed alone and together leave main over budget turn the push run on
 *   main red after the second merge, naming the later run.
 * - `deriveSet` from `scripts/receipts-manifest.ts`, which records each run's set, number and label.
 *
 *   bun runner/heldout/openings.ts      print every set's derived openings
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { RunnerError } from '../errors.ts';
import { loadManifest as loadRegistry } from '../prereg/prereg.ts';
import { DEFAULT_SET, heldoutSet, heldoutSets, openingsLedger, readManifest, type OpeningRow, type OpeningsLedger } from '../../scripts/seal-heldout.ts';

/** The block a preregistration made after internal-task carries when any of its cells runs a held-out split. */
export interface HeldoutBlock {
  set: string;
  label: 'confirmatory' | 'dev';
  reason?: string;
  candidate_sha256: string;
}

interface PreregLike {
  run_id: string;
  cells: Array<{ id?: string; slice?: string; split: string; task_set?: string; tasks?: string[]; preamble?: string }>;
  tasks?: Record<string, string[]>;
  heldout?: HeldoutBlock;
}

export interface LegacyEntry {
  run_id: string;
  set: string;
  prereg_json: string;
  sha256: string[];
}

export interface RegisteredHeldout {
  id: string;
  preregistration: string;
  prereg_json: string;
  run_id: string;
  sha256: string;
  sets: string[];
  heldout?: HeldoutBlock;
}

export interface DerivedOpening {
  run_id: string;
  status: OpeningRow['status'];
  label: OpeningRow['label'];
  reason: string | null;
  /** 1-based among counted rows (planned or opened) in preregistration order; null for withdrawn and superseded rows. */
  number: number | null;
  /** 1-based among counted confirmatory rows; null otherwise. Above the budget is over budget. */
  confirmatory_rank: number | null;
  /** The first-parent commit that first added the experiment's preregistration; null when it is not registered or not committed. */
  prereg_commit: string | null;
}

export interface DerivedSet {
  set: string;
  ledger: OpeningsLedger;
  openings: DerivedOpening[];
  confirmatory_used: number;
}

type Order = Map<string, { commit: string; position: number }>;

const COUNTED = new Set<OpeningRow['status']>(['planned', 'opened']);
const SPLITS = new Set(['dev', 'heldout']);
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * A cell that could reach held-out content without saying so: a split other than dev or heldout, a task id that is a
 * path (in cell.tasks, or the top-level tasks list the runner falls back to), or a preamble inside a held-out tree.
 */
export function cellProblem(prereg: PreregLike): string | null {
  for (const c of prereg.cells ?? []) {
    if (!SPLITS.has(c.split)) return `run ${prereg.run_id}: cell ${c.id ?? '?'} has split ${JSON.stringify(c.split)}; a cell's split is "dev" or "heldout"`;
    const fallback = c.slice !== undefined ? prereg.tasks?.[c.slice] : undefined;
    const tasks = c.tasks?.length ? c.tasks : Array.isArray(fallback) ? fallback : [];
    if (typeof c.preamble === 'string' && /(^|\/)heldout(\/|$)/.test(normalize(c.preamble))) return `run ${prereg.run_id}: cell ${c.id ?? '?'} reads its preamble from ${JSON.stringify(c.preamble)}, inside a held-out tree; a preamble never comes from held-out tasks`;
    const bad = tasks.find((t) => typeof t !== 'string' || !TASK_ID.test(t) || t.includes('..'));
    if (bad !== undefined) return `run ${prereg.run_id}: cell ${c.id ?? '?'} names task ${JSON.stringify(bad)}, which is not a task id; a task id names one directory of the cell's split, never a path`;
  }
  return null;
}

/** The first problem with a heldout block made after internal-task, as the code and message plan throws and CI lists. */
function blockProblem(prereg: PreregLike, sets: string[]): { code: string; message: string } | null {
  const block = prereg.heldout;
  const id = prereg.run_id;
  if (!block || typeof block !== 'object') return { code: 'HE-HELDOUT-001', message: `run ${id} has held-out cells of set ${sets.join(', ')} and no heldout block; fix: add "heldout": {"set": "${sets[0]}", "label": "confirmatory" or "dev", "reason": "<required for dev>", "candidate_sha256": "<sha256 of the candidate>"} to the preregistration, and its row to the set's MANIFEST.json openings ledger, in the same pull request (docs/methodology.md item 13)` };
  if (sets.length !== 1 || block.set !== sets[0]) return { code: 'HE-HELDOUT-001', message: `run ${id}: heldout.set is ${JSON.stringify(block.set)} but its held-out cells run ${sets.join(', ')}; one run opens one held-out set. fix: name the set the cells run, or split the run` };
  if (block.label !== 'confirmatory' && block.label !== 'dev') return { code: 'HE-HELDOUT-001', message: `run ${id}: heldout.label must be "confirmatory" or "dev" (got ${JSON.stringify(block.label)})` };
  if (typeof block.candidate_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(block.candidate_sha256)) return { code: 'HE-HELDOUT-001', message: `run ${id}: heldout.candidate_sha256 must be the 64-hex sha256 of the candidate (docs/methodology.md item 14, R5); got ${JSON.stringify(block.candidate_sha256)}` };
  if (block.label === 'dev' && !(typeof block.reason === 'string' && block.reason.trim())) return { code: 'HE-HELDOUT-004', message: `run ${id} is a dev opening of set ${block.set} with no reason; fix: say why it is not confirmatory in heldout.reason and in its ledger row (for example "later opening", "revise-then-retest", "in-sample for <change>")` };
  return null;
}

/** The held-out sets a preregistration's cells run, sorted. */
export function heldoutSetsOf(prereg: Pick<PreregLike, 'cells'>): string[] {
  return [...new Set(prereg.cells.filter((c) => c.split === 'heldout').map((c) => c.task_set ?? DEFAULT_SET))].sort();
}

export function legacyList(): LegacyEntry[] {
  return (JSON.parse(readFileSync(join(import.meta.dir, 'legacy-preregistrations.json'), 'utf8')) as { preregistrations: LegacyEntry[] }).preregistrations;
}

function legacyFor(runId: string, digest: string, legacy: LegacyEntry[]): LegacyEntry | undefined {
  return legacy.find((l) => l.run_id === runId && l.sha256.includes(digest));
}

/** Every registered experiment (docs/benchmarks/preregistrations.json and .d/) whose prereg.json runs a held-out cell. */
export function registeredHeldout(root: string): RegisteredHeldout[] {
  if (!existsSync(join(root, 'docs/benchmarks/preregistrations.json'))) return [];
  const out: RegisteredHeldout[] = [];
  for (const entry of loadRegistry(root)) {
    const preregJson = join(dirname(entry.preregistration), 'prereg.json');
    if (!existsSync(join(root, preregJson))) continue;
    const raw = readFileSync(join(root, preregJson), 'utf8');
    const p = JSON.parse(raw) as PreregLike;
    const sets = heldoutSetsOf(p);
    if (!sets.length) continue;
    out.push({ id: entry.id, preregistration: entry.preregistration, prereg_json: preregJson, run_id: p.run_id, sha256: sha256(raw), sets, ...(p.heldout ? { heldout: p.heldout } : {}) });
  }
  return out;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * Position (0 = oldest) of the commit that first added each path: first on main's first-parent history up to the
 * checkout's merge base with origin/main (or main), then on the checkout's first-parent history after it. On main the
 * merge base is HEAD; on a pull request that merged main, main's preregistrations keep main's order and the pull
 * request's own come after them, as they will once it is squash-merged. Without a main ref, HEAD's first-parent history
 * alone. A path never added (uncommitted, or outside a repository) is absent. Throws in a shallow clone, where the order
 * is unknowable.
 */
export function preregistrationOrder(root: string, paths: string[]): Order {
  const out: Order = new Map();
  if (!paths.length) return out;
  if (git(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true') throw new Error('shallow clone: held-out openings are ordered by first-parent history; run with full history (git fetch --unshallow, or actions/checkout fetch-depth: 0)');
  const mainRef = ['refs/remotes/origin/main', 'refs/heads/main'].find((r) => git(root, ['rev-parse', '--verify', '--quiet', r]) !== null);
  const base = mainRef ? git(root, ['merge-base', 'HEAD', mainRef])?.trim() : undefined;
  const added = (range: string): Array<{ commit: string; files: string[] }> => {
    const log = git(root, ['log', '--first-parent', '--diff-merges=first-parent', '--diff-filter=A', '--format=%x00%H', '--name-only', range, '--', ...paths]);
    if (log === null) throw new Error(`git log ${range} failed in ${root}; held-out openings are ordered by git history, so run inside the repository with git available`);
    return log.split('\0').filter((b) => b.trim()).reverse().map((block) => {
      const [commit, ...files] = block.split('\n').map((l) => l.trim()).filter(Boolean);
      return { commit: commit!, files };
    });
  };
  const onMain = added(base ?? 'HEAD');
  onMain.forEach(({ commit, files }, position) => {
    for (const f of files) if (!out.has(f)) out.set(f, { commit, position });
  });
  if (base) for (const { commit, files } of added(`${base}..HEAD`)) for (const f of files) if (!out.has(f)) out.set(f, { commit, position: onMain.length });
  return out;
}

/** A set's openings in derived order with their numbers, or undefined when the set has no openings ledger. */
export function deriveSet(root: string, setName: string, registered = registeredHeldout(root), order?: Order): DerivedSet | undefined {
  const ledger = openingsLedger(readManifest(heldoutSet(setName, root)));
  if (!ledger) return undefined;
  const byId = new Map(registered.map((r) => [r.id, r]));
  const positions = order ?? preregistrationOrder(root, registered.map((r) => r.preregistration));
  const key = (row: OpeningRow) => {
    const reg = byId.get(row.run_id);
    const at = reg ? positions.get(reg.preregistration) : undefined;
    return { position: at?.position ?? Number.POSITIVE_INFINITY, commit: at?.commit ?? null };
  };
  const sorted = [...ledger.openings].sort((a, b) => {
    const pa = key(a).position, pb = key(b).position;
    if (pa !== pb) return pa < pb ? -1 : 1;
    return a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0;
  });
  let number = 0, rank = 0;
  const openings = sorted.map((row) => {
    const counted = COUNTED.has(row.status);
    if (counted) number++;
    if (counted && row.label === 'confirmatory') rank++;
    return { run_id: row.run_id, status: row.status, label: row.label, reason: row.reason ?? null, number: counted ? number : null, confirmatory_rank: counted && row.label === 'confirmatory' ? rank : null, prereg_commit: key(row).commit };
  });
  return { set: setName, ledger, openings, confirmatory_used: rank };
}

const rel = (root: string, p: string) => (p.startsWith(root + '/') ? p.slice(root.length + 1) : p);

/** The CI check over the repository at root: problems as printable lines, empty when every set's ledger holds. */
export function checkOpenings(root: string, legacy = legacyList()): string[] {
  const registered = registeredHeldout(root);
  let order: Order;
  try {
    order = preregistrationOrder(root, registered.map((r) => r.preregistration));
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
  const problems: string[] = [];
  const sets = heldoutSets(root);
  const known = new Set(sets.map((s) => s.name));
  for (const r of registered) {
    if (r.run_id !== r.id) problems.push(`${r.id}: ${r.prereg_json} names run_id ${r.run_id}; a held-out experiment's registry id and run_id must match`);
    for (const s of r.sets) if (!known.has(s)) problems.push(`${r.id}: runs held-out cells of set ${s}, which has no held-out tree`);
    if (legacyFor(r.id, r.sha256, legacy)) continue;
    const changed = legacy.some((l) => l.run_id === r.id);
    if (!r.heldout) problems.push(`${r.id}: ${r.prereg_json} runs held-out cells of ${r.sets.join(', ')} and has no heldout block${changed ? ' (it is on the legacy list, but its prereg.json changed since); a dated amendment to a legacy run adds the new digest to its entry in runner/heldout/legacy-preregistrations.json in the same pull request, anything else needs' : ';'} add "heldout": {"set", "label", "reason", "candidate_sha256"} and its ledger row (HE-HELDOUT-001)`);
    else if (r.sets.length !== 1 || r.heldout.set !== r.sets[0]) problems.push(`${r.id}: heldout.set is ${JSON.stringify(r.heldout.set)} but the held-out cells run ${r.sets.join(', ')}; one run opens one held-out set (HE-HELDOUT-001)`);
    else {
      const p = blockProblem({ run_id: r.run_id, cells: [], heldout: r.heldout }, r.sets);
      if (p) problems.push(`${r.id}: ${p.message} (${p.code})`);
    }
  }
  for (const entry of existsSync(join(root, 'docs/benchmarks/preregistrations.json')) ? loadRegistry(root) : []) {
    const preregJson = join(dirname(entry.preregistration), 'prereg.json');
    if (!existsSync(join(root, preregJson))) continue;
    const p = cellProblem(JSON.parse(readFileSync(join(root, preregJson), 'utf8')) as PreregLike);
    if (p) problems.push(`${entry.id}: ${preregJson}: ${p} (HE-HELDOUT-001)`);
  }
  const candidates = new Map<string, string>();
  for (const set of sets) {
    const users = registered.filter((r) => r.sets.includes(set.name));
    const derived = deriveSet(root, set.name, registered, order);
    if (!derived) {
      if (users.length) problems.push(`set ${set.name}: ${users.map((u) => u.id).join(', ')} run held-out cells but ${rel(root, set.manifest)} has no openings ledger`);
      continue;
    }
    const { ledger } = derived;
    for (const u of users) {
      const rows = ledger.openings.filter((o) => o.run_id === u.id);
      if (rows.length !== 1) { problems.push(`set ${set.name}: ${u.id} runs held-out cells and has ${rows.length} ledger rows; it needs exactly one`); continue; }
      if (!u.heldout || legacyFor(u.id, u.sha256, legacy) || u.heldout.set !== set.name || !COUNTED.has(rows[0]!.status)) continue;
      for (const k of ['label', 'reason', 'candidate_sha256'] as const) {
        if ((u.heldout[k] ?? null) !== (rows[0]![k] ?? null)) problems.push(`set ${set.name}: ${u.id}: heldout.${k} in ${u.prereg_json} is ${JSON.stringify(u.heldout[k] ?? null)}, its ledger row says ${JSON.stringify(rows[0]![k] ?? null)}`);
      }
    }
    for (const row of ledger.openings) {
      const reg = users.find((u) => u.id === row.run_id);
      const trials = reg ? join(root, dirname(reg.preregistration), 'results', 'trials.jsonl') : null;
      if (!COUNTED.has(row.status) && trials && existsSync(trials) && readFileSync(trials, 'utf8').trim()) problems.push(`set ${set.name}: ${row.run_id} is ${row.status} but has committed trials in ${rel(root, trials)}; a registration that ran a trial opened the set and stays counted, so mark it opened (HE-HELDOUT-002)`);
      if (!reg) problems.push(`set ${set.name}: ledger row ${row.run_id} names no registered experiment with held-out cells of this set`);
    }
    for (const o of derived.openings) {
      if (o.status === 'planned' && o.label === 'confirmatory' && ledger.status !== 'open') problems.push(`set ${set.name}: ${o.run_id} is a planned confirmatory opening of a set whose status is ${ledger.status}; mark a set's rows opened before the set is spent or retired, or label the run dev with a reason (HE-HELDOUT-003)`);
      if (o.confirmatory_rank !== null && o.confirmatory_rank > ledger.opening_budget) problems.push(`set ${set.name}: ${o.run_id} is confirmatory opening ${o.confirmatory_rank} against a budget of ${ledger.opening_budget} (preregistration first added at ${o.prereg_commit?.slice(0, 12) ?? 'no first-parent commit'}); label it dev with a reason, or withdraw it`);
    }
    const ledgerOrder = ledger.openings.map((o) => o.run_id).join(', ');
    const derivedOrder = derived.openings.map((o) => o.run_id).join(', ');
    if (ledgerOrder !== derivedOrder) problems.push(`set ${set.name}: ledger rows are in the order ${ledgerOrder}; preregistration order on first-parent history is ${derivedOrder}; reorder the rows`);
    for (const row of ledger.openings) {
      if (row.label !== 'confirmatory' || !COUNTED.has(row.status) || !row.candidate_sha256) continue;
      const other = candidates.get(row.candidate_sha256);
      if (other) problems.push(`set ${set.name}: ${row.run_id} is a confirmatory opening of candidate ${row.candidate_sha256.slice(0, 12)}, which ${other} already opened confirmatory; a candidate gets one confirmatory opening`);
      else candidates.set(row.candidate_sha256, `${row.run_id} (set ${set.name})`);
    }
  }
  return problems;
}

/**
 * The plan-time check for one preregistration (its parsed body and the sha256 of its bytes). Returns the lines plan
 * prints, empty for a run with no held-out cell; throws HE-HELDOUT-001 to 004.
 */
export function checkPlan(prereg: PreregLike, digest: string, root: string, legacy = legacyList()): string[] {
  const unsafe = cellProblem(prereg);
  if (unsafe) throw new RunnerError('HE-HELDOUT-001', unsafe);
  const sets = heldoutSetsOf(prereg);
  if (!sets.length) return [];
  const legacyEntry = legacyFor(prereg.run_id, digest, legacy);
  const block = prereg.heldout;
  if (!legacyEntry) {
    const p = blockProblem(prereg, sets);
    if (p) throw new RunnerError(p.code, p.message);
    const registered = registeredHeldout(root).find((r) => r.id === prereg.run_id);
    if (registered?.sha256 !== digest) throw new RunnerError('HE-HELDOUT-002', `run ${prereg.run_id}: ${registered ? `this prereg.json (sha256 ${digest.slice(0, 12)}) is not the registered ${registered.prereg_json} (sha256 ${registered.sha256.slice(0, 12)})` : 'is not a registered experiment with held-out cells (docs/benchmarks/preregistrations.json or preregistrations.d/)'}; a held-out run plans from its registered preregistration. fix: plan the registered prereg.json, or commit the change to it as a dated amendment`);
  }
  const setName = legacyEntry?.set ?? block!.set;
  const set = heldoutSet(setName, root);
  const ledger = openingsLedger(readManifest(set));
  const rows = ledger?.openings.filter((o) => o.run_id === prereg.run_id) ?? [];
  if (!ledger || rows.length !== 1) throw new RunnerError('HE-HELDOUT-002', `run ${prereg.run_id} has ${rows.length} rows in the openings ledger of set ${setName} (${rel(root, set.manifest)}${ledger ? '' : ', which has no ledger'}); fix: add one row {"run_id": "${prereg.run_id}", "status": "planned", "label", "reason", "candidate_sha256"} matching the heldout block, in the same pull request as the preregistration`);
  const row = rows[0]!;
  let unknown = '';
  const derive = () => {
    try {
      return deriveSet(root, setName);
    } catch (e) {
      unknown = e instanceof Error ? e.message : String(e);
      return undefined;
    }
  };
  const line = (d: DerivedSet | undefined, tail: string) => {
    const n = d?.openings.find((o) => o.run_id === row.run_id)?.number;
    return `HELDOUT: run ${prereg.run_id} set ${setName}${n ? ` opening ${n}` : ''} ${row.label}${row.reason ? ` (${row.reason})` : ''}, status ${row.status}; ${tail}${unknown ? `; opening number unknown: ${unknown}` : ''}`;
  };
  if (!COUNTED.has(row.status)) throw new RunnerError('HE-HELDOUT-002', `run ${prereg.run_id}: its row in the openings ledger of set ${setName} is ${row.status}; a ${row.status} registration does not open the set. fix: register a new run id`);
  if (legacyEntry) return [line(derive(), 'registered before internal-task (runner/heldout/legacy-preregistrations.json), accepted as its backfilled row')];
  for (const k of ['label', 'reason', 'candidate_sha256'] as const) {
    if ((block![k] ?? null) !== (row[k] ?? null)) throw new RunnerError('HE-HELDOUT-002', `run ${prereg.run_id}: heldout.${k} is ${JSON.stringify(block![k] ?? null)} but its row in ${rel(root, set.manifest)} says ${JSON.stringify(row[k] ?? null)}; fix: make the row match the preregistration`);
  }
  let derived: DerivedSet | undefined;
  if (row.label === 'confirmatory') {
    if (row.status === 'planned' && ledger.status !== 'open') throw new RunnerError('HE-HELDOUT-003', `run ${prereg.run_id} is a planned confirmatory opening of set ${setName}, whose status is ${ledger.status}; a set that is not open takes no new confirmatory opening. fix: label it dev with a reason, or run it on an open set`);
    const confirmatory = ledger.openings.filter((o) => o.label === 'confirmatory' && COUNTED.has(o.status)).length;
    if (confirmatory > ledger.opening_budget) {
      try {
        derived = deriveSet(root, setName);
      } catch (e) {
        throw new RunnerError('HE-HELDOUT-003', `run ${prereg.run_id}: set ${setName} lists ${confirmatory} confirmatory openings against a budget of ${ledger.opening_budget}, and their order cannot be derived: ${e instanceof Error ? e.message : String(e)}`);
      }
      const rank = derived!.openings.find((o) => o.run_id === row.run_id)!.confirmatory_rank!;
      if (rank > ledger.opening_budget) throw new RunnerError('HE-HELDOUT-003', `run ${prereg.run_id} is confirmatory opening ${rank} of set ${setName}, whose budget is ${ledger.opening_budget}; fix: label it dev with a reason (heldout block and ledger row), or run it on a set with budget left`);
    }
  }
  return [line(derived ?? derive(), `budget ${ledger.opening_budget} confirmatory, set status ${ledger.status}`)];
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..');
  const registered = registeredHeldout(root);
  for (const set of heldoutSets(root)) {
    const d = deriveSet(root, set.name, registered);
    if (!d) { console.log(`SET ${set.name}: no openings ledger`); continue; }
    console.log(`SET ${set.name}: status ${d.ledger.status}, budget ${d.ledger.opening_budget} confirmatory at alpha ${d.ledger.alpha_per_opening}, ${d.confirmatory_used} used, ${d.ledger.exposures.length} exposures`);
    for (const o of d.openings) console.log(`  ${o.number ?? '-'}\t${o.run_id}\t${o.status}\t${o.label}${o.reason ? `\t${o.reason}` : ''}`);
  }
}
