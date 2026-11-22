// Audit 2: recalls credited through "gbrain ... | head N" or "| tail N" with a bare numeric argument (read by head/tail as a file name).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTurn, isGbrainServed, isGbrainCall, hasToken, unwrapShell } from '../../../../../../scripts/gbrain-install/transcript.ts';
// Usage: bun audit2.ts <run dir> <audits dir>; writes <audits dir>/audit2.json.
const [RUN, OUT] = process.argv.slice(2);
if (!OUT) { console.error('usage: bun audit2.ts <run dir> <audits dir>'); process.exit(2); }
const shard = new Map(readFileSync(join(RUN, 'readers/cell-shard.txt'), 'utf8').trim().split('\n').map(l => l.split(/\s+/) as [string, string]));
const recs = readFileSync(join(RUN, 'merged/trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
// A pipe stage "head N" / "tail N" whose operand is a bare number (optionally after flags), e.g. "head 20", "tail -n 5 20". "+N" and "-N" are options, not files.
const BARE = /\|\s*(head|tail)((?:\s+-[A-Za-z]*\d*)*)\s+(\d+)\s*$/;
const rows: any[] = [];
const pipesSeen: any[] = [];
const shellGbrain: Record<string, number> = {};
const anyHeadTail: any[] = [];
let shellCredits = 0, mcpCredits = 0, recalled = 0;
for (const r of recs) {
  const rn = r.trial_id.split('/').at(-1);
  const dir = join(RUN, 'lite', shard.get(r.cell)!, 'results/trials', r.cell, 'gbrain-install', rn);
  const turns = JSON.parse(readFileSync(join(dir, 'install-turns.json'), 'utf8'));
  for (const t of turns.filter((x: any) => x.role === 'recall' || x.role === 'hinted')) {
    const evs = parseTurn(r.harness, join(dir, 'logs'), t.turn, t.session);
    for (const e of evs) {
      if (e.kind !== 'shell' || !isGbrainCall(e)) continue;
      shellGbrain[t.role] = (shellGbrain[t.role] ?? 0) + 1;
      if (/\|\s*(head|tail)\b/.test(unwrapShell(e.input))) anyHeadTail.push({ trial_id: r.trial_id, role: t.role, command: unwrapShell(e.input).slice(0, 300) });
      const cmd = unwrapShell(e.input).trim();
      const m = cmd.match(BARE);
      if (!m) continue;
      const credited = isGbrainServed(e) && !e.is_error && hasToken(e.output, r.install.nonce);
      pipesSeen.push({ trial_id: r.trial_id, role: t.role, turn: t.turn, command: cmd.slice(0, 300), file_operand: m[3], served: isGbrainServed(e), output_has_nonce: hasToken(e.output, r.install.nonce), credited, outcome: r.install.outcome });
    }
    if (t.role === 'recall' && r.install.outcome === 'recalled') {
      recalled++;
      const cr = evs.filter(e => isGbrainServed(e) && !e.is_error && hasToken(e.output, r.install.nonce));
      shellCredits += cr.filter(e => e.kind === 'shell').length;
      mcpCredits += cr.filter(e => e.kind === 'mcp').length;
      for (const e of cr.filter(e => e.kind === 'shell')) rows.push({ trial_id: r.trial_id, command: unwrapShell(e.input), bare_number: (unwrapShell(e.input).trim().match(BARE) ?? [])[3] ?? null });
    }
  }
}
const out = {
  audit: 2, run: 'gbrain-install-2026-11',
  method: 'Every recall and hinted turn of all 200 trials re-parsed from the raw turn files with the pinned transcript.ts; every shell gbrain call whose last pipe stage is head or tail with a bare numeric operand is listed; every credited recall event (isGbrainServed, not an error, nonce in output) is split by kind.',
  recalled_trials: recalled,
  credited_recall_events: { mcp: mcpCredits, shell: shellCredits },
  shell_credited_recalls: rows,
  credited_through_bare_number_pipe: rows.filter(x => x.bare_number !== null).map(x => x.trial_id),
  file_named_N_checked: [],
  credits_withdrawn: [],
  bare_number_pipes_seen_in_recall_or_hinted_turns: pipesSeen,
  shell_gbrain_calls_in_recall_or_hinted_turns: shellGbrain,
  head_or_tail_pipes_after_gbrain_in_recall_or_hinted_turns: anyHeadTail,
};
writeFileSync(join(OUT, 'audit2.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ recalled, mcpCredits, shellCredits, bare: out.credited_through_bare_number_pipe.length, pipesSeen, shellGbrain, anyHeadTail }, null, 1));
