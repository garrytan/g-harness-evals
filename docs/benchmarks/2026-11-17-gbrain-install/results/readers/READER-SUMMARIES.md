# Miss reader summaries (2026-11-18)

## A1 (GPT-6 Astra, Subagent 9, $5.11)

Completed all 34 reads in `/home/user/.capy/work/gst-2715/run/readers/A1.reads.jsonl`, exactly once each. Scratch removed; scored records unchanged.

**claude-code-opus-bare-gbrain-install (13)**
All 13 recalled through gbrain’s successful SessionStart hook; the nonce appears in its output before the answer, despite `gbrain_call=false` in scoring.
Disagree with misses for r1, r5, r7–r10, r12–r14, r16–r17, r19–r20.
Fields: `died_at_step=recalled` 13; `side=unclear` 13 because these are scoring disagreements, not attributable product failures.

**claude-code-opus-paste-gbrain-install (8)**
All eight show the same successful hook-delivered recall, following actual MCP saves.
Disagree with misses for r1–r3, r6, r10, r14, r16–r17.
Fields: `died_at_step=recalled` 8; `side=unclear` 8, using the same convention above.

**hermes-opus-bare-gbrain-install (10)**
r1–r8 failed because Hermes’s offline package scanner blocked installation without unattended approval; subsequent recall came from Hermes memory.
r9–r10 installed and saved successfully, but protected configuration blocked wiring; ordinary recall used `session_search`, so both remain misses. Their `not-installed` label obscures this distinction.
Fields: `binary` 8, `wired` 2; `harness` 10. Both later retrieved through gbrain when hinted; r9’s recorded hinted `gbrain_call=false` contradicts turn 7’s CLI result.

**hermes-opus-paste-gbrain-install (3)**
r2, r3 and r5 hit the same package-scanner block, then saved and recalled only through Hermes memory.
Fields: `binary` 3; `harness` 3.
No disagreement with these three scored misses.

## A2 (GPT-6 Astra, Subagent 10, $4.93)

Completed all 20 reads in `/home/user/.capy/work/gst-2715/run/readers/A2.reads.jsonl`, validated exactly once each; scratch deleted. Sixteen scored misses have direct fresh-session GBrain recall evidence. Scores remain unchanged.

**openclaw-opus-bare-gbrain-install**
- As read: 6 recalled, 4 missed; disagreements: r1, r2, r5, r6, r8, r10.
- r3/r4/r7/r9 saved successfully but used OpenClaw transcript search on unhinted recall; all four succeeded through GBrain when hinted.
- The missing brain-first reminder followed MCP-only setup: mixed documentation/model attribution for r3/r7/r9; model attribution for r4, which explicitly saw the reminder-install command.
- Fields: `died_at_step=recalled` 10; sides mixed 3, model 1, unclear 6; other categories zero.

**openclaw-opus-paste-gbrain-install**
- As read: all 10 recalled; disagreements: r1–r10.
- Nested `tool_call` → `gbrain__recall` returned the nonce before each correct answer, contradicting recorded `finish.gbrain_call=false`.
- Fields: `died_at_step=recalled` 10; side unclear 10; other categories zero.

For successful reads, the required step field marks the disputed recall stage, not an actual death; side is unclear because no GBrain/model/harness failure was established.

## B1 (Opus 5.5, Subagent 11, $2.97)

I disagree with the score on 13 of the 20 OpenClaw + GPT-6.1 Sol trials: as I read them, the nonce was recalled through gbrain. All 11 Hermes + Sol trials are real misses at the install step, and the cause is Hermes's own security guard, not gbrain.

All 31 trials have one line each in `run/readers/B1.reads.jsonl`. My scratch dir is deleted. I saw no secrets.

**The scorer problem (please check before the failure table goes out)**

