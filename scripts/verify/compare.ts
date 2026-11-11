// Compares a rebuilt analysis file with the committed one and describes every difference in plain words.
// JSON files are compared by value (key order does not matter, numbers must be equal as written); any other file is
// compared line by line. A path names one value inside a JSON file, for example cells[2].pass_rate.estimate.

export const MISSING = Symbol('missing');
export type Value = unknown | typeof MISSING;

export interface Difference {
  path: string;
  committed: Value;
  rebuilt: Value;
}

const plainKey = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

// The public copy of this repository (garrytan/g-harness-evals) replaces internal task codes and cloud machine names in
// the scripts it publishes, but leaves the committed result files byte for byte as they were. So a rebuild there prints
// "internal-task" where the published file says the code, and "<vm name>" where it names the machine. Both are labels,
// never results, and verify compares them as equal.
const TASK_CODE = /\b(?:HARN|GSTA|GBRA|GST|GEVA|FOUN|CAPY)-[0-9]+\b|\binternal-task\b/g;
const VM_NAME = /\bubirun-[A-Za-z0-9]+-[0-9]{9,}-[0-9a-f]{6,}[A-Za-z0-9-]*|<vm name>/g;
export const asPublished = (s: string) => s.replace(TASK_CODE, '<task code>').replace(VM_NAME, '<vm name>');

export function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return parent + '[' + key + ']';
  if (plainKey.test(key)) return parent ? parent + '.' + key : key;
  return parent + '[' + JSON.stringify(key) + ']';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function compareJson(committed: unknown, rebuilt: unknown, path = '', out: Difference[] = []): Difference[] {
  if (Array.isArray(committed) && Array.isArray(rebuilt)) {
    const n = Math.max(committed.length, rebuilt.length);
    for (let i = 0; i < n; i++) {
      const p = joinPath(path, i);
      if (i >= committed.length) out.push({ path: p, committed: MISSING, rebuilt: rebuilt[i] });
      else if (i >= rebuilt.length) out.push({ path: p, committed: committed[i], rebuilt: MISSING });
      else compareJson(committed[i], rebuilt[i], p, out);
    }
    return out;
  }
  if (isObject(committed) && isObject(rebuilt)) {
    for (const k of Object.keys(committed)) {
      const p = joinPath(path, k);
      if (!(k in rebuilt)) out.push({ path: p, committed: committed[k], rebuilt: MISSING });
      else compareJson(committed[k], rebuilt[k], p, out);
    }
    for (const k of Object.keys(rebuilt)) if (!(k in committed)) out.push({ path: joinPath(path, k), committed: MISSING, rebuilt: rebuilt[k] });
    return out;
  }
  if (typeof committed === 'string' && typeof rebuilt === 'string' && asPublished(committed) === asPublished(rebuilt)) return out;
  if (!Object.is(committed, rebuilt) && !(committed === 0 && rebuilt === 0)) out.push({ path: path || '(the whole file)', committed, rebuilt });
  return out;
}

export function countNumbers(v: unknown): number {
  if (typeof v === 'number') return 1;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + countNumbers(x), 0);
  if (isObject(v)) return Object.values(v).reduce((n: number, x) => n + countNumbers(x), 0);
  return 0;
}

export function getAt(root: unknown, path: string): Value {
  let cur: unknown = root;
  for (const tok of path.match(/\[\d+\]|\["(?:[^"\\]|\\.)*"\]|[^.[\]]+/g) ?? []) {
    const key: string | number = tok.startsWith('["') ? JSON.parse(tok.slice(1, -1)) : tok.startsWith('[') ? Number(tok.slice(1, -1)) : tok;
    if (typeof key === 'number' ? !Array.isArray(cur) || key >= cur.length : !isObject(cur) || !(key in cur)) return MISSING;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

export function show(v: Value): string {
  if (v === MISSING) return 'nothing (the value is absent)';
  const s = JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

export function describe(file: string, d: Difference): string {
  const what = typeof d.committed === 'number' || typeof d.rebuilt === 'number' ? 'the number at' : 'the value at';
  if (d.committed === MISSING) return file + ': ' + d.path + ' is not in the published file, but rebuilding from the receipts gives ' + show(d.rebuilt) + '.';
  if (d.rebuilt === MISSING) return file + ': ' + d.path + ' is published as ' + show(d.committed) + ', but rebuilding from the receipts does not produce it.';
  return file + ': ' + what + ' ' + d.path + ' is published as ' + show(d.committed) + ', but rebuilding from the receipts gives ' + show(d.rebuilt) + '.';
}

export interface LineDifference { line: number; committed: string | null; rebuilt: string | null }

// Myers' diff: the shortest list of kept, deleted and inserted lines that turns a into b.
function editScript(a: string[], b: string[]): ('=' | '-' | '+')[] {
  const n = a.length, m = b.length, max = n + m, off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  const ops: ('=' | '-' | '+')[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && t[off + k - 1]! < t[off + k + 1]!) ? k + 1 : k - 1;
    const px = t[off + prevK]!, py = px - prevK;
    while (x > px && y > py) { ops.push('='); x--; y--; }
    if (d > 0) { ops.push(x === px ? '+' : '-'); x = px; y = py; }
  }
  return ops.reverse();
}

// Lines of the published file that the rebuild does not reproduce, each paired with the rebuilt line that took its
// place when there is one, plus the blocks of lines only the rebuild has, each with the published line it comes
// before. Line numbers are the published file's.
export interface AddedBlock { before: number; lines: string[] }

export function compareText(committed: string, rebuilt: string): { differences: LineDifference[]; added: AddedBlock[] } {
  const a = committed.split('\n');
  const b = rebuilt.split('\n');
  const ops = editScript(a, b);
  const differences: LineDifference[] = [];
  const added: AddedBlock[] = [];
  let i = 0, j = 0;
  for (let p = 0; p < ops.length;) {
    if (ops[p] === '=') { i++; j++; p++; continue; }
    const gone: number[] = [], came: number[] = [];
    while (p < ops.length && ops[p] !== '=') { if (ops[p] === '-') gone.push(i++); else came.push(j++); p++; }
    gone.forEach((at, n) => differences.push({ line: at + 1, committed: a[at]!, rebuilt: n < came.length ? b[came[n]!]! : null }));
    if (came.length > gone.length) added.push({ before: i + 1, lines: came.slice(gone.length).map((at) => b[at]!) });
  }
  return { differences, added };
}

const clip = (s: string) => (s.length > 160 ? s.slice(0, 157) + '...' : s);

export function describeLine(file: string, d: LineDifference): string {
  if (d.committed === null) return file + ': line ' + d.line + ' is not in the published file, but rebuilding from the receipts adds ' + JSON.stringify(clip(d.rebuilt!)) + '.';
  if (d.rebuilt === null) return file + ': line ' + d.line + ' is published as ' + JSON.stringify(clip(d.committed)) + ', but rebuilding from the receipts does not produce it.';
  return file + ': line ' + d.line + ' is published as ' + JSON.stringify(clip(d.committed)) + ', but rebuilding from the receipts gives ' + JSON.stringify(clip(d.rebuilt)) + '.';
}

export function hasNumber(v: unknown): boolean {
  return countNumbers(v) > 0;
}
