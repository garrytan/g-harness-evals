// owner-identity (internal-task-a, internal-task-b): the owner card check and QM's sender signal for the trial record.
//
// The runner hands a cell's owner card (Cell.owner_card) to the adapter as HE_OWNER_CARD_B64; each adapter writes it where its
// harness reads standing context and names it in the ready line's owner_card field (docs/owner-identity.md, "The owner card").
// On an owner-identity trial the harness slot is bound with collect_requests, so the bodies the proxy forwarded stay in its
// memory; ownerCardCheck reads the first agent-loop request among them and says whether the card's lines are in it. Arms N and G
// must show the card there, arm B (no owner_card) must not. Nothing here is a score: it is the pilot's check that the part
// under test ran.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { TrialOwnerCard, TrialSenderSignal } from '../contracts.ts';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Every string inside a request body, in order, so a card line inside JSON escapes still matches. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** The first agent-loop request among the collected bodies: on the cell model (the part after "provider:"), offering tools; the
 *  first on the cell model when none offers tools; null when none is on the cell model. A housekeeping call on another model
 *  (session titles, an ack emoji) is never the first agent-loop request. */
export function firstAgentLoopRequest(requests: unknown[], cellModel: string): Record<string, unknown> | null {
  const name = cellModel.includes(':') ? cellModel.slice(cellModel.indexOf(':') + 1) : cellModel;
  const onModel = requests.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && (b as Record<string, unknown>).model === name);
  return onModel.find((b) => Array.isArray(b.tools) && b.tools.length > 0) ?? onModel[0] ?? null;
}

/** How many of the card's non-empty lines a request body holds, whitespace collapsed on both sides. */
export function cardLinesIn(card: string, body: unknown): { lines: number; found: number } {
  const lines = card.split('\n').map(squash).filter(Boolean);
  const text = squash(strings(body).join('\n'));
  return { lines: lines.length, found: lines.filter((l) => text.includes(l)).length };
}

/** The record's owner_card. `card` is the card checked (the cell's, or the set's card on a cell without one), `expected` whether
 *  the cell carries owner_card, `ready` the adapter's parsed ready line (null when it wrote none). */
export function ownerCardCheck(o: { card: Buffer | null; expected: boolean; ready: unknown; requests: unknown[]; cellModel: string }): TrialOwnerCard {
  const r = (o.ready as { owner_card?: { file?: unknown; card_sha256?: unknown; setting?: unknown } } | null)?.owner_card;
  const ready = r && typeof r.file === 'string' && typeof r.card_sha256 === 'string'
    ? { file: r.file, card_sha256: r.card_sha256, ...(typeof r.setting === 'string' ? { setting: r.setting } : {}) }
    : null;
  const first = firstAgentLoopRequest(o.requests, o.cellModel);
  const { lines, found } = cardLinesIn(o.card?.toString('utf8') ?? '', first ?? '');
  const first_request = !first ? 'no_request' : lines > 0 && found === lines ? 'present' : found > 0 ? 'partial' : 'absent';
  const card_sha256 = o.card ? createHash('sha256').update(o.card).digest('hex') : null;
  const ok = o.expected
    ? ready !== null && ready.card_sha256 === card_sha256 && first_request === 'present'
    : ready === null && first_request === 'absent';
  return { expected: o.expected, card_sha256, ready, first_request, lines, lines_found: found, ok };
}

/** QM's per-turn sender, from the adapter's <logs>/turns/turn-NNNN.job.json (the body it posted to /v1/turns); null when the
 *  adapter wrote no job file. */
export function qmSenderSignal(logsDir: string): TrialSenderSignal | null {
  const dir = join(logsDir, 'turns');
  if (!existsSync(dir)) return null;
  const turns = readdirSync(dir).filter((f) => /^turn-\d+\.job\.json$/.test(f)).sort().flatMap((f) => {
    try {
      const job = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { actor?: { externalId?: unknown; displayName?: unknown } };
      if (typeof job.actor?.externalId !== 'string') return [];
      return [{ turn: Number(f.slice(5, f.indexOf('.'))), external_id: job.actor.externalId, display_name: typeof job.actor.displayName === 'string' ? job.actor.displayName : null }];
    } catch { return []; }
  });
  return turns.length ? { field: 'actor.externalId', turns } : null;
}
