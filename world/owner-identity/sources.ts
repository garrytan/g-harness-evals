// One builder per import source. Each takes a variant index k (0 to 4, plus meeting 5 to 7, chat-1to1 5, imessage 5; notes
// 0 and 1), plants facts through the ledger and returns the export files of one task folder. The variant fixes the format
// and the hard cases, so coverage does not depend on the seed; the seed picks names, tokens, wording and times.

import type { Rng } from '../brain/names.ts';
import { THEY, cap, named, type FactLedger, type HardCase } from './facts.ts';
import type { Cast, Person } from './people.ts';
import type { AgentTurn, Email, Line, Rendered } from './formats/types.ts';
import { aiderHistoryMd, chatgptConversationsJson, claudeCodeJsonl, codexRolloutJsonl } from './formats/agent.ts';
import { csvExport, discordExport, imessageAlt, imessageSlack, messengerJson, signalExport, slackExportJson, telegramText, whatsappIso, whatsappUs } from './formats/chat.ts';
import { boldName, ics, speakerLetter, srt, teamsExport } from './formats/meeting.ts';
import { emailThreadMd, mbox, outlookTxt } from './formats/email.ts';
import { notesPage } from './formats/notes.ts';
import { isoUtc, ymd } from './formats/time.ts';
import { capitalise, pseudoWord, type TokenPool } from './tokens.ts';

export interface Ctx { r: Rng; cast: Cast; L: FactLedger; pool: TokenPool; taskId: string; start: number }
export interface Built { files: Rendered[]; title: string }

const FILLER = ['Sounds good.', 'Running a few minutes late.', 'Ha, fair enough.', 'Can we push to 3?', 'Thanks for sorting that.', 'Did you see the rain this morning?',
  'Talk later.', 'Yes, that works for me.', 'Let me check and get back to you.', 'Nice, congrats!', 'Same here.', 'On my way.', 'Got it, thanks.', 'Totally.'];
const LEAD = ['', '', '', 'Oh, one more thing. ', 'Quick update. ', 'Before I forget. '];
const PROJECTS = ['garden-planner', 'invoice-tool', 'trail-log', 'recipe-box', 'budget-sheet', 'photo-sorter'];
const MEETINGS = ['Weekend trip planning', 'Book club logistics', 'Side project sync', 'Neighbourhood fair prep', 'Running club catch-up'];
const THREADS = ['Lake trip crew', 'Supper club', 'Weekend plans', 'Trail club', 'Fair committee'];
const TOPICS = ['the fall schedule', 'the garden plot', 'the neighbourhood fair', 'the lake trip', 'the book club calendar'];
const ALERTS = ['City transit board delays its fare vote to next month.', 'Weekend storm expected along the coast, forecasters say.', 'County library extends its weekend opening hours.',
  'Farmers market moves to the school parking lot for the summer.', 'Regional rail line adds a late service on Fridays.'];
const PAPERS = ['Courier', 'Gazette', 'Dispatch', 'Bulletin', 'Observer'];
const SCHEDULER = 'agent:scheduler';

// `as` overrides the label the export shows for this line; `hold` keeps filler out of the gap after it.
interface Beat { who: Person | string; text: string; fwd?: string; as?: string; hold?: boolean }

const idOf = (w: Person | string) => (typeof w === 'string' ? w : w.id);

function clock(c: Ctx) {
  let at = c.start;
  return () => (at += c.r.int(1, 9) * 60_000 + c.r.int(0, 59) * 1000);
}

function weave(c: Ctx, beats: Beat[], speakers: Person[], label: (p: Person) => string, fillerRate = 0.5): Line[] {
  const tick = clock(c);
  const out: Line[] = [];
  const push = (who: Person | string, text: string, fwd?: string, as?: string) => out.push({ who: idOf(who), label: as ?? (typeof who === 'string' ? who : label(who)), at: tick(), text, ...(fwd ? { forwardedFrom: fwd } : {}) });
  for (const b of beats) {
    push(b.who, b.text, b.fwd, b.as);
    if (!b.hold && c.r.next() < fillerRate) push(c.r.pick(speakers), c.r.pick(FILLER));
  }
  return out;
}

