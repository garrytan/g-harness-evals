// owner-identity (GST-3217): the owner card reaches Claude Code and Codex through their startup files. The adapters' owner-card
// block is cut out of each adapter.sh and run under bash with a scrubbed environment (env -i plus an allowlist, never a login
// shell): it appends the card after whatever the gbrain installer wrote, records owner-card.json and the ready fragment, and
// refuses a bad card before ready. The runner validates Cell.owner_card and hands the card over as HE_OWNER_CARD_B64.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPrereg, OWNER_CARD_HARNESSES, type Cell, type Prereg } from '../runner/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const tmp = mkdtempSync(join(tmpdir(), 'he-owner-card-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const ADAPTERS = { 'claude-code': { dirVar: 'CLAUDE_CONFIG_DIR', file: 'CLAUDE.md' }, codex: { dirVar: 'CODEX_HOME', file: 'AGENTS.md' } } as const;

function ownerCardBlock(harness: keyof typeof ADAPTERS): string {
  const text = readFileSync(join(ROOT, 'harnesses', harness, 'adapter.sh'), 'utf8');
  const start = text.indexOf('# owner-identity (GST-3217): HE_OWNER_CARD_B64');
  const endMark = "owner_card_json=$(printf ',\"owner_card\"";
  const end = text.indexOf('\nfi\n', text.indexOf(endMark, start));
  if (start < 0 || end < 0) throw new Error(`no owner-card block in harnesses/${harness}/adapter.sh`);
  return text.slice(start, end + 4);
}

function run(harness: keyof typeof ADAPTERS, name: string, card: string | null, existing?: string) {
  const dir = join(tmp, harness, name);
  const home = join(dir, 'state', harness === 'codex' ? 'codex' : 'claude');
  const logs = join(dir, 'logs');
  mkdirSync(logs, { recursive: true });
  if (existing !== undefined) { mkdirSync(home, { recursive: true }); writeFileSync(join(home, ADAPTERS[harness].file), existing); }
  const script = join(dir, 'block.sh');
  writeFileSync(script, `set -euo pipefail\nlog() { printf '%s\\n' "$*" >> "$HE_LOG_DIR/adapter.log"; }\n${ownerCardBlock(harness)}\nprintf '%s' "$owner_card_json" > "$HE_LOG_DIR/ready-fragment"\n`);
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HE_LOG_DIR: logs, [ADAPTERS[harness].dirVar]: home };
  if (card !== null) env.HE_OWNER_CARD_B64 = card;
  const r = spawnSync('bash', [script], { env, encoding: 'utf8' });
  const startup = join(home, ADAPTERS[harness].file);
  return { status: r.status, startup: existsSync(startup) ? readFileSync(startup, 'utf8') : null, rec: existsSync(join(logs, 'owner-card.json')) ? JSON.parse(readFileSync(join(logs, 'owner-card.json'), 'utf8')) : null, fragment: existsSync(join(logs, 'ready-fragment')) ? readFileSync(join(logs, 'ready-fragment'), 'utf8') : null };
}

const CARD = 'You work for Avery Quill (avery@example.test, aq@example.test). Facts they state about themselves belong on their page.';
const b64 = (s: string) => Buffer.from(s).toString('base64');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

