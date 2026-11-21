import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { isGbrainServed, parseClaude, parseOpenclaw } from '../../../../../scripts/gbrain-install/transcript.ts';
import type { InstallTurn } from '../../../../../scripts/gbrain-install/classify.ts';
import { verdict, type InstallTrialRecord } from '../../../../../scripts/gbrain-install/verdict.ts';
import { applyRuleA, conservativeOutcome, finishOf, gbrainHookRecall, gbrainToolName, outcomeOf, outsideOf, scanState, settingsProofOf, toolCallEvidence, unwrapToolCallResult, type Outcome, type SettingsProof } from './rescore.ts';

const FIX = join(import.meta.dir, 'fixtures');
const fixture = (name: string) => readFileSync(join(FIX, name), 'utf8');
const TMP = join(import.meta.dir, '.test-tmp');
mkdirSync(TMP, { recursive: true });
const tmp = mkdtempSync(join(TMP, 'run-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const NONCE = 'Skoflouthirn';
const REPLY = "Your sister's new cat is called **Skoflouthirn**.";
const turn = (events: InstallTurn['events'], reply: string): InstallTurn => ({ turn: 3, session: 's2', role: 'recall', text: "What's my sister's new cat called?", reply_text: reply, exit: 0, started_at: '2026-11-17T19:35:16.056Z', ended_at: '2026-11-17T19:35:49.436Z', probe: null, events });

// ---- rule a: fixtures/openclaw-recall.* follow lite/s06/.../openclaw-sol-paste-gbrain-install/gbrain-install/r1/logs/turns/turn-0003
const envelope = fixture('openclaw-recall.openclaw.json');
const realSession = fixture('openclaw-recall.openclaw-session.jsonl');
const variant = (id: string, text: string, innerError = false) => realSession.split('\n').map(l => {
  if (!l.trim()) return l;
  const d = JSON.parse(l);
  const m = d.event.message;
  if (m.role === 'assistant' && m.content[0]?.type === 'toolCall') m.content[0].arguments.id = id;
  if (m.role === 'toolResult') {
    const t: string = m.content[0].text;
    const head = t.slice(0, t.indexOf('\n---\n') + 5), tail = t.slice(t.lastIndexOf('\n<<<END_EXTERNAL'));
    const inner = JSON.parse(t.slice(head.length, t.length - tail.length));
    inner.tool.id = id;
    inner.result.content[0].text = text;
    if (innerError) inner.result.isError = true;
    m.content[0].text = head + JSON.stringify(inner, null, 2) + tail;
  }
  return JSON.stringify(d);
}).join('\n');

describe('rule a: OpenClaw tool_call naming a gbrain tool', () => {
  test('gbrainToolName reads both id shapes and nothing else', () => {
    expect(gbrainToolName('mcp:gbrain:gbrain__recall')).toBe('gbrain__recall');
    expect(gbrainToolName('gbrain__recall')).toBe('gbrain__recall');
    expect(gbrainToolName('mcp:gbrain:search')).toBe('gbrain__search');
    expect(gbrainToolName('openclaw:memory-core:memory_search')).toBeNull();
    expect(gbrainToolName('sessions_search')).toBeNull();
  });

  test('a wrapped mcp:gbrain:gbrain__recall result is a gbrain-served recall', () => {
    const frozen = parseOpenclaw(envelope, realSession, 's2', 3);
    const call = frozen.find(e => e.name === 'tool_call')!;
    expect(call.kind).toBe('other');
    expect(isGbrainServed(call)).toBe(false);
    expect(finishOf(turn(frozen, REPLY), NONCE, null, true, []).gbrain_call).toBe(false);
    const fixed = applyRuleA(frozen);
    const e = fixed.find(x => x.name === 'gbrain__recall')!;
    expect(e).toMatchObject({ kind: 'mcp', is_error: false });
    expect(e.output).toContain(NONCE);
    expect(e.output).not.toContain('EXTERNAL_UNTRUSTED_CONTENT');
    expect(isGbrainServed(e)).toBe(true);
    const f = finishOf(turn(fixed, REPLY), NONCE, null, true, []);
    expect(f.gbrain_call).toBe(true);
    expect(outcomeOf(f, true)).toBe('recalled');
    expect(toolCallEvidence(realSession, NONCE)).toEqual([3]);
  });

  test('the bare gbrain__recall id counts the same way', () => {
    const fixed = applyRuleA(parseOpenclaw(envelope, variant('gbrain__recall', "The user's sister's new cat is called Skoflouthirn."), 's2', 3));
    expect(fixed.some(e => e.name === 'gbrain__recall' && isGbrainServed(e))).toBe(true);
  });

  test('negative: a tool_call to OpenClaw memory_search holding the nonce is not a gbrain call', () => {
    const raw = variant('openclaw:memory-core:memory_search', '{"results":[{"snippet":"sister\'s new cat is called Skoflouthirn"}]}');
    const fixed = applyRuleA(parseOpenclaw(envelope, raw, 's2', 3));
    expect(fixed.find(e => e.name === 'tool_call')!.kind).toBe('other');
    expect(finishOf(turn(fixed, REPLY), NONCE, null, true, []).gbrain_call).toBe(false);
    expect(toolCallEvidence(raw, NONCE)).toEqual([]);
  });

  test('negative: a failed gbrain tool_call (inner result isError) does not count', () => {
    const fixed = applyRuleA(parseOpenclaw(envelope, variant('mcp:gbrain:gbrain__recall', "The user's sister's new cat is called Skoflouthirn.", true), 's2', 3));
    expect(fixed.find(x => x.name === 'gbrain__recall')!.is_error).toBe(true);
    expect(finishOf(turn(fixed, REPLY), NONCE, null, true, []).gbrain_call).toBe(false);
  });

  test('an error object result is left as the output, flagged by the message', () => {
    expect(unwrapToolCallResult('{\n  "status": "error",\n  "tool": "tool_call",\n  "error": "getaddrinfo EAI_AGAIN raw.githubusercontent.com"\n}')).toBeNull();
  });
});

// ---- rule b: fixtures/claude-recall.claude.jsonl and claude-settings.json follow dest/s01/.../claude-code-opus-bare-gbrain-install r1
const realTurn = fixture('claude-recall.claude.jsonl');
const settingsFile = (body: string) => { const p = join(tmp, 'settings-' + Math.random().toString(36).slice(2) + '.json'); writeFileSync(p, body); return p; };
const hookSettings = (command: string) => settingsFile(JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }));
const gbrainProof = (): SettingsProof => settingsProofOf([join(FIX, 'claude-settings.json')]);
const lostProof = (): SettingsProof => settingsProofOf([settingsFile('')]);

