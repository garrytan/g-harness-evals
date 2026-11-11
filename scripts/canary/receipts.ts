#!/usr/bin/env bun
// File-level helpers for scripts/canary/receipts.sh, which owns every git operation on the canary-receipts branch.
//
//   bun scripts/canary/receipts.ts prepare --src <run dir> --dst <staging dir>
//       copies the run directory, replaces proxy-capture files (proxy-requests.ndjson) with capture-manifest.json (path,
//       bytes, sha256), refuses any other file holding capture-shaped request bodies, then scans every staged file for token
//       shapes with scripts/publish-audit.ts's patterns (gzip decoded, SQLite read as bytes). Exit 4 on any refusal; the
//       report names the pattern and the file, never the match.
//   bun scripts/canary/receipts.ts state --history <history.jsonl> [--now <iso>]
//       the last screened release per product, the last T2, a pending tier, and the last history timestamp (dead-man check).
//   bun scripts/canary/receipts.ts lock-check --lock <lock.json> --run-id <id> --fresh-hours <h> [--now <iso>]
//       exit 0 when the lock is absent, stale or this run's own; exit 3 when another run holds a fresh one.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CAPTURE_FILE } from '../../runner/proxy/capture.ts';
import { scanText, type Hit } from '../publish-audit.ts';
import type { HistoryLine } from './alert.ts';

const CAPTURE_LINE = /"seq"\s*:\s*\d+\s*,\s*"prev"\s*:\s*"[0-9a-f]*"\s*,\s*"route"\s*:/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p)); else out.push(p);
  }
  return out.sort();
}

const textOf = (path: string) => {
  const buf = readFileSync(path);
  return (path.endsWith('.gz') ? Buffer.from(Bun.gunzipSync(buf)) : buf).toString('latin1');
};

export function prepare(src: string, dst: string): { copied: number; stripped: Array<{ path: string; bytes: number; sha256: string }>; problems: string[] } {
  const stripped: Array<{ path: string; bytes: number; sha256: string }> = [];
  const problems: string[] = [];
  let copied = 0;
  for (const p of files(src)) {
    const rel = relative(src, p);
    const name = rel.split('/').at(-1)!;
    if (name === CAPTURE_FILE || name.startsWith(CAPTURE_FILE + '.')) {
      const buf = readFileSync(p);
      stripped.push({ path: rel, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
      continue;
    }
    if (CAPTURE_LINE.test(textOf(p))) { problems.push(`${rel}: holds captured request bodies outside ${CAPTURE_FILE}`); continue; }
    mkdirSync(dirname(join(dst, rel)), { recursive: true });
    copyFileSync(p, join(dst, rel));
    copied++;
  }
  if (stripped.length) writeFileSync(join(dst, 'capture-manifest.json'), JSON.stringify({ note: 'captured request bodies stay on the run machine; hashes only', files: stripped }, null, 2) + '\n');
  const hits: Hit[] = [];
  for (const p of existsSync(dst) ? files(dst) : []) scanText(textOf(p), relative(dst, p), hits, {});
  for (const h of hits) problems.push(`${h.where}: token pattern ${h.pattern}`);
  return { copied, stripped, problems };
}

export interface ProductState {
  screened: { sha: string; version: string } | null; screened_prev: { sha: string; version: string } | null; screened_at: string | null; screened_run: string | null;
  last_t2_at: string | null; t2_verdict: string | null; pending: string | null; pending_month: string | null;
}
export interface State { last_history_at: string | null; hours_since_last: number | null; products: Record<'gstack' | 'gbrain', ProductState> }

export function state(lines: readonly HistoryLine[], now: string): State {
  const product = (p: 'gstack' | 'gbrain'): ProductState => {
    const mine = lines.filter((l) => l.product === p);
    const screened = [...mine].reverse().find((l) => l.status !== 'INCOMPLETE' && l.new);
    const t2 = [...mine].reverse().find((l) => l.status !== 'INCOMPLETE' && l.tiers?.includes('T2'));
    const last = mine.at(-1);
    return {
      screened: screened?.new ?? null, screened_prev: screened?.prev ?? null, screened_at: screened?.at ?? null, screened_run: screened?.run_id ?? null,
      last_t2_at: t2?.at ?? null, t2_verdict: t2?.verdict ?? null, pending: last?.pending ?? null, pending_month: last?.pending ? last.lease_month ?? null : null,
    };
  };
  const last = lines.at(-1)?.at ?? null;
  return { last_history_at: last, hours_since_last: last ? (Date.parse(now) - Date.parse(last)) / 3600_000 : null, products: { gstack: product('gstack'), gbrain: product('gbrain') } };
}

export function readHistory(path: string): HistoryLine[] {
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l) as HistoryLine]; } catch { return []; } });
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const now = flag('--now') ?? new Date().toISOString();
  if (cmd === 'prepare' && flag('--src') && flag('--dst')) {
    mkdirSync(flag('--dst')!, { recursive: true });
    const r = prepare(flag('--src')!, flag('--dst')!);
    for (const p of r.problems) console.error('receipts: refused: ' + p);
    console.log(JSON.stringify({ copied: r.copied, stripped: r.stripped.length, problems: r.problems.length }));
    process.exit(r.problems.length ? 4 : 0);
  } else if (cmd === 'state' && flag('--history')) {
    console.log(JSON.stringify(state(readHistory(flag('--history')!), now)));
  } else if (cmd === 'lock-check' && flag('--lock') && flag('--run-id')) {
    const lock = existsSync(flag('--lock')!) ? JSON.parse(readFileSync(flag('--lock')!, 'utf8')) as { run_id: string; at: string } : null;
    const fresh = lock && (Date.parse(now) - Date.parse(lock.at)) / 3600_000 < Number(flag('--fresh-hours') ?? 12);
    if (lock && fresh && lock.run_id !== flag('--run-id')) { console.error(`receipts: run ${lock.run_id} holds the lock since ${lock.at}`); process.exit(3); }
    console.log(lock ? (fresh ? 'own' : 'stale') : 'free');
  } else {
    console.error('usage: receipts.ts prepare --src <dir> --dst <dir> | state --history <file> [--now <iso>] | lock-check --lock <file> --run-id <id> [--fresh-hours <h>]');
    process.exit(2);
  }
}
