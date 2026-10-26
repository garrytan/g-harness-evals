#!/usr/bin/env bun
// Publishing audit: what has to be true before this repository is made public, checked by machine.
//
//   bun scripts/publish-audit.ts [--json <out.json>] [--no-history]
//
// Keyless and read-only. It scans for token shapes in (1) every tracked file of the working tree, with every
// gzipped snapshot decoded and every SQLite ledger read both as raw bytes and row by row, and (2) every blob in
// every commit of every ref, gzipped blobs decoded, so a key that was committed and later deleted is still
// found and named with a commit that holds it. It lists every email domain and phone-shaped string in the
// tracked tree so a person can check them against the world's own synthetic domains, confirms that the
// receipts trees hold only evaluator-owned files, and runs the link check. Trial tokens of runs before 2026-10-26 (prefix sk-trial-; since then trial-token:<id>, which matches no key shape)
// are the per-trial dummies the harness containers see; they are allowlisted and said so. A synthetic canary
// is scanned first and the run fails if the scanner misses it. Any non-allowlisted hit, or any step that
// cannot run, exits non-zero: the audit fails closed.
//
// The token prefixes are assembled from parts below so that this file does not itself match the scan.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';

const root = resolve(import.meta.dir, '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
const scanHistory = !argv.includes('--no-history');

const p = (...parts: string[]) => parts.join('');
export const TOKEN_PATTERNS: Record<string, RegExp> = {
  slack_bot: new RegExp(p('xox', 'b-[A-Za-z0-9-]{10,}'), 'g'),
  slack_user: new RegExp(p('xox', 'p-[A-Za-z0-9-]{10,}'), 'g'),
  slack_app: new RegExp(p('xap', 'p-[A-Za-z0-9-]{10,}'), 'g'),
  slack_admin: new RegExp(p('wad', 'm-[A-Za-z0-9-]{10,}'), 'g'),
  anthropic: new RegExp(p('sk-', 'ant-[A-Za-z0-9_-]{10,}'), 'g'),
  gbrain: new RegExp(p('gbrain', '_[0-9a-f]{20}'), 'g'),
  openai_or_generic_sk: /\bsk-[A-Za-z0-9_-]{20,}/g,
  bearer: /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/g,
  github: new RegExp(p('gh', 'p_[A-Za-z0-9]{30,}|github_', 'pat_[A-Za-z0-9_]{30,}'), 'g'),
  aws: new RegExp(p('AKIA', '[0-9A-Z]{16}'), 'g'),
};
/** Trial tokens are per-trial dummies minted by the runner; the harness containers see nothing else. */
/** Reviewed non-secrets: the test suite's placeholder bearer values (tests/metering-proxy.test.ts) and templated headers. */
export const ALLOW = [/^sk-trial-/, /^Bearer\s+sk-trial-/, /^Bearer\s+(dummy|placeholder|container)[A-Za-z-]*$/, /^Bearer\s+\$\{?[A-Z_]+/, /^Bearer\s+<[^>]+>/, /^Bearer\s+\{[^}]+\}/];
const allowed = (hit: string) => ALLOW.some((a) => a.test(hit));

export interface Hit { pattern: string; where: string; sample: string; commit?: string }
export function scanText(text: string, where: string, hits: Hit[], counts: Record<string, number>): void {
  for (const [name, re] of Object.entries(TOKEN_PATTERNS)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (allowed(m[0])) { counts['allowlisted:' + name] = (counts['allowlisted:' + name] ?? 0) + 1; continue; }
      counts[name] = (counts[name] ?? 0) + 1;
      if (hits.length < 200) hits.push({ pattern: name, where, sample: m[0].slice(0, 6) + '…' + m[0].slice(-3) + ' (' + m[0].length + ' chars)' });
    }
  }
}

