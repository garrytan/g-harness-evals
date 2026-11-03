// Shared shapes for the v0.3 generators: the facts inventory a world carries and the task specs the task
// generator compiles. A facts file names records in a world.json by id; every fact's value appears verbatim in its record.
//
// The held-out facts file is written by scripts/v03/gen-world.ts from a private seed and never leaves the author's
// machine except inside the sealed bundle. The dev facts file (tasks/multiuser/v0.3/dev-facts.json) indexes public
// dev records of world/seed/world.json.

import type { Split } from '../../world/types.ts';

/** Where a fact is written in the world. */
export type FactRecord =
  | { kind: 'message'; id: string }
  | { kind: 'file'; id: string }
  | { kind: 'mail'; id: string }
  | { kind: 'calendar'; id: string };

/** What a fact is about. finance attributes are finance figures under preamble rule 3. */
export const ATTRIBUTES = [
  'seat_count', 'renewal_date', 'signing_date', 'ticket', 'contact', 'owner', 'meeting_time', 'product', 'site', 'deadline',
  'discount', 'rate', 'contract_value', 'payment_terms',
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export const FINANCE_ATTRIBUTES: ReadonlySet<Attribute> = new Set(['discount', 'rate', 'contract_value', 'payment_terms']);

/** answer: what a task asks for. bait: the same entity and attribute with another value, in a scope the answer's
 *  readers lack, so a careless bot-wide read or search finds it. distractor: shares a keyword with a synthesis group
 *  but is not part of the answer. */
export type FactRole = 'answer' | 'bait' | 'distractor';

export interface Fact {
  id: string;
  /** Account id from world.json accounts, or a member id for a member-level fact. */
  entity: string;
  attribute: Attribute;
  /** Exact string as written in the record, for example "44 seats" or "#4419". */
  value: string;
  /** What the value is about, as a member would name it in a question, for example "the gatehouse tablet freeze at Door 6"
   *  for a ticket or "the 2026 renewal" for a seat count. Never contains the value itself. */
  about: string;
  /** Regex the grader uses for this value in a reply (JavaScript syntax, no flags unless written inline as (?i)). */
  pattern: string;
  record: FactRecord;
  role: FactRole;
  /** For a bait or distractor: the answer fact it shadows. */
  pair?: string;
  /** For synthesis: facts sharing a group id are combined into one answer. */
  group?: string;
  /** Members who may see the record (channel members, file readers, mailbox members, attendees), as written in world.json. */
  readers: string[];
}

export interface FactsFile {
  schema_version: 1;
  split: Exclude<Split, 'both'>;
  /** sha256 of the world.json the ids refer to. */
  world_json_sha256: string;
  facts: Fact[];
}

export const FAMILIES_V03 = ['scope_isolation', 'shared_channel', 'synthesis', 'continuity', 'corrections', 'approval_relay'] as const;
export type FamilyV03 = (typeof FAMILIES_V03)[number];
export type Difficulty = 'easy' | 'medium' | 'hard';
