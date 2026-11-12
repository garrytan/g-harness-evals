// internal-task "Got the skill" on QM (docs/benchmarks/2026-11-08-skill-resolver/PREREGISTRATION.md, Measures): the catalog
// skills a trial opened, from the captured model requests and from QM's stored tool trace. Pure, no I/O;
// tests/qm-skill-opens.test.ts feeds it fixture traces, scripts/skill-resolver/step0/qm/arms/qm-arms-check.ts real ones.
//
// An open is one of:
//   skills   a skills tool call with action read whose answer is the file (QM's answer is "[no such skill file: ...]"
//            when it is not; the trace's tool_result says found false). The name is the call's name argument.
//   files    a files tool read of a path ending in <name>/SKILL.md that QM answered with the file. QM syncs a read skill
//            to <sandbox root>/.agent-skills/<session>/<hash>/<name>/ (src/skills/materialize.ts at 90e4ced7), so any
//            directory prefix counts.
//   execute  an execute call that exited 0 and reads <name>/SKILL.md by scripts/skill-resolver/got-skill.ts's shell rule
//            (shellReadArgs: a command segment whose program is a reader, cat, head, tail, sed without -i, less, more, nl,
//            awk, bat or tac, with the path as an argument and not a redirect target, so cat > <name>/SKILL.md is a write),
//            and whose answer has no reader error for that path (No such file or directory, Permission denied, Is a
//            directory): the exit code of a pipeline is its last command's, so cat <missing> | head still exits 0.
// Only names in the catalog count as opened; reads of other skills (QM's own browse, onboarding) are listed apart.
import { entryFromItem, toolCalls, type Entry } from './gstack/s1-count.ts';
import { shellReadArgs } from '../../scripts/skill-resolver/got-skill.ts';

export type Via = 'skills' | 'files' | 'execute';
export interface SkillOpen { skill: string; via: Via; source: 'request' | 'trace'; call_id: string | null; path: string | null; found: boolean }
export interface SkillOpens { opened: string[]; opens: SkillOpen[]; other: SkillOpen[]; refused: SkillOpen[] }

interface RawCall { id: string | null; tool: string; args: Record<string, unknown>; resultText: string | null; isError: boolean; found: boolean | null; code: number | null; source: 'request' | 'trace' }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const parseArgs = (v: unknown): Record<string, unknown> => {
  if (obj(v)) return v;
  try { const j = JSON.parse(str(v)); return obj(j) ? j : {}; } catch { return {}; }
};
const exitOf = (text: string): number | null => { const m = /\[exit (-?\d+)\]\s*$/.exec(text); return m ? Number(m[1]) : null; };

/** Tool calls in one captured request: Anthropic tool_use/tool_result blocks, or Responses function_call and
 *  function_call_output items. */
export function requestCalls(body: Record<string, unknown>): RawCall[] {
  const results = new Map<string, { text: string; isError: boolean }>();
  const calls: Array<{ id: string; tool: string; args: Record<string, unknown> }> = [];
  for (const m of (Array.isArray(body.messages) ? body.messages : []) as Array<{ content?: unknown }>) {
    if (!Array.isArray(m.content)) continue;
    for (const c of m.content as Array<Record<string, unknown>>) {
      if (c.type === 'tool_use') calls.push({ id: str(c.id), tool: str(c.name), args: parseArgs(c.input) });
      if (c.type === 'tool_result') results.set(str(c.tool_use_id), { text: typeof c.content === 'string' ? c.content : Array.isArray(c.content) ? (c.content as Array<{ text?: string }>).map((x) => x.text ?? '').join('') : '', isError: c.is_error === true });
    }
  }
  for (const x of (Array.isArray(body.input) ? body.input : []) as Array<Record<string, unknown>>) {
    if (x.type === 'function_call') calls.push({ id: str(x.call_id), tool: str(x.name), args: parseArgs(x.arguments) });
    if (x.type === 'function_call_output') results.set(str(x.call_id), { text: typeof x.output === 'string' ? x.output : JSON.stringify(x.output ?? ''), isError: false });
  }
  return calls.map((c) => {
    const r = results.get(c.id);
    return { id: c.id || null, tool: c.tool, args: c.args, resultText: r ? r.text : null, isError: r?.isError ?? false, found: null, code: r ? exitOf(r.text) : null, source: 'request' as const };
  });
}

