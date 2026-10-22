#!/usr/bin/env bun
// Import a messy-company-v1 checkout into world/seed/world.json.
//
//   bun world/seed/import.ts <path-to-messy-company-v1> [--out world/seed]
//
// Reads plan/world.json, plan/pages.json and corpus/{dev,heldout}/**/*.md. Never modifies the input.
// The mapping rules are described in world/seed/README.md; the counts printed at the end are the ones
// the README quotes.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type {
  Account, CalendarEvent, Channel, Mail, MailParty, Member, Message, Split, Team, World, WorldFile,
} from '../types.ts';

const TODAY = '2026-10-14';
const TIME_ZONE = { name: 'America/Chicago', offset_minutes: -300 };
const UNDATED_DATE = '2026-10-13';
const EMAIL_DOMAIN = 'pemberline.com';
const ORG_WIDE_ROLES = new Set(['ruth-calloway', 'anselm-grieve', 'june-osei', 'moss']);
const ADMINS = new Set(['ruth-calloway']);

interface PlanPerson {
  id: string; name: string; first: string; initials: string; kind: string; role: string; org: string; team?: string;
}
interface PlanTeam { id: string; name: string; short: string; cluster: string; lead: string }
interface PlanAccount {
  id: string; name: string; cluster: string; parent?: string;
  renamed?: { on: string; to: string; former: string }; aliases: { surface: string }[];
}
interface PlanStint { account: string; owner: string; role: string; start: string | null; end: string | null }
interface PlanWorld {
  today: string; split_of: Record<string, Split>; teams: PlanTeam[]; people: PlanPerson[];
  accounts: PlanAccount[]; stints: PlanStint[];
}
interface PlanPage {
  slug: string; cluster: string; split: Split; kind: string; type: string; title: string; date: string | null;
  body_date?: string; writer: string; accounts: string[]; visibility?: string; status?: string;
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function slackId(prefix: string, key: string): string {
  const h = createHash('sha256').update(key).digest();
  let n = 0n;
  for (const b of h.subarray(0, 8)) n = (n << 8n) | BigInt(b);
  return prefix + n.toString(36).toUpperCase().padStart(10, '0').slice(0, 10);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function legalName(name: string): string {
  return name.replace(/\s*"[^"]*"\s*/, ' ').replace(/\s+/g, ' ').trim();
}

function handleFor(name: string): string {
  const parts = legalName(name).split(' ');
  return parts.map((p) => p.toLowerCase()).join('.');
}

function emailFor(name: string): string {
  const parts = legalName(name).split(' ');
  const last = parts.slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');
  if (!last) return `${parts[0]!.toLowerCase()}@${EMAIL_DOMAIN}`;
  return `${parts[0]![0]!.toLowerCase()}${last}@${EMAIL_DOMAIN}`;
}

function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: text };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.replace(/^"(.*)"$/, '$1');
  }
  return { fm, body: text.slice(m[0].length) };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function toTs(date: string, time: string | null, offsetMinutes: number, seq: number): string {
  let hh = 9;
  let mm = 0;
  if (time) {
    const m = time.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (m) {
      hh = Number(m[1]);
      mm = Number(m[2]);
      const ap = m[3]?.toUpperCase();
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
    }
  }
  const utc = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh, mm) - offsetMinutes * 60_000;
  return `${Math.floor(utc / 1000)}.${String(seq).padStart(6, '0')}`;
}

