#!/usr/bin/env bun
// Checks scripts/rules-at-scale/pin.json and an installed harness against it.
//   bun scripts/rules-at-scale/pin-check.ts                          the pin's shape: every harness has a version, an
//                                                                    integrity (npm sha512 or a git commit) and a version check
//   bun scripts/rules-at-scale/pin-check.ts <harness> <version text>  exit 0 when the text a harness printed matches its pin
//   bun scripts/rules-at-scale/pin-check.ts --installed [h,h]         runs each harness's version command on this machine
// Inside a task container the same check runs from agents_rules.py (rules_wiring.version_matches, the same patterns),
// because the container has no bun. Exit 1 on a mismatch, 2 on usage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PinEntry { version: string; npm_integrity?: string; native_binary_sha256?: string; commit?: string; version_command: string; version_pattern?: string }
export interface RulesPin { schema: string; harnesses: Record<string, PinEntry> }

export const PIN_PATH = join(import.meta.dir, 'pin.json');
export const HARNESSES = ['claude-code', 'codex', 'hermes', 'openclaw', 'pi', 'gemini-cli'];

export function loadPin(path = PIN_PATH): RulesPin { return JSON.parse(readFileSync(path, 'utf8')) as RulesPin; }

/** Problems with the pin's shape, empty when it is sound. */
export function pinProblems(pin: RulesPin): string[] {
  const out: string[] = [];
  if (pin.schema !== 'rules-at-scale-pin/1') out.push('schema must be rules-at-scale-pin/1');
  for (const h of HARNESSES) {
    const p = pin.harnesses?.[h];
    if (!p) { out.push(h + ': missing'); continue; }
    if (!p.version) out.push(h + ': no version');
    if (h === 'hermes') {
      if (!/^[0-9a-f]{40}$/.test(p.commit ?? '')) out.push(h + ': commit must be a full sha');
    } else {
      if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(p.npm_integrity ?? '')) out.push(h + ': npm_integrity must be an npm sha512');
      if (!p.version_pattern) out.push(h + ': no version_pattern');
      else if (!new RegExp(p.version_pattern, 'm').test(sampleOutput(h, p.version))) out.push(h + ': version_pattern does not match its own version');
    }
    if (h === 'claude-code' && !/^[0-9a-f]{64}$/.test(p.native_binary_sha256 ?? '')) out.push(h + ': native_binary_sha256 must be a sha256');
    if (!p.version_command) out.push(h + ': no version_command');
  }
  return out;
}

/** What each harness prints for --version at a release (seen on the delivery map's installs). */
export function sampleOutput(h: string, v: string): string {
  return ({ 'claude-code': v + ' (Claude Code)', codex: 'codex-cli ' + v, openclaw: 'OpenClaw ' + v, pi: v, 'gemini-cli': v } as Record<string, string>)[h] ?? v;
}

export function versionMatches(pin: RulesPin, h: string, output: string): boolean {
  const p = pin.harnesses[h];
  if (!p) return false;
  if (h === 'hermes') return output.trim() === p.commit;
  return new RegExp(p.version_pattern!, 'm').test(output.trim());
}

if (import.meta.main) {
  const pin = loadPin();
  const args = process.argv.slice(2);
  if (!args.length) {
    const problems = pinProblems(pin);
    for (const p of problems) console.error('pin-check: ' + p);
    if (!problems.length) console.log('pin-check: ok ' + HARNESSES.map((h) => h + ' ' + pin.harnesses[h]!.version).join(', '));
    process.exit(problems.length ? 1 : 0);
  }
  if (args[0] === '--installed') {
    let bad = 0;
    for (const h of (args[1] ?? HARNESSES.join(',')).split(',')) {
      const r = Bun.spawnSync(['bash', '-c', pin.harnesses[h]!.version_command], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
      const out = (r.stdout.toString() + r.stderr.toString()).trim();
      const ok = r.exitCode === 0 && versionMatches(pin, h, out);
      if (!ok) bad++;
      console.log((ok ? 'ok ' : 'MISMATCH ') + h + ': ' + (out.split('\n').pop() ?? '') + ' (pin ' + pin.harnesses[h]!.version + ')');
    }
    process.exit(bad ? 1 : 0);
  }
  if (args.length === 2 && HARNESSES.includes(args[0]!)) process.exit(versionMatches(pin, args[0]!, args[1]!) ? 0 : 1);
  console.error('usage: pin-check.ts | pin-check.ts <harness> <version text> | pin-check.ts --installed [h,h]');
  process.exit(2);
}