/** Tool calls in QM's stored session (GET /v1/admin/sessions/:id answers entries, or items since QM #2964/#2971). */
export function traceCalls(session: unknown): RawCall[] {
  const body = obj(session) && obj(session.body) ? session.body : session;
  const entries: Entry[] = obj(body) && Array.isArray(body.entries) ? (body.entries as Entry[]) : obj(body) && Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>).map(entryFromItem) : [];
  return toolCalls(entries).map((c) => ({
    id: c.callId, tool: c.tool, args: c.args, resultText: c.result ? str(c.result.result) : null, isError: c.result?.isError === true,
    found: typeof c.result?.found === 'boolean' ? (c.result.found as boolean) : null, code: typeof c.result?.code === 'number' ? (c.result.code as number) : c.result ? exitOf(str(c.result.result)) : null, source: 'trace' as const,
  }));
}

const READ_ERROR = /No such file or directory|Permission denied|Is a directory/;
const SKILL_MD = /([\w.-]+)\/SKILL\.md\b/g;
const NOT_FOUND = /^\s*(?:\[no such (?:skill )?file|Validation failed for tool)/;

function opensOf(c: RawCall): SkillOpen[] {
  const answered = c.resultText !== null || c.found !== null;
  const ok = answered && !c.isError && c.found !== false && !NOT_FOUND.test(c.resultText ?? '');
  const open = (skill: string, via: Via, path: string | null, found: boolean): SkillOpen => ({ skill, via, source: c.source, call_id: c.id, path, found });
  if (c.tool === 'skills' && str(c.args.action) === 'read' && str(c.args.name)) return [open(str(c.args.name), 'skills', str(c.args.path) || null, ok)];
  if (c.tool === 'files' && str(c.args.action) === 'read') {
    const m = /(?:^|\/)([\w.-]+)\/SKILL\.md$/.exec(str(c.args.path));
    return m ? [open(m[1]!, 'files', str(c.args.path), ok)] : [];
  }
  if (c.tool === 'execute') {
    const errors = (c.resultText ?? '').split('\n').filter((l) => READ_ERROR.test(l));
    const names = new Set(shellReadArgs(str(c.args.command)).flatMap((w) => [...w.matchAll(SKILL_MD)].map((m) => m[1]!)));
    return [...names].map((n) => open(n, 'execute', null, ok && c.code === 0 && !errors.some((l) => [...l.matchAll(SKILL_MD)].some((m) => m[1] === n))));
  }
  return [];
}

/** The catalog skills a trial opened. requests: the captured request bodies of the trial, in order (each later request
 *  repeats the history, so calls are kept once per call id); session: QM's stored session. Either may be omitted. */
export function skillOpens(o: { catalog: Iterable<string>; requests?: Array<Record<string, unknown>>; session?: unknown }): SkillOpens {
  const catalog = new Set(o.catalog);
  const seen = new Map<string, RawCall>();
  for (const body of o.requests ?? []) for (const c of requestCalls(body)) {
    const key = 'request:' + (c.id ?? JSON.stringify(c.args));
    const prev = seen.get(key);
    if (!prev || (prev.resultText === null && c.resultText !== null)) seen.set(key, c);
  }
  const calls = [...seen.values(), ...(o.session === undefined ? [] : traceCalls(o.session))];
  const all = calls.flatMap(opensOf);
  const opens = all.filter((x) => x.found && catalog.has(x.skill));
  return {
    opened: [...new Set(opens.map((x) => x.skill))].sort(),
    opens,
    other: all.filter((x) => x.found && !catalog.has(x.skill)),
    refused: all.filter((x) => !x.found),
  };
}