describe('rule b: gbrain SessionStart hook in the Claude Code recall turn', () => {
  test("gbrain's hook output with the nonce is a gbrain-served recall when the reply holds it", () => {
    expect(gbrainProof()).toEqual({ settings: 'ok', events: { SessionStart: { commands: 1, gbrain: 1 }, UserPromptSubmit: { commands: 1, gbrain: 1 } } });
    const events = parseClaude(realTurn, 's2', 4);
    expect(finishOf(turn(events, REPLY), NONCE, null, true, []).gbrain_call).toBe(false);
    const hit = gbrainHookRecall(realTurn, gbrainProof(), NONCE);
    expect(hit).toEqual({ line: 2, via: 'settings' });
    const f = finishOf(turn(events, REPLY), NONCE, hit!.line, true, []);
    expect(f).toMatchObject({ gbrain_call: true, hook_recall: true });
    expect(outcomeOf(f, true)).toBe('recalled');
  });

  test("negative: a SessionStart hook that is not gbrain's does not count", () => {
    expect(gbrainHookRecall(realTurn, settingsProofOf([hookSettings('cat /workspace/notes.md')]), NONCE)).toBeNull();
    const mixed = settingsProofOf([hookSettings('cat /workspace/notes.md'), join(FIX, 'claude-settings.json')]);
    expect(mixed.events.SessionStart).toEqual({ commands: 2, gbrain: 1 });
    expect(gbrainHookRecall(realTurn, mixed, NONCE)).toBeNull();
  });

  test('negative: the reply must hold the nonce, the hook must succeed and hold it', () => {
    const hit = gbrainHookRecall(realTurn, gbrainProof(), NONCE)!;
    expect(finishOf(turn(parseClaude(realTurn, 's2', 4), "I don't know your sister's cat's name."), NONCE, hit.line, true, []).gbrain_call).toBe(false);
    expect(gbrainHookRecall(realTurn.replace('"outcome":"success"', '"outcome":"error"').replace('"exit_code":0', '"exit_code":1'), gbrainProof(), NONCE)).toBeNull();
    expect(gbrainHookRecall(realTurn.replaceAll(NONCE, 'Mittens'), gbrainProof(), NONCE)).toBeNull();
  });

  test("the probe fallback needs gbrain's output header", () => {
    expect(lostProof().settings).toBe('lost');
    expect(settingsProofOf([join(tmp, 'missing.json')]).settings).toBe('missing');
    const noHeader = realTurn.replaceAll('<!-- retrieved brain context', '<!-- other context');
    expect(gbrainHookRecall(noHeader, lostProof(), NONCE, true)).toBeNull();
  });

  test('strict b (the default) ignores the probe when settings.json is lost; lenient b counts it', () => {
    const events = parseClaude(realTurn, 's2', 4);
    const strict = gbrainHookRecall(realTurn, lostProof(), NONCE, false);
    const lenient = gbrainHookRecall(realTurn, lostProof(), NONCE, true);
    expect(strict).toBeNull();
    expect(lenient).toEqual({ line: 2, via: 'probe' });
    expect(outcomeOf(finishOf(turn(events, REPLY), NONCE, strict?.line ?? null, true, []), true)).toBe('not-recalled');
    expect(outcomeOf(finishOf(turn(events, REPLY), NONCE, lenient!.line, true, []), true)).toBe('recalled');
  });
});

