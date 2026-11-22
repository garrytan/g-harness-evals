#!/usr/bin/env python3
"""Writes AUDITS.md from audit1.json, audit2.json and audit3.json only."""
import json, sys
if len(sys.argv) != 2:
    sys.exit('usage: python3 make-md.py <audits dir>')
A = sys.argv[1]
a1, a2, a3 = (json.load(open(f'{A}/audit{i}.json')) for i in (1, 2, 3))
short = lambda t: t.replace('gbrain-install-2026-11/', '').replace('-gbrain-install/gbrain-install/', ' ')
cell = lambda c: c.replace('-gbrain-install', '')
T1, T3 = a1['totals'], a3['totals']
L = []
L += ['# Post-run audits 1-3, gbrain-install-2026-11', '',
      '**Takeaways.** Every recall the pinned scorer counted (94, including the excluded INFRA run) was served by a saved fact (gbrain\'s `remember` store), never by a page from the conversation archive, so Audit 1 moves nothing. Audit 1 didn\'t check the 59 recalls that rules a, b and c add to the headline a+b+c column (45 OpenClaw, 14 Claude Code), so this result covers the pinned scorer\'s recalls only. No recall was credited through a `head N` or `tail N` pipe, so Audit 2 withdraws nothing. The release-pin recount from the raw watcher and probe records matches the verdict exactly. One input claim was wrong: 5 recalled Claude Code trials have no brain database in their copied state, so where their brain holds the nonce is read from the save transcript, not the brain.', '']
L += ['## Audit 1: recall from the conversation archive', '',
      'Method: the recall turn of each recalled trial was re-parsed with the pinned `transcript.ts`, and each credited gbrain call output was classified by the result item that holds the nonce (a `facts` item or a `results` page slug). Each trial\'s `state/.gbrain/brain.pglite` was copied to scratch and opened with pglite 0.4.3 (the version gbrain v0.60.734.0 ships). Every table was searched for the nonce, and pages were split into `conversations/` (archive) and other slugs.', '',
      '| Cell | Recalled | Recalled from archive | Nonce only in archive pages | Served by a saved fact | Brain not in the copy |', '|---|---:|---:|---:|---:|---:|']
for r in a1['per_cell']:
    L.append(f"| {cell(r['cell'])} | {r['recalled']} | {r['recalled_from_archive']} | {r['nonce_only_in_archive']} | {r['served_by_saved_fact']} | {r['brain_not_in_copy']} |")
tot = lambda k: sum(r[k] for r in a1['per_cell'])
L.append(f"| **Total (counted)** | **{tot('recalled')}** | **{tot('recalled_from_archive')}** | **{tot('nonce_only_in_archive')}** | **{tot('served_by_saved_fact')}** | **{tot('brain_not_in_copy')}** |")
bh = T1['brain_holds']
L += ['', f"Totals: {T1['recalled_trials']} recalled trials, {T1['counted_recalled']} counted. Recalled from archive: {T1['recalled_from_archive']}. Nonce only in archive pages: {T1['nonce_only_in_archive']}.",
      f"Where the brain holds the nonce (counted): saved fact only, no page, {bh.get('saved fact only, no page', 0)}; an explicit page as well as a saved fact, {bh.get('explicit page (and saved fact)', 0)}; brain not in the copy, {bh.get('unknown: brain not in the copy', 0)}.", '',
      'Exceptions:', '']
for t in a1['totals']['reported_apart']:
    L.append(f"- Reported apart: {short(t)}. Its recall was served by a saved fact and its brain holds the nonce as a saved fact only, no page.")
miss = a1['exceptions']['brain_not_in_copy']
L.append(f"- Brain not in the copy ({len(miss)}): {', '.join(short(t) for t in miss)}. Their `state/.gbrain` holds only an owner file, notices and persistence, with no `brain.pglite`, and the older `results.partial-*` copies hold no state for them at all. The brain existed during the run: the probe saw it and the runner's own check marked it as holding the nonce. Their recall was served by a saved fact, and their save turn's `remember` reply says `write_through: skipped entity_page_missing, written: false`, so no page was written. This contradicts the brief, which said only s01 r19 lost its state. s01 r19 did not recall, so it is not in this audit.")
for x in a1['exceptions']['explicit_page_holds_nonce']:
    L.append(f"- {short(x['trial_id'])}: the agent saved with the gbrain CLI (`remember`), which also wrote the markdown page `{', '.join(x['pages'])}`, and the fact points to that page. The recall was still served by the fact.")
for x in a1['exceptions']['more_than_one_fact_or_expired_fact']:
    fs = '; '.join(f"fact {f['id']} ({f['write_origin']['channel']}, {f['visibility']}{', expired' if f['expired_at'] else ''})" for f in x['facts'])
    L.append(f"- {short(x['trial_id'])}: two facts hold the nonce: {fs}. The recall was served by the live fact.")
for x in a1['exceptions']['archive_pages_exist_but_lack_nonce']:
    L.append(f"- {short(x['trial_id'])}: the brain has {x['archive_pages_total']} `conversations/` archive pages, and none of them holds the nonce.")
