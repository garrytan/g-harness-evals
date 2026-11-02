#!/usr/bin/env bun
// gn-hard-follow-2026-11 analysis: re-probe every trial with skill-probe.ts at PR #210's head 409d6946 (read-only import),
// apply the frozen rule, and print per-arm tables. Counts and bits only.
//   bun analyze.ts <run dir>
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { probeTrialDir, wilson } from '/home/user/.capy/work/wt-opus-native-plan/scripts/gstack-laneb/skill-probe.ts';

const rd = process.argv[2]!;
const shards = ['opus-hard-gstack', 'opus-hard-none'];
const rows: any[] = [];
for (const s of shards) {
  const res = join(rd, 'shards', s, 'results');
  const f = join(res, 'trials.jsonl');
  if (!existsSync(f)) { console.log('missing ' + f); continue; }
  for (const l of readFileSync(f, 'utf8').split('\n').filter((x) => x.trim())) {
    const t = JSON.parse(l);
    const dir = join(res, t.paths?.trial_dir ?? '', 'harbor');
    const probe = probeTrialDir(dir, 'investigate');
    t.laneb = { ...(t.laneb ?? {}), skill_probe: probe };
    const mp = join(dir, 'artifacts', 'logs', 'artifacts', 'model.patch');
    const sdk = join(dir, 'agent', 'sdk-messages.jsonl');
    const lines = existsSync(sdk) ? readFileSync(sdk, 'utf8').split('\n').filter((x) => x.trim()).flatMap((x) => { try { return [JSON.parse(x)]; } catch { return []; } }) : [];
    const uses = new Map<string, { name: string; input: any }>(); const results = new Map<string, { err: boolean; text: string }>(); const texts: string[] = [];
    for (const m of lines) {
      if (m.type === 'AssistantMessage') for (const c of m.content ?? []) { if (c?.id && c?.name) uses.set(c.id, { name: c.name, input: c.input ?? {} }); if (typeof c?.text === 'string') texts.push(c.text); }
      if (m.type === 'UserMessage' && Array.isArray(m.content)) for (const c of m.content) if (c?.tool_use_id) results.set(c.tool_use_id, { err: c.is_error === true, text: typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '') });
    }
    const headCmds: string[] = []; const checkoutCmds: string[] = []; const tools: Record<string, number> = {};
    for (const [id, u] of uses) {
      tools[u.name] = (tools[u.name] ?? 0) + 1;
      if (u.name !== 'Bash') continue;
      const cmd = String(u.input.command ?? ''); const r = results.get(id);
      if (!r || r.err) continue;
      for (const seg of cmd.split(/&&|\|\||;|\n|\|/)) {
        const m = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+(commit|reset|rebase|merge|cherry-pick|am|checkout|switch|stash)\b(.*)/.exec(seg);
        if (!m) continue;
        if (m[1] === 'checkout' || m[1] === 'switch' || m[1] === 'stash') checkoutCmds.push(m[1] + m[2].slice(0, 40)); else if (!(m[1] === 'reset' && !/--hard|--soft|--mixed|HEAD[~^]|\b[0-9a-f]{7,40}\b/.test(m[2]))) headCmds.push(m[1] + m[2].slice(0, 40));
      }
    }
    const all = texts.join('\n');
    t.__x = { arm: t.laneb.arm, patch_bytes: existsSync(mp) ? statSync(mp).size : null, head_moved: headCmds.length > 0, head_cmds: headCmds, checkout_cmds: checkoutCmds, tools,
      n_tool_calls: uses.size, debug_report: /DEBUG REPORT/.test(all), root_cause_text: /root cause/i.test(all), skill_reads: [...uses.values()].filter((u) => /skills\/(gstack\/)?investigate\//.test(JSON.stringify(u.input))).length };
    rows.push(t);
  }
}
mkdirSync(join(rd, 'reprobed'), { recursive: true });
writeFileSync(join(rd, 'reprobed', 'trials.jsonl'), rows.map((t) => { const { __x, ...r } = t; return JSON.stringify(r); }).join('\n') + '\n');
writeFileSync(join(rd, 'reprobed', 'extras.jsonl'), rows.map((t) => JSON.stringify({ trial_id: t.trial_id, task: t.task, ...t.__x, grade: t.grade, termination: t.termination, usd: t.usage?.usd ?? null, requests: t.usage?.requests ?? null, wall_ms: t.wall_ms, cap_stop: t.cap_stop, probe: t.laneb.skill_probe, exception: t.laneb.exception, agent_error: t.laneb.agent_error })).join('\n') + '\n');
const arms: Record<string, any> = {};
for (const t of rows) {
  const a = (arms[t.__x.arm] ??= { records: 0, completed: 0, probe_read: 0, completed_with_probe: 0, followed: 0, followed_completed: 0, pass: 0, graded: 0, usd: 0, head_moved: 0, head_moved_empty_patch: 0, empty_patch: 0, preamble: 0, any_step: 0, skill_tool: 0, skill_end: 0, debug_report: 0, root_cause_text: 0, skill_listed: 0, router_listed: 0, tampered: 0, cap_stop: 0 });
  const p = t.laneb.skill_probe;
  a.records++; if (t.termination === 'completed') a.completed++;
  if (p?.transcript) { a.probe_read++; if (p.followed) a.followed++; if (p.preamble_ok) a.preamble++; if (p.skill_steps_ok > 0) a.any_step++; if (p.skill_tool) a.skill_tool++; if (p.skill_end_ok) a.skill_end++; if (p.skill_listed) a.skill_listed++; if (p.router_listed) a.router_listed++; if (p.tampered) a.tampered++; }
  if (p?.transcript && t.termination === 'completed') { a.completed_with_probe++; if (p.followed) a.followed_completed++; }
  if (t.grade === 'pass' || t.grade === 'fail') a.graded++; if (t.grade === 'pass') a.pass++;
  a.usd += t.usage?.usd ?? 0; if (t.cap_stop) a.cap_stop++;
  if (t.__x.head_moved) { a.head_moved++; if (!t.__x.patch_bytes) a.head_moved_empty_patch++; }
  if (!t.__x.patch_bytes) a.empty_patch++;
  if (t.__x.debug_report) a.debug_report++; if (t.__x.root_cause_text) a.root_cause_text++;
}
const g = arms.gstack ?? { completed_with_probe: 0, followed_completed: 0 }; const n = arms.none ?? { pass: 0, followed: 0 };
const ci = wilson(g.followed_completed, g.completed_with_probe);
const band = !ci ? null : ci[1] < 0.6 && !(ci[0] > 0.4) ? 'STOP' : ci[0] > 0.4 && !(ci[1] < 0.6) ? 'PROCEED' : 'ASK';
const decision = n.followed > 0 ? 'PROBE_FAULT' : n.pass >= 4 ? 'VOID' : g.completed_with_probe < 12 ? 'INCOMPLETE' : band;
const provisional = (arms.gstack?.head_moved_empty_patch ?? 0) > 0;
console.log(JSON.stringify({ arms, gstack_wilson95: ci, band, decision, provisional_grades: provisional }, null, 1));
for (const t of rows) console.log([t.__x.arm, t.task, t.trial_id.split('/').pop(), t.termination, t.grade, (t.usage?.usd ?? 0).toFixed(3), 'req=' + (t.usage?.requests ?? '?'), 'calls=' + t.__x.n_tool_calls, 'patch=' + t.__x.patch_bytes, 'head=' + (t.__x.head_moved ? t.__x.head_cmds.join('|') : 'no'), 'followed=' + t.laneb.skill_probe?.followed, 'pre=' + t.laneb.skill_probe?.preamble_ok, 'steps=' + t.laneb.skill_probe?.skill_steps_ok, 'skilltool=' + t.laneb.skill_probe?.skill_tool, 'dr=' + t.__x.debug_report, 'rc=' + t.__x.root_cause_text, 'skillreads=' + t.__x.skill_reads].join(' '));