Three things in the scorer turn gbrain recalls into misses:
1. **Wrapped MCP calls are missed.** OpenClaw sends every MCP call through a generic tool named `tool_call`, with the real tool named in its arguments (`mcp:gbrain:gbrain__recall`). `parseOpenclaw` in `scripts/gbrain-install/transcript.ts` keeps only the outer name `tool_call`, so `isGbrainServed` never fires for OpenClaw. The same gap leaves `saved_ms` null on MCP saves.
2. **OpenClaw's transcript index counts as harness memory.** `outsideBrain` flags rows in `openclaw-agent.sqlite`'s `memory_index_chunks` table. I opened all 19 flagged databases: every nonce hit there has `source='sessions'`, meaning OpenClaw's own index of the conversation transcript. Nothing was deliberately saved to harness memory. The table name doesn't match the `TRANSCRIPT_TABLE` regex, so these rows aren't skipped the way transcripts are meant to be. Since `outside.length` is checked first in `install.ts:418`, this alone forces "harness-memory" on 19 of the 20 OpenClaw trials.
3. **A launcher isn't recognised.** In one trial, paste r8, the agent called gbrain through a small launcher script that only runs the gbrain binary, and that doesn't count as a gbrain call.

**Per cell**

- **openclaw-sol-bare (10): 6 recalled as read, 4 real misses, all at the recalled step.**
  - Recalled as read: r1, r2, r3, r4, r9, r10. Each saved with gbrain remember, then in the fresh session called gbrain recall over MCP and answered from its result. OpenClaw's own memory_search came back empty.
  - r5, r6, r7 (side: mixed): the fact was in gbrain, but the agent never called it in the recall session. It answered from OpenClaw's own session-history search. The scored label is right in substance here. GBrain's per-turn reminder wasn't in those recall prompts; it was injected in only 3 of 20 OpenClaw trials, and most still used gbrain without it.
  - r8 (side: model): gbrain recall returned the fact, but the agent had saved it as belonging to "the user in conversation s1" and refused to use it in a new conversation.

- **openclaw-sol-paste (10): 7 recalled as read, 3 real misses, all at the recalled step.**
  - Recalled as read: r1, r4, r5, r6, r8, r9, r10. r5 was scored not-recalled with no outside-brain hit at all, so its only cause is the `tool_call` gap. r8 used the launcher described above.
  - r2 and r7 (side: gbrain): the fact was saved with `gbrain remember`, but the recall turn only ran `gbrain search`. That keyword page search doesn't cover remembered facts and came back empty. r2 then asked the user; r7 answered from OpenClaw's session history. This looks like a real gbrain fix: search silently misses facts, and the brain-ops skill and turn rule point lookups at search and query.
  - r3 (side: harness, termination timeout): the recall turn got no model output at all and hit the 900-second limit with one request still open. Its hinted turn recalled through gbrain.

- **hermes-sol-bare (6: r2, r4, r5, r6, r9, r10) and hermes-sol-paste (5: r4, r6, r7, r9, r10): all missed at the binary step, side: harness.**
  - Hermes's command scanner, Tirith, returned "BLOCKED: Security scan" on `bun install -g github:garrytan/gbrain#v0.60.734.0`. Its threat-intel lookups are skipped in offline mode, and single-query mode can't ask anyone to approve. The Git-clone fallback was blocked too.
  - The model refused to bypass the guard through all three scripted "carry on" replies, then saved the fact with Hermes's own memory tool. The harness-memory label is correct.
  - This is a Hermes configuration issue (its own message names `approvals.single_query_mode: approve`). gbrain's install docs could mention it, but gbrain didn't cause it.

**Totals across my 31:** binary/harness 11, recalled/gbrain 2, recalled/mixed 3, recalled/model 1, recalled/harness 1. The 13 trials I read as recalled carry `died_at_step: "recalled"` and `side: "unclear"`, since the brief's side list has no value for a scorer fault.

## B2 (Opus 5.5, Subagent 12, $2.14)

