#!/usr/bin/env bun
// Per-shard preflight resolve for the skill-resolver arms (internal-task, scripts/skill-resolver/ARMS.md). Keyless, no network.
//
//   bun scripts/skill-resolver/preflight.ts --kit <kit dir> [--harness <h>]... [--image-tag dev] [--out <preflight.json>]
//
// For each harness it runs the kit's hook wrapper once inside harness-eval/<h>:<tag>, exactly as a trial's hook runs it (the kit
// read-only at /opt/skill-resolver, the catalog where the adapter installs it, a copy of the kit's gbrain-home, push mode, one probe
// turn), and checks the status line against the build receipt: code OK, not INFRA (index not stale, index_hash and gbrain_version
// equal to the receipt's, no CATALOG_MISMATCH), the command line carrying --fail-open and --expect-catalog with the receipt's
// catalog_hash, GBRAIN_SKILLS_NO_AUTOREBUILD=1 recorded, and the wrapper's output equal to the harness's reply shape around the
// block. It then runs the shadow replay check (scripts/skill-resolver/shadow-replay-check.ts) with the kit's bin/gbrain for the
// harness: a shadow block sequence unlike the on sequence is INFRA for the shard (problem "INFRA: SHADOW_REPLAY_MISMATCH").
// Exit 0 when every harness passes, 1 otherwise; --out gets the per-harness record.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CATALOG_NAME, HARNESSES, INSTALL_DIR, type KitHarness } from './build-kit.ts';
import { hookOutput, type StatusLine } from './hook-wrapper.ts';
import { normalizeReceipt, normalizeResult, receiptPathIn } from './result-fields.ts';
import { shadowReplay } from './shadow-replay-check.ts';

export const PROBE = 'Build a three statement financial model in a spreadsheet, with the balance sheet tied out.';

export type PreflightRecord = { harness: KitHarness; ok: boolean; problems: string[]; status: StatusLine | null; receipt: Record<string, unknown> | null; shadow_replay?: string };

