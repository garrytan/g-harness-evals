#!/usr/bin/env bun
// internal-task: the leak preflight of both live-ingestion arms on one split, outside a run (docs/gbrain-arm.md, "The leak preflight").
//
//   env -i PATH=$PATH HOME=$HOME bun scripts/gbrain-leak-preflight.ts --image <tag> [--split dev] [--arms open,member-sources]
//       [--world world/seed/world.json] [--out <dir>] [--channel-remember member|conversation]
//
// Keyless: no model call, no key; the sidecar and the probe container get none. Runs runner/trial/gbrain-leak-preflight.ts per arm,
// writes leak-preflight-<scope>-<split>[-conversation].json (no token value) and leak-preflight-<split>.md under --out (default
// ~/.capy/work/gbrain-leak-preflight), compares the two arms' brain layout, and exits 1 on any problem (the HE-GBRAIN line says
// which), 0 when both arms pass. The informational write-carry probes are recorded, never counted.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RunnerError } from '../runner/errors.ts';
import { LEAK_CODES, layoutProblem, leakFix, leakMessage, leakRecordName, runLeakPreflight, writeLeakRecord, type LeakArm, type LeakChannelRemember, type LeakPreflightRecord } from '../runner/trial/gbrain-leak-preflight.ts';
import { DEFAULT_WORLD_PATH } from '../runner/trial/world.ts';

/** The receipt page: per arm the scripted facts, what each asker got per tool, T8 and the informational probes. */
export function renderLeakPreflight(records: LeakPreflightRecord[]): string {
  const out: string[] = [];
  for (const r of records) {
    out.push(`## ${r.arm === 'open' ? 'Open arm (scope open)' : 'Rules arm (scope member-sources)'}, split ${r.split}`, '');
    out.push(`Image \`${r.image}\` ${r.image_id}, gbrain ${r.gbrain_commit ?? 'unknown'}. ${r.ok ? 'PASS' : `FAIL, ${r.problems.length} problem(s)`}. ${r.summary.facts} scripted facts (${r.summary.database_only} held only in the database, no page), ${r.summary.askers} askers, ${r.summary.calls} calls. Manifest sha256 \`${r.layout.manifest_sha256.slice(0, 16)}\`, ingest tokens sha256 \`${r.layout.ingest_tokens_sha256.slice(0, 16)}\`.`, '');
    out.push('| Asker | Token | search | query | recall | get_page | list_pages | hot memory | list rows outside grant |', '|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const a of r.asked) out.push(`| ${a.asker ?? 'public-only'} | ${a.token} | ${a.returned.search.length} | ${a.returned.query.length} | ${a.returned.recall.length} | ${a.returned.get_page.length} | ${a.returned.list_pages.length} | ${a.returned.hot_memory.length} | ${a.rows_outside.length} |`);
    out.push('', 'Cells count the scripted facts whose marker came back (get_page and list_pages: whose page was served or listed).', '');
    if (r.write_carry) {
      out.push(`Write carry (T8): ${r.write_carry.writer}'s ${r.write_carry.writes.map((w) => `${w.tool} ${w.landed ? `landed in ${w.source_id ?? 'its write source'}` : `did not land (${w.error})`}`).join(' and ')}.`, '');
      out.push('| Reader | Write | Read tools that returned it |', '|---|---|---|');
      for (const x of r.write_carry.reads) out.push(`| ${x.reader} | ${x.write} | ${x.tools.join(', ') || 'none'} |`);
      out.push('');
    }
    if (r.channel_carry) {
      const c = r.channel_carry;
      out.push(`Channel write (channel remember conversation): ${c.writer}'s remember in ${c.channel} ${c.write.landed ? `landed in ${c.write.landed_in.join(', ') || 'no source the unscoped token reads'} (${c.write.pages.length} page(s) hold it)` : `did not land (${c.write.error})`}; its source ${c.source} is read by ${c.readers.join(', ')}.`, '');
      out.push('| Reader | Reads the source | Read tools that returned it | Inconclusive reads |', '|---|---|---|---|');
      for (const x of c.reads) out.push(`| ${x.reader} | ${c.readers.includes(x.reader) ? 'yes' : 'no'} | ${x.tools.join(', ') || 'none'} | ${x.inconclusive.join(', ') || 'none'} |`);
      out.push('');
    }
    for (const [name, v] of Object.entries(r.informational).filter(([k]) => k.startsWith('write_carry_'))) {
      const p = v as { error?: string; writes?: Array<{ label: string; landed: boolean; error: string | null }>; crossed?: Record<string, string[]> };
      out.push(`Informational \`${name}\` (recorded, never a failure): ${p.error ? `error: ${p.error}` : (p.writes ?? []).map((w) => `${w.label} ${w.landed ? `landed, crossed to ${(p.crossed?.[w.label] ?? []).join(', ') || 'nobody'}` : `did not land (${w.error})`}`).join('; ')}.`, '');
    }
    if (r.problems.length) { out.push('Problems:', ''); for (const p of r.problems.slice(0, 40)) out.push(`- [${p.check}] token ${p.token} member ${p.member} tool ${p.tool} fact ${p.fact} source ${p.source}: ${p.what}`); out.push(''); }
  }
  return out.join('\n');
}

if (import.meta.main) {
  const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
  const image = arg('image', 'harness-eval/gbrain:dev');
  const split = arg('split', 'dev') as 'dev' | 'heldout';
  const arms = arg('arms', 'open,member-sources').split(',') as LeakArm[];
  const remember = arg('channel-remember', 'member') as LeakChannelRemember;
  if (remember !== 'member' && remember !== 'conversation') { console.error(`--channel-remember must be member or conversation, not ${remember}`); process.exit(2); }
  const out = resolve(arg('out', join(homedir(), '.capy', 'work', 'gbrain-leak-preflight')));
  mkdirSync(out, { recursive: true });
  const records: LeakPreflightRecord[] = [];
  let failed: string | null = null;
  for (const arm of arms) {
    const path = join(out, leakRecordName(arm, split, remember));
    const { record, secrets } = await runLeakPreflight({ image, split, arm, worldPath: arg('world', DEFAULT_WORLD_PATH), record: path, ...(remember === 'conversation' ? { channelRemember: remember } : {}), log: (l) => console.log(l) });
    writeLeakRecord(path, record, secrets);
    records.push(record);
    console.log(`LEAK: ${arm}/${split} ${record.ok ? 'ok' : 'FAIL'}: ${record.summary.facts} facts, ${record.summary.askers} askers, ${record.summary.calls} calls, ${record.problems.length} problem(s); ${path}`);
    if (!record.ok) failed ??= leakMessage(LEAK_CODES[arm], { arm, split, image, image_id: record.image_id, commit: record.gbrain_commit, record: path, fix: leakFix(arm, { image, split, commit: record.gbrain_commit }) }, record.problems);
  }
  const open = records.find((r) => r.arm === 'open'), rules = records.find((r) => r.arm === 'member-sources');
  const layout = open && rules ? layoutProblem(open, rules) : null;
  writeFileSync(join(out, `leak-preflight-${split}.md`), `# Leak preflight, split ${split}\n\n${open && rules ? (layout ? `Layout: DIFFERS. ${layout}\n\n` : 'Layout: the two arms served the same manifest and ingest tokens from one image.\n\n') : ''}${renderLeakPreflight(records)}`);
  if (layout) failed ??= `${LEAK_CODES.layout} ${layout}`;
  if (failed) { console.error(failed); process.exit(1); }
  console.log(`LEAK: ok ${arms.join(', ')} on ${split}; ${join(out, `leak-preflight-${split}.md`)}`);
  void RunnerError;
}
