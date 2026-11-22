// internal-task: gbrain's install route for each harness, read from INSTALL_FOR_AGENTS.md at the tag under test. This file holds
// selectors, never commands: a marker in the doc and the fenced block after it (or an inline command the doc names), so the
// canary runs what the doc at that tag tells an agent to run. Each selector's block sha256 at v0.60.761.0 is kept so a changed
// block is reported (doc_route: changed); a selector whose marker is gone makes the run INCOMPLETE.
import { createHash } from 'node:crypto';

export type Harness = 'claude-code' | 'codex' | 'openclaw' | 'hermes';
export const HARNESSES: Harness[] = ['claude-code', 'codex', 'openclaw', 'hermes'];
export type Step = 'bun' | 'binary' | 'setup';

/** One way to find a route part in the doc: the nth fenced block after marker, or (inline) a command the doc names in prose. */
export interface Selector { id: string; marker: string; nth?: number; inline?: string }
/** A route part: the first selector whose marker the doc holds wins. */
export interface Part { name: string; alternatives: Selector[] }

export const BUN: Part = { name: 'bun-default', alternatives: [{ id: 'step1-default', marker: 'Default path (Bun' }] };
export const SETUP_CC: Part = { name: 'setup', alternatives: [{ id: 'step3-claude-code-codex', marker: '**If you are Claude Code or Codex**' }] };
export const INIT: Part = { name: 'init', alternatives: [{ id: 'step3-otherwise', marker: '## Step 3: Create the Brain', nth: 1 }] };
export const HERMES_BINARY: Part = { name: 'release-binary', alternatives: [{ id: 'release-binary', marker: '<a id="release-binary"></a>' }] };
export const HERMES_REGISTER: Part = { name: 'register', alternatives: [{ id: 'if-hermes', marker: '**If you are Hermes:**' }] };
export const OPENCLAW_REGISTER: Part = { name: 'register', alternatives: [
  { id: 'if-openclaw', marker: '**If you are OpenClaw:**' },
  { id: 'inline-setup-openclaw', marker: 'per-turn rule that \`gbrain setup openclaw\` installs', inline: 'gbrain setup openclaw' },
] };

/** Block sha256s at v0.60.761.0, and the inline OpenClaw setup at v0.60.757.0 (tests/install-canary.test.ts recomputes them). */
export const EXPECTED: Record<string, string> = {
  'step1-default': 'ae568b42c72c2e56cbc5ecbc33c87673018622a46a742ca0f6059e52a122b5fa',
  'step3-claude-code-codex': '9677ca624dbe6a55fa9e118230e17dd830c47ab88a782b44eeeb5d285ba2128c',
  'step3-otherwise': 'adbb6a5df33f7d9d35e1ce9c8051e603848d39390e19f5f0e59b404384ad78fa',
  'release-binary': '816995ace84a42b3a859f652a9f19368288ca1347289f8e830b26b313e28dce7',
  'if-hermes': '663f1aef8b0578c3403965c1bae21457ba0d7ab1617a2ca20e2b5606999fecc2',
  'if-openclaw': 'c64549b503764d2c6d0d9c1b9f85f2dd5612ffdb8a50e9687c5a3e927357f13d',
  'inline-setup-openclaw': '95cc1bc489b19577335d40fa3bcac2a6be1fe2799408e7956c15d9414a836de0',
};

/** Hermes's release-binary route exists in the doc from v0.60.757.0; before that the doc sends Hermes down the Bun route. */
export const hasReleaseBinary = (doc: string) => doc.includes(HERMES_BINARY.alternatives[0]!.marker);

/** The parts the canary runs for a harness, and (Hermes with a release-binary route only) the probe parts run in their own
 *  trial, whose refusal is recorded and never fails the release. */
export function routeParts(harness: Harness, doc: string): { route: Part[]; probe: Part[] | null } {
  if (harness === 'claude-code' || harness === 'codex') return { route: [BUN, SETUP_CC], probe: null };
  if (harness === 'openclaw') return { route: [BUN, INIT, OPENCLAW_REGISTER], probe: null };
  return hasReleaseBinary(doc) ? { route: [HERMES_BINARY, HERMES_REGISTER], probe: [BUN] } : { route: [BUN, INIT, HERMES_REGISTER], probe: null };
}