// ---- rule c: schema from state/openclaw/agents/main/agent/openclaw-agent.sqlite (dest/s06, openclaw-sol-paste r1)
const SCHEMA = [
  "CREATE TABLE memory_index_chunks (chunk_rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, path TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'memory', start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, hash TEXT NOT NULL, model TEXT NOT NULL, text TEXT NOT NULL, embedding BLOB NOT NULL, updated_at INTEGER NOT NULL) STRICT",
  'CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(text, id UNINDEXED, path UNINDEXED, source UNINDEXED, model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED)',
  'CREATE TRIGGER memory_index_chunks_fts_after_insert AFTER INSERT ON memory_index_chunks BEGIN INSERT INTO memory_index_chunks_fts (rowid, text, id, path, source, model, start_line, end_line) VALUES (NEW.chunk_rowid, NEW.text, NEW.id, NEW.path, NEW.source, NEW.model, NEW.start_line, NEW.end_line); END',
  'CREATE TABLE transcript_events (id INTEGER PRIMARY KEY, event TEXT)',
];
const makeState = (name: string, rows: Array<{ source: string; path: string; text: string }>) => {
  const dir = mkdtempSync(join(tmp, 'trial-'));
  const agent = join(dir, 'state', 'openclaw', 'agents', 'main', 'agent');
  mkdirSync(agent, { recursive: true });
  const db = new Database(join(agent, name));
  for (const s of SCHEMA) db.run(s);
  rows.forEach((r, i) => db.run('INSERT INTO memory_index_chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at) VALUES (?, ?, ?, 1, 9, ?, ?, ?, ?, 1794944134498)', ['c' + i, r.path, r.source, 'h' + i, 'fts-only', r.text, new Uint8Array(0)]));
  db.run('INSERT INTO transcript_events (event) VALUES (?)', ["Remember that my sister's new cat is called Skoflouthirn."]);
  db.close();
  return scanState([join(dir, 'state', 'openclaw')], NONCE, dir, join(tmp, 'sqlite'));
};
const sessionsRow = { source: 'sessions', path: 'sessions/main/cee762fc-acff-430e-8426-fd970eb881ff.jsonl', text: "User: Remember that my sister's new cat is called Skoflouthirn.\nAssistant: Remembered." };