function isoAt(date: string, hh: number, mm: number, offsetMinutes: number): string {
  const sign = offsetMinutes <= 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${off}`;
}

// Chat line shapes seen in the corpus. Every header starts a message; the lines up to the next header are its text.
const HEADERS: { re: RegExp; name: number; time: number | null; text: number | null }[] = [
  { re: /^\*\*(\d{1,2}:\d{2})\s+[\u2014\u2013-]\s+([^*]+?):\*\*\s*(.*)$/, name: 2, time: 1, text: 3 },
  { re: /^\*\*([^*\[]+?)\*\*\s+\[(\d{1,2}:\d{2}(?:\s*[AP]M)?)\]\s*$/, name: 1, time: 2, text: null },
  { re: /^\[(\d{1,2}:\d{2})\]\s+\*{0,2}([A-Za-z][\w.'-]*)\*{0,2}:\s*(.*)$/, name: 2, time: 1, text: 3 },
  { re: /^\*\*([^*]+?)\s{2,}(\d{1,2}:\d{2}\s*[AP]M)\*\*\s*$/, name: 1, time: 2, text: null },
  { re: /^([A-Z][A-Za-z.'"-]+(?:\s[A-Z"][A-Za-z.'"-]+){1,3})\s{2,}(\d{1,2}:\d{2}\s*[AP]M)\s*$/, name: 1, time: 2, text: null },
  { re: /^\*\*([A-Z][^*:]+?)\*\*\s*$/, name: 1, time: null, text: null },
];

interface RawMessage { author: string; time: string | null; text: string }

export function parseChat(body: string, resolve: (name: string) => string | null): RawMessage[] {
  const out: RawMessage[] = [];
  let current: RawMessage | null = null;
  const lines: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let matched = false;
    for (const h of HEADERS) {
      const m = line.match(h.re);
      if (!m) continue;
      const author = resolve(m[h.name]!.trim());
      if (!author) continue;
      if (current) current.text = lines.join('\n').trim();
      lines.length = 0;
      current = { author, time: h.time ? m[h.time]!.trim() : null, text: '' };
      out.push(current);
      if (h.text !== null && m[h.text]) lines.push(m[h.text]!);
      matched = true;
      break;
    }
    if (!matched && current) lines.push(line);
  }
  if (current) current.text = lines.join('\n').trim();
  return out;
}

function channelNameFromTitle(title: string): string | null {
  const m = title.match(/#([a-z0-9][a-z0-9-]*)/);
  return m ? m[1]! : null;
}

export function importWorld(root: string): { world: World; inputs: { path: string; sha256: string; bytes: number }[] } {
  const inputs: { path: string; sha256: string; bytes: number }[] = [];
  const read = (p: string): string => {
    const buf = readFileSync(p);
    inputs.push({ path: relative(root, p), sha256: sha256(buf), bytes: buf.length });
    return buf.toString('utf8');
  };

  const plan = JSON.parse(read(join(root, 'plan/world.json'))) as PlanWorld;
  const pages = JSON.parse(read(join(root, 'plan/pages.json'))) as PlanPage[];
  if (plan.today !== TODAY) throw new Error(`plan today is ${plan.today}, expected ${TODAY}`);
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]));

  const teamOfCluster = new Map(plan.teams.map((t) => [t.cluster, t.id]));
  const teams: Team[] = plan.teams.map((t) => ({
    id: t.id, name: t.name, short: t.short, cluster: t.cluster, split: plan.split_of[t.cluster]!, lead: t.lead, members: [],
  }));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const members: Member[] = [];
  const memberById = new Map<string, Member>();
  const addMember = (p: PlanPerson, kind: Member['kind'], note?: string): Member => {
    const team = p.team ?? null;
    const m: Member = {
      id: p.id,
      slack_id: slackId('U', p.id),
      name: p.name,
      first: p.first,
      handle: handleFor(p.name),
      email: p.org === 'pemberline' ? emailFor(p.name) : `${handleFor(p.name).replace(/\./g, '')}@${p.org}.example`,
      role: p.role,
      kind,
      org: p.org,
      team,
      cluster: team ? teamById.get(team)!.cluster : null,
      org_wide: ORG_WIDE_ROLES.has(p.id),
      is_admin: ADMINS.has(p.id),
      split: 'both',
      ...(note ? { note } : {}),
    };
    members.push(m);
    memberById.set(m.id, m);
    if (team) teamById.get(team)!.members.push(m.id);
    return m;
  };
  for (const p of plan.people) {
    if (p.kind === 'employee' || p.kind === 'agent') addMember(p, p.kind);
  }
  const planPeople = new Map(plan.people.map((p) => [p.id, p]));

  // Name resolution: full name, legal name, first name, slack handle, initial+last, nickname handle.
  const names = new Map<string, string>();
  const register = (m: Member) => {
    const legal = legalName(m.name);
    const parts = legal.split(' ');
    const last = parts.slice(1).join(' ');
    const keys = [m.name, legal, m.first, `${m.first} ${last}`, m.handle, `${parts[0]![0]}${last.replace(/[^A-Za-z]/g, '')}`,
      `${m.first[0]}${last.replace(/[^A-Za-z]/g, '')}`, m.first.toLowerCase(), m.email.split('@')[0]!];
    for (const k of keys) {
      const key = k.toLowerCase().replace(/\s+/g, ' ').trim();
      if (key && !names.has(key)) names.set(key, m.id);
    }
  };
  members.forEach(register);
  const resolve = (name: string): string | null => {
    const key = name.replace(/^@/, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (key === 'me') return null;
    const hit = names.get(key) ?? names.get(key.replace(/-/g, ' '));
    if (hit) return hit;
    return null;
  };
  // An author the plan does not list as a Pemberline employee: a planned contact or vendor becomes a guest user
  // with that kind; anyone else becomes a guest with no org.
  const resolveOrCreate = (name: string): string | null => {
    const hit = resolve(name);
    if (hit) return hit;
    if (!/^[A-Z][a-z]+(\s[A-Z][A-Za-z'-]+)+$/.test(name)) return null;
    const planned = plan.people.find((p) => legalName(p.name).toLowerCase() === name.toLowerCase());
    const m = planned
      ? addMember(planned, planned.kind as Member['kind'], 'guest account: appears as a chat author in the corpus')
      : addMember({ id: slugify(name), name, first: name.split(' ')[0]!, initials: '', kind: 'guest', role: 'unplanned chat author', org: 'unknown' },
        'guest', 'not in the plan; appears only as a chat author');
    register(m);
    return m.id;
  };

  const stintOwner = (account: string): string | null => {
    const live = plan.stints.filter((s) => s.account === account && s.role === 'primary'
      && (s.end === null || s.end > TODAY) && (s.start === null || s.start <= TODAY));
    return live.length ? live[live.length - 1]!.owner : null;
  };
  const accounts: Account[] = plan.accounts.map((a) => ({
    id: a.id,
    name: a.renamed ? a.renamed.to : a.name,
    cluster: a.cluster,
    split: plan.split_of[a.cluster]!,
    team: teamOfCluster.get(a.cluster)!,
    owner: stintOwner(a.id),
    ...(a.parent ? { parent: a.parent } : {}),
    ...(a.renamed ? { renamed: a.renamed } : {}),
    aliases: a.aliases.map((x) => x.surface),
    folder: `accounts/${a.id}`,
  }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const channels: Channel[] = [];
  const channelByName = new Map<string, Channel>();
  const messages: Message[] = [];
  const files: WorldFile[] = [];
  const calendar: CalendarEvent[] = [];
  const mail: Mail[] = [];

  const channelFor = (name: string, kind: Channel['kind'], cluster: string | null, split: Split, rule: string, purpose: string): Channel => {
    let c = channelByName.get(name);
    if (c) return c;
    c = { id: slackId('C', name), name, kind, purpose, split, cluster, members: [], source_slugs: [], rule };
    channels.push(c);
    channelByName.set(name, c);
    return c;
  };
  const addChannelMember = (c: Channel, id: string) => { if (!c.members.includes(id)) c.members.push(id); };

  const corpusFiles = walk(join(root, 'corpus')).filter((p) => p.endsWith('.md'));
  let seq = 0;
  for (const path of corpusFiles) {
    const rel = relative(join(root, 'corpus'), path);
    const [split, kindDir, file] = rel.split('/') as [Split, string, string];
    const slug = `${kindDir}/${file.replace(/\.md$/, '')}`;
    const page = pageBySlug.get(slug);
    if (!page) throw new Error(`no plan brief for ${slug}`);
    if (page.split !== split) throw new Error(`split mismatch for ${slug}`);
    const raw = read(path);
    const { fm, body } = parseFrontmatter(raw);
    const team = teamOfCluster.get(page.cluster)!;
    const date = fm.date ?? null;

    if (page.kind === 'chat') {
      const parsed = parseChat(body, resolveOrCreate);
      if (parsed.length === 0) throw new Error(`no messages parsed from ${slug}`);
      const title = fm.title ?? page.title;
      const authors = [...new Set(parsed.map((m) => m.author))];
      let channel: Channel;
      if (/^DM:/i.test(title)) {
        const key = authors.slice().sort().join('+');
        channel = channelFor(`dm:${key}`, 'dm', page.cluster, split,
          'a corpus page titled "DM: ..." becomes a direct message between its authors', title);
      } else {
        const name = channelNameFromTitle(title);
        if (!name) throw new Error(`cannot name channel for ${slug}: ${title}`);
        const kind: Channel['kind'] = name.startsWith('inc-') ? 'incident' : name.endsWith('-random') ? 'random' : 'team';
        const rule = kind === 'incident'
          ? 'incident channel from a "#inc-..." chat page; members are its corpus authors plus the owning team'
          : kind === 'random'
            ? 'social channel from a "#<team>-random" chat page; members are the team plus its corpus authors'
            : 'team channel from a "#<team>-team" or "#<pod>" chat page; members are the team plus its corpus authors';
        const purpose = kind === 'incident' ? `Incident room (${title})` : kind === 'random' ? `${teamById.get(team)!.name} social channel` : `${teamById.get(team)!.name} working channel`;
        channel = channelFor(name, kind, page.cluster, split, rule, purpose);
        for (const id of teamById.get(team)!.members) addChannelMember(channel, id);
      }
      for (const id of authors) addChannelMember(channel, id);
      channel.source_slugs.push(slug);
      const msgDate = date ?? UNDATED_DATE;
      for (const m of parsed) {
        seq += 1;
        messages.push({
          id: `m-${seq}`,
          channel: channel.id,
          author: m.author,
          ts: toTs(msgDate, m.time, TIME_ZONE.offset_minutes, seq),
          date: msgDate,
          date_basis: date ? 'frontmatter' : 'undated',
          time_text: m.time,
          text: m.text,
          split,
          slug,
        });
      }
      continue;
    }

    if (page.kind === 'email') {
      const header: Record<string, string> = {};
      const bodyLines = body.split('\n');
      let i = 0;
      while (i < bodyLines.length) {
        const line = bodyLines[i]!.trim();
        if (line === '' || line.startsWith('#')) { i += 1; continue; }
        const m = line.match(/^\*{0,2}(From|To|Cc|Date|Subject)\*{0,2}:\*{0,2}\s*(.*?)\s*\**$/i);
        if (!m) break;
        header[m[1]!.toLowerCase()] = m[2]!;
        i += 1;
      }
      // A page with no To: header addresses whoever its salutation names: "Pree," is one member, "Team," or
      // "All," is the writer's team (or every employee when the writer has none).
      if (!header.to) {
        const salutation = bodyLines.slice(i).map((l) => l.trim()).find((l) => l !== '')?.match(/^([A-Z][A-Za-z]+),$/)?.[1];
        if (salutation && /^(team|all|everyone)$/i.test(salutation)) {
          const writer = memberById.get(page.writer);
          header.to = writer?.team ? teamById.get(writer.team)!.name : 'All employees';
        } else if (salutation && resolve(salutation)) {
          header.to = salutation;
        }
      }
      const party = (s: string): MailParty => {
        const raw = s.trim();
        const addr = raw.match(/<([^>]+)>/)?.[1] ?? (raw.includes('@') ? raw : null);
        const name = raw.replace(/<[^>]+>/, '').replace(/\(.*\)/, '').trim();
        const byEmail = addr ? members.find((mm) => mm.email.toLowerCase() === addr.toLowerCase())?.id ?? null : null;
        return { member: byEmail ?? resolve(name), raw };
      };
      const parties = (s: string | undefined): MailParty[] => {
        if (!s) return [];
        const sep = s.includes(';') ? ';' : ',';
        const out: MailParty[] = [];
        for (const part of s.split(sep).map((x) => x.trim()).filter(Boolean)) {
          const t = teams.find((tt) => part.toLowerCase() === tt.name.toLowerCase() || part.toLowerCase() === `${tt.short.toLowerCase()} team`);
          if (t) { for (const id of t.members) out.push({ member: id, raw: part }); continue; }
          if (part === 'All employees') {
            for (const m of members) if (m.kind === 'employee') out.push({ member: m.id, raw: part });
            continue;
          }
          out.push(party(part));
        }
        return out;
      };
      const from = header.from ? party(header.from) : { member: page.writer, raw: memberById.get(page.writer)?.name ?? page.writer };
      const to = parties(header.to);
      const cc = parties(header.cc);
      const mailbox = [...new Set([from, ...to, ...cc].map((p) => p.member).filter((x): x is string => !!x))];
      if (from.member === null && mailbox.length === 0) throw new Error(`no known party in ${slug}`);
      mail.push({
        id: `mail-${slug.split('/')[1]}`,
        from,
        to,
        cc,
        date: date ?? UNDATED_DATE,
        date_header: header.date ?? null,
        subject: header.subject ?? fm.title ?? page.title,
        body: bodyLines.slice(i).join('\n').trim(),
        mailbox_members: mailbox,
        accounts: page.accounts,
        split,
        slug,
        status: 'received',
      });
      continue;
    }

    if (page.kind === 'meeting') {
      const lines = body.split('\n');
      const dateLine = lines.find((l) => /^\**(meeting )?date\**:/i.test(l.trim())) ?? '';
      const timeMatch = dateLine.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      let hh = 10;
      let mm = 0;
      if (timeMatch) {
        hh = Number(timeMatch[1]) % 12 + (timeMatch[3]!.toLowerCase() === 'pm' ? 12 : 0);
        mm = Number(timeMatch[2] ?? 0);
      }
      const attendeesLine = lines.find((l) => /^\**attendees\**:/i.test(l.trim()));
      const scan = attendeesLine ?? lines.slice(0, 15).join(' ');
      const found = new Set<string>([page.writer]);
      for (const m of members) {
        if (m.kind !== 'employee' && m.kind !== 'agent') continue;
        const legal = legalName(m.name);
        const re = new RegExp(`\\b(${[m.name, legal, m.first].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
        if (re.test(scan)) found.add(m.id);
      }
      const d = date ?? UNDATED_DATE;
      calendar.push({
        id: `evt-${slug.split('/')[1]}`,
        title: fm.title ?? page.title,
        date: d,
        body_date: page.body_date ?? null,
        start: isoAt(d, hh, mm, TIME_ZONE.offset_minutes),
        end: isoAt(d, hh + 1, mm, TIME_ZONE.offset_minutes),
        organizer: page.writer,
        attendees: [...found],
        attendees_text: attendeesLine ? attendeesLine.trim().replace(/^\*{0,2}attendees\*{0,2}:\*{0,2}\s*/i, '').trim() : null,
        accounts: page.accounts,
        split,
        slug,
        notes: body.trim(),
      });
      continue;
    }

    // Everything else is a file in the share.
    const kindMap: Record<string, WorldFile['kind']> = {
      record: 'contract', ticket: 'ticket', crm: 'crm', weekly: 'update', profile: 'profile', 'agent-note': 'digest', note: 'note', 'private-note': 'note',
    };
    const kind = kindMap[page.kind];
    if (!kind) throw new Error(`unmapped page kind ${page.kind} for ${slug}`);
    const subdir: Record<WorldFile['kind'], string> = {
      contract: 'contracts', ticket: 'tickets', crm: 'crm', update: 'updates', profile: 'profile', digest: 'digests', note: 'notes',
    };
    let folder: string;
    let visibility: WorldFile['visibility'];
    let fileTeam: string | null = team;
    if (kind === 'note') {
      folder = `members/${page.writer}/notes`;
      visibility = fm.visibility === 'private' ? 'private' : 'public';
      fileTeam = memberById.get(page.writer)?.team ?? team;
    } else if (kind === 'digest' || kind === 'update') {
      folder = `teams/${team}/${subdir[kind]}`;
      visibility = kind === 'digest' ? 'public' : 'team';
    } else {
      const first = page.accounts[0];
      if (!first) throw new Error(`${page.kind} page ${slug} names no account`);
      folder = `${accountById.get(first)!.folder}/${subdir[kind]}`;
      visibility = 'team';
    }
    const filePath = `${folder}/${basename(file)}`;
    files.push({
      id: `f-${slug.replace('/', '-')}`,
      path: filePath,
      folder,
      owner: page.writer,
      team: fileTeam,
      visibility,
      kind,
      title: fm.title ?? page.title,
      date,
      status: fm.status ?? null,
      accounts: page.accounts,
      split,
      slug,
      bytes: Buffer.byteLength(raw),
      sha256: sha256(raw),
      body: raw,
    });
  }

  // Channels the corpus justifies without a chat export of their own.
  const employees = members.filter((m) => m.kind === 'employee' || m.kind === 'agent').map((m) => m.id);
  const general = channelFor('general', 'general', null, 'both',
    'workspace-wide channel; every employee and the assistant agent are members; no corpus history', 'Company-wide announcements');
  employees.forEach((id) => addChannelMember(general, id));
  const helpIt = channelFor('help-it-ops', 'named', null, 'both',
    'named in a corpus message ("pinging IT in #help-it-ops", chats/central-team-banter); every employee is a member; no corpus history',
    'IT help desk');
  employees.forEach((id) => addChannelMember(helpIt, id));
  for (const c of channels) {
    if (c.kind !== 'dm') c.members.sort();
  }

  for (const m of members) {
    if (m.id === 'moss') m.note = 'AI assistant in the corpus; kept as a workspace user so its digests have an owner';
  }

  messages.sort((a, b) => Number(a.ts) - Number(b.ts) || a.id.localeCompare(b.id));
  files.sort((a, b) => a.path.localeCompare(b.path));
  calendar.sort((a, b) => a.start.localeCompare(b.start));
  mail.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  channels.sort((a, b) => a.name.localeCompare(b.name));

  const world: World = {
    world_id: 'pemberline-messy-company-v1',
    today: TODAY,
    time_zone: TIME_ZONE,
    source: { dataset: 'messy-company-v1', path: 'eval/data/messy-company-v1 in garrytan/gbrain-evals', inputs: inputs.length },
    teams,
    members,
    accounts,
    channels,
    messages,
    files,
    calendar,
    mail,
  };
  inputs.sort((a, b) => a.path.localeCompare(b.path));
  return { world, inputs };
}

