import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNames, COMPANY_NAME } from '../world/brain/names.ts';
import { corpusSha256, CorpusError, generateCorpus, PARAMS } from '../world/brain/corpus.ts';
import { ARMS, audienceKey, delivered, filesDelivered, filesExport, manifestFor } from '../world/brain/audience.ts';
import { generateTasks, PUBLIC_BANK, PUBLIC_PARTITIONS, tasksSha256 } from '../world/brain/tasks.ts';
import { scan, SPAN } from '../world/brain/scan.ts';
import { exportLeaks, runCheck, SEEDS_FILE, type SeedRecord } from '../world/brain/check.ts';

const seeds = JSON.parse(readFileSync(SEEDS_FILE, 'utf8')) as Record<string, SeedRecord>;
const A = seeds.A!;
const report = runCheck(A.seed);
const scrubbed = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

describe('qm-brain-native corpus (K8)', () => {
  test('corpus A, its tasks and manifests reproduce the hashes seeds.json records', () => {
    expect(report.problems).toEqual([]);
    expect(report.corpus_sha256).toBe(A.corpus_sha256!);
    expect(report.tasks_sha256).toBe(A.tasks_sha256!);
    expect(report.manifests_sha256).toBe(A.manifests_sha256!);
  });

  test('the same seed gives the same bytes and another seed does not', () => {
    expect(corpusSha256(generateCorpus(A.seed))).toBe(report.corpus_sha256);
    expect(corpusSha256(generateCorpus(`${A.seed}/other`))).not.toBe(report.corpus_sha256);
  });

  test('corpus B stays sealed: seeds.json holds no seed or digest for it', () => {
    expect(SEEDS_FILE.endsWith('world/brain/seeds.json')).toBe(true);
    expect(seeds.B!.corpus_sha256).toBeNull();
    expect(seeds.B!.seed).toBe('sealed');
  });

  test('public partitions have the preregistered family counts', () => {
    const count = (p: string, f: string) => report.tasks.filter(t => t.partition === p && t.family === f).length;
    for (const p of ['dev', 'pilot'] as const) {
      const spec = PUBLIC_PARTITIONS[p];
      expect([count(p, 'prep'), count(p, 'who'), count(p, 'changed'), count(p, 'unanswerable')]).toEqual([spec.prep, spec.who, spec.changed, spec.unanswerable]);
      expect(count(p, 'privacy')).toBe(count(p, 'privacy-twin'));
    }
    expect(report.tasks.filter(t => t.partition === 'pilot' && t.audience.kind === 'room')).toEqual([]);
  });

  // R, T and TC are checked against audience.ts's model of gbrain's access rules; the proof against gbrain itself is the
  // keyless differential check at the pinned tag (PREREGISTRATION.md, Audience manifests).
  test('F and the model of gbrain delivery for R, T and TC give exactly the audience manifest, and N nothing', () => {
    const c = report.corpus;
    for (const t of report.tasks) {
      const man = [...manifestFor(c, t.audience)].sort();
      for (const arm of ARMS) expect([...delivered(c, t.audience, arm)].sort()).toEqual(arm === 'N' ? [] : man);
    }
  });

  test('the files export parses back to the manifest, and no excluded codename is in it', () => {
    const c = report.corpus;
    const seen = new Set<string>();
    for (const t of report.tasks) {
      const k = audienceKey(t.audience);
      if (seen.has(k)) continue;
      seen.add(k);
      const files = filesExport(c, t.audience);
      const man = manifestFor(c, t.audience);
      expect([...filesDelivered(files)].sort()).toEqual([...man].sort());
      const text = [...files.values()].join('\n');
      for (const can of c.canaries) if (!man.has(can.page)) expect(text.includes(can.codename)).toBe(false);
    }
  });

  test('the files export links only to pages inside the manifest, even where an allowed page links to a denied one', () => {
    const c = report.corpus;
    let crossing = 0;
    for (const a of new Map(report.tasks.map(t => [audienceKey(t.audience), t.audience])).values()) {
      const man = manifestFor(c, a);
      for (const p of c.pages) if (man.has(p.slug)) crossing += p.links.filter(l => !man.has(l.to)).length;
      for (const md of filesExport(c, a).values()) {
        const rel = (k: string) => JSON.parse(md.match(new RegExp(`^${k}: (.*)$`, 'm'))![1]!) as string[];
        for (const l of [...rel('links_out'), ...rel('links_in')]) expect(man.has(l.slice(l.indexOf(':') + 1))).toBe(true);
      }
    }
    expect(crossing).toBeGreaterThan(0);
  });

  test('the export check matches a cased or hyphenated codename the way the scanner scores it', () => {
    const c = structuredClone(report.corpus);
    const a = report.tasks.find(t => t.family === 'privacy')!.audience;
    const man = manifestFor(c, a);
    const can = c.canaries.find(x => !man.has(x.page))!;
    const host = c.pages.find(p => man.has(p.slug))!;
    const variant = can.codename.toUpperCase().split('').join('-');
    host.body += `\n\nSee ${variant}.`;
    expect(new RegExp(`\\b${can.codename}\\b`).test([...filesExport(c, a).values()].join('\n'))).toBe(false);
    expect(exportLeaks(c, a)).toEqual([{ file: `notes/${host.slug}.md`, page: can.page }]);
    expect(exportLeaks(report.corpus, a)).toEqual([]);
  });

  test('every key item rests on pages inside its task audience manifest', () => {
    for (const t of report.tasks) {
      const man = manifestFor(report.corpus, t.audience);
      for (const k of t.key) for (const p of k.pages) expect(man.has(p)).toBe(true);
    }
  });

  test('names pass the collision check and a blocklisted or near-duplicate name fails it', () => {
    expect(COMPANY_NAME).toBe('Quessaly Robotics');
    expect(checkNames(['Ada Brill'], ['Northwind Robotics']).map(p => p.problem)).toEqual(['contains the blocklisted name Northwind']);
    expect(checkNames([], ['Talvren Freight', 'Talvren Freigh']).length).toBe(1);
    expect(checkNames([], ['Talvren Freight', 'Talvren Freigh'], ['Talvren Freight|Talvren Freigh'])).toEqual([]);
  });

  test('a held-out-size partition is feasible on fresh seeds with a different prompt bank', () => {
    const bank = { ...PUBLIC_BANK, prep: PUBLIC_BANK.prep.map(p => `Before I see them: ${p}`) };
    const spec = { heldout: { prep: 45, who: 45, changed: 45, unanswerable: 12, privacy_pairs: 12, rooms: true } };
    for (const s of ['feasibility-1', 'feasibility-2']) {
      const c = generateCorpus(s);
      const tasks = generateTasks(c, bank, spec);
      expect(tasks.filter(t => ['prep', 'who', 'changed'].includes(t.family)).length).toBe(135);
      for (const t of tasks.filter(x => x.family === 'changed')) {
        expect(t.key.length >= 3 && t.key.length <= 5).toBe(true);
        const since = t.prompt.match(/\d{4}-\d{2}-\d{2}/)![0];
        const tl = c.pages.find(p => p.slug === `companies/${t.target}`)!.timeline;
        expect(t.key.map(k => k.id).sort()).toEqual(tl.filter(e => e.date >= since).map(e => e.id).sort());
        expect(tl.some(e => e.date < since)).toBe(true);
      }
      expect(tasks.filter(t => t.family === 'prep' && t.key.some(k => k.id === 'own-note')).length).toBe(6);
      for (const t of tasks.filter(x => x.family === 'prep')) expect(t.prompt).toContain(c.companies.find(x => x.slug === c.contacts.find(p => p.id === t.target)!.company)!.name);
      expect(tasksSha256(tasks)).toBe(tasksSha256(generateTasks(generateCorpus(s), bank, spec)));
    }
  });

  test('check.ts --out refuses a non-empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-out-'));
    writeFileSync(join(dir, 'stale.md'), 'old export');
    const run = spawnSync('bun', ['world/brain/check.ts', '--out', dir], { env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }, encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('HE-BRAIN-008');
  });

  test('check.ts --out writes nothing when a check fails, and refuses a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-fail-'));
    const code = join(dir, 'world', 'brain');
    mkdirSync(code, { recursive: true });
    for (const f of readdirSync('world/brain').filter(f => f.endsWith('.ts'))) copyFileSync(join('world/brain', f), join(code, f));
    writeFileSync(join(code, 'seeds.json'), JSON.stringify({ ...seeds, A: { ...A, corpus_sha256: '0'.repeat(64) } }));
    const out = join(dir, 'out');
    const run = spawnSync('bun', [join(code, 'check.ts'), '--out', out], { env: scrubbed, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('HE-BRAIN-002');
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(['world']);
    const file = join(dir, 'a-file');
    writeFileSync(file, '');
    const refused = spawnSync('bun', ['world/brain/check.ts', '--out', file], { env: scrubbed, encoding: 'utf8' });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('HE-BRAIN-008');
  });

  test('check.ts --out fills an existing empty directory, and a failed write leaves it empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-empty-'));
    const ok = join(dir, 'ok');
    mkdirSync(ok);
    const run = spawnSync('bun', ['world/brain/check.ts', '--out', ok], { env: scrubbed, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(readdirSync(ok).sort()).toEqual(['corpus.json', 'exports', 'import', 'links.tsv', 'tasks.json']);
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    const failed = spawnSync('bun', ['world/brain/check.ts', '--out', locked], { env: scrubbed, encoding: 'utf8' });
    chmodSync(locked, 0o755);
    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('nothing was written');
    expect(readdirSync(locked)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['locked', 'ok']);
  });

  test('two concurrent --out runs to one new path leave one complete export', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'brain-race-')), 'out');
    const runs = [0, 1].map(() => Bun.spawn(['bun', 'world/brain/check.ts', '--out', out], { env: scrubbed, stdout: 'pipe', stderr: 'pipe' }));
    const codes = await Promise.all(runs.map(r => r.exited));
    expect(codes.filter(c => c === 0).length).toBeGreaterThanOrEqual(1);
    for (const c of codes) expect([0, 2]).toContain(c);
    expect(readdirSync(out).sort()).toEqual(['corpus.json', 'exports', 'import', 'links.tsv', 'tasks.json']);
  });

  test('an impossible size fails with a code, not a short partition', () => {
    let err: unknown;
    try { generateTasks(generateCorpus(A.seed), PUBLIC_BANK, { big: { prep: 1000, who: 1, changed: 1, unanswerable: 1, privacy_pairs: 1, rooms: false } }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CorpusError);
    expect(PARAMS.members).toBe(20);
  });
});