describe('rule c: OpenClaw memory_index_chunks rows from its own session index', () => {
  test('sessions-source rows are harness memory to the frozen scan and not under rule c', () => {
    const scan = makeState('openclaw-agent.sqlite', [sessionsRow, { source: 'sessions', path: sessionsRow.path, text: 'unrelated' }]);
    expect(JSON.stringify(scan)).not.toContain(NONCE);
    expect(scan[0]!.tables!.find(t => t.table === 'memory_index_chunks')!.matches).toEqual([{ source: 'sessions', rows: 1 }]);
    const frozen = outsideOf(scan, false).outside;
    expect(frozen.length).toBe(1);
    expect(frozen[0]).toMatch(/^state\/openclaw\/agents\/main\/agent\/openclaw-agent\.sqlite \(memory_index_chunks, memory_index_chunks_fts/);
    const c = outsideOf(scan, true);
    expect(c.outside).toEqual([]);
    expect(c.dropped.some(d => d.endsWith('#memory_index_chunks (1 row, all source=sessions)'))).toBe(true);
    expect(outcomeOf({ reply: true, gbrain_call: true, brain: true, outside_brain: frozen }, true)).toBe('harness-memory');
    expect(outcomeOf({ reply: true, gbrain_call: true, brain: true, outside_brain: c.outside }, true)).toBe('recalled');
  });

  test('negative: a row with another source still counts, and so do its fts tables', () => {
    const scan = makeState('openclaw-agent.sqlite', [sessionsRow, { source: 'memory', path: 'MEMORY.md', text: "- Sister's new cat: Skoflouthirn" }]);
    const frozen = outsideOf(scan, false).outside;
    expect(outsideOf(scan, true).outside).toEqual(frozen);
    expect(frozen[0]).toContain('memory_index_chunks, memory_index_chunks_fts');
  });

  test('negative: rule c applies only in openclaw-agent.sqlite', () => {
    const scan = makeState('other-store.sqlite', [sessionsRow]);
    expect(outsideOf(scan, true).outside).toEqual(outsideOf(scan, false).outside);
    expect(outsideOf(scan, true).outside.length).toBe(1);
  });
});

describe('the frozen order of checks', () => {
  test('outside the brain first, then the finish line, then the install', () => {
    expect(outcomeOf({ reply: true, gbrain_call: true, brain: true, outside_brain: ['state/hermes/memories/USER.md'] }, true)).toBe('harness-memory');
    expect(outcomeOf({ reply: true, gbrain_call: true, brain: false, outside_brain: [] }, true)).toBe('not-recalled');
    expect(outcomeOf({ reply: false, gbrain_call: false, brain: false, outside_brain: [] }, false)).toBe('not-installed');
    expect(outcomeOf({ reply: true, gbrain_call: true, brain: true, outside_brain: [] }, false)).toBe('recalled');
  });
});

describe('conservative harness_error rule', () => {
  test('a harness_error or timeout trial is a miss in every column; the pinned verdict still counts it', () => {
    expect(conservativeOutcome('recalled', 'harness_error')).toBe('not-recalled');
    expect(conservativeOutcome('recalled', 'timeout')).toBe('not-recalled');
    expect(conservativeOutcome('recalled', 'completed')).toBe('recalled');
    expect(conservativeOutcome('harness-memory', 'timeout')).toBe('harness-memory');
    const rec = (n: number, termination: string): InstallTrialRecord => ({
      trial_id: `gbrain-install-2026-11/codex-sol-bare-gbrain-install/gbrain-install/r${n}`, cell: 'codex-sol-bare-gbrain-install', harness: 'codex', model: 'openai:gpt-6.1-sol', wall_ms: 1, started_at: '2026-11-17T12:00:00.000Z', termination,
      install: { arm: 'bare', tag: 'v0.60.734.0', outcome: 'recalled', finish_ms: 1000, agent_turns: 3, non_harness_requests: 0, hinted: { ran: false, reply: false, gbrain_call: false }, classification: { person_needed: [], probe_versions: { first: '0.60.734.0', last: '0.60.734.0' }, infra: null } },
    } as unknown as InstallTrialRecord);
    const records = [rec(1, 'completed'), rec(16, 'harness_error')];
    expect(verdict(records)[0]!.finish.k).toBe(2);
    const conservative = records.map(r => ({ ...r, install: { ...r.install, outcome: conservativeOutcome(r.install.outcome as Outcome, r.termination) } }) as InstallTrialRecord);
    expect(verdict(conservative)[0]!.finish).toMatchObject({ k: 1, n: 2 });
  });
});
