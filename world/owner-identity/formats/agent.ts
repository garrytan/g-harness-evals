// Agent-session export writers: Claude Code session JSONL, Codex rollout JSONL, a ChatGPT conversations.json export and an
// aider chat history (the agent-session format gbrain has no reader for).

import type { AgentTurn, Rendered } from './types.ts';
import { isoUtc, parts, pad, utc, ymd, hms } from './time.ts';

const uuid = (seed: string, n: number) => {
  const h = new Bun.CryptoHasher('sha256').update(`${seed}:${n}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export function claudeCodeJsonl(name: string, turns: AgentTurn[], o: { sessionId: string; cwd: string; model: string }): Rendered {
  let parent: string | null = null;
  const lines = turns.map((t, i) => {
    const id = uuid(o.sessionId, i);
    const base = { parentUuid: parent, isSidechain: !!t.sidechain, userType: 'external', cwd: o.cwd, sessionId: o.sessionId, version: '2.4.1', gitBranch: 'main', type: t.role, uuid: id, timestamp: isoUtc(t.at) };
    parent = id;
    return JSON.stringify(t.role === 'user'
      ? { ...base, message: { role: 'user', content: t.text } }
      : { ...base, message: { id: `msg_${id.replace(/-/g, '').slice(0, 24)}`, type: 'message', role: 'assistant', model: o.model, content: [{ type: 'text', text: t.text }], stop_reason: 'end_turn' } });
  });
  return { name, format: 'claude-code-session-jsonl', known: true, text: lines.join('\n') + '\n' };
}

export function codexRolloutJsonl(name: string, turns: AgentTurn[], o: { sessionId: string; cwd: string; originator: string; model: string }): Rendered {
  const first = turns[0]!.at;
  const lines = [JSON.stringify({ timestamp: isoUtc(first), type: 'session_meta', payload: { id: o.sessionId, timestamp: isoUtc(first), cwd: o.cwd, originator: o.originator, cli_version: '0.98.0', model: o.model } })];
  for (const t of turns) {
    const content = [{ type: t.role === 'user' ? 'input_text' : 'output_text', text: t.text }];
    lines.push(JSON.stringify({ timestamp: isoUtc(t.at), type: 'response_item', payload: { type: 'message', role: t.role, content } }));
  }
  return { name, format: 'codex-rollout-jsonl', known: true, text: lines.join('\n') + '\n' };
}

export function chatgptConversationsJson(name: string, turns: AgentTurn[], o: { id: string; title: string }): Rendered {
  const ids = turns.map((_, i) => uuid(o.id, i));
  const root = uuid(o.id, 999);
  const mapping: Record<string, unknown> = { [root]: { id: root, message: null, parent: null, children: [ids[0]] } };
  turns.forEach((t, i) => {
    mapping[ids[i]!] = {
      id: ids[i],
      message: { id: ids[i], author: { role: t.role, name: null, metadata: {} }, create_time: utc(t.at) / 1000, content: { content_type: 'text', parts: [t.text] }, status: 'finished_successfully', metadata: {} },
      parent: i === 0 ? root : ids[i - 1],
      children: i + 1 < ids.length ? [ids[i + 1]] : [],
    };
  });
  const conv = [{ title: o.title, create_time: utc(turns[0]!.at) / 1000, update_time: utc(turns.at(-1)!.at) / 1000, mapping, current_node: ids.at(-1), conversation_id: o.id, id: o.id }];
  return { name, format: 'chatgpt-conversations-json', known: true, text: JSON.stringify(conv, null, 2) + '\n' };
}

export function aiderHistoryMd(name: string, turns: AgentTurn[]): Rendered {
  const p = parts(turns[0]!.at);
  const out = [`# aider chat started at ${ymd(turns[0]!.at)} ${hms(turns[0]!.at)}`, '', `> aider --model sonnet-latest`, `> Aider v0.90.2 started ${pad(p.h)}:${pad(p.mi)}`, ''];
  for (const t of turns) {
    if (t.role === 'user') out.push(`#### ${t.text}`, '');
    else out.push(t.text, '');
  }
  return { name, format: 'aider-chat-history-md', known: false, text: out.join('\n') };
}