/** The lines of the nth fenced block after marker, or null when the marker or the block is missing. Blank lines and whole-line
 *  comments are dropped; a comment after a command stays, as written. */
export function blockAfter(doc: string, marker: string, nth = 0): string[] | null {
  const at = doc.indexOf(marker);
  if (at < 0) return null;
  const lines = doc.slice(at).split('\n');
  let seen = -1;
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*\x60\x60\x60(bash|sh|shell)?\s*$/.test(lines[i]!)) continue;
    seen++;
    const end = lines.findIndex((l, j) => j > i && /^\s*\x60\x60\x60\s*$/.test(l));
    if (end < 0) return null;
    if (seen < nth) { i = end; continue; }
    return lines.slice(i + 1, end).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '' && !/^\s*#/.test(l));
  }
  return null;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The channel a run tests: a release tag (refs in the doc swapped for the tag), or stable (the doc as written). */
export type Channel = { kind: 'tag'; tag: string } | { kind: 'stable' };

/** The two substitutions the canary makes, and only for a tag: #stable and releases/latest/download name the tag instead. Codex
 *  runs Claude Code's setup line with codex in its place, as the doc says. */
export function substitute(line: string, harness: Harness, channel: Channel): string {
  let out = line;
  if (channel.kind === 'tag') out = out.replaceAll('github:garrytan/gbrain#stable', 'github:garrytan/gbrain#' + channel.tag)
    .replaceAll('/releases/latest/download/', '/releases/download/' + channel.tag + '/');
  if (harness === 'codex') out = out.replace(/\bgbrain setup claude-code\b/g, 'gbrain setup codex');
  return out;
}

export function stepOf(line: string): Step {
  if (/bun\.sh\/install|^export PATH=/.test(line)) return 'bun';
  if (/bun install -g|\/releases\/|^chmod |--version\b/.test(line)) return 'binary';
  return 'setup';
}

export interface RouteLine { part: string; selector: string; step: Step; doc_line: string; command: string }
export interface Resolved { selector: string; part: string; found: boolean; sha256: string | null; changed: boolean }
export interface Route { lines: RouteLine[]; resolved: Resolved[]; missing: string[] }

export function resolveParts(parts: Part[], doc: string, harness: Harness, channel: Channel): Route {
  const lines: RouteLine[] = [];
  const resolved: Resolved[] = [];
  const missing: string[] = [];
  for (const part of parts) {
    let hit: { sel: Selector; body: string[] } | null = null;
    for (const sel of part.alternatives) {
      const body = sel.inline ? (doc.includes(sel.marker) ? [sel.inline] : null) : blockAfter(doc, sel.marker, sel.nth ?? 0);
      if (body?.length) { hit = { sel, body }; break; }
    }
    if (!hit) { missing.push(part.name); resolved.push({ selector: part.alternatives.map((s) => s.id).join('|'), part: part.name, found: false, sha256: null, changed: false }); continue; }
    const digest = sha256(hit.body.join('\n') + '\n');
    resolved.push({ selector: hit.sel.id, part: part.name, found: true, sha256: digest, changed: !!EXPECTED[hit.sel.id] && EXPECTED[hit.sel.id] !== digest });
    for (const docLine of hit.body) {
      const command = substitute(docLine, harness, channel);
      lines.push({ part: part.name, selector: hit.sel.id, step: stepOf(command), doc_line: docLine, command });
    }
  }
  return { lines, resolved, missing };
}

/** The route under test and the probe (if any) for a harness at a doc. */
export function resolveRoute(harness: Harness, doc: string, channel: Channel): { route: Route; probe: Route | null } {
  const { route, probe } = routeParts(harness, doc);
  return { route: resolveParts(route, doc, harness, channel), probe: probe ? resolveParts(probe, doc, harness, channel) : null };
}