I disagree with the score on 16 of my 20 trials, so treat these misses as a scorer problem before anyone builds a gbrain fix list from them. In 16 trials particle-1 recalled the nonce through a real gbrain MCP call in the fresh session. The scorer can't see OpenClaw's MCP calls, so it counts none of them.

**Why the scorer misses them.** OpenClaw sends MCP calls through its own `tool_call` tool, with `{"id":"mcp:gbrain:gbrain__recall","args":…}` (one trial uses the id `gbrain__recall`). `toolEvent` in `scripts/gbrain-install/transcript.ts` (run-wt) only recognises names like `mcp__x__y` or `x__y`. So it files these calls under kind `other`, `isGbrainServed` never fires, and `gbrain_call` comes out false. The same blind spot explains why `saved_ms` is null wherever the save went through MCP. Only gbrain calls made from the shell are counted.

Output is in `run/readers/B2.reads.jsonl`: 20 lines, one per trial, checked against `B2.tsv`. My scratch dir is deleted.

**Paste cell (openclaw-particle-paste), 10 trials, all scored not-recalled**
- All 10 read as **recalled**.
- Every trial ran `gbrain setup openclaw` fully: the MCP server, the `AGENTS.md` brain-first block and the turn-rule are all present, and the recall turn carries the "check GBrain first" note.
- In each recall turn, `gbrain__recall` returned the nonce with no error, and the reply quotes it.
- The steps reached were binary, brain, wired, saved and recalled in all 10. There is no gbrain-side failure. I marked side "harness" because of the scorer and OpenClaw's tool wrapper, not because of gbrain.

**Bare cell (openclaw-particle-bare), 10 trials: 3 not-recalled, 7 harness-memory**
- **6 read as recalled: r1, r4, r6, r8, r9, r10.** All of them hit the scorer blind spot above.
  - r4, r6 and r10 were scored harness-memory only because the nonce also turned up in OpenClaw's `memory_index_chunks`. I extracted r4's state: those rows are `source='sessions'`, meaning OpenClaw indexed the save-turn chat log by itself. The agent never saved there. I'm assuming r6 and r10 are the same; I didn't extract their state.
- **3 read as missed, all at the recall step, side mixed: r3, r5, r7.**
  - The fact was saved to gbrain in each one. But the agent wired gbrain by hand with `openclaw mcp add` and never ran `gbrain setup openclaw`, so the new session had no brain-first instruction.
  - It then searched OpenClaw's own memory and session history. r3 and r7 said "I don't know"; r5 answered from OpenClaw's `sessions_search`.
  - The hinted turn found the fact in gbrain in all three.
- **1 unclear: r2.** The agent found the nonce in OpenClaw's session history first and then confirmed it with a gbrain recall.
- **Gbrain-side causes in the bare cell.** r2 to r7 all skipped `gbrain setup openclaw`, and this is the only part of either cell that points at gbrain:
  - `gbrain setup --help` lists only `claude-code` and `codex` as usage, so the agent had no hint that an `openclaw` target exists.
  - In r6, `gbrain setup openclaw --dry-run` failed with `invalid_params`, because `openclaw.json` "could not be read as JSON" (OpenClaw's config is JSON5).
- **Counts by died_at_step:** recalled 10 (6 recalled, 3 missed, 1 unclear). **By side:** harness 6, mixed 4.

**What to do with this**
- The 16 recalled reads are a scorer bug, not a gbrain failure. Every OpenClaw cell, not just particle, probably needs re-scoring once `toolEvent` unwraps OpenClaw's `tool_call` and reads the inner id.
- The harness-memory rule also counts OpenClaw's automatic indexing of its own chat logs as a save to harness memory. Someone needs to decide whether that should count.
- The gbrain fixes worth filing are adding `openclaw` to `gbrain setup --help` and making `gbrain setup openclaw` parse JSON5 configs.

I saw no tokens or keys while reading.

