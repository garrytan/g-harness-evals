// Builds the exposure fixtures (tests/fixtures/review-bugs/exposure/) into a session output dir with each harness's real
// layout, for tests/review-bugs/exposure.test.ts. The sqlite stores are kept in the repository as JSON row dumps
// (<case>/openclaw.rows.json, <case>/hermes.rows.json) of the rows the canary runs wrote, so a fixture diff is readable;
// this file writes them back into a store with the columns the readers query. Codex rollouts and Claude Code transcripts
// are copied as they are. See the README beside this file for where each case came from.
import { Database } from 'bun:sqlite';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const FIXTURES = import.meta.dir;

export function materialize(harness: string, name: string): string {
  const src = join(FIXTURES, harness, name);
  const out = mkdtempSync(join(tmpdir(), 'exposure-fx-'));
  if (harness === 'claude-code') { cpSync(src, out, { recursive: true }); return out; }
  if (harness === 'codex') {
    const dir = join(out, 'state', 'codex', 'sessions', '2026', '11', '14');
    mkdirSync(dir, { recursive: true });
    for (const f of existsSync(src) ? readdirSync(src) : []) if (f.endsWith('.jsonl')) cpSync(join(src, f), join(dir, f));
    return out;
  }
  if (harness === 'openclaw') {
    const dir = join(out, 'state', 'openclaw', 'exec', 'agents', 'main', 'agent');
    mkdirSync(dir, { recursive: true });
    const file = join(src, 'openclaw.rows.json');
    if (!existsSync(file)) return out;
    const rows = JSON.parse(readFileSync(file, 'utf8'));
    if (rows === 'EMPTY_FILE') { writeFileSync(join(dir, 'openclaw-agent.sqlite'), ''); return out; }
    const db = new Database(join(dir, 'openclaw-agent.sqlite'));
    db.run('create table transcript_events (session_id text, seq integer, created_at integer, event_json text, event_zstd blob, primary key (session_id, seq))');
    for (const r of rows as Array<{ session_id: string; seq: number; created_at: number; event_json: string }>) db.query('insert into transcript_events values (?, ?, ?, ?, null)').run(r.session_id, r.seq, r.created_at, r.event_json);
    db.close();
    return out;
  }
  const dir = join(out, 'state', 'hermes');
  mkdirSync(dir, { recursive: true });
  const file = join(src, 'hermes.rows.json');
  if (!existsSync(file)) return out;
  const dump = JSON.parse(readFileSync(file, 'utf8'));
  if (dump === 'EMPTY_FILE') { writeFileSync(join(dir, 'state.db'), ''); return out; }
  const db = new Database(join(dir, 'state.db'));
  db.run('create table sessions (id text primary key, source text, parent_session_id text, started_at real, ended_at real, end_reason text)');
  db.run('create table messages (id integer primary key, session_id text, role text, content text, tool_call_id text, tool_calls text, tool_name text, finish_reason text, display_kind text, timestamp real)');
  for (const s of dump.sessions) db.query('insert into sessions values (?, ?, ?, ?, ?, ?)').run(s.id, s.source, s.parent_session_id, s.started_at, s.ended_at, s.end_reason);
  for (const m of dump.messages) db.query('insert into messages values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(m.id, m.session_id, m.role, m.content, m.tool_call_id, m.tool_calls, m.tool_name, m.finish_reason, m.display_kind, m.timestamp);
  db.close();
  return out;
}
