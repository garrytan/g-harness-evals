// The four exposure signals of one gstack /review session on QM (internal-task plan, "Exposure gate"), read from QM's own
// record: the stored session trace of the reviewing session (GET /v1/admin/sessions/:id) and the model requests QM
// captured for it (GET /v1/admin/sessions/:id/llm). Pure, no I/O; review-smoke.ts calls it once per session and
// tests/qm-review-smoke.test.ts feeds it fixture traces.
//
//   1 skill_opened     the review skill was opened, by harnesses/qm/skill-opens.ts's rule (a skills read QM answered with
//                      the file, a files read of review/SKILL.md, or a clean shell read of it).
//   2 specialists      subagent launches whose brief names a reader-map checklist path. QM's subagent tool is subagents
//                      with action open (src/agent/agent-tools/sessions.ts at 90e4ced7); a launch counts once QM answered
//                      it with a sessionId. Readers are named the way gstack-evals src/trial/review/readers.ts names them:
//                      one checklist path is that checklist's reader, two or more is batched, none but an adversarial
//                      marker is adversarial-native, anything else is other.
//   3 adversarial      a started launch whose brief carries one of the map's adversarial markers.
//   4 returned         each started reader's report reached the reviewing session before the session ended. QM delivers a
//                      child's result as a <wake reason="subagent" sessionId="..." kind="..."> block inside a later tool
//                      result or user message of the parent (renderSubagentMail, src/sessions/subagent-mail.ts). The end is
//                      the last trace seq of the told request's final turn (endSeq); a report after it is late.
//
// An unreadable trace (no entries, or no user message with the told line) throws a SignalError with a stable code, so
// the session counts as a gap, never as exposed or not exposed.
import { traceCalls, skillOpens, type SkillOpen } from '../skill-opens.ts';
import { entryFromItem, type Entry } from './s1-count.ts';

export interface ReaderMap { schema_version: 1; gstack: { repo: string; sha: string }; checklists: Record<string, string>; adversarial: string[] }
export const BATCHED = 'batched', ADVERSARIAL = 'adversarial-native', OTHER = 'other';