export function preflightHarness(kitDir: string, h: KitHarness, tag = 'dev'): PreflightRecord {
  const kit = resolve(kitDir);
  const problems: string[] = [];
  const home = join(kit, 'index', h, 'gbrain-home');
  let receipt: Record<string, unknown>;
  try { receipt = normalizeReceipt(JSON.parse(readFileSync(receiptPathIn(home, CATALOG_NAME), 'utf8'))); } catch (e) { return { harness: h, ok: false, problems: ['no readable receipt: ' + (e as Error).message], status: null, receipt: null }; }
  const tmp = mkdtempSync(join(tmpdir(), 'he-skill-preflight-'));
  try {
    const state = join(tmp, 'state'), logs = join(tmp, 'logs');
    mkdirSync(state, { recursive: true }); mkdirSync(logs, { recursive: true });
    cpSync(home, join(state, 'gbrain-home'), { recursive: true });
    const hook = { harness: h, arm: 'preflight', mode: 'push', gbrain: '/opt/skill-resolver/bin/gbrain', gbrain_home: '/he-state/gbrain-home', catalog: CATALOG_NAME,
      expect_catalog: receipt.catalog_hash, receipt: receiptPathIn('/opt/skill-resolver/index/' + h + '/gbrain-home', CATALOG_NAME),
      status_dir: '/he-logs/skill-resolver', turn_file: '/he-state/turn.json', top_k: 5, timeout_ms: 10000 };
    writeFileSync(join(state, 'hook.json'), JSON.stringify(hook));
    writeFileSync(join(state, 'turn.json'), JSON.stringify({ turn: 1, name: 'preflight', session_key: 'preflight', window_key: 'preflight', session_turn: 1, message: PROBE }));
    const r = spawnSync('docker', ['run', '--rm', '-i', '--network', 'none', '--user', process.getuid!() + ':' + process.getgid!(), '--entrypoint', '/opt/skill-resolver/bin/he-skill-hook',
      '-v', kit + ':/opt/skill-resolver:ro', '-v', join(kit, 'catalog', 'skills') + ':' + INSTALL_DIR[h] + ':ro', '-v', state + ':/he-state', '-v', logs + ':/he-logs',
      'harness-eval/' + h + ':' + tag, '/he-state/hook.json'], { input: '{}', encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
    if (r.status !== 0) problems.push('the wrapper exited ' + r.status + ' (it must always exit 0): ' + String(r.stderr).slice(0, 300));
    let status: StatusLine | null = null, result: { block?: string } | null = null;
    try { status = JSON.parse(readFileSync(join(logs, 'skill-resolver', 'status.ndjson'), 'utf8').trim().split('\n').pop()!); } catch { problems.push('no status line'); }
    try { result = normalizeResult((JSON.parse(readFileSync(join(logs, 'skill-resolver', 'results.ndjson'), 'utf8').trim().split('\n').pop()!) as { result: unknown }).result); } catch { problems.push('no result line'); }
    if (status) {
      if (status.code !== 'OK') problems.push('status code ' + status.code + (status.error ? ' (' + status.error + ')' : ''));
      if (status.infra) problems.push('INFRA: ' + status.infra_reasons.join(','));
      if (status.index_hash !== receipt.index_hash) problems.push('index_hash ' + status.index_hash + ' is not the receipt\'s ' + receipt.index_hash);
      if (status.gbrain_version !== receipt.gbrain_version) problems.push('gbrain_version ' + status.gbrain_version + ' is not the receipt\'s ' + receipt.gbrain_version);
      if (status.catalog_hash !== receipt.catalog_hash) problems.push('catalog_hash ' + status.catalog_hash + ' is not the receipt\'s ' + receipt.catalog_hash);
      if (!status.argv.includes('--fail-open')) problems.push('the command line has no --fail-open');
      const i = status.argv.indexOf('--expect-catalog');
      if (i < 0 || status.argv[i + 1] !== receipt.catalog_hash) problems.push('the command line does not pass --expect-catalog ' + receipt.catalog_hash);
      if (!status.autorebuild_off) problems.push('GBRAIN_SKILLS_NO_AUTOREBUILD=1 not recorded');
      if (result?.block && r.stdout !== hookOutput(h, result.block)) problems.push('the wrapper printed something other than the ' + h + ' reply shape around the block');
    }
    const replay = shadowReplay(join(kit, 'bin', 'gbrain'), h);
    if (!replay.ok) problems.push('INFRA: SHADOW_REPLAY_MISMATCH (' + replay.problems.slice(0, 3).join('; ') + ')');
    return { harness: h, ok: problems.length === 0, problems, status, receipt, shadow_replay: (replay.ok ? 'SHADOW_REPLAY_OK ' : 'SHADOW_REPLAY_FAIL ') + replay.line };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const all = (n: string) => argv.flatMap((a, i) => (a === '--' + n && argv[i + 1] ? [argv[i + 1]!] : []));
  const kit = all('kit')[0];
  if (!kit) { console.error('usage: preflight.ts --kit <kit dir> [--harness <h>]... [--image-tag dev] [--out <file>]'); process.exit(2); }
  const hs = (all('harness').length ? all('harness') : [...HARNESSES]) as KitHarness[];
  const records = hs.map((h) => preflightHarness(kit, h, all('image-tag')[0] ?? 'dev'));
  for (const r of records) console.log((r.ok ? 'PREFLIGHT ok ' : 'PREFLIGHT FAIL ') + r.harness + ' code=' + (r.status?.code ?? '-') + ' infra=' + (r.status?.infra ?? '-') + ' timing_ms=' + (r.status?.timing_ms ?? '-') + ' wall_ms=' + (r.status?.wall_ms ?? '-') + ' index_hash=' + String(r.status?.index_hash ?? '-').slice(0, 12) + ' gbrain=' + (r.status?.gbrain_version ?? '-') + ' shadow_replay=' + (r.shadow_replay?.startsWith('SHADOW_REPLAY_OK') ? 'ok' : 'FAIL') + (r.problems.length ? ' problems: ' + r.problems.join('; ') : ''));
  const out = all('out')[0];
  if (out) writeFileSync(out, JSON.stringify({ kit: resolve(kit), records }, null, 1) + '\n');
  process.exit(records.every((r) => r.ok) ? 0 : 1);
}