export function countWorld(world: World): Record<string, number> {
  const by = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((acc, x) => { acc[f(x)] = (acc[f(x)] ?? 0) + 1; return acc; }, {});
  const out: Record<string, number> = {
    members: world.members.length,
    employees: world.members.filter((m) => m.kind === 'employee').length,
    agents: world.members.filter((m) => m.kind === 'agent').length,
    guests: world.members.filter((m) => m.kind === 'contact' || m.kind === 'vendor' || m.kind === 'guest').length,
    teams: world.teams.length,
    accounts: world.accounts.length,
    channels: world.channels.filter((c) => c.kind !== 'dm').length,
    dms: world.channels.filter((c) => c.kind === 'dm').length,
    messages: world.messages.length,
    files: world.files.length,
    private_notes: world.files.filter((f) => f.visibility === 'private').length,
    calendar_events: world.calendar.length,
    mail: world.mail.length,
  };
  for (const [k, v] of Object.entries(by(world.messages, (m) => `messages_${m.split}`))) out[k] = v;
  for (const [k, v] of Object.entries(by(world.files, (f) => `files_${f.kind}`))) out[k] = v;
  for (const [k, v] of Object.entries(by(world.channels.filter((c) => c.kind !== 'dm'), (c) => `channels_${c.kind}`))) out[k] = v;
  for (const [k, v] of Object.entries(by(world.calendar, (e) => `calendar_${e.split}`))) out[k] = v;
  for (const [k, v] of Object.entries(by(world.mail, (m) => `mail_${m.split}`))) out[k] = v;
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  if (!root) {
    console.error('usage: bun world/seed/import.ts <messy-company-v1 dir> [--out world/seed]');
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1]! : join(import.meta.dir);
  const { world, inputs } = importWorld(root);
  const json = JSON.stringify(world, null, 1) + '\n';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'world.json'), json);
  const manifest = {
    world_id: world.world_id,
    today: world.today,
    source: world.source,
    inputs_sha256: sha256(inputs.map((i) => `${i.sha256}  ${i.path}\n`).join('')),
    world_json_sha256: sha256(json),
    world_json_bytes: Buffer.byteLength(json),
    counts: countWorld(world),
    inputs,
  };
  writeFileSync(join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(JSON.stringify({ counts: manifest.counts, inputs: inputs.length, inputs_sha256: manifest.inputs_sha256, world_json_sha256: manifest.world_json_sha256 }, null, 1));
}