export interface Launch { call_id: string | null; seq: number | null; name: string | null; isolation: string | null; session_id: string | null; refused: string | null; checklists: string[]; adversarial: boolean; reader: string }
export interface Report { session_id: string; kind: string; seq: number; before_end: boolean }
export interface ReaderResult { reader: string; session_id: string; returned: boolean; returned_before_end: boolean; kind: string | null }
export interface ReviewSignals {
  skill_opened: boolean;
  opens: SkillOpen[];
  subagent_tool_offered: boolean | null;
  launches: Launch[];
  specialists_dispatched: string[];
  adversarial_dispatched: boolean;
  reports: Report[];
  readers: ReaderResult[];
  all_returned_before_end: boolean | null;
  end_seq: number;
}
export class SignalError extends Error {
  constructor(readonly code: 'E_QM_TRACE_EMPTY' | 'E_QM_TRACE_NO_TOLD', message: string) { super(code + ': ' + message); }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The trace's entries: QM answers entries, or items since QM #2964/#2971 (converted by s1-count.ts entryFromItem). */
export function entriesOf(session: unknown): Entry[] {
  const body = obj(session) && obj(session.body) ? session.body : session;
  if (obj(body) && Array.isArray(body.entries)) return body.entries as Entry[];
  if (obj(body) && Array.isArray(body.items)) return (body.items as Array<Record<string, unknown>>).map(entryFromItem);
  return [];
}

/** The reader a launch brief names, by readers.ts's rule. */
export function readerOf(brief: string, map: ReaderMap): { reader: string; checklists: string[]; adversarial: boolean } {
  const checklists = Object.keys(map.checklists).filter((p) => brief.includes(p)).sort();
  const adversarial = map.adversarial.some((m) => brief.includes(m));
  if (checklists.length === 1) return { reader: map.checklists[checklists[0]!]!, checklists, adversarial };
  if (checklists.length > 1) return { reader: BATCHED, checklists, adversarial };
  return { reader: adversarial ? ADVERSARIAL : OTHER, checklists, adversarial };
}

const WAKE = /<wake reason="subagent"[^>]*\bsessionId="([^"]+)"[^>]*\bkind="([^"]+)"/g;
const OPENED = /\(sessionId ([^;)\s]+)/;
const entryText = (e: Entry): string => [e.payload?.result, e.payload?.text, e.payload?.message].map(str).filter(Boolean).join('\n');

/** The four signals for one reviewing session. requests: QM's captured requests for it, in order (for the skill open and
 *  for whether the subagents tool was offered); endSeq: the last trace seq of the told request's final turn. */
export function reviewSignals(o: { session: unknown; requests?: Array<Record<string, unknown>>; map: ReaderMap; told: string; endSeq?: number; skill?: string }): ReviewSignals {
  const entries = entriesOf(o.session);
  if (!entries.length) throw new SignalError('E_QM_TRACE_EMPTY', 'the stored session has no entries or items (want GET /v1/admin/sessions/:id?limit=50000)');
  if (!entries.some((e) => e.type === 'user' && str(e.payload?.text).includes(o.told.slice(0, 200)))) throw new SignalError('E_QM_TRACE_NO_TOLD', 'no user message in the stored session carries the told line');
  const endSeq = o.endSeq ?? Math.max(...entries.map((e) => e.seq));
  const skill = o.skill ?? 'review';
  const opens = skillOpens({ catalog: [skill], session: o.session, ...(o.requests ? { requests: o.requests } : {}) });
  const offered = o.requests?.length ? o.requests.some((b) => Array.isArray(b.tools) && (b.tools as Array<{ name?: unknown }>).some((t) => t?.name === 'subagents')) : null;
  const seqOf = new Map<string, number>();
  for (const e of entries) if (e.type === 'tool_call' && str(e.payload?.callId)) seqOf.set(str(e.payload!.callId), e.seq);
  const launches: Launch[] = traceCalls(o.session).filter((c) => c.tool === 'subagents' && str(c.args.action) === 'open').map((c) => {
    const sid = OPENED.exec(c.resultText ?? '')?.[1] ?? null;
    const refused = c.isError || !sid ? (c.resultText ?? 'no answer').slice(0, 300) : null;
    return { call_id: c.id, seq: c.id ? seqOf.get(c.id) ?? null : null, name: str(c.args.name) || null, isolation: str(c.args.isolation) || null, session_id: refused ? null : sid, refused, ...readerOf(str(c.args.task), o.map) };
  });
  const reports: Report[] = [];
  for (const e of entries) for (const m of entryText(e).matchAll(WAKE)) {
    if (!reports.some((r) => r.session_id === m[1] && r.seq === e.seq)) reports.push({ session_id: m[1]!, kind: m[2]!, seq: e.seq, before_end: e.seq <= endSeq });
  }
  const readers = launches.filter((l) => l.session_id).map((l): ReaderResult => {
    const final = reports.filter((r) => r.session_id === l.session_id && r.kind !== 'in_progress');
    return { reader: l.reader, session_id: l.session_id!, returned: final.length > 0, returned_before_end: final.some((r) => r.before_end), kind: final[0]?.kind ?? null };
  });
  return {
    skill_opened: opens.opened.includes(skill),
    opens: opens.opens,
    subagent_tool_offered: offered,
    launches,
    specialists_dispatched: [...new Set(launches.filter((l) => l.session_id && l.checklists.length).map((l) => l.reader))].sort(),
    adversarial_dispatched: launches.some((l) => l.session_id && l.adversarial),
    reports,
    readers,
    all_returned_before_end: readers.length ? readers.every((r) => r.returned_before_end) : null,
    end_seq: endSeq,
  };
}
