// Pure counters for the S1 gstack probe (docs/benchmarks/2026-11-03-qm-s1-gstack-probe/PREREGISTRATION.md, "Counting").
// Input: one turn's stored QM session (GET /v1/admin/sessions/:id?scope=personal:<member>&limit=50000), the staged skill
// files and the request. Output: opens, matched opens, complete reads, starts, the progress marker, the contamination
// audit and the fixture faults. No I/O; s1-probe.ts calls countTurn once per turn and tests/qm-s1-probe.test.ts feeds it
// sessions shaped like QM b6786d67's.
//
// QM stores each tool call as a tool_call entry whose payload names the tool (payload.tool) and carries the model's raw
// arguments (payload.wire.argumentsJson, present even when QM's argument check refused the call), and each answer as a
// tool_result entry with the same callId: files reads carry path, bytes, found, result and, when QM cut the text at
// 16,384 characters, output {chars, shownChars, blob}; execute answers carry code and result.

export const SKILL_ROOT = '/root/workspace/gstack';
export const REPO_ROOT = '/root/workspace/repo';
export const ARMS = ['gstack-router', 'no-gstack'] as const;
export type Arm = (typeof ARMS)[number];

/** The five invented requests, word for word as preregistered (design.json "requests"). progress names the marker of
 *  "Task progress" (null for request 3, which asks for care, not an action). */
export const REQUESTS = [
  { id: 1, skill: 'investigate', progress: 'login-test-or-log', text: 'Something in my branch broke the login test since yesterday. Can you find out why before I touch anything?' },
  { id: 2, skill: 'review', progress: 'diff', text: 'Before I merge, can you review the diff on my feature branch for anything risky?' },
  { id: 3, skill: 'careful', progress: null, text: "I'm about to run a cleanup script on the prod database box. Be extra careful with anything destructive while we work." },
  { id: 4, skill: 'document-release', progress: 'log-describe-or-tag', text: 'Write up release notes for what changed since the last tag.' },
  { id: 5, skill: 'learn', progress: 'memory-write', text: 'Save what we learned today about the flaky retry test so you remember it next time.' },
] as const;
export type Request = (typeof REQUESTS)[number];

