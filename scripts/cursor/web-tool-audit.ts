#!/usr/bin/env bun
// The tool audit of Cursor trials (harnesses/cursor/README.md, "Web tools"; plan item F1). Cursor's docs give no switch
// that turns web search off and no stream-json event name for it, so this audit reads documented records only:
//   - <trial>/logs/tool-hooks.ndjson, one line per tool call from the adapter's postToolUse and postToolUseFailure hooks
//     (https://cursor.com/docs/hooks: they fire for every tool, with tool_name). A tool_name outside the documented
//     matcher values (Shell, Read, Write, Grep, Delete, Task, MCP:<tool>) is flagged;
//   - the turns' status.json tool_calls_started, counted from the documented stream-json tool_call records: a trial with
//     tool calls in its stream and no hook line is flagged, because then the hooks did not record what ran;
//   - the run's egress.ndjson (beside trials.jsonl): a denied host outside *.cursor.sh is flagged.
// A reader confirms from the logs whether a flagged call was a web call. Exit 1 when any trial is flagged, 0 when none
// is, 2 for a usage error.
//
// A frontier Harbor Cursor trial (scripts/frontier-harbor, record paths.trial_dir beside trials.jsonl) keeps the same
// records under <trial dir>/harbor/agent/: cursor-tool-hooks.ndjson and cursor-status.json. Its egress sidecar logs no
// host decision, so it has no egress line.
//
//   bun scripts/cursor/web-tool-audit.ts <trials.jsonl> [...]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DOCUMENTED_TOOLS = ['Shell', 'Read', 'Write', 'Grep', 'Delete', 'Task'];
const documented = (name: string) => DOCUMENTED_TOOLS.includes(name) || name.startsWith('MCP:');

export interface TrialAudit { hook_calls: number; undocumented: Record<string, number>; unparsed_hook_lines: number; stream_tool_calls: number; denied_hosts: string[]; flags: string[] }

export function auditTrial(trialDir: string, deniedHosts: string[] = []): TrialAudit {
  const harbor = existsSync(join(trialDir, 'harbor', 'agent'));
  const logs = harbor ? join(trialDir, 'harbor', 'agent') : join(trialDir, 'logs');
  const out: TrialAudit = { hook_calls: 0, undocumented: {}, unparsed_hook_lines: 0, stream_tool_calls: 0, denied_hosts: deniedHosts, flags: [] };
  const hooks = join(logs, harbor ? 'cursor-tool-hooks.ndjson' : 'tool-hooks.ndjson');
  if (existsSync(hooks)) {
    for (const l of readFileSync(hooks, 'utf8').split('\n').filter((x) => x.trim())) {
      let ev: { tool_name?: unknown; unparsed?: boolean };
      try { ev = JSON.parse(l); } catch { out.unparsed_hook_lines++; continue; }
      if (ev.unparsed || typeof ev.tool_name !== 'string') { out.unparsed_hook_lines++; continue; }
      out.hook_calls++;
      if (!documented(ev.tool_name)) out.undocumented[ev.tool_name] = (out.undocumented[ev.tool_name] ?? 0) + 1;
    }
  }
  for (const d of [join(logs, 'turns'), logs]) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((n) => n.endsWith('.status.json') || (harbor && n === 'cursor-status.json'))) {
      try { out.stream_tool_calls += Number((JSON.parse(readFileSync(join(d, f), 'utf8')) as { tool_calls_started?: number }).tool_calls_started ?? 0); }
      catch { out.flags.push('unreadable ' + f); }
    }
  }
  if (!existsSync(hooks)) out.flags.push('no ' + (harbor ? 'cursor-tool-hooks.ndjson' : 'tool-hooks.ndjson'));
  for (const [k, v] of Object.entries(out.undocumented)) out.flags.push('tool ' + k + ' x' + v);
  if (out.unparsed_hook_lines) out.flags.push(out.unparsed_hook_lines + ' unreadable hook lines');
  if (out.stream_tool_calls > 0 && out.hook_calls === 0) out.flags.push(out.stream_tool_calls + ' tool calls in the stream, none in the hook log');
  for (const h of deniedHosts) out.flags.push('egress denied ' + h);
  return out;
}

/** Denied hosts per trial from egress.ndjson, hosts under cursor.sh left out (Cursor's own, docs/enterprise/network-configuration). */
export function deniedByTrial(egressFile: string): Map<string, string[]> {
  const by = new Map<string, Set<string>>();
  if (!existsSync(egressFile)) return new Map();
  for (const l of readFileSync(egressFile, 'utf8').split('\n').filter((x) => x.trim())) {
    let d: { trial?: string | null; decision?: string; host?: string; port?: number };
    try { d = JSON.parse(l); } catch { continue; }
    if (d.decision !== 'deny' || !d.trial || !d.host || d.host === 'cursor.sh' || d.host.endsWith('.cursor.sh')) continue;
    if (!by.has(d.trial)) by.set(d.trial, new Set());
    by.get(d.trial)!.add(d.host + ':' + d.port);
  }
  return new Map([...by].map(([k, v]) => [k, [...v].sort()]));
}

export function main(argv: string[]): number {
  if (!argv.length) { console.error('usage: bun scripts/cursor/web-tool-audit.ts <trials.jsonl> [...]'); return 2; }
  let trials = 0, flagged = 0;
  for (const file of argv) {
    const denied = deniedByTrial(join(dirname(file), 'egress.ndjson'));
    for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l) as { trial_id: string; harness: string; paths?: { dir?: string; trial_dir?: string } };
      const dir = r.paths?.dir ?? (r.paths?.trial_dir ? join(dirname(file), r.paths.trial_dir) : undefined);
      if (r.harness !== 'cursor' || !dir) continue;
      trials++;
      const a = auditTrial(dir, denied.get(r.trial_id) ?? []);
      if (a.flags.length) { flagged++; console.log(r.trial_id + ': ' + a.flags.join(', ')); }
    }
  }
  console.log('web-tool-audit (cursor): ' + trials + ' trials, ' + flagged + ' flagged for a reader');
  return flagged ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