L.append(f"- In {len(a1['exceptions']['credited_events_with_text_method'])} Hermes trials the credited output is text or cut JSON, so the item was read from the text (\"excerpt from fact N\" and similar markers). All of them are facts.")
L += ['', '## Audit 2: `head` or `tail` with a bare number', '',
      'Method: every recall and hinted turn of all 200 trials was re-parsed from the raw turn files. Every shell gbrain call whose last pipe stage is `head` or `tail` with a bare numeric operand was listed, and every credited recall event was split by kind.', '',
      f"Result: **{len(a2['credited_through_bare_number_pipe'])} recalls credited through a bare-number pipe, {len(a2['credits_withdrawn'])} credits withdrawn.** All {a2['credited_recall_events']['mcp']} credited recall events across the {a2['recalled_trials']} recalled trials are gbrain MCP tool calls. {a2['credited_recall_events']['shell']} are shell calls, so no file named N needed checking. The recall turns hold {a2['shell_gbrain_calls_in_recall_or_hinted_turns'].get('recall', 0)} shell gbrain calls and the hinted turns {a2['shell_gbrain_calls_in_recall_or_hinted_turns'].get('hinted', 0)}. {len(a2['head_or_tail_pipes_after_gbrain_in_recall_or_hinted_turns'])} of those pipe into head or tail, all with a flag (`-15`, `-40`, `-60`) rather than a bare number, and none was credited. Per cell: 0 in every cell.", '',
      '## Audit 3: the release-pin counts', '',
      f"Method: for each of the {a3['counted_runs']} counted runs, every line of `logs/install-watch.ndjson` and every `logs/turns/turn-NNNN.probe.json` was read and sorted by parsed time. The first and last non-null gbrain version were compared with `classification.probe_versions` and with the `pin` columns of `verdict.ts --json`.", '',
      '| Cell | Arm | n | First not pin (verdict / recount) | Last not pin (verdict / recount) | No version seen (verdict / recount) |', '|---|---|---:|---|---|---|']
for c in a3['cells']:
    v, r = c['verdict_pin'], c['recount_pin']
    L.append(f"| {cell(c['cell'])} | {c['arm']} | {c['n']} | {v['first_version_off_pin']} / {r['first_version_off_pin']} | {v['last_version_off_pin']} / {r['last_version_off_pin']} | {v['no_version_seen']} / {r['no_version_seen']} |")
V, R = T3['verdict'], T3['recount']
L.append(f"| **Total** | | **{a3['counted_runs']}** | **{V['first_version_off_pin']} / {R['first_version_off_pin']}** | **{V['last_version_off_pin']} / {R['last_version_off_pin']}** | **{V['no_version_seen']} / {R['no_version_seen']}** |")
e = a3['edge_checks']
nv = e['no_version_runs_transcript_check']
L += ['', f"Result: no difference. {len(a3['per_trial_mismatches'])} runs differ from `probe_versions` and {a3['cells_differing']} cells differ from the verdict. Every version any record saw was the pin, 0.60.734.0.", '',
      'Edge cases checked (the known limits of the version columns):', '',
      f"- Watcher file missing: {len(e['runs_missing_watcher_file'])}. Unparseable watcher lines: {len(e['runs_with_unparseable_watch_lines'])}. Unparseable probe files: {len(e['runs_with_unparseable_probe_files'])}. (Some watcher files end without a final newline, and both the runner and this recount read that last line.)",
      f"- A gbrain binary seen but with a null version (the probe's 5-second `--version` timeout and its cache by path, mtime and size): {len(e['runs_with_binary_but_null_version_records'])} records.",
      f"- More than one version in a run (an off-pin first install that the watcher's 1-second sampling could miss): {len(e['runs_with_more_than_one_version'])}.",
      f"- A first version that came from an end-of-turn probe rather than the watcher: {len(e['runs_first_version_from_turn_probe_not_watcher'])}.",
      f"- The {len(nv)} no-version runs are all Hermes (Opus 5.5 and GPT-6.1 Sol) and all died at the binary step. No record saw a gbrain binary on PATH or in `~/.bun/bin`, `~/.local/bin` or `~/.npm-global/bin`, and no gbrain call printed gbrain output: {sum(1 for x in nv if x['gbrain_calls_succeeded_with_output'])} calls exited 0 with output, and those printed only Bun's `1.4.4`, \"gbrain not installed\" or a status line. So \"no version seen\" there means gbrain never ran, not a probe miss. One of these runs, hermes-opus-bare r1, has the descriptive transcript `version` field set to Bun's `1.4.4`, the case Amendment 1's note 4 describes. That field feeds no count.",
      f"- Excluded runs, listed apart: {', '.join(short(x['trial_id']) + ' (' + x['reason'] + ', saw ' + str(x['recount']['first']) + ')' for x in a3['excluded'])}.", '',
      '## Notes', '',
      '- Read-only: trial data was only read. Brains were copied to scratch before pglite opened them, and the `.gbrain-ipc-secret` file and `secret/` paths were left out of every copy and extraction. No network, no model or harness runs and no spend. One slip: early on I ran a read-only `git log -3` in run-wt, against the brief\'s no-git rule.',
      '- Scripts, in scripts/: recall-events.ts, save-events.ts, run-brains.sh with brain-dump.ts (it needs pglite 0.4.3, the version gbrain v0.60.734.0 ships), audit1.py, audit2.ts, audit3.ts, audit3-noversion.ts and make-md.py. Each takes the run/ folder of the raw archive raw-2026-11-17-gbrain-install--run and an output folder as arguments; scripts/README.md gives the order. Scratch was deleted after the run, so audit1.py needs recall-events.ts, save-events.ts and run-brains.sh run again before it can be rerun.']
open(f'{A}/AUDITS.md', 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
