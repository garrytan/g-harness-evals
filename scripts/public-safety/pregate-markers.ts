#!/usr/bin/env bun
/**
 * The public tree's .gstack/pregate.json, generated from the public-safety rules (R11). The private repository's
 * pregate.json is copied unchanged except for its sealed block: answer_markers become exactly the regexes of
 * scripts/public-safety/rules.json (each rule's regex or regexes; ignore_case or an i flag wraps a regex in (?i:...)),
 * and local_paths is true, so gstack-pregate's sealed check and pre-push hook refuse the same value-free patterns that
 * public CI refuses. Every key must be one gstack-pregate accepts, and every marker must pass its sealed-config limits
 * (64 markers of 1 to 256 characters, each a valid regex); anything else throws instead of writing a config gstack
 * would refuse. The export's tree staging (scripts/public-export/export.ts) writes the result into the public tree.
 *
 *   bun scripts/public-safety/pregate-markers.ts <rules.json> <pregate.json>   prints the public pregate.json
 */
import { readFileSync } from 'node:fs';

export const RULES_PATH = 'scripts/public-safety/rules.json';
export const PREGATE_PATH = '.gstack/pregate.json';
export const PREGATE_KEYS = ['runner', 'dependencies', 'empty_lanes', 'selection', 'warn', 'strays', 'local', 'guards', 'serial_patterns', 'price_file', 'sealed', 'stall_timeout_s', 'timeout_s', 'remote_gate', 'allowlist', 'run_profiles', 'remote_gate_runs', 'ship_lanes_from'];
export const SEALED_KEYS = ['paths', 'transcripts', 'answer_markers', 'seed_patterns', 'local_paths', 'allow_paths', 'case_insensitive', 'label_keys', 'identifier_keys', 'visibility'];
const MAX_MARKERS = 64;
const MAX_REGEX = 256;

interface Rule { id?: unknown; regex?: unknown; regexes?: unknown; patterns?: unknown; ignore_case?: unknown; flags?: unknown; blocking?: unknown; allow_paths?: unknown; allow_classes?: unknown; agent_notes_exempt?: unknown }

/** The answer markers one rules.json yields, in rule order, without duplicates. A rule with exceptions (allow_paths,
 *  allow_classes, the Agent notes exemption) or that is not blocking is left to check.ts, since pregate cannot express it. */
export function markersOf(rules: unknown): string[] {
  const list = (rules as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) throw new Error(RULES_PATH + ': expected {"rules": [...]}');
  const out: string[] = [];
  for (const [i, r] of (list as Rule[]).entries()) {
    const at = RULES_PATH + ' rules[' + i + ']' + (typeof r?.id === 'string' ? ' (' + r.id + ')' : '');
    if (r?.blocking === false || r?.allow_paths !== undefined || r?.allow_classes !== undefined || r?.agent_notes_exempt === true) continue;
    const regexes = r?.regex !== undefined ? [r.regex] : r?.patterns !== undefined ? r.patterns : r?.regexes;
    if (!Array.isArray(regexes) || !regexes.length || regexes.some((x) => typeof x !== 'string')) throw new Error(at + ': needs a regex string or a non-empty patterns or regexes array');
    const flags = typeof r.flags === 'string' ? r.flags : '';
    if (/[^gi]/.test(flags)) throw new Error(at + ': flag ' + flags.replace(/[gi]/g, '') + ' has no gstack-pregate equivalent');
    const fold = r.ignore_case === true || flags.includes('i');
    for (const x of regexes as string[]) {
      const marker = fold ? '(?i:' + x + ')' : x;
      if (!marker || marker.length > MAX_REGEX) throw new Error(at + ': a marker must be 1 to ' + MAX_REGEX + ' characters');
      try { new RegExp(marker); } catch (e) { throw new Error(at + ': not a valid regex (' + (e as Error).message + ')'); }
      if (!out.includes(marker)) out.push(marker);
    }
  }
  if (out.length > MAX_MARKERS) throw new Error(RULES_PATH + ': ' + out.length + ' markers; gstack-pregate takes at most ' + MAX_MARKERS);
  return out;
}

/** The public pregate.json object: the given config with sealed.answer_markers from the rules and sealed.local_paths true. */
export function publicPregate(rules: unknown, pregate: unknown): Record<string, unknown> {
  if (!pregate || typeof pregate !== 'object' || Array.isArray(pregate)) throw new Error(PREGATE_PATH + ': expected a JSON object');
  const config = pregate as Record<string, unknown>;
  for (const k of Object.keys(config)) if (k !== '$schema' && !PREGATE_KEYS.includes(k)) throw new Error(PREGATE_PATH + ': gstack-pregate does not accept the key ' + k);
  const sealed = config.sealed ?? {};
  if (typeof sealed !== 'object' || Array.isArray(sealed)) throw new Error(PREGATE_PATH + ': sealed must be an object');
  for (const k of Object.keys(sealed)) if (!SEALED_KEYS.includes(k)) throw new Error(PREGATE_PATH + ': gstack-pregate does not accept the key sealed.' + k);
  return { ...config, sealed: { ...sealed, answer_markers: markersOf(rules), local_paths: true } };
}

/** The file text the export writes: two-space JSON with a trailing newline, as the source file is written. */
export function renderPublicPregate(rulesText: string, pregateText: string): string {
  return JSON.stringify(publicPregate(JSON.parse(rulesText), JSON.parse(pregateText)), null, 2) + '\n';
}

if (import.meta.main) {
  const [rules, pregate] = process.argv.slice(2);
  if (!rules || !pregate) { console.error('usage: bun scripts/public-safety/pregate-markers.ts <rules.json> <pregate.json>'); process.exit(2); }
  try { process.stdout.write(renderPublicPregate(readFileSync(rules, 'utf8'), readFileSync(pregate, 'utf8'))); }
  catch (e) { console.error('pregate-markers: ' + (e as Error).message); process.exit(1); }
}