const lead = (c: Ctx, s: string) => c.r.pick(LEAD) + s;
const others = (c: Ctx, n: number) => c.r.shuffle([...c.cast.contacts]).slice(0, n);
const uid = (c: Ctx) => { const h = Array.from({ length: 4 }, () => c.r.int(0, 0xffffffff).toString(16).padStart(8, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const youRelay = (third: (w: { s: string; p: string }) => string) => `You told me ${third({ s: 'you', p: 'your' })}.`;
const theyRelay = (name: string) => (third: (w: { s: string; p: string }) => string) => `${name} told me ${third(THEY)}.`;
const schedulerLine = (c: Ctx, intro: string) => `${intro} ${c.L.agent(SCHEDULER, 'agent_on_owner_account', c.cast.owner.id, 'scheduler')}`;

export function agentSession(c: Ctx, k: number): Built {
  const { L, r } = c;
  const o = c.cast.owner;
  const [q1, q2] = others(c, 2) as [Person, Person];
  const ai = ['agent:claude-code', 'agent:codex', 'agent:chatgpt', 'agent:claude-code', 'agent:aider'][k]!;
  const orch = 'agent:orchestrator';
  const proj = r.pick(PROJECTS);
  const tick = clock(c);
  const u = (who: string, text: string, sidechain = false): AgentTurn => ({ who, role: 'user', at: tick(), text, sidechain });
  const a = (text: string, sidechain = false): AgentTurn => ({ who: ai, role: 'assistant', at: tick(), text, sidechain });
  const ownerTurns = (aiFacts: number): AgentTurn[] => {
    const t = [u(o.id, `Can you help me clean up the ${proj} repo today? Some context first. ${L.own(o, 'control')}`)];
    t.push(a(`Sure. ${aiFacts > 0 ? L.agent(ai, 'assistant_model_says_I', ai, 'ai') + ' ' : ''}I'll start by reading the README.`));
    t.push(u(o.id, `${L.relay(o, q1, 'owner_quotes_other', theyRelay(q1.first))} So don't schedule anything that clashes with that.`), a('Understood, I will keep that in mind.'));
    t.push(u(o.id, `${L.own(o, 'control')} Anyway, the failing test is in the date parser.`));
    t.push(a(`${aiFacts > 1 ? L.agent(ai, 'assistant_model_says_I', ai, 'ai') + ' ' : ''}Found it: the parser drops the time zone. Fixed, and the tests pass.`));
    if (aiFacts > 2 || k === 2) t.push(u(o.id, `${L.own(o, 'control')} Can you note that somewhere?`), a('Noted in the project log.'));
    t.push(u(o.id, `${L.relay(o, q2, 'owner_quotes_other', theyRelay(q2.first))} Add that to the team calendar notes, please.`), a('Added to the calendar notes.'));
    return t;
  };
  const brief = (n: number) => `You are working for ${o.name} on the ${proj} repo. ${Array.from({ length: n }, () => L.agent(orch, 'agent_brief_in_user_seat', o.id, 'brief')).join(' ')} Task: update the README so the setup steps match the current scripts. Report back when done.`;
  const sid = uid(c);
  const cwd = `/home/${o.first.toLowerCase()}/code/${proj}`;
  if (k === 0 || k === 1) {
    const main = ownerTurns(1);
    const worker = [u(orch, brief(2)), a('Starting with the setup section of the README.'), a('README updated; the setup steps now match package.json.')];
    const wsid = uid(c);
    if (k === 0) return { title: `Claude Code session and a worker session on ${proj}`, files: [claudeCodeJsonl(`${sid}.jsonl`, main, { sessionId: sid, cwd, model: 'claude-opus-5-5' }), claudeCodeJsonl(`${wsid}.jsonl`, worker, { sessionId: wsid, cwd, model: 'claude-opus-5-5' })] };
    const stamp = (t: AgentTurn) => isoUtc(t.at).slice(0, 19).replace(/:/g, '-');
    return { title: `Codex session and a worker session on ${proj}`, files: [codexRolloutJsonl(`rollout-${stamp(main[0]!)}-${sid}.jsonl`, main, { sessionId: sid, cwd, originator: 'codex_cli_rs', model: 'gpt-6.1-sol' }), codexRolloutJsonl(`rollout-${stamp(worker[0]!)}-${wsid}.jsonl`, worker, { sessionId: wsid, cwd, originator: 'codex_exec', model: 'gpt-6.1-sol' })] };
  }
  if (k === 2) return { title: `ChatGPT conversation about ${proj}`, files: [chatgptConversationsJson('conversations.json', ownerTurns(2), { id: sid, title: `Cleaning up ${proj}` })] };
  if (k === 3) {
    const main = ownerTurns(1);
    const side = [u(orch, `You are working for ${o.name}. ${L.agent(orch, 'agent_brief_in_user_seat', o.id, 'brief')} Find every TODO in the date parser and list them.`, true), a('Found four TODOs in the date parser; listing them now.', true)];
    main.splice(3, 0, ...side);
    return { title: `Claude Code session with a subagent on ${proj}`, files: [claudeCodeJsonl(`${sid}.jsonl`, main, { sessionId: sid, cwd, model: 'claude-opus-5-5' })] };
  }
  const turns = [u(orch, brief(2)), a(`${L.agent(ai, 'assistant_model_says_I', ai, 'ai')} Lint errors fixed.`),
    u(o.id, `${o.first} here, typing myself now. ${L.own(o, 'control')}`), a('Noted.'),
    u(o.id, `${L.relay(o, q1, 'owner_quotes_other', theyRelay(q1.first))} ${L.own(o, 'control')}`), a('Got it.'),
    u(o.id, L.relay(o, q2, 'owner_quotes_other', theyRelay(q2.first))), a('Thanks, noted for the schedule.')];
  return { title: `aider session on ${proj}`, files: [aiderHistoryMd('.aider.chat.history.md', turns)] };
}

export function chat1to1(c: Ctx, k: number): Built {
  const { L, cast } = c;
  const o = cast.owner;
  if (k === 5) {
    const x = others(c, 1)[0]!;
    const beats: Beat[] = [
      { who: x, text: `Hey ${o.first}! ${lead(c, L.own(x, 'control'))}` },
      { who: o, text: lead(c, L.own(o, 'control')) },
      { who: SCHEDULER, as: o.name, text: schedulerLine(c, `This is Scheduler, ${o.first}'s scheduling agent, typing from ${o.first}'s account.`) },
      { who: x, text: lead(c, L.own(x, 'control')) },
      { who: o, text: `${o.first} here, typing myself again. ${L.own(o, 'control')}` },
      { who: SCHEDULER, as: o.name, text: schedulerLine(c, `Scheduler again, still on ${o.first}'s account:`) },
    ];
    return { title: `Telegram chat with ${x.name}, partly typed by the owner's scheduling agent`, files: [telegramText('messages.txt', weave(c, beats, [o, x], (p) => p.name), `Chat with ${x.name}`)] };
  }
  const x = k === 2 ? cast.byRole('similar_name') : k === 3 ? cast.byRole('anagram_nickname') : others(c, 1)[0]!;
  const hcX: HardCase = k === 2 || k === 3 ? 'similar_name_decoy' : k === 4 ? 'swapped_or_anonymous_labels' : 'control';
  const hcO: HardCase = k === 1 || k === 3 || k === 4 ? 'owner_aliases' : 'control';
  const beats: Beat[] = [
    { who: x, text: `Hey ${o.first}! ${lead(c, L.own(x, hcX))}` },
    { who: o, text: lead(c, L.own(o, hcO)) },
    { who: x, text: lead(c, L.own(x, hcX)) },
  ];
  if (k === 1 || k === 3) beats.push({ who: x, text: L.relay(x, o, 'owner_quoted_by_other', youRelay) });
  if (k === 2) beats.push({ who: o, text: (() => { const q = others(c, 1)[0]!; return L.relay(o, q, 'owner_quotes_other', theyRelay(q.first)); })() });
  beats.push({ who: o, text: lead(c, L.own(o, hcO)) }, { who: x, text: lead(c, L.own(x, hcX)) });
  if (k === 0 || k === 4) beats.push({ who: o, text: lead(c, L.own(o, k === 4 ? 'swapped_or_anonymous_labels' : 'control')) });
  if (k === 4) {
    for (const b of beats.filter((b) => b.who === o).slice(0, 2)) b.who = 'second-line';
    const lines = weave(c, beats, [o, x], (p) => (p.id === o.id ? o.phones[0]! : x.phones[0]!)).map((l) => (l.who === 'second-line' ? { ...l, who: o.id, label: o.phones[1]! } : l));
    return { title: `SMS backup with ${x.first}`, files: [csvExport(`sms-${x.e164[0]!.slice(2)}.csv`, lines)] };
  }
  if (k === 0) return { title: `WhatsApp chat with ${x.first}`, files: [whatsappUs(`WhatsApp Chat with ${x.name}.txt`, weave(c, beats, [o, x], (p) => (p.id === o.id ? o.whatsapp_name : p.name)))] };
  if (k === 1) return { title: `WhatsApp chat with ${x.first}`, files: [whatsappIso(`WhatsApp Chat with ${x.name}.txt`, weave(c, beats, [o, x], (p) => (p.id === o.id ? o.whatsapp_name : p.name)))] };
  if (k === 2) return { title: `Telegram chat with ${x.name}`, files: [telegramText('messages.txt', weave(c, beats, [o, x], (p) => p.name), `Chat with ${x.name}`)] };
  return { title: `Signal chat with ${x.signal_name}`, files: [signalExport(`signal-${x.signal_name.toLowerCase()}.txt`, weave(c, beats, [o, x], (p) => p.signal_name))] };
}

export function groupChat(c: Ctx, k: number): Built {
  const { L, cast, r } = c;
  const o = cast.owner;
  const g = others(c, 3);
  if (k === 2) g[2] = cast.byRole('assistant');
  if (k === 3) g[2] = cast.byRole('similar_name');
  const [a, b, x] = g as [Person, Person, Person];
  const GC: HardCase = 'group_chat';
  const beats: Beat[] = [
    { who: a, text: `Morning all! ${lead(c, L.own(a, GC))}` },
    { who: o, text: lead(c, L.own(o, k === 2 ? 'owner_aliases' : GC)) },
    { who: b, text: lead(c, L.own(b, GC)) },
  ];
  const title = r.pick(['Weekend crew', 'Trail club', 'Supper club', 'Pottery people', 'Lake trip']);
  if (k === 0) beats.push({ who: x, text: lead(c, L.own(x, 'swapped_or_anonymous_labels')) }, { who: b, text: L.relay(b, o, 'owner_quoted_by_other', theyRelay(o.first)) });
  if (k === 1) {
    const src = cast.contacts.find((p) => !g.includes(p))!;
    beats.push({ who: o, text: L.relay(o, b, 'owner_quotes_other', theyRelay(b.first)) }, { who: x, text: L.own(src, 'forwarded_email'), fwd: src.name });
    L.facts.at(-1)!.reporter = x.id;
  }
  if (k === 2) beats.push({ who: x, text: L.relay(x, o, 'assistant_on_behalf', (t) => `Posting for ${o.first}, who asked me to share this: ${t(named(o.first))}.`) }, { who: x, text: `Separately, ${L.own(x, 'assistant_on_behalf', true)}` });
  if (k === 3) beats.push({ who: x, text: `${x.first} here, the other ${x.first}. ${L.own(x, 'similar_name_decoy')}` }, { who: x, text: lead(c, L.own(x, 'similar_name_decoy')) }, { who: o, text: L.relay(o, a, 'owner_quotes_other', theyRelay(a.first)) });
  if (k === 4) {
    const src = cast.contacts.find((p) => !g.includes(p))!;
    beats.push({ who: a, text: L.relay(a, o, 'owner_quoted_by_other', theyRelay(o.first)) }, { who: x, text: L.own(src, 'forwarded_email'), fwd: src.name });
    L.facts.at(-1)!.reporter = x.id;
  }
  beats.push({ who: o, text: lead(c, L.own(o, k === 2 ? 'owner_aliases' : GC)) });
  const people = [o, a, b, x];
  if (k === 0) return { title: `WhatsApp group ${title}`, files: [whatsappUs(`WhatsApp Chat with ${title}.txt`, weave(c, beats, people, (p) => (p.id === o.id ? o.whatsapp_name : p.id === x.id ? x.phones[0]! : p.name)))] };
  if (k === 1) return { title: `Telegram group ${title}`, files: [telegramText('messages.txt', weave(c, beats, people, (p) => p.name), title)] };
  if (k === 2) {
    const lines = weave(c, beats, people, (p) => p.first);
    const users = people.map((p) => ({ id: p.slack_id, name: p.slack, real_name: p.name, display_name: p.first }));
    return { title: `Slack export of #${title.toLowerCase().replace(/ /g, '-')}`, files: slackExportJson(lines, users, ymd(lines[0]!.at)) };
  }
  if (k === 3) return { title: `Discord channel export`, files: [discordExport(`${title.replace(/ /g, '')} - general.txt`, weave(c, beats, people, (p) => p.discord), title, 'general')] };
  return { title: `Messenger group ${title}`, files: [messengerJson('message_1.json', weave(c, beats, people, (p) => p.name), title, people.map((p) => p.name))] };
}

export function meeting(c: Ctx, k: number): Built {
  const { L, cast, r } = c;
  const o = cast.owner;
  if (k >= 5) {
    const [a, other] = others(c, 2) as [Person, Person];
    const b = k === 5 ? other : cast.byRole('similar_name');
    const title = r.pick(MEETINGS);
    const people = [o, a, b];
    const REC: HardCase = 'recorder_label_absorbs';
    const rec = (text: string) => { L.facts.at(-1)!.cue = 'clear'; return text; };
    const asRole = () => rec(`${o.first}, speaking as your ${a.role_in_story}: ${L.own(a, REC, true)}`);
    const byName = () => rec(`${o.first}, ${a.first} here again: ${L.own(a, REC, true)}`);
    if (k === 5) {
      const beats: Beat[] = [
        { who: o, text: `Thanks for joining, both. ${L.own(o, 'control')}` },
        { who: a, as: o.teams_name, text: asRole() },
        { who: b, text: `Good to see you both. ${L.own(b, 'control')}` },
        { who: a, as: o.teams_name, hold: true, text: byName() },
        { who: o, text: `Thanks, ${a.first}. ${L.own(o, 'control')}` },
        { who: b, text: `Sounds right to me, ${o.first}. ${L.own(b, 'control')}` },
      ];
      return { title, files: [teamsExport('meeting-chat.txt', weave(c, beats, people, (p) => p.teams_name, 0.3))] };
    }
    const GEN: HardCase = 'owner_under_generic_label';
    const generic = k === 6 ? 'Participant 2' : 'Speaker 2';
    const beats: Beat[] = [
      { who: o, text: `Hi all, I'm the one who set up this call, so I'll kick off. ${L.own(o, GEN)}` },
      { who: a, as: o.name, hold: true, text: asRole() },
      { who: o, text: `Thanks, ${a.first}, good to know.` },
      { who: b, text: `${b.first} ${b.last} here, the other ${o.first}. ${L.own(b, 'similar_name_decoy')}` },
      { who: a, as: o.name, hold: true, text: byName() },
      { who: o, text: `Thanks, ${a.first}. Since I organised this call, one more from me: ${L.own(o, GEN, true)}` },
      { who: a, text: `${a.first} again. ${L.own(a, 'control')}` },
    ];
    if (k === 6) return { title, files: [boldName(`${title.toLowerCase().replace(/ /g, '-')}.md`, weave(c, beats, people, (p) => (p.id === o.id ? generic : p.name), 0.3), title)] };
    const letter = (p: Person) => (p.id === o.id ? generic : p.id === a.id ? 'Speaker 1' : 'Speaker 3');
    return { title, files: [speakerLetter('transcript.txt', weave(c, beats, people, letter, 0.3), `Transcript: ${title}`)] };
  }
  const att = others(c, 2);
  if (k === 3) att.push(cast.byRole('assistant'));
  if (k === 4) att[1] = cast.byRole('similar_name');
  const [a, b] = att as [Person, Person];
  const title = r.pick(MEETINGS);
  const hcAll: HardCase = k === 1 || k === 2 || k === 4 ? 'swapped_or_anonymous_labels' : 'control';
  const beats: Beat[] = [];
  if (k === 3) {
    const ea = att[2]!;
    beats.push({ who: ea, text: L.relay(ea, o, 'assistant_on_behalf', (t) => `${o.first} is running late and asked me to start. ${cap(t(named(o.first)))}.`) }, { who: ea, text: `For my part, ${L.own(ea, 'assistant_on_behalf', true)}` });
  }
  if (k === 4) beats.push({ who: o, text: `Hi both, this is ${o.first}, I set up this call.` }, { who: b, text: `${b.first} ${b.last} here, the other ${o.first}. ${L.own(b, 'similar_name_decoy')}` });
  beats.push({ who: o, text: `Thanks for joining, ${a.first}. ${L.own(o, k === 3 ? 'owner_aliases' : hcAll)}` });
  beats.push({ who: a, text: `Thanks, ${o.first}. ${L.own(a, hcAll)}` });
  if (k !== 4) beats.push({ who: b, text: `Good to see you both. ${L.own(b, hcAll)}` });
  if (k === 0) { const q = cast.contacts.find((p) => p.id !== a.id && p.id !== b.id)!; beats.push({ who: o, text: L.relay(o, q, 'owner_quotes_other', (t) => `Before we move on: ${theyRelay(q.first)(t)}`) }); }
  if (k === 1) beats.push({ who: a, text: L.relay(a, o, 'owner_quoted_by_other', (t) => `${o.first}, you mentioned this last week, right? ${youRelay(t)}`) });
  if (k === 2) beats.push({ who: 'agent:notetaker', text: `Notetaker here. ${L.agent('agent:notetaker', 'assistant_model_says_I', 'agent:notetaker', 'ai')}` });
  beats.push({ who: b, text: `Sounds right to me, ${o.first}. ${L.own(b, hcAll)}` });
  beats.push({ who: o, text: `One more from me, ${b.first}. ${L.own(o, k === 3 ? 'owner_aliases' : hcAll)}` });
  if (k === 2 || k === 4) beats.push({ who: a, text: `Last thing, ${o.first}. ${L.own(a, hcAll)}` });
  const people = [o, ...att];
  if (k === 0) return { title, files: [boldName(`${title.toLowerCase().replace(/ /g, '-')}.md`, weave(c, beats, people, (p) => p.name, 0.3), title)] };
  if (k === 1) {
    const letters = r.shuffle(['A', 'B', 'C']);
    const lines = weave(c, beats, people, (p) => `Speaker ${letters[people.indexOf(p)]}`, 0.3);
    const invite = ics('invite.ics', { uid: `${c.taskId}@calendar.example.com`, title, start: lines[0]!.at - 60_000, minutes: 30, organizer: { name: a.name, email: a.emails[0]! },
      attendees: people.map((p) => ({ name: p.name, email: p.emails[0]!, self: p.id === o.id })) });
    return { title, files: [speakerLetter('transcript.txt', lines, `Transcript: ${title}`), invite] };
  }
  if (k === 2) {
    const lines = weave(c, beats, people, (p) => p.name, 0.3).map((l) => (l.who === 'agent:notetaker' ? { ...l, label: 'Notetaker' } : l));
    const cut = Math.floor(lines.length / 2);
    lines.splice(cut, 0, { who: a.id, label: a.name, at: lines[cut - 1]!.at + 5000, text: `Sorry, quick note: I think the transcript has ${o.first} and me swapped from here on.` });
    for (const l of lines.slice(cut + 1)) if (l.who === o.id) l.label = a.name; else if (l.who === a.id) l.label = o.name;
    return { title, files: [boldName(`${title.toLowerCase().replace(/ /g, '-')}.md`, lines, title)] };
  }
  if (k === 3) return { title, files: [teamsExport('meeting-chat.txt', weave(c, beats, people, (p) => p.teams_name, 0.3))] };
  return { title, files: [srt('captions.srt', weave(c, beats, people, (p) => `SPEAKER ${people.indexOf(p) + 1}`, 0.3))] };
}

export function imessage(c: Ctx, k: number): Built {
  const { L, cast } = c;
  const o = cast.owner;
  const me = cast.byRole('me_contact');
  if (k === 5) {
    const [a, b] = others(c, 2) as [Person, Person];
    const ea = cast.byRole('assistant');
    const q = cast.contacts.find((p) => p.id !== a.id && p.id !== b.id)!;
    const thread = c.r.pick(THREADS);
    const ONE: HardCase = 'group_thread_one_label';
    const beats: Beat[] = [
      { who: a, text: `${a.first} here: ${L.own(a, ONE, true)}` },
      { who: o, text: lead(c, L.own(o, 'control')) },
      { who: b, text: `${b.first} here. ${L.own(b, ONE)}` },
      { who: SCHEDULER, as: 'Me', text: schedulerLine(c, `This is Scheduler, ${o.first}'s scheduling agent, typing from ${o.first}'s phone.`) },
      { who: ea, text: `${ea.first} here, pasting ${q.first}'s reply from our email thread: "${L.own(q, 'assistant_relays_thread')}"` },
      { who: ea, text: `${ea.first} again. ${L.relay(ea, o, 'assistant_on_behalf', (t) => `${o.first} asked me to share this: ${t(named(o.first))}.`)}` },
      { who: o, as: thread, text: `${o.first} here, from my other phone. ${L.own(o, 'owner_aliases')}` },
    ];
    L.facts.find((f) => f.hard_case === 'assistant_relays_thread')!.reporter = ea.id;
    return { title: 'iMessage group thread exported under the thread name', files: [imessageSlack(`${thread}.txt`, weave(c, beats, [o, a, b, ea], (p) => (p.id === o.id ? 'Me' : thread)))] };
  }
  const label = (p: Person) => (p.id === o.id || p.id === me.id ? 'Me' : p.name);
  if (k === 0 || k === 2) {
    const x = k === 0 ? others(c, 1)[0]! : me;
    const hc: HardCase = k === 0 ? 'control' : 'me_contact_decoy';
    const beats: Beat[] = [
      { who: x, text: k === 2 ? `It's ${me.first}, by the way, new phone. ${L.own(x, hc)}` : lead(c, L.own(x, hc)) },
      { who: o, text: lead(c, L.own(o, 'control')) }, { who: x, text: lead(c, L.own(x, hc)) },
      ...(k === 2 ? [{ who: x, text: L.relay(x, o, 'owner_quoted_by_other', youRelay) }] : []),
      { who: o, text: lead(c, L.own(o, 'control')) }, { who: x, text: lead(c, L.own(x, hc)) },
      ...(k === 0 ? [{ who: o, text: lead(c, L.own(o, 'control')) }] : []),
    ];
    return { title: `iMessage chat with ${k === 2 ? 'a contact saved as Me' : x.first}`, files: [imessageSlack(`${k === 2 ? 'Me' : x.name}.txt`, weave(c, beats, [o, x], label))] };
  }
  if (k === 1) {
    const [a, b, x] = others(c, 3) as [Person, Person, Person];
    const beats: Beat[] = [
      { who: a, text: lead(c, L.own(a, 'group_chat')) }, { who: o, text: lead(c, L.own(o, 'group_chat')) }, { who: b, text: lead(c, L.own(b, 'group_chat')) },
      { who: x, text: L.relay(x, o, 'owner_quoted_by_other', theyRelay(o.first)) }, { who: 'second-line', text: `From my other phone, sorry. ${L.own(o, 'owner_aliases')}` }, { who: x, text: lead(c, L.own(x, 'group_chat')) },
    ];
    const lines = weave(c, beats, [o, a, b, x], label).map((l) => (l.who === 'second-line' ? { ...l, who: o.id, label: o.phones[1]! } : l));
    return { title: 'iMessage group thread', files: [imessageSlack(`${a.first}, ${b.first} & ${x.first}.txt`, lines)] };
  }
  if (k === 3) {
    const d = cast.byRole('similar_name');
    const f1 = weave(c, [{ who: d, text: lead(c, L.own(d, 'similar_name_decoy')) }, { who: o, text: lead(c, L.own(o, 'control')) }, { who: d, text: lead(c, L.own(d, 'similar_name_decoy')) }], [o, d], label);
    const f2 = weave(c, [{ who: me, text: `${me.first} again. ${L.own(me, 'me_contact_decoy')}` }, { who: o, text: lead(c, L.own(o, 'control')) }, { who: me, text: lead(c, L.own(me, 'me_contact_decoy')) }], [o, me], label);
    return { title: 'Two iMessage chats', files: [imessageSlack(`${d.name}.txt`, f1), imessageSlack('Me.txt', f2)] };
  }
  const x = others(c, 1)[0]!;
  const beats: Beat[] = [
    { who: me, text: `${me.first} here! ${L.own(me, 'me_contact_decoy')}` }, { who: o, text: lead(c, L.own(o, 'owner_aliases')) },
    { who: x, text: lead(c, L.own(x, 'swapped_or_anonymous_labels')) }, { who: me, text: lead(c, L.own(me, 'me_contact_decoy')) },
    { who: 'second-line', text: `On my work phone now. ${L.own(o, 'owner_aliases')}` }, { who: x, text: lead(c, L.own(x, 'swapped_or_anonymous_labels')) },
  ];
  const lines = weave(c, beats, [o, me, x], (p) => (p.id === x.id ? x.e164[0]! : 'Me')).map((l) => (l.who === 'second-line' ? { ...l, who: o.id, label: o.e164[1]! } : l));
  return { title: 'iMessage group from another export tool', files: [imessageAlt('chat-export.txt', lines, `${me.e164[0]}, ${x.e164[0]}`)] };
}

export function email(c: Ctx, k: number): Built {
  const { L, cast, r } = c;
  const o = cast.owner;
  const ea = cast.byRole('assistant');
  const [x, y] = others(c, 2) as [Person, Person];
  const tick = clock(c);
  const subject = r.pick(['Plans for the fall', 'Catching up', 'Quick favour', 'Notes from Saturday', 'Next steps']);
  let n = 0;
  const mail = (who: Person, fromAddr: string, to: Person[], body: string, labels: string[], subj = subject, extra: Partial<Email> = {}): Email =>
    ({ who: who.id, fromName: who.name, fromAddr, to: to.map((p) => `${p.name} <${p.emails[0]}>`), at: tick(), subject: subj, body, labels, id: `${c.taskId}-${++n}`, ...extra });
  const forwarded = (src: Person, withMe: boolean, extra = 0) => {
    const before = L.facts.length;
    const f1 = [L.own(src, 'forwarded_email'), ...Array.from({ length: extra }, () => L.own(src, 'forwarded_email'))].join(' ');
    const f2 = withMe ? `\n\nPasting what I wrote in our group chat:\nMe: ${L.own(src, 'me_contact_decoy')}` : '';
    for (const fact of L.facts.slice(before)) fact.reporter = o.id;
    return `---------- Forwarded message ---------\nFrom: ${src.name} <${src.emails[0]}>\nSubject: ${subject}\n\nHi all,\n\n${f1}${f2}\n\nBest,\n${src.first}`;
  };
  const sent = ['Sent'], inbox = ['Inbox', 'Important'];
  if (k === 0) {
    const mails = [
      mail(o, o.emails[2]!, [y], `${y.first}, see below from ${x.first}.\n\n${L.own(o, 'owner_aliases')}\n\n${o.nick}\n\n${forwarded(x, true, 1)}`, sent, `Fwd: ${subject}`),
      mail(y, y.emails[0]!, [o], `Thanks for passing that on!\n\n${L.own(y, 'control')}\n\nOn an earlier date, ${o.name} wrote:\n> ${y.first}, see below from ${x.first}.`, inbox, `Re: Fwd: ${subject}`),
      mail(o, o.emails[1]!, [y], `Sending from my other address. ${L.own(o, 'owner_aliases')}`, sent, `Re: Fwd: ${subject}`),
    ];
    return { title: 'Gmail mbox with a forward', files: [mbox('mail.mbox', mails)] };
  }
  if (k === 1 || k === 3) {
    const onBehalf = mail(ea, ea.emails[0]!, [x], `Hi ${x.first},\n\nWriting on behalf of ${o.first}. ${L.relay(ea, o, 'assistant_on_behalf', (t) => `${o.first} asked me to let you know: ${t(named(o.first))}.`)}\n\nAlso, ${L.own(ea, 'assistant_on_behalf', true)}\n\nBest,\n${ea.first}, assistant to ${o.name}`, inbox, subject, { cc: [`${o.name} <${o.emails[1]}>`] });
    if (k === 1) {
      const mails = [onBehalf,
        mail(x, x.emails[0]!, [o], `Thanks ${ea.first}. ${o.first}, ${L.own(x, 'control', true)} ${L.own(x, 'control')}\n\nOn an earlier date, ${ea.name} wrote:\n> Hi ${x.first},`, inbox, `Re: ${subject}`),
        mail(o, o.emails[1]!, [x], `Thanks both. ${L.own(o, 'owner_aliases')} ${L.own(o, 'owner_aliases')}`, sent, `Re: ${subject}`)];
      return { title: 'Gmail mbox with an assistant writing on the owner\'s behalf', files: [mbox('mail.mbox', mails)] };
    }
    const mails = [onBehalf,
      mail(o, o.emails[0]!, [y], `${y.first}, forwarding this from ${x.first}. ${L.own(o, 'control')}\n\n${forwarded(x, true)}`, sent, `Fwd: ${subject}`),
      mail(o, o.emails[0]!, [ea], `Thanks for handling that. ${L.own(o, 'control')}`, sent, `Re: ${subject}`)];
    return { title: 'Gmail mbox with an assistant and a forward', files: [mbox('mail.mbox', mails)] };
  }
  if (k === 2) {
    const q = cast.contacts.find((p) => p.id !== x.id && p.id !== y.id)!;
    const mails = [
      mail(o, o.emails[0]!, [y], `${y.first}, passing this along. ${L.own(o, 'control')} ${L.relay(o, q, 'owner_quotes_other', theyRelay(q.first))}\n\n${forwarded(x, true)}`, sent, `Fwd: ${subject}`),
      mail(y, y.emails[0]!, [o], `Thanks! ${L.own(y, 'control')}\n\n> ${y.first}, passing this along.`, inbox, `Re: Fwd: ${subject}`),
      mail(o, o.emails[0]!, [y], `Great. ${L.own(o, 'control')}`, sent, `Re: Fwd: ${subject}`),
    ];
    return { title: 'Email thread with a forward', files: [emailThreadMd('thread.md', mails, `Fwd: ${subject}`)] };
  }
  const mails = [
    mail(o, o.emails[2]!, [y], `${y.first}, FYI below. ${L.own(o, 'owner_aliases')}\n\n${forwarded(x, false, 2)}`, sent, `FW: ${subject}`),
    mail(y, y.emails[0]!, [o], `Thanks. ${L.own(y, 'control')}`, inbox, `RE: FW: ${subject}`),
    mail(o, o.emails[1]!, [y], `From my work address: ${L.own(o, 'owner_aliases')}`, sent, `RE: FW: ${subject}`),
  ];
  return { title: 'Outlook text export with a forward', files: [outlookTxt('outlook-export.txt', mails)] };
}

export function notes(c: Ctx, k: number): Built {
  const { L, cast, r } = c;
  const o = cast.owner;
  const [f1, f2] = others(c, 2) as [Person, Person];
  let word = capitalise(pseudoWord(r, 2));
  while (!c.pool.ok(word)) word = capitalise(pseudoWord(r, r.int(2, 3)));
  c.pool.reserve(word);
  const outlet = `${word} ${r.pick(PAPERS)}`;
  const press = `press:${outlet.toLowerCase().replace(/ /g, '-')}`;
  const said = (f: Person, verb: string) => L.relay(o, f, 'reported_speech_in_notes', (t) => `${o.first}'s observation: a friend, ${f.first}, ${verb} ${o.first} that ${t(named(f.first))}.`);
  const day = ymd(c.start);
  const topic = r.pick(TOPICS);
  const page = k === 0
    ? notesPage(`brainstorm-${topic.replace(/^the /, '').replace(/ /g, '-')}.md`, `Brainstorm: ${topic}`, [
      `_Notes the assistant wrote from ${o.first}'s voice memo on ${day}._`,
      `${o.first} wants ${topic} settled before the end of the month. Ideas so far:`,
      [`- ${o.first}'s own note: "${L.own(o, 'control')}"`, `- ${said(f1, 'told')}`, '- Open question: whether to ask the group for a vote or just pick a date.', `- ${said(f2, 'mentioned to')}`,
        `- ${o.first}'s observation: "${L.own(o, 'control')}"`].join('\n'),
    ])
    : notesPage(`recap-${day}.md`, `Recap: dinner with ${f1.first} and ${f2.first}`, [
      `_Written by the assistant from ${o.first}'s voice note after dinner on ${day}._`,
      `${o.first} had dinner with ${f1.first} and ${f2.first} to talk about ${topic}. ${said(f1, 'told')}`,
      `${o.first} added: "${L.own(o, 'control')}" ${said(f2, 'mentioned to')}`,
      `Before leaving, ${o.first} said: "${L.own(o, 'control')}"`,
    ]);
  const alerts = r.shuffle([...ALERTS]);
  const digest = notesPage('news-alerts.md', `News alerts, ${day}`, [
    `_Compiled by the assistant from ${o.first}'s news alerts._`,
    [`- **Wire roundup:** ${alerts[0]}`,
      `- **${outlet}:** ${L.press(press, o, 'press_paraphrase', (t) => `Report claims ${t(named(o.name))}.`)}`,
      `- **Wire roundup:** ${alerts[1]}`,
      `- **${outlet}:** ${L.press(press, o, 'press_paraphrase', (t) => `${outlet} says ${t(named(o.name))}, citing people familiar with the plans.`)}`].join('\n'),
  ]);
  return { title: k === 0 ? `Brainstorm notes and a news-alert digest` : `Dinner recap and a news-alert digest`, files: [page, digest] };
}

export const BUILDERS = { 'agent-session': agentSession, 'chat-1to1': chat1to1, 'group-chat': groupChat, meeting, imessage, email, notes } as const;
export type Source = keyof typeof BUILDERS;
export const SOURCES = Object.keys(BUILDERS) as Source[];