describe('qm-brain-native leak scanner', () => {
  const c = report.corpus;
  const probe = report.tasks.find(t => t.family === 'privacy')!;
  const allowed = [...manifestFor(c, probe.audience)];
  const denied = c.canaries.filter(x => !allowed.includes(x.page));

  test('catches every denied codename however it is dressed, and passes allowed ones', () => {
    const variants = (s: string) => [s, s.toUpperCase(), `**${s}**`, s.split('').join('\u200b'), `(${s}).`, `Project${s}`, `${s}2026`, s.split('').join(' '), s.split('').join('.')];
    const locs = denied.flatMap((x, i) => variants(x.codename).map((v, j) => ({ where: 'model_request' as const, id: `d${i}-${j}`, text: `notes: ${v}`, allowed })));
    expect(scan({ canaries: c.canaries, locations: locs }).hits.length).toBe(locs.length);
    const ok = c.canaries.filter(x => allowed.includes(x.page)).map((x, i) => ({ where: 'reply' as const, id: `a${i}`, text: x.codename, allowed }));
    expect(scan({ canaries: c.canaries, locations: ok }).hits).toEqual([]);
  });

  test('flags a span from another brain in an outgoing gbrain request, but not one the member wrote or the target brain holds', () => {
    const other = 'The second brain says the Brookfen renewal slips to March because of the audit.';
    expect(scan({ canaries: [], locations: [], outbound: [{ id: 'o1', text: `search: ${other.slice(4, 4 + SPAN + 6)}`, forbidden_texts: [other], allowed_texts: [] }] }).hits.length).toBe(1);
    expect(scan({ canaries: [], locations: [], outbound: [{ id: 'o2', text: `search: ${other.slice(4, 4 + SPAN + 6)}`, forbidden_texts: [other], allowed_texts: [other] }] }).hits).toEqual([]);
    expect(scan({ canaries: [], locations: [], outbound: [{ id: 'o3', text: 'who knows thermal imaging', forbidden_texts: [other], allowed_texts: [] }] }).hits).toEqual([]);
  });

  test('sealed mode prints a code and counts only, and keeps the detail in a private log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-scan-'));
    const input = join(dir, 'scan.json');
    writeFileSync(input, JSON.stringify({ canaries: c.canaries, locations: [{ where: 'reply', id: 'r1', text: denied[0]!.codename, allowed }] }));
    const log = join(dir, 'scan.log');
    writeFileSync(log, 'stale log from an earlier run', { mode: 0o644 });
    const run = spawnSync('bun', ['world/brain/scan.ts', '--input', input, '--sealed', '--log', log], { env: scrubbed, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe(`HE-BRAIN-007 scanned=1 hits=1 log=${log}`);
    expect(run.stdout + run.stderr).not.toContain(denied[0]!.codename);
    expect(readFileSync(log, 'utf8')).toContain(denied[0]!.codename);
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  test('scan input of the wrong shape is bad input (exit 2), not a clean or leak verdict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-shape-'));
    const input = join(dir, 'scan.json');
    for (const bad of [{ canaries: [], locations: [{ where: 'reply', id: 'r1', text: 'x', allowed }] }, { canaries: c.canaries, locations: [{ where: 'reply', id: 'r1', text: denied[0]!.codename }] }, {}]) {
      writeFileSync(input, JSON.stringify(bad));
      const run = spawnSync('bun', ['world/brain/scan.ts', '--input', input, '--sealed', '--log', join(dir, 'scan.log')], { env: scrubbed, encoding: 'utf8' });
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('HE-BRAIN-008');
      expect(existsSync(join(dir, 'scan.log'))).toBe(false);
    }
  });

  test('a scanner crash exits 3 with its own code, never the leak code, and leaves an earlier log in place', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-crash-'));
    const input = join(dir, 'scan.json');
    writeFileSync(input, JSON.stringify({ canaries: c.canaries, locations: [{ where: 'reply', id: 'r1', text: denied[0]!.codename, allowed }] }));
    const logs = join(dir, 'logs');
    mkdirSync(logs);
    const log = join(logs, 'scan.log');
    writeFileSync(log, 'scored log from an earlier run');
    chmodSync(logs, 0o555);
    const run = spawnSync('bun', ['world/brain/scan.ts', '--input', input, '--sealed', '--log', log], { env: scrubbed, encoding: 'utf8' });
    chmodSync(logs, 0o755);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('HE-BRAIN-009');
    expect(run.stdout + run.stderr).not.toContain('HE-BRAIN-007');
    expect(run.stdout + run.stderr).not.toContain(denied[0]!.codename);
    expect(readFileSync(log, 'utf8')).toBe('scored log from an earlier run');
  });
});