const sh = (cmd: string[], opts: { cwd?: string; maxBuffer?: number } = {}): string => {
  const r = Bun.spawnSync(cmd, { cwd: opts.cwd ?? root, stdout: 'pipe', stderr: 'pipe', maxBuffer: opts.maxBuffer ?? 256 * 1024 * 1024 });
  if (r.exitCode !== 0) throw new Error(cmd.join(' ') + ' exited ' + r.exitCode + ': ' + r.stderr.toString().slice(0, 300));
  return r.stdout.toString();
};
const textOf = (buf: Uint8Array, path: string): string => path.endsWith('.gz') ? Buffer.from(Bun.gunzipSync(Buffer.from(buf))).toString('latin1') : Buffer.from(buf).toString('latin1');

// ---- 0. canary: the scanner must see what it is looking for -------------------------------------------------
function canary(): { ok: boolean; detail: string } {
  const fake = [p('xox', 'b-', '0000000000-canary0000'), p('sk-', 'ant-', 'api03-canary' + 'A'.repeat(20)), p('gbrain', '_', 'abcdef0123456789abcd'), 'Bearer ' + p('sk-', 'ant-', 'canary' + 'B'.repeat(24)), 'sk-trial-' + 'c'.repeat(24)].join('\n');
  const hits: Hit[] = []; const counts: Record<string, number> = {};
  scanText(fake, 'canary', hits, counts);
  const gz = Buffer.from(Bun.gzipSync(Buffer.from(fake)));
  const hits2: Hit[] = []; const counts2: Record<string, number> = {};
  scanText(textOf(gz, 'canary.gz'), 'canary.gz', hits2, counts2);
  const ok = (counts.slack_bot ?? 0) >= 1 && (counts.anthropic ?? 0) >= 2 && (counts.gbrain ?? 0) >= 1 && (counts.bearer ?? 0) >= 1 && (counts['allowlisted:openai_or_generic_sk'] ?? 0) >= 1 && JSON.stringify(counts2) === JSON.stringify(counts);
  return { ok, detail: JSON.stringify(counts) };
}