for (const harness of Object.keys(ADAPTERS) as Array<keyof typeof ADAPTERS>) {
  describe(`${harness} adapter owner card`, () => {
    test('appended after what the gbrain installer wrote, with a blank line between, and recorded', () => {
      const installer = '<!-- gbrain brain-first -->\nCheck GBrain first.\n';
      const r = run(harness, 'after-installer', b64(CARD), installer);
      expect(r.status).toBe(0);
      expect(r.startup).toBe(`${installer}\n\n${CARD}\n`);
      expect(r.rec.file.endsWith(`/${ADAPTERS[harness].file}`)).toBe(true);
      expect(r.rec).toMatchObject({ status: 'ok', card_sha256: sha(CARD), card_bytes: CARD.length, existed: true, bytes_before: installer.length, file_sha256: sha(r.startup!) });
      expect(JSON.parse(`{${r.fragment!.slice(1)}}`)).toEqual({ owner_card: { file: r.rec.file, card_sha256: sha(CARD), appended_to_existing: true } });
    });

    test('with no startup file the card alone is written', () => {
      const r = run(harness, 'fresh', b64(CARD));
      expect(r.status).toBe(0);
      expect(r.startup).toBe(`${CARD}\n`);
      expect(r.rec.existed).toBe(false);
    });

    test('unset, nothing is written or recorded', () => {
      const r = run(harness, 'unset', null, 'seed\n');
      expect(r.status).toBe(0);
      expect(r.startup).toBe('seed\n');
      expect(r.rec).toBeNull();
      expect(r.fragment).toBe('');
    });

    test('a card over 4,000 bytes or not canonical base64 is HE-ADAPTER-007 before ready, the startup file untouched', () => {
      for (const [name, card] of [['big', b64('x'.repeat(4001))], ['bad', 'not base64!']] as const) {
        const r = run(harness, name, card, 'seed\n');
        expect(r.status).toBe(2);
        expect(r.startup).toBe('seed\n');
        expect(r.rec).toMatchObject({ status: 'error', code: 'HE-ADAPTER-007' });
      }
    });
  });
}

test('the runner hands the card only to the adapters that read it', () => {
  expect([...OWNER_CARD_HARNESSES].map(String).sort()).toEqual(Object.keys(ADAPTERS).sort());
});

function prereg(cell: Partial<Cell>, runId: string): string {
  const dir = join(tmp, 'prereg', runId);
  mkdirSync(dir, { recursive: true });
  const c = { id: 'oc', harness: 'claude-code', model: 'anthropic:claude-opus-5-5', slice: 'multiuser', split: 'dev', repetitions: 1, ceiling: { input_tokens: 20_000, output_tokens: 2_000 }, ...cell } as Cell;
  const p: Prereg = { schema_version: 1, run_id: runId, question: 'owner card fixture', tasks: {}, cells: [c], wall_clock_s: { multiuser: 120 }, spend_cap_usd: 1, drop_order: [], minimum_v01: [] };
  writeFileSync(join(dir, 'prereg.json'), JSON.stringify(p));
  return join(dir, 'prereg.json');
}

test('Cell.owner_card loads on Claude Code and Codex; a missing, empty or oversized card or another harness is refused', () => {
  const card = join(tmp, 'card.md');
  writeFileSync(card, CARD);
  expect(loadPrereg(prereg({ owner_card: card }, 'oc-cc')).prereg.cells[0]!.owner_card).toBe(card);
  expect(loadPrereg(prereg({ owner_card: card, harness: 'codex', model: 'openai:gpt-6.1-sol', network: 'internal' }, 'oc-codex')).prereg.cells[0]!.owner_card).toBe(card);
  expect(() => loadPrereg(prereg({ owner_card: join(tmp, 'nope.md') }, 'oc-missing'))).toThrow(/HE-TASK-002 .*owner_card not found/);
  const empty = join(tmp, 'empty.md');
  writeFileSync(empty, '');
  expect(() => loadPrereg(prereg({ owner_card: empty }, 'oc-empty'))).toThrow(/HE-TASK-002 .*is 0 bytes/);
  const big = join(tmp, 'big.md');
  writeFileSync(big, 'x'.repeat(4001));
  expect(() => loadPrereg(prereg({ owner_card: big }, 'oc-big'))).toThrow(/HE-TASK-002 .*is 4001 bytes/);
  expect(() => loadPrereg(prereg({ owner_card: card, harness: 'openclaw' }, 'oc-openclaw'))).toThrow(/HE-PREREG-005 .*owner_card is read by the claude-code and codex adapters only/);
});

