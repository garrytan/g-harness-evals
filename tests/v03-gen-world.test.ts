import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FactsFile } from '../scripts/v03/types.ts';
import type { World } from '../world/types.ts';
import { PLANTED_MARKER } from './fixtures/v03-fake-transport.ts';
import { checkSet } from '../scripts/v03/check-set.ts';
import { generate, parseCounts, writeTask } from '../scripts/v03/gen-tasks.ts';

// scripts/v03/gen-world.ts with a keyless fake model: determinism, fact placement, bait scope, dev records kept, and
// print discipline (no page text, name or value on stdout or stderr).

const repo = join(import.meta.dir, '..');
const corpus = process.env.MESSY_COMPANY_V1 ?? join(homedir(), '.capy/work/harness-eval/gbrain-evals/eval/data/messy-company-v1');
const publicText = readFileSync(join(repo, 'world/seed/world.json'), 'utf8');
const publicWorld = JSON.parse(publicText) as World;

async function run(seedFile: string, out: string, extra: string[] = []) {
  const p = Bun.spawn(['bun', join(repo, 'tests/fixtures/v03-gen-world-run.ts'), '--seed-file', seedFile, '--source', corpus, '--out', out,
    '--lease-usd', '1', '--run-id', 'v03-gen-test', ...extra], { cwd: repo, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

describe.skipIf(!existsSync(corpus))('v0.3 world generator (fake model)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'v03-gen-'));
  const seedFile = join(tmp, 'test.seed');
  writeFileSync(seedFile, 'v03-gen-world-test-seed-1');
  const outA = join(tmp, 'a'), outB = join(tmp, 'b');
  let a: Awaited<ReturnType<typeof run>>, b: Awaited<ReturnType<typeof run>>;
  let world: World, facts: FactsFile;

  test('two runs from one seed succeed and agree on plan, facts and world digests', async () => {
    [a, b] = await Promise.all([run(seedFile, outA), run(seedFile, outB)]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const sa = JSON.parse(a.stdout), sb = JSON.parse(b.stdout);
    expect(sa.digests).toEqual(sb.digests);
    expect(sa.plan_sha256).toBe(sb.plan_sha256);
    expect(readFileSync(join(outA, 'facts.json'), 'utf8')).toBe(readFileSync(join(outB, 'facts.json'), 'utf8'));
    expect(readFileSync(join(outA, 'world.json'), 'utf8')).toBe(readFileSync(join(outB, 'world.json'), 'utf8'));
    expect(existsSync(join(outA, 'MANIFEST.json'))).toBe(true);
    expect(sa.counts.pages_heldout).toBeGreaterThanOrEqual(90);
    expect(sa.counts.pages_heldout).toBeLessThanOrEqual(120);
    expect(sa.counts.retries).toBeGreaterThan(0);
    expect(sa.counts.fallbacks).toBeGreaterThan(0);
    world = JSON.parse(readFileSync(join(outA, 'world.json'), 'utf8'));
    facts = JSON.parse(readFileSync(join(outA, 'facts.json'), 'utf8'));
    const meta = JSON.parse(readFileSync(join(outA, 'gen-meta.json'), 'utf8'));
    expect(meta.digests.world_json_sha256).toBe(facts.world_json_sha256);
    expect(facts.split).toBe('heldout');
  }, 30_000);

  test('the inventory meets the plan minimums and every fact value sits verbatim in its record', () => {
    const answers = facts.facts.filter((f) => f.role === 'answer');
    const baits = facts.facts.filter((f) => f.role === 'bait');
    expect(new Set(baits.map((f) => f.pair)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(answers.map((f) => f.group).filter(Boolean)).size).toBeGreaterThanOrEqual(8);
    expect(answers.filter((f) => ['discount', 'rate', 'contract_value', 'payment_terms'].includes(f.attribute)).length).toBeGreaterThanOrEqual(10);
    for (const a of world.accounts.filter((x) => x.split === 'heldout')) {
      for (const at of ['seat_count', 'renewal_date', 'ticket', 'contact', 'meeting_time', 'product', 'site', 'deadline']) {
        expect(answers.some((f) => f.entity === a.id && f.attribute === at)).toBe(true);
      }
    }
    const text = (kind: string, id: string): string => {
      if (kind === 'message') return world.messages.find((m) => m.id === id)!.text;
      if (kind === 'file') return world.files.find((f) => f.id === id)!.body;
      if (kind === 'mail') { const m = world.mail.find((x) => x.id === id)!; return m.subject + '\n' + m.body; }
      return world.calendar.find((e) => e.id === id)!.notes;
    };
    for (const f of facts.facts) {
      expect(text(f.record.kind, f.record.id)).toContain(f.value);
      expect(new RegExp(f.pattern).test(f.value)).toBe(true);
      expect(f.about.toLowerCase()).not.toContain(f.value.toLowerCase());
      expect(f.readers.length).toBeGreaterThan(0);
    }
  });

  test('every bait sits where at least one reader of its answer cannot see it', () => {
    const byId = new Map(facts.facts.map((f) => [f.id, f]));
    for (const bait of facts.facts.filter((f) => f.role === 'bait')) {
      const answer = byId.get(bait.pair!)!;
      expect(answer.entity).toBe(bait.entity);
      expect(answer.attribute).toBe(bait.attribute);
      expect(answer.value).not.toBe(bait.value);
      expect(answer.readers.some((r) => !bait.readers.includes(r))).toBe(true);
    }
  });

  test('no fact value occurs in the public world', () => {
    const lower = publicText.toLowerCase();
    for (const f of facts.facts) expect(lower.includes(f.value.toLowerCase())).toBe(false);
  });

  test('world.json is the public world with its held-out records replaced by slice.json, which changes no public record', () => {
    const slice = JSON.parse(readFileSync(join(outA, 'slice.json'), 'utf8')) as Record<string, Array<{ id: string; split: string }>>;
    const COLLECTIONS = ['teams', 'members', 'accounts', 'channels', 'messages', 'files', 'calendar', 'mail'] as const;
    for (const c of COLLECTIONS) {
      const pub = publicWorld[c] as unknown as Array<{ id: string; split: string }>;
      const publicIds = new Set(pub.map((r) => r.id));
      expect(slice[c]!.length).toBeGreaterThan(0);
      for (const r of slice[c]!) {
        expect(r.split).toBe('heldout');
        expect(publicIds.has(r.id) && pub.find((x) => x.id === r.id)!.split !== 'heldout').toBe(false);
      }
      expect(world[c] as unknown).toEqual([...pub.filter((r) => r.split !== 'heldout'), ...slice[c]!]);
    }
    for (const k of ['world_id', 'today', 'time_zone', 'source'] as const) expect((world as unknown as Record<string, unknown>)[k]).toEqual((publicWorld as unknown as Record<string, unknown>)[k]);
    expect(readFileSync(join(outA, 'world.json'), 'utf8')).toBe(JSON.stringify(world, null, 1) + '\n');
  });

  test('the generated world supplies all 48 held-out candidates and every one passes the keyless checks', async () => {
    const tasksDir = join(tmp, 'tasks');
    const tasks = generate({ world, facts: facts.facts, split: 'heldout', seed: 'v03-gen-world-test-tasks', ids: 'opaque',
      counts: parseCounts('scope_isolation=9,shared_channel=6,synthesis=8,continuity=9,corrections=9,approval_relay=7') });
    expect(tasks.length).toBe(48);
    for (const t of tasks) writeTask(join(tasksDir, t.id), t.id, 'heldout', t.built);
    const checks = await checkSet(tasksDir, join(outA, 'world.json'), 'heldout', facts.facts);
    expect(checks.filter((c) => c.flags.length).map((c) => c.id + ':' + c.flags.join(',') + ':' + c.details.join(' | '))).toEqual([]);
  }, 60_000);

  test('stdout and stderr carry no page text, name or value', () => {
    const printed = a.stdout + a.stderr + b.stdout + b.stderr;
    expect(printed).not.toContain(PLANTED_MARKER);
    for (const f of facts.facts) expect(printed).not.toContain(f.value);
    for (const m of world.members.filter((x) => x.split === 'both')) {
      expect(printed).not.toContain(m.name);
      expect(printed).not.toContain(m.first);
    }
    for (const acc of world.accounts.filter((x) => x.split === 'heldout')) expect(printed).not.toContain(acc.name);
    for (const f of world.files.filter((x) => x.split === 'heldout')) {
      expect(printed).not.toContain(f.slug);
      expect(printed).not.toContain(f.title);
    }
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
});

test('an output path inside the checkout is refused with a code only, before the source is read', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'v03-gen-'));
  const seedFile = join(tmp, 'test.seed');
  writeFileSync(seedFile, 'v03-gen-world-test-seed-1');
  try {
    const r = await run(seedFile, join(repo, 'v03-should-not-exist'), ['--dry-plan']);
    expect(r.code).toBe(1);
    const [json, v03, ...rest] = r.stderr.trim().split('\n');
    expect(JSON.parse(json!)).toEqual({ ok: false, error: 'E_OUT_INSIDE_CHECKOUT' });
    expect(v03).toBe('V03: error GEN-OUT_INSIDE_CHECKOUT');
    expect(rest).toEqual([]);
    expect(existsSync(join(repo, 'v03-should-not-exist'))).toBe(false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