// ---- 1. tracked working tree, gz decoded, ledgers read ------------------------------------------------------
function scanWorkingTree() {
  const files = sh(['git', 'ls-files', '-z']).split('\0').filter(Boolean);
  const hits: Hit[] = []; const counts: Record<string, number> = {};
  const emails: Record<string, { n: number; paths: Set<string> }> = {};
  const phones: Record<string, number> = {};
  let bytes = 0, gz = 0, ledgers = 0;
  const emailRe = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
  const phoneRe = /(?:\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b|\+\d{1,3}[ .-]\d{2,4}[ .-]\d{3,4}[ .-]\d{3,4}\b)/g;
  for (const f of files) {
    const full = join(root, f);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    const buf = new Uint8Array(readFileSync(full));
    bytes += buf.length;
    if (f.endsWith('.gz')) gz++;
    const text = textOf(buf, f);
    scanText(text, f, hits, counts);
    if (/ledger\.sqlite$/.test(f)) {
      ledgers++;
      const db = new Database(full, { readonly: true });
      const tables = db.query<{ name: string }, []>("select name from sqlite_master where type='table'").all();
      for (const t of tables) for (const row of db.query('select * from "' + t.name.replace(/"/g, '""') + '"').all() as Record<string, unknown>[]) scanText(Object.values(row).map(String).join(' '), f + ':' + t.name, hits, counts);
      db.close();
    }
    if (/\.(gz|sqlite|png|jpg|jpeg|webp|woff2?|ico)$/.test(f)) continue;
    let m: RegExpExecArray | null;
    emailRe.lastIndex = 0;
    while ((m = emailRe.exec(text))) { const d = m[1]!.toLowerCase(); (emails[d] ??= { n: 0, paths: new Set() }).n++; if (emails[d]!.paths.size < 5) emails[d]!.paths.add(f); }
    phoneRe.lastIndex = 0;
    while ((m = phoneRe.exec(text))) phones[f] = (phones[f] ?? 0) + 1;
  }
  return { files: files.length, bytes, gz, ledgers, hits, counts, emails: Object.fromEntries(Object.entries(emails).sort((a, b) => b[1].n - a[1].n).map(([d, v]) => [d, { n: v.n, paths: [...v.paths] }])), phones };
}

// ---- 2. every blob in history, gz decoded ------------------------------------------------------------------
async function scanHistoryBlobs() {
  const listing = sh(['git', 'rev-list', '--all', '--objects'], { maxBuffer: 512 * 1024 * 1024 }).split('\n').filter(Boolean);
  const pathOf = new Map<string, string>();
  for (const line of listing) { const sp = line.indexOf(' '); if (sp > 0) pathOf.set(line.slice(0, sp), line.slice(sp + 1)); }
  const ids = [...pathOf.keys()];
  const proc = Bun.spawn(['git', 'cat-file', '--batch'], { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(ids.join('\n') + '\n');
  proc.stdin.end();
  const hits: Hit[] = []; const counts: Record<string, number> = {};
  let blobs = 0, bytes = 0, skipped = 0;
  let buf = new Uint8Array(0);
  const reader = proc.stdout.getReader();
  const concat = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  let done = false;
  while (true) {
    let nl = buf.indexOf(10);
    while (nl < 0 && !done) { const r = await reader.read(); if (r.done) { done = true; break; } buf = concat(buf, r.value); nl = buf.indexOf(10); }
    if (nl < 0) break;
    const header = Buffer.from(buf.subarray(0, nl)).toString();
    const [sha, type, sizeStr] = header.split(' ');
    if (type === 'missing' || !sizeStr) { buf = buf.subarray(nl + 1); if (type === 'missing') skipped++; continue; }
    const size = Number(sizeStr);
    while (buf.length < nl + 1 + size + 1 && !done) { const r = await reader.read(); if (r.done) { done = true; break; } buf = concat(buf, r.value); }
    const body = buf.subarray(nl + 1, nl + 1 + size);
    buf = buf.subarray(nl + 1 + size + 1);
    if (type !== 'blob') continue;
    blobs++; bytes += size;
    const path = pathOf.get(sha!) ?? '?';
    let text: string;
    try { text = textOf(body, path); } catch { skipped++; continue; }
    const before = hits.length;
    scanText(text, path + ' @blob ' + sha!.slice(0, 12), hits, counts);
    for (let i = before; i < hits.length; i++) {
      const c = sh(['git', 'log', '--all', '--format=%h %s', '--find-object=' + sha!]).split('\n').filter(Boolean);
      hits[i]!.commit = c[c.length - 1] ?? 'unknown';
    }
  }
  await proc.exited;
  return { blobs, bytes, skipped, hits, counts };
}

// ---- 3. receipts trees hold only evaluator-owned files ----------------------------------------------------
/** The per-trial harness files a preregistration names as receipts and its results/.gitignore un-ignores: small, token-free
 *  evidence that the harness loaded what the evaluator put in front of it (gbrain-installer-2026-10: OpenClaw's turn-1 run record
 *  with the injected workspace files, Hermes's SOUL.md; gbrain-installer-hook-2026-10: the hook receipts the adapters keep). */
export const KEPT_HARNESS_RECEIPTS = ['logs/turns/turn-0001.openclaw.json', 'state/hermes/SOUL.md', 'logs/gbrain-hook.openclaw.json', 'logs/gbrain-hook.hermes.log']
  .map((p) => new RegExp(`/trials/[^/]+/[^/]+/r\\d+/${p.replace(/[.]/g, '\\.')}$`));
/** Files under a results tree that belong to the harness or carry a token (trial.json, state, workspaces, the sidecar's
 *  directory, raw logs, sqlite side files), less the named receipts above. */
export function harnessOwned(files: string[]): string[] {
  return files.filter((f) => !KEPT_HARNESS_RECEIPTS.some((re) => re.test(f)) && (/\/trials\/[^/]+\/[^/]+\/r\d+\/(trial\.json|state\/|workspace\/|gbrain\/|compose\.serve\.yaml)/.test(f) || /ledger\.sqlite-(shm|wal)$/.test(f) || (/\/logs\//.test(f) && !/\/logs\/adapter\.log$/.test(f))));
}
function receipts() {
  const files = sh(['git', 'ls-files', '-z', 'docs/benchmarks']).split('\0').filter(Boolean);
  const forbidden = harnessOwned(files);
  const runs = [...new Set(files.map((f) => f.split('/')[2]).filter((d): d is string => !!d && /^\d{4}-/.test(d)))].sort();
  const count = (re: RegExp) => files.filter((f) => re.test(f)).length;
  return { runs, files: files.length, forbidden, snapshots_gz: count(/snapshot\.json\.gz$/), adapter_logs: count(/adapter\.log$/), request_files: count(/\.request\.json$/), ledgers: count(/ledger\.sqlite$/), usage_logs: count(/proxy-usage\.ndjson$/), gitignores: count(/results\/\.gitignore$/) };
}

// ---- 4. links and private references ----------------------------------------------------------------------
function links() {
  const r = Bun.spawnSync(['python3', 'scripts/check-links.py'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const out = r.stdout.toString() + r.stderr.toString();
  const files = sh(['git', 'ls-files', '-z', '*.md', '*.json', '*.ts', '*.toml', '*.yaml', '*.yml']).split('\0').filter(Boolean);
  const privateRefs: string[] = [];
  const scratchRefs: string[] = [];
  for (const f of files) {
    const t = readFileSync(join(root, f), 'latin1');
    const priv = t.match(/https?:\/\/[a-z0-9.-]*capy\.ai\/[^\s)"'`]*|(?:\/home\/user|~)\/\.capy\/(?:drive|files)\/[^\s)"'`]*/g);
    if (priv) privateRefs.push(f + ': ' + [...new Set(priv)].slice(0, 3).join(', '));
    if (/(?:\/home\/user|~)\/\.capy\/work\//.test(t)) scratchRefs.push(f);
  }
  return { exit: r.exitCode, summary: out.trim().split('\n').pop() ?? '', private_refs: privateRefs, scratch_refs: scratchRefs };
}

// ---- 5. licence and attribution ---------------------------------------------------------------------------
function licence() {
  const lic = existsSync(join(root, 'LICENSE')) ? readFileSync(join(root, 'LICENSE'), 'utf8').split('\n')[0]!.trim() : null;
  const vendored = ['runner/stats/README.md', 'runner/proxy/README.md', 'runner/ledger/README.md'].filter((f) => existsSync(join(root, f))).map((f) => ({ file: f, names_source: /gbrain-evals/.test(readFileSync(join(root, f), 'utf8')), says_mit: /MIT/.test(readFileSync(join(root, f), 'utf8')) }));
  return { license_first_line: lic, vendored };
}

if (import.meta.main) {
  const started = Date.now();
  const can = canary();
  if (!can.ok) { console.error('[publish-audit] canary not detected: ' + can.detail); process.exit(2); }
  const head = sh(['git', 'rev-parse', 'HEAD']).trim();
  const tree = scanWorkingTree();
  const hist = scanHistory ? await scanHistoryBlobs() : null;
  const rec = receipts();
  const lk = links();
  const lic = licence();
  const problems: string[] = [];
  if (tree.hits.length) problems.push(tree.hits.length + ' token-shaped string(s) in the tracked working tree');
  if (hist && hist.hits.length) problems.push(hist.hits.length + ' token-shaped string(s) in history blobs');
  if (rec.forbidden.length) problems.push(rec.forbidden.length + ' harness-owned file(s) committed under results');
  if (lk.exit !== 0) problems.push('check-links failed: ' + lk.summary);
  if (lk.private_refs.length) problems.push(lk.private_refs.length + ' file(s) reference a Capy thread or a private drive path');
  if (!lic.license_first_line) problems.push('LICENSE missing');
  const report = { audited_at: new Date().toISOString(), git_head: head, canary: can, working_tree: tree, history: hist, receipts: rec, links: lk, licence: lic, problems, seconds: Math.round((Date.now() - started) / 1000) };
  const out = flag('json');
  if (out) Bun.write(out, JSON.stringify(report, null, 1) + '\n');
  const lines = [
    '## Publishing audit at ' + head.slice(0, 12) + ' (' + report.audited_at + ')',
    '',
    'Canary: detected (' + can.detail + ').',
    'Working tree: ' + tree.files + ' tracked files, ' + (tree.bytes / 1048576).toFixed(1) + ' MiB, ' + tree.gz + ' gzipped snapshots decoded, ' + tree.ledgers + ' SQLite ledgers read row by row. Token-shaped strings: ' + (tree.hits.length || 'none') + '. Allowlisted trial tokens: ' + JSON.stringify(Object.fromEntries(Object.entries(tree.counts).filter(([k]) => k.startsWith('allowlisted:')))) + '.',
    hist ? 'History: ' + hist.blobs + ' blobs in every ref (' + (hist.bytes / 1048576).toFixed(1) + ' MiB decoded' + (hist.skipped ? ', ' + hist.skipped + ' undecodable' : '') + '). Token-shaped strings: ' + (hist.hits.length || 'none') + '. Allowlisted: ' + JSON.stringify(Object.fromEntries(Object.entries(hist.counts).filter(([k]) => k.startsWith('allowlisted:')))) + '.' : 'History: not scanned (--no-history).',
    'Receipts: ' + rec.runs.length + ' run folders, ' + rec.files + ' files; ' + rec.snapshots_gz + ' snapshot.json.gz, ' + rec.adapter_logs + ' adapter.log, ' + rec.request_files + ' turn request files, ' + rec.usage_logs + ' proxy-usage.ndjson, ' + rec.ledgers + ' ledgers, ' + rec.gitignores + ' results/.gitignore. Harness-owned files committed: ' + (rec.forbidden.length || 'none') + '.',
    'Email domains in the tracked tree (text files): ' + Object.entries(tree.emails).map(([d, v]) => d + ' (' + v.n + ')').join(', ') + '.',
    'Phone-shaped strings: ' + Object.values(tree.phones).reduce((a, b) => a + b, 0) + ' in ' + Object.keys(tree.phones).length + ' file(s)' + (Object.keys(tree.phones).length ? ': ' + Object.keys(tree.phones).slice(0, 8).join(', ') : '') + '.',
    'Links: ' + lk.summary + '. References to a Capy thread or private drive: ' + (lk.private_refs.length || 'none') + '. Files naming a machine scratch path (~/.capy/work, not a secret, cosmetic): ' + lk.scratch_refs.length + (lk.scratch_refs.length ? ' (' + lk.scratch_refs.join(', ') + ')' : '') + '.',
    'Licence: ' + (lic.license_first_line ?? 'missing') + '; vendored notices: ' + lic.vendored.map((v) => v.file + (v.says_mit ? ' MIT' : ' no MIT line') + (v.names_source ? ', names gbrain-evals' : '')).join('; ') + '.',
    '',
    problems.length ? 'FAIL: ' + problems.join('; ') : 'PASS: no token-shaped string outside the trial-token allowlist, no harness-owned file under results, links green.',
  ];
  for (const h of [...tree.hits, ...(hist?.hits ?? [])]) lines.push('- ' + h.pattern + ' in ' + h.where + (h.commit ? ' (commit ' + h.commit + ')' : '') + ': ' + h.sample);
  console.log(lines.join('\n'));
  process.exit(problems.length ? 1 : 0);
}
