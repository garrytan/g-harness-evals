// gbrain time-to-first-wow eval: the coding check tasks (scripts/gbrain-first-wow/coding.ts). Grades each task's buggy project and a
// reference fix with the real grader; the reference fixes live only here, never in the files a session sees. No model, no key.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyCodingTask, codingTaskForSeed, gradeCodingTask, CODING_TASKS, COUNTED_CODING_SEEDS, type CodingTask } from '../scripts/gbrain-first-wow/coding.ts';
import { buildFixture, personaFor, type Home } from '../scripts/gbrain-first-wow/fixtures.ts';

const routesFix = (importLine: string, routeLine: string) => importLine + '\n\nexport function routes(req: Request): Response {\n  const url = new URL(req.url);\n  if (url.pathname === "/health") return new Response("ok");\n  ' + routeLine + '\n  return new Response("not found", { status: 404 });\n}\n';

const REFERENCE_FIXES: Record<string, Record<string, string>> = {
  'coding-01': {
    'src/items.ts': String.raw`export interface Item { id: number; name: string }

export const ITEMS: Item[] = Array.from({ length: 53 }, (_, i) => ({ id: i + 1, name: "item " + (i + 1) }));

export const PAGE_SIZE = 20;

export function listItems(page: string | null, items: Item[] = ITEMS): Item[] {
  const n = Number(page);
  const p = Number.isInteger(n) && n >= 1 ? n : 1;
  return items.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
}
`,
  },
  'coding-02': {
    'src/util/chunk.ts': String.raw`export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
`,
  },
  'coding-03': {
    'src/util/time.ts': String.raw`export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("invalid date: " + iso);
  return d.toISOString().slice(0, 10);
}
`,
  },
  'coding-04': {
    'src/validate.ts': String.raw`export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
`,
  },
  'coding-05': {
    'src/users.ts': String.raw`export interface User { id: number; name: string }

const USERS = new Map<number, User>([
  [1, { id: 1, name: "Ada" }],
  [2, { id: 2, name: "Grace" }],
  [3, { id: 3, name: "Linus" }],
]);

export function getUser(idText: string): Response {
  if (!/^[1-9]\d*$/.test(idText)) return Response.json({ error: "invalid user id" }, { status: 400 });
  const user = USERS.get(Number(idText));
  if (!user) return Response.json({ error: "user not found" }, { status: 404 });
  return Response.json(user);
}
`,
  },
  'coding-06': {
    'src/util/duration.ts': String.raw`export function parseDuration(text: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!text || !match) throw new Error("invalid duration: " + text);
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}
`,
  },
  'coding-07': {
    'src/config.ts': String.raw`export interface Config { logLevel: string; pageSize: number; retries: number }

const numberOr = (value: string | undefined, fallback: number) => (value === undefined || value === "" ? fallback : Number(value));

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    logLevel: env.LOG_LEVEL || "info",
    pageSize: numberOr(env.PAGE_SIZE, 20),
    retries: numberOr(env.RETRIES, 3),
  };
}
`,
  },
  'coding-08': {
    'src/members.ts': String.raw`export interface Member { name: string; joined: string }

export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => {
    const x = a.name.toLowerCase(), y = b.name.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.joined < b.joined ? -1 : a.joined > b.joined ? 1 : 0;
  });
}
`,
  },
  'coding-09': {
    'src/util/months.ts': String.raw`export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
`,
  },
  'coding-10': {
    'src/money.ts': String.raw`export function formatPrice(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (cents < 0 ? "-" : "") + "$" + dollars + "." + String(abs % 100).padStart(2, "0");
}
`,
  },
  'coding-11': {
    'src/csv.ts': String.raw`export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted && c === '"' && line[i + 1] === '"') { field += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { fields.push(field); field = ""; }
    else field += c;
  }
  fields.push(field);
  return fields;
}
`,
  },
  'coding-12': {
    'src/util/slug.ts': String.raw`export function slugify(title: string): string {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
`,
  },
  'coding-13': {
    'src/retry.ts': String.raw`export const BASE_DELAY_MS = 100;
export const MAX_DELAY_MS = 5000;

export function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
}
`,
  },
  'coding-14': {
    'src/tags.ts': String.raw`export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
`,
  },
  'coding-15': {
    'src/routes.ts': String.raw`export function routes(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    return new Response("ok");
  }
  return new Response("not found", { status: 404 });
}
`,
  },
};

const PLANTED_SEEDS = [100, 101, 102, 103, 104, 9100, 9101];
const HOMES: Home[] = ['claude-code', 'codex'];
const tmpRoots: string[] = [];

