// Shared record shapes for the simulated company world.
// world/seed/import.ts writes a `World`; the services load one and filter it by split.

export type Split = 'dev' | 'heldout' | 'both';

export interface Team {
  id: string;
  name: string;
  short: string;
  cluster: string;
  split: Split;
  lead: string;
  members: string[];
}

export interface Member {
  id: string;
  slack_id: string;
  name: string;
  first: string;
  handle: string;
  email: string;
  role: string;
  kind: 'employee' | 'agent' | 'contact' | 'vendor' | 'guest';
  org: string;
  team: string | null;
  cluster: string | null;
  org_wide: boolean;
  is_admin: boolean;
  split: Split;
  note?: string;
}

export interface Account {
  id: string;
  name: string;
  cluster: string;
  split: Split;
  team: string;
  owner: string | null;
  parent?: string;
  renamed?: { on: string; to: string; former: string };
  aliases: string[];
  folder: string;
}

export interface Channel {
  id: string;
  name: string;
  kind: 'team' | 'random' | 'incident' | 'general' | 'named' | 'dm';
  purpose: string;
  split: Split;
  cluster: string | null;
  members: string[];
  source_slugs: string[];
  rule: string;
}

export interface Message {
  id: string;
  channel: string;
  author: string;
  ts: string;
  date: string;
  date_basis: 'frontmatter' | 'undated';
  time_text: string | null;
  text: string;
  split: Split;
  slug: string;
}

export interface WorldFile {
  id: string;
  path: string;
  folder: string;
  owner: string;
  team: string | null;
  visibility: 'private' | 'team' | 'public';
  kind: 'contract' | 'ticket' | 'crm' | 'update' | 'profile' | 'digest' | 'note';
  title: string;
  date: string | null;
  status: string | null;
  accounts: string[];
  split: Split;
  slug: string;
  bytes: number;
  sha256: string;
  body: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  body_date: string | null;
  start: string;
  end: string;
  organizer: string;
  attendees: string[];
  attendees_text: string | null;
  accounts: string[];
  split: Split;
  slug: string | null;
  notes: string;
}

export interface MailParty {
  member: string | null;
  raw: string;
}

export interface Mail {
  id: string;
  from: MailParty;
  to: MailParty[];
  cc: MailParty[];
  date: string;
  date_header: string | null;
  subject: string;
  body: string;
  mailbox_members: string[];
  accounts: string[];
  split: Split;
  slug: string | null;
  status: 'received' | 'draft';
}

export interface World {
  world_id: string;
  today: string;
  time_zone: { name: string; offset_minutes: number };
  source: { dataset: string; path: string; inputs: number };
  teams: Team[];
  members: Member[];
  accounts: Account[];
  channels: Channel[];
  messages: Message[];
  files: WorldFile[];
  calendar: CalendarEvent[];
  mail: Mail[];
}