/** Start, preamble: the skill's own gstack command (they do not exist in QM's sandbox; the attempt is the marker). */
const PREAMBLE: Record<string, RegExp[]> = {
  investigate: [/gstack-skill-start\b[^\n]*--skill[= ]+["']?investigate\b/],
  review: [/gstack-skill-start\b[^\n]*--skill[= ]+["']?review\b/],
  'document-release': [/gstack-skill-start\b[^\n]*--skill[= ]+["']?document-release\b/],
  learn: [/gstack-skill-start\b[^\n]*--skill[= ]+["']?learn\b/, /gstack-learnings-(?:search|log)\b/],
  careful: [/gstack-paths\b/, /"skill":"careful"/],
};
/** Start, first step: the skill's own first-step command; careful and learn have none. */
const FIRST_STEP: Record<string, RegExp[] | null> = {
  investigate: [/git log --oneline -20 --/],
  review: [/git remote get-url origin/, /gh pr view --json baseRefName/, /git symbolic-ref refs\/remotes\/origin\/HEAD/],
  'document-release': [/git remote get-url origin/, /gh pr view --json baseRefName/, /git symbolic-ref refs\/remotes\/origin\/HEAD/],
  careful: null,
  learn: null,
};
const GIT = (sub: string) => new RegExp('\\bgit(?:\\s+-C\\s+\\S+)?\\s+' + sub + '\\b');
const PROGRESS: Record<string, RegExp[]> = {
  'login-test-or-log': [/\bnode\s+\S*login\.test/, /\bnpm\s+(?:run\s+)?test\b/, GIT('log')],
  diff: [GIT('diff')],
  'log-describe-or-tag': [GIT('log'), GIT('describe'), GIT('tag')],
};
/** A command that works in the fixture repository: it names the repository's path, or cds or -C's into repo. */
const IN_REPO = /\/root\/workspace\/repo\b|~\/workspace\/repo\b|(?:^|[\s;&(])(?:cd|-C)\s+(?:\.\/)?repo(?:\/|\b)/;
/** The preregistered reading commands for an execute open: a command segment (split on ;, &&, ||, | and newlines) whose
 *  command is cat, sed or head and which names the skill's path itself. */
const SEGMENT = /;|&&|\|\||\||\n/;
const READS = /^\s*\(?\s*(?:cat|sed|head)\b/;
const SKILL_IN_COMMAND = /(?:\/root\/workspace\/|~\/workspace\/|(?<![\w./-]))gstack\/([\w.-]+)\/SKILL\.md/g;
const AUDIT = /(?<![a-z])gstack|SKILL\.md/i;
const CUT_MARKER = /…\[output cut: showing the first (\d+) and last (\d+) of (\d+) chars\. The full output is in (tool-output\/[\w/]+);[^\]]*\]…/;

export interface Entry { seq: number; type: string; payload?: Record<string, unknown> }

/** QM after #2964 and #2971 (2026-11-03) answers GET /v1/admin/sessions/:id with items, not entries. This is QM b6786d67's
 *  own read-side converter (src/sessions/items.ts entryFromItem at b6786d67), so a newer QM's items reach these counters in
 *  the entry shape they were written for. A column the wire omits counts as null. */
export function entryFromItem(item: Record<string, unknown>): Entry {
  const seq = typeof item.seq === 'number' ? item.seq : typeof item.seq === 'string' && item.seq.trim() !== '' ? Number(item.seq) : NaN;
  if (!Number.isFinite(seq)) throw new Error('entryFromItem: item seq ' + JSON.stringify(item.seq ?? null) + ' is not a number, so the session cannot be counted');
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const col = (k: string): unknown => (item[k] === undefined ? null : item[k]);
  const kind = String(item.kind ?? '');
  const payload: Record<string, unknown> = { ...(obj(item.body) ? item.body : {}) };
  if (col('blobSha')) payload.output = { ...(obj(payload.output) ? payload.output : {}), blob: col('blobSha') };
  const put = (key: string, value: unknown) => { if (value != null) payload[key] = value; };
  const ENTRY_TYPES: Record<string, string> = { UserMessage: 'user', SteeringMessage: 'user', AgentMessage: 'assistant', Reasoning: 'thinking', ToolCall: 'tool_call', ToolResult: 'tool_result', Elicitation: 'approval_request', ElicitationResponse: 'approval_resolved' };
  const TEXT_KEYS: Record<string, string> = { UserMessage: 'text', SteeringMessage: 'text', AgentMessage: 'text', ContextCompaction: 'text', Reasoning: 'thinking', ToolResult: 'result', Error: 'message' };
  let type = ENTRY_TYPES[kind] ?? 'system';
  if (kind === 'AgentMessage') { if (col('variant') === 'narration') type = 'text'; else if (col('variant') === 'files_delivered') type = 'delivery'; }
  const textKey = TEXT_KEYS[kind];
  if (textKey && (col('text') !== null || !(textKey in payload))) put(textKey, col('text') ?? '');
  put('runId', col('turnId')); put('callId', col('callId')); put('tool', col('tool')); put('requestId', col('elicitId')); put('isError', col('isError'));
  put('hidden', col('hidden')); put('ts', col('externalId')); put('throughSeq', col('throughSeq')); put('approved', col('approved'));
  if (kind === 'SteeringMessage') payload.steered = true;
  if (type === 'system') {
    const SYSTEM_KINDS: Record<string, string> = { ContextCompaction: 'context_summary', Retraction: 'message_revision', Error: 'turn_failure', Stop: 'turn_stopped' };
    payload.kind = SYSTEM_KINDS[kind] ?? (payload.kind === 'goal_cancelled' ? 'goal_cancelled' : 'wake');
  }
  put('cause', col('wakeCause'));
  const wire = payload.wire;
  if (col('step') != null || (obj(wire) && obj(wire.message))) payload.step = { ...(obj(wire) && obj(wire.message) ? wire.message : {}), ...(col('step') == null ? {} : { index: col('step') }) };
  return { seq, type, payload };
}
export interface StagedFile { sandbox_path: string; chars: number; text?: string }
export interface Call { seq: number; callId: string | null; tool: string; args: Record<string, unknown>; raw: string; result: Record<string, unknown> | null; resultSeq: number | null }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Every tool call of a stored session with the answer QM stored for it, in order. */
export function toolCalls(entries: Entry[]): Call[] {
  const results = new Map<string, Entry>();
  for (const e of entries) if (e.type === 'tool_result' && str(e.payload?.callId)) results.set(str(e.payload!.callId), e);
  return entries.filter((e) => e.type === 'tool_call').map((e) => {
    const p = e.payload ?? {};
    const raw = str((p.wire as { argumentsJson?: unknown } | undefined)?.argumentsJson);
    let parsed: Record<string, unknown> = {};
    try { const j = JSON.parse(raw); if (j && typeof j === 'object') parsed = j; } catch { /* keep the stored fields */ }
    const { wire: _w, step: _s, runId: _r, callId: _c, tool: _t, ...stored } = p;
    const callId = str(p.callId) || null;
    const res = callId ? results.get(callId) : undefined;
    return { seq: e.seq, callId, tool: str(p.tool), args: { ...stored, ...parsed }, raw: raw || JSON.stringify(stored), result: res?.payload ?? null, resultSeq: res?.seq ?? null };
  });
}

const absolute = (path: string) => (path.startsWith('/') ? path : path.startsWith('~/') ? '/root/' + path.slice(2) : '/root/workspace/' + path.replace(/^\.\//, ''));
/** The skill a staged path belongs to: /root/workspace/gstack/<skill>/SKILL.md; null for the root SKILL.md or another path. */
export const skillOf = (path: string): string | null => new RegExp('^' + SKILL_ROOT + '/([\\w.-]+)/SKILL\\.md$').exec(absolute(path))?.[1] ?? null;
const filePath = (c: Call) => absolute(str(c.result?.path) || str(c.args.path));
const command = (c: Call) => (c.tool === 'execute' ? str(c.args.command) : '');
const resultText = (c: Call) => str(c.result?.result);
/** QM refused the call: no answer, an error answer, or its argument check's "Validation failed" text. */
const refused = (c: Call) => !c.result || c.result.isError === true || /^Validation failed for tool/.test(resultText(c));
const cutOf = (c: Call) => { const o = c.result?.output as { chars?: number; shownChars?: number } | undefined; return o && typeof o.chars === 'number' && typeof o.shownChars === 'number' && o.shownChars < o.chars ? o : null; };

export interface Open { seq: number; skill: string; via: 'files' | 'execute'; path: string; cut: boolean }

/** Opens: a files read of a staged skill path that QM answered with the file (found: true), or an execute that exited 0
 *  with a cat, sed or head segment naming the skill's path. */
export function opens(calls: Call[]): Open[] {
  const out: Open[] = [];
  for (const c of calls) {
    if (c.tool === 'files' && str(c.args.action) === 'read') {
      const skill = skillOf(filePath(c));
      if (skill && c.result && c.result.found === true && !c.result.isError) out.push({ seq: c.seq, skill, via: 'files', path: filePath(c), cut: !!cutOf(c) });
    } else if (c.tool === 'execute' && c.result && c.result.code === 0) {
      for (const m of command(c).split(SEGMENT).filter((s) => READS.test(s)).flatMap((s) => [...s.matchAll(SKILL_IN_COMMAND)])) out.push({ seq: c.seq, skill: m[1]!, via: 'execute', path: SKILL_ROOT + '/' + m[1] + '/SKILL.md', cut: !!cutOf(c) });
    }
  }
  return out;
}

/** Lines of a delivered text, without QM's cut marker. */
const deliveredLines = (text: string) => text.replace(CUT_MARKER, '\n').split('\n');

/** How the matched skill was read completely, if it was: inline (one files read, not cut, bytes equal to the staged
 *  characters), cut (a cut read whose head and tail, plus later reads of the staged path or of the parked tool-output copy,
 *  deliver every non-blank line of the staged file), or pieces (execute reads alone deliver every line). Needs the staged text. */
export function completeRead(calls: Call[], staged: StagedFile): 'inline' | 'cut' | 'pieces' | null {
  const reads = calls.filter((c) => c.tool === 'files' && str(c.args.action) === 'read' && filePath(c) === staged.sandbox_path && c.result && c.result.found !== false);
  if (reads.some((c) => !cutOf(c) && c.result!.bytes === staged.chars)) return 'inline';
  if (staged.text === undefined) return null;
  const parked = new Set<string>();
  for (const c of reads) { const m = CUT_MARKER.exec(resultText(c)); if (m) parked.add(m[4]!.split('/').pop()!); }
  const names = (c: Call) => { const s = c.raw + ' ' + str(c.result?.path); return s.includes(staged.sandbox_path) || s.includes(staged.sandbox_path.slice('/root/workspace/'.length)) || [...parked].some((id) => s.includes(id)); };
  const pieces = calls.filter((c) => c.result && !reads.includes(c) && (c.tool === 'execute' || c.tool === 'files') && names(c));
  const delivered = new Set([...reads, ...pieces].flatMap((c) => deliveredLines(resultText(c))));
  const covered = staged.text.split('\n').every((line) => !line.trim() || delivered.has(line));
  if (!covered) return null;
  return reads.some((c) => cutOf(c)) ? 'cut' : pieces.length ? 'pieces' : null;
}

export interface TurnCounts {
  opens: Open[];
  open_any: boolean;
  open_matched: boolean;
  root_reads: number;
  complete_read: 'inline' | 'cut' | 'pieces' | null;
  cut_reads: number;
  read_after_cut: boolean;
  start_preamble: boolean;
  start_first_step: boolean | null;
  progress: boolean | null;
  audit: Array<{ seq: number; tool: string; text: string }>;
  contaminated: boolean;
  faults: string[];
}

export interface TurnInput { arm: Arm; request: Pick<Request, 'skill' | 'progress'>; entries: Entry[]; staged: StagedFile[]; routerInFirstPrompt: boolean | null }

export function countTurn(t: TurnInput): TurnCounts {
  const calls = toolCalls(t.entries);
  const o = opens(calls);
  const matched = o.filter((x) => x.skill === t.request.skill);
  const firstMatched = matched.length ? Math.min(...matched.map((x) => x.seq)) : Infinity;
  const after = calls.filter((c) => c.seq > firstMatched);
  const any = (cs: Call[], res: RegExp[]) => cs.some((c) => res.some((r) => r.test(command(c))));
  const firstStep = FIRST_STEP[t.request.skill] ?? null;
  const target = t.staged.find((s) => skillOf(s.sandbox_path) === t.request.skill);
  const cutSeqs = calls.filter((c) => c.tool === 'files' && skillOf(filePath(c)) && cutOf(c)).map((c) => c.seq);
  const progress = t.request.progress === null ? null
    : t.request.progress === 'memory-write' ? calls.some((c) => c.tool === 'memory' && ['add', 'edit'].includes(str(c.args.action)) && !refused(c))
    : calls.some((c) => typeof c.result?.code === 'number' && IN_REPO.test(command(c)) && PROGRESS[t.request.progress!]!.some((r) => r.test(command(c))));
  const audit = calls.filter((c) => AUDIT.test(c.raw) || AUDIT.test(str(c.result?.path))).map((c) => ({ seq: c.seq, tool: c.tool, text: (command(c) || str(c.args.path) || c.raw).slice(0, 300) }));
  const stagedPaths = new Set(t.staged.map((s) => s.sandbox_path));
  const faults: string[] = [];
  if (t.arm === 'gstack-router' && calls.some((c) => (c.tool === 'files' && stagedPaths.has(filePath(c)) && /^\[(?:no such file|not in the computer's workspace)/.test(resultText(c))))) faults.push('staged-file-missing');
  if (calls.some((c) => resultText(c).includes('this scope has no default sandbox'))) faults.push('no-default-sandbox');
  if (t.arm === 'gstack-router' && t.routerInFirstPrompt !== true) faults.push(t.routerInFirstPrompt === false ? 'router-missing-from-system-prompt' : 'router-prompt-unread');
  return {
    opens: o,
    open_any: o.length > 0,
    open_matched: matched.length > 0,
    root_reads: calls.filter((c) => c.tool === 'files' && filePath(c) === SKILL_ROOT + '/SKILL.md' && c.result?.found !== false).length,
    complete_read: target && matched.length ? completeRead(calls, target) : null,
    cut_reads: cutSeqs.length,
    read_after_cut: cutSeqs.length > 0 && calls.some((c) => c.seq > Math.min(...cutSeqs) && (AUDIT.test(c.raw) || /tool-output\//.test(c.raw))),
    start_preamble: matched.length > 0 && any(after, PREAMBLE[t.request.skill] ?? []),
    start_first_step: firstStep === null ? null : matched.length > 0 && any(after, firstStep),
    progress,
    audit,
    contaminated: t.arm === 'no-gstack' && audit.length > 0,
    faults,
  };
}