/** The target project as the fixture writes it, with the task applied and then any overrides (an edit the session made). */
function project(seed: number, task: CodingTask, overrides: Record<string, string> = {}): string {
  const fixture = buildFixture(seed, personaFor(seed), 'claude-code');
  const applied = applyCodingTask(fixture, task);
  const root = mkdtempSync(join(tmpdir(), 'first-wow-coding-test-'));
  tmpRoots.push(root);
  const files = new Map([...fixture.files].filter(([p]) => p.startsWith(applied.project + '/')));
  for (const [p, body] of applied.files) files.set(p, body);
  for (const [p, body] of Object.entries(overrides)) files.set(applied.project + '/' + p, body);
  for (const [p, body] of files) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return join(root, applied.project);
}

const textOf = (t: CodingTask) => [t.prompt, t.hidden, ...Object.keys(t.files), ...Object.values(t.files)].join('\n');

describe('coding tasks', () => {
  test('15 tasks with unique ids coding-01 to coding-15', () => {
    expect(CODING_TASKS.map(t => t.id)).toEqual(Array.from({ length: 15 }, (_, i) => 'coding-' + String(i + 1).padStart(2, '0')));
  });

  test('each hidden test file holds the visible cases and at least two more', () => {
    for (const t of CODING_TASKS) {
      const visible = t.files[t.testFile]!;
      const visibleCases = visible.match(/^test\(/gm)!.length;
      expect(t.hidden.startsWith(visible.trimEnd())).toBe(true);
      expect(t.hidden.match(/^test\(/gm)!.length).toBe(t.hiddenCases);
      expect(t.hiddenCases).toBeGreaterThanOrEqual(visibleCases + 2);
    }
  });

  test('each task writes its visible test, never the base test file, and only project-relative paths', () => {
    for (const t of CODING_TASKS) {
      expect(Object.keys(t.files)).toContain(t.testFile);
      expect(t.testFile).not.toBe('test/app.test.ts');
      for (const p of Object.keys(t.files)) expect(p).toMatch(/^(src|test)\/[a-z/.-]+\.ts$/);
    }
  });

  test('tasks name no planted fact for seeds 100 to 104 and 9100 to 9101, in either home', () => {
    const planted = new Set<string>();
    const topics = new Set<string>();
    for (const seed of PLANTED_SEEDS) {
      for (const home of HOMES) {
        for (const q of buildFixture(seed, personaFor(seed), home).manifest.questions) {
          for (const v of [q.answer, q.superseded, ...q.decoys]) if (v) planted.add(v.toLowerCase());
          topics.add(q.topic);
        }
      }
    }
    expect(planted.size).toBeGreaterThan(10);
    for (const t of CODING_TASKS) {
      const text = textOf(t).toLowerCase();
      for (const v of planted) expect(text.includes(v)).toBe(false);
      for (const topic of topics) expect(t.prompt.includes(topic)).toBe(false);
    }
  });

  test('tasks carry nothing shaped like a planted fact, for any seed', () => {
    for (const t of CODING_TASKS) {
      const text = textOf(t);
      expect(text).not.toContain('ff_');
      expect(text.match(/\d+/g)?.filter(n => n.length === 5 && Number(n) >= 40000 && Number(n) < 60000) ?? []).toEqual([]);
      expect(t.prompt).not.toMatch(/\b(flag|staging|port|provider|vendor|gbrain|memory|history)\b/i);
    }
  });
});

describe('seed mapping', () => {
  test('the counted seeds map one to one onto the 15 tasks', () => {
    expect(COUNTED_CODING_SEEDS.length).toBe(15);
    expect(new Set(COUNTED_CODING_SEEDS).size).toBe(15);
    expect(new Set(COUNTED_CODING_SEEDS.map(s => codingTaskForSeed(s).id)).size).toBe(15);
  });

  test('pilot 2 seeds 100, 102 and 104 get three different tasks', () => {
    expect([100, 102, 104].map(s => codingTaskForSeed(s).id)).toEqual(['coding-11', 'coding-13', 'coding-15']);
  });

  test('the mapping is a pure function of the seed', () => {
    for (const s of [0, 7, 100, 214, 9100]) expect(codingTaskForSeed(s)).toBe(codingTaskForSeed(s));
    expect(codingTaskForSeed(215).id).toBe(codingTaskForSeed(200).id);
  });
});

describe('applyCodingTask', () => {
  test('is byte-identical for the same input and leaves the fixture alone', () => {
    for (const seed of [100, 101, 9100]) {
      const fixture = buildFixture(seed, personaFor(seed), 'codex');
      const before = JSON.stringify([...fixture.files]);
      for (const t of CODING_TASKS) {
        const a = applyCodingTask(fixture, t), b = applyCodingTask(buildFixture(seed, personaFor(seed), 'codex'), t);
        expect(JSON.stringify([...a.files])).toBe(JSON.stringify([...b.files]));
        expect(a.prompt).toBe(t.prompt);
        expect(a.project).toBe(fixture.manifest.projects[0]!.dir);
        for (const p of a.files.keys()) {
          expect(p.startsWith(a.project + '/')).toBe(true);
          expect(fixture.manifest.sessions.some(s => s.path === p)).toBe(false);
        }
      }
      expect(JSON.stringify([...fixture.files])).toBe(before);
    }
  });

  test('ships no reference fix into the session', () => {
    for (const t of CODING_TASKS) {
      const fix = REFERENCE_FIXES[t.id]!;
      for (const [p, body] of Object.entries(fix)) expect(t.files[p]).not.toBe(body);
    }
  });
});

describe('gradeCodingTask', () => {
  for (const t of CODING_TASKS) {
    test(t.id + ': the buggy project fails and the reference fix passes', async () => {
      const buggy = await gradeCodingTask(project(100, t), t);
      expect(buggy.passed).toBe(false);
      expect(buggy.fail).toBeGreaterThan(0);
      const fixed = await gradeCodingTask(project(101, t, REFERENCE_FIXES[t.id]), t);
      expect(fixed.output).toContain(fixed.pass + ' pass');
      expect(fixed).toMatchObject({ passed: true, pass: t.hiddenCases, fail: 0 });
    }, 60_000);
  }

  test('a test folder or test file linked outside the project fails the task and writes nothing outside it', async () => {
    const t = CODING_TASKS.find(x => x.id === 'coding-02')!;
    const outside = mkdtempSync(join(tmpdir(), 'first-wow-outside-'));
    tmpRoots.push(outside);
    const dir = project(100, t);
    rmSync(join(dir, dirname(t.testFile)), { recursive: true, force: true });
    symlinkSync(outside, join(dir, dirname(t.testFile)));
    const g = await gradeCodingTask(dir, t);
    expect(g).toMatchObject({ passed: false, pass: 0, fail: 0 });
    expect(g.output).toContain('hidden test not installed');
    expect(readdirSync(outside)).toEqual([]);
    const target = join(outside, 'kept.ts');
    writeFileSync(target, 'kept');
    const dir2 = project(100, t);
    rmSync(join(dir2, t.testFile), { force: true });
    symlinkSync(target, join(dir2, t.testFile));
    expect((await gradeCodingTask(dir2, t)).passed).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('kept');
  }, 60_000);

  test('an edited visible test does not help: the hidden file overwrites it', async () => {
    const t = CODING_TASKS.find(x => x.id === 'coding-02')!;
    const dir = project(100, t, { [t.testFile]: 'import { test } from "bun:test";\n\ntest("fine", () => {});\n' });
    expect(readFileSync(join(dir, t.testFile), 'utf8')).toContain('"fine"');
    expect((await gradeCodingTask(dir, t)).passed).toBe(false);
  }, 60_000);

  test('a fix that special-cases the visible test fails', async () => {
    const t = CODING_TASKS.find(x => x.id === 'coding-01')!;
    const hack = REFERENCE_FIXES['coding-01']!['src/items.ts']!.replace(/  const n = [\s\S]*\n}\n$/, '  return page === "2" ? items.slice(20, 40) : items;\n}\n');
    expect(hack).toContain('page === "2"');
    const grade = await gradeCodingTask(project(100, t, { 'src/items.ts': hack }), t);
    expect(grade.passed).toBe(false);
    expect(grade.pass).toBe(1);
  }, 60_000);

  test('runs with only PATH and HOME in the environment, HOME in a temp dir', async () => {
    const probe: CodingTask = {
      id: 'probe', bug: '', prompt: '', files: {}, testFile: 'test/env.test.ts', hiddenCases: 1,
      hidden: 'import { expect, test } from "bun:test";\n\ntest("env", () => {\n  expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();\n  expect(process.env.OPENAI_API_KEY).toBeUndefined();\n  expect(process.env.HOME).not.toBe("' + process.env.HOME + '");\n  expect(process.env.PATH).toBeTruthy();\n});\n',
    };
    const grade = await gradeCodingTask(project(100, CODING_TASKS[0]!), probe);
    expect(grade).toMatchObject({ passed: true, pass: 1, fail: 0 });
  }, 60_000);

  test('a hung test run is killed at the timeout and fails', async () => {
    const hang: CodingTask = {
      id: 'hang', bug: '', prompt: '', files: {}, testFile: 'test/hang.test.ts', hiddenCases: 1,
      hidden: 'import { test } from "bun:test";\n\ntest("hang", async () => { await new Promise((r) => setTimeout(r, 60_000)); }, 120_000);\n',
    };
    const grade = await gradeCodingTask(project(100, CODING_TASKS[0]!), hang, 2000);
    expect(grade.passed).toBe(false);
    expect(grade.output).toContain('timeout 2000 ms');
  }, 60_000);
});

process.on('exit', () => { for (const r of tmpRoots) rmSync(r, { recursive: true, force: true }); });
