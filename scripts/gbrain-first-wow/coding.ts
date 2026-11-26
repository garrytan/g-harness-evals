// Coding check tasks for the gbrain time-to-first-wow eval (docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md, "The
// coding check"). Each task is a small bug or missing behaviour in the fixture's target project (manifest.projects[0], the TypeScript
// service fixtures.ts writes). The task adds its buggy source and a visible test to that project, and the person asks for the fix in
// a fresh session, the first one after setup. No task touches the planted facts or the person's history, and none needs anything
// beyond the project's own files and bun:test.
//
// Grading runs on the project as the session left it: the project is copied to a temp dir, the task's hidden test file is written over
// its visible test file (the visible cases plus at least two more, so a fix that special-cases the visible test fails), and bun test
// runs that one file with only PATH and HOME in its environment, under a timeout. A task passes when the run exits 0 and every hidden
// case passes.
//
// Seeds map to tasks by seed mod 15, so any 15 consecutive seeds cover the 15 tasks once each. Pilot 2 uses seeds 100, 102 and 104
// (coding-11, coding-13 and coding-15); the counted run uses COUNTED_CODING_SEEDS, seeds 200 to 214, one per task.
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import type { Fixture } from './fixtures.ts';

export interface CodingTask {
  id: string;
  /** What is wrong, in one line. */
  bug: string;
  /** The person's request, as they type it. */
  prompt: string;
  /** Project-relative files the task writes before the session: the buggy source and the visible test. */
  files: Record<string, string>;
  /** Project-relative path of the visible test; the grader overwrites it with the hidden version. */
  testFile: string;
  /** The hidden test file: the visible cases first, then the extra ones. */
  hidden: string;
  hiddenCases: number;
}

export interface CodingGrade { passed: boolean; pass: number; fail: number; output: string }

export const GRADE_TIMEOUT_MS = 120_000;
const OUTPUT_MAX = 8000;

interface TaskSpec {
  id: string;
  bug: string;
  prompt: string;
  source: Record<string, string>;
  test: { path: string; header: string; visible: string[]; hidden: string[] };
}

function task(s: TaskSpec): CodingTask {
  const file = (cases: string[]) => s.test.header + '\n' + cases.join('\n\n') + '\n';
  return {
    id: s.id, bug: s.bug, prompt: s.prompt,
    files: { ...s.source, [s.test.path]: file(s.test.visible) },
    testFile: s.test.path,
    hidden: file([...s.test.visible, ...s.test.hidden]),
    hiddenCases: s.test.visible.length + s.test.hidden.length,
  };
}

const routesWith = (importLine: string, routeLine: string) => importLine + '\n\nexport function routes(req: Request): Response {\n  const url = new URL(req.url);\n  if (url.pathname === "/health") return new Response("ok");\n  ' + routeLine + '\n  return new Response("not found", { status: 404 });\n}\n';

export const CODING_TASKS: readonly CodingTask[] = [
  task({
    id: 'coding-01',
    bug: '/items ignores ?page and returns every row',
    prompt: 'The /items endpoint returns every row. It should return 20 per page with ?page=N, where page 1 is the first page. A missing or invalid page (not a whole number, or below 1) should give page 1, and a page past the end should give an empty list. Can you fix it?',
    source: {
      'src/routes.ts': routesWith('import { listItems } from "./items.ts";', 'if (url.pathname === "/items") return Response.json(listItems(url.searchParams.get("page")));'),
      'src/items.ts': String.raw`export interface Item { id: number; name: string }

export const ITEMS: Item[] = Array.from({ length: 53 }, (_, i) => ({ id: i + 1, name: "item " + (i + 1) }));

export const PAGE_SIZE = 20;

export function listItems(page: string | null, items: Item[] = ITEMS): Item[] {
  return items;
}
`,
    },
    test: {
      path: 'test/items.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { routes } from "../src/routes.ts";

const ids = async (query: string) => ((await routes(new Request("http://x/items" + query)).json()) as Array<{ id: number }>).map((i) => i.id);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
`,
      visible: [
        String.raw`test("page 2 gives items 21 to 40", async () => {
  expect(await ids("?page=2")).toEqual(range(21, 40));
});`,
      ],
      hidden: [
        String.raw`test("page 1 gives items 1 to 20", async () => {
  expect(await ids("?page=1")).toEqual(range(1, 20));
});`,
        String.raw`test("no page gives page 1", async () => {
  expect(await ids("")).toEqual(range(1, 20));
});`,
        String.raw`test("the last page holds the remainder", async () => {
  expect(await ids("?page=3")).toEqual(range(41, 53));
});`,
        String.raw`test("a page past the end is empty", async () => {
  expect(await ids("?page=4")).toEqual([]);
});`,
        String.raw`test("invalid pages give page 1", async () => {
  for (const q of ["?page=abc", "?page=0", "?page=-2", "?page=1.5"]) expect(await ids(q)).toEqual(range(1, 20));
});`,
      ],
    },
  }),
  task({
    id: 'coding-02',
    bug: 'chunk() drops the last partial chunk (loop bound off by one chunk)',
    prompt: 'chunk() in src/util/chunk.ts loses the leftovers: chunk([1, 2, 3, 4, 5], 2) gives [[1, 2], [3, 4]] and the 5 disappears. The remainder should come back as a last, shorter chunk. Can you fix it?',
    source: {
      'src/util/chunk.ts': String.raw`export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i + size <= items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
`,
    },
    test: {
      path: 'test/chunk.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { chunk } from "../src/util/chunk.ts";
`,
      visible: [
        String.raw`test("keeps the remainder", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});`,
      ],
      hidden: [
        String.raw`test("remainder of one with size 3", () => {
  expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
});`,
        String.raw`test("even split", () => {
  expect(chunk(["a", "b", "c", "d"], 2)).toEqual([["a", "b"], ["c", "d"]]);
});`,
        String.raw`test("fewer items than the size", () => {
  expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
});`,
        String.raw`test("empty list", () => {
  expect(chunk([], 3)).toEqual([]);
});`,
      ],
    },
  }),
  task({
    id: 'coding-03',
    bug: 'dayKey() slices the date text and ignores the UTC offset',
    prompt: "dayKey() in src/util/time.ts is meant to give the UTC calendar day (YYYY-MM-DD) of a timestamp, but it ignores the offset: dayKey('2026-03-01T23:30:00-05:00') gives '2026-03-01' when the UTC day is '2026-03-02'. Can you fix it? It should throw on a string that isn't a valid date.",
    source: {
      'src/util/time.ts': String.raw`export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}
`,
    },
    test: {
      path: 'test/time.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { dayKey } from "../src/util/time.ts";
`,
      visible: [
        String.raw`test("a negative offset that crosses midnight", () => {
  expect(dayKey("2026-03-01T23:30:00-05:00")).toBe("2026-03-02");
});`,
      ],
      hidden: [
        String.raw`test("a positive offset that goes back a day", () => {
  expect(dayKey("2026-03-02T06:00:00+09:00")).toBe("2026-03-01");
});`,
        String.raw`test("crossing a year end", () => {
  expect(dayKey("2026-12-31T22:00:00-03:00")).toBe("2027-01-01");
});`,
        String.raw`test("UTC and offsets that stay on the day", () => {
  expect(dayKey("2026-07-04T12:00:00Z")).toBe("2026-07-04");
  expect(dayKey("2026-07-04T08:00:00+02:00")).toBe("2026-07-04");
});`,
        String.raw`test("invalid input throws", () => {
  expect(() => dayKey("not a date")).toThrow();
});`,
      ],
    },
  }),
  task({
    id: 'coding-04',
    bug: 'isValidEmail() only checks for an @',
    prompt: "isValidEmail() in src/validate.ts lets junk through, like 'bob@', '@example.com' and 'bo b@example.com'. A valid address has exactly one @, no spaces, something before the @, and a domain after it with a dot that has text on both sides (so 'bob@example' and 'bob@example.' fail). Can you tighten it?",
    source: {
      'src/validate.ts': String.raw`export function isValidEmail(email: string): boolean {
  return email.includes("@");
}
`,
    },
    test: {
      path: 'test/validate.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { isValidEmail } from "../src/validate.ts";
`,
      visible: [
        String.raw`test("accepts a normal address and rejects a bare local part", () => {
  expect(isValidEmail("ana@example.com")).toBe(true);
  expect(isValidEmail("bob@")).toBe(false);
});`,
      ],
      hidden: [
        String.raw`test("accepts dots, plus tags and subdomains", () => {
  expect(isValidEmail("first.last+tag@mail.example.co.uk")).toBe(true);
});`,
        String.raw`test("rejects a missing local part or spaces", () => {
  for (const e of ["@example.com", "bo b@example.com", " ana@example.com", "ana@exa mple.com"]) expect(isValidEmail(e)).toBe(false);
});`,
        String.raw`test("rejects a domain without a proper dot", () => {
  for (const e of ["bob@example", "bob@example.", "bob@.com"]) expect(isValidEmail(e)).toBe(false);
});`,
        String.raw`test("rejects more than one @", () => {
  for (const e of ["a@@example.com", "a@b@example.com"]) expect(isValidEmail(e)).toBe(false);
});`,
      ],
    },
  }),
  task({
    id: 'coding-05',
    bug: 'GET /users/<id> answers 200 null for unknown users and accepts bad ids',
    prompt: 'GET /users/<id> answers 200 with a null body when the user does not exist, and /users/abc does the same. An unknown user should get 404, and an id that is not a positive whole number (like abc, 0, 1.5 or 12x) should get 400, each with a JSON body like { "error": "..." }. Real users should still come back as they do now. Can you fix it?',
    source: {
      'src/routes.ts': routesWith('import { getUser } from "./users.ts";', 'if (url.pathname.startsWith("/users/")) return getUser(url.pathname.slice("/users/".length));'),
      'src/users.ts': String.raw`export interface User { id: number; name: string }

const USERS = new Map<number, User>([
  [1, { id: 1, name: "Ada" }],
  [2, { id: 2, name: "Grace" }],
  [3, { id: 3, name: "Linus" }],
]);

export function getUser(idText: string): Response {
  const id = parseInt(idText);
  return Response.json(USERS.get(id) ?? null);
}
`,
    },
    test: {
      path: 'test/users.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { routes } from "../src/routes.ts";

const get = (path: string) => routes(new Request("http://x" + path));
`,
      visible: [
        String.raw`test("an unknown user is 404", () => {
  expect(get("/users/999").status).toBe(404);
});`,
      ],
      hidden: [
        String.raw`test("a known user comes back", async () => {
  const res = get("/users/2");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 2, name: "Grace" });
});`,
        String.raw`test("the 404 body names an error", async () => {
  const body = (await get("/users/999").json()) as { error?: unknown };
  expect(typeof body.error).toBe("string");
});`,
        String.raw`test("ids that are not positive whole numbers are 400", async () => {
  for (const id of ["abc", "12x", "1.5", "0", "-1"]) {
    const res = get("/users/" + id);
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as { error?: unknown }).error).toBe("string");
  }
});`,
      ],
    },
  }),
  task({
    id: 'coding-06',
    bug: 'parseDuration() reads only the first unit and accepts trailing text',
    prompt: "parseDuration() in src/util/duration.ts should turn strings like '90s', '5m', '1h30m' or '2h5m10s' into seconds, but anything with more than one unit comes out wrong ('1h30m' gives 3600). It should also throw on anything else: an empty string, an unknown unit like '5x', or extra text like '10m please'. Units always come in h, m, s order, each at most once. Can you fix it?",
    source: {
      'src/util/duration.ts': String.raw`const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  const match = /(\d+)([hms])/.exec(text);
  if (!match) throw new Error("invalid duration: " + text);
  return Number(match[1]) * UNIT_SECONDS[match[2]!]!;
}
`,
    },
    test: {
      path: 'test/duration.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { parseDuration } from "../src/util/duration.ts";
`,
      visible: [
        String.raw`test("hours and minutes", () => {
  expect(parseDuration("1h30m")).toBe(5400);
});`,
      ],
      hidden: [
        String.raw`test("single units", () => {
  expect(parseDuration("90s")).toBe(90);
  expect(parseDuration("5m")).toBe(300);
});`,
        String.raw`test("all three units", () => {
  expect(parseDuration("2h5m10s")).toBe(7510);
});`,
        String.raw`test("a skipped unit", () => {
  expect(parseDuration("1h1s")).toBe(3601);
});`,
        String.raw`test("invalid input throws", () => {
  for (const s of ["", "5x", "10m please", "h"]) expect(() => parseDuration(s)).toThrow();
});`,
      ],
    },
  }),
  task({
    id: 'coding-07',
    bug: 'loadConfig() has no defaults for PAGE_SIZE and RETRIES',
    prompt: "loadConfig() in src/config.ts gives NaN for pageSize when PAGE_SIZE isn't set, and the same for retries without RETRIES. When a variable is unset or empty, pageSize should default to 20 and retries to 3. Values that are set still win, and RETRIES=0 is valid (it means no retries). Can you fix it?",
    source: {
      'src/config.ts': String.raw`export interface Config { logLevel: string; pageSize: number; retries: number }

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    logLevel: env.LOG_LEVEL || "info",
    pageSize: Number(env.PAGE_SIZE),
    retries: Number(env.RETRIES),
  };
}
`,
    },
    test: {
      path: 'test/config.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
`,
      visible: [
        String.raw`test("defaults when nothing is set", () => {
  expect(loadConfig({})).toEqual({ logLevel: "info", pageSize: 20, retries: 3 });
});`,
      ],
      hidden: [
        String.raw`test("set values win", () => {
  expect(loadConfig({ LOG_LEVEL: "debug", PAGE_SIZE: "50", RETRIES: "5" })).toEqual({ logLevel: "debug", pageSize: 50, retries: 5 });
});`,
        String.raw`test("empty values fall back to the defaults", () => {
  expect(loadConfig({ PAGE_SIZE: "", RETRIES: "" })).toEqual({ logLevel: "info", pageSize: 20, retries: 3 });
});`,
        String.raw`test("zero retries is kept", () => {
  expect(loadConfig({ RETRIES: "0" }).retries).toBe(0);
});`,
        String.raw`test("one variable set, the other defaulted", () => {
  expect(loadConfig({ PAGE_SIZE: "10" })).toEqual({ logLevel: "info", pageSize: 10, retries: 3 });
});`,
      ],
    },
  }),
  task({
    id: 'coding-08',
    bug: 'sortMembers() compares names case-sensitively and has no tie-break',
    prompt: "sortMembers() in src/members.ts puts every lowercase name after the capitalized ones, so 'alice' lands after 'Zoe'. It should sort by name ignoring case, and members whose names match (ignoring case) by joined date, oldest first. joined is a YYYY-MM-DD string. Can you fix it?",
    source: {
      'src/members.ts': String.raw`export interface Member { name: string; joined: string }

export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((a, b) => (a.name > b.name ? 1 : -1));
}
`,
    },
    test: {
      path: 'test/members.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { sortMembers, type Member } from "../src/members.ts";

const m = (name: string, joined = "2026-01-01"): Member => ({ name, joined });
`,
      visible: [
        String.raw`test("ignores case", () => {
  expect(sortMembers([m("Zoe"), m("alice"), m("Bob")]).map((x) => x.name)).toEqual(["alice", "Bob", "Zoe"]);
});`,
      ],
      hidden: [
        String.raw`test("same name in different case sorts by joined date", () => {
  const out = sortMembers([m("Sam", "2026-03-01"), m("Ann", "2026-05-01"), m("sam", "2025-12-01")]);
  expect(out).toEqual([m("Ann", "2026-05-01"), m("sam", "2025-12-01"), m("Sam", "2026-03-01")]);
});`,
        String.raw`test("same name sorts by joined date, oldest first", () => {
  const out = sortMembers([m("Lee", "2026-02-10"), m("Lee", "2024-07-30"), m("Lee", "2025-01-15")]);
  expect(out.map((x) => x.joined)).toEqual(["2024-07-30", "2025-01-15", "2026-02-10"]);
});`,
        String.raw`test("a mixed list", () => {
  const names = sortMembers([m("mia"), m("Max"), m("ben"), m("Carl"), m("abe")]).map((x) => x.name);
  expect(names).toEqual(["abe", "ben", "Carl", "Max", "mia"]);
});`,
      ],
    },
  }),
  task({
    id: 'coding-09',
    bug: 'addMonths() overflows into the next month at month end',
    prompt: "addMonths() in src/util/months.ts runs past short months: addMonths('2026-01-31', 1) gives '2026-03-03'. It should land on the last day of the target month instead ('2026-02-28'), handle leap years, work across year ends, and take negative month counts too. Can you fix it?",
    source: {
      'src/util/months.ts': String.raw`export function addMonths(day: string, months: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
`,
    },
    test: {
      path: 'test/months.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { addMonths } from "../src/util/months.ts";
`,
      visible: [
        String.raw`test("clamps to the end of February", () => {
  expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
});`,
      ],
      hidden: [
        String.raw`test("leap year February", () => {
  expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
});`,
        String.raw`test("mid-month days are unchanged", () => {
  expect(addMonths("2026-03-15", 1)).toBe("2026-04-15");
  expect(addMonths("2026-08-31", 12)).toBe("2027-08-31");
});`,
        String.raw`test("across a year end", () => {
  expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
});`,
        String.raw`test("negative months", () => {
  expect(addMonths("2026-05-31", -1)).toBe("2026-04-30");
  expect(addMonths("2026-01-31", -2)).toBe("2025-11-30");
});`,
      ],
    },
  }),
  task({
    id: 'coding-10',
    bug: 'formatPrice() prints raw division: no fixed decimals, no thousands commas, wrong sign',
    prompt: "formatPrice() in src/money.ts prints 1250 cents as '$12.5' instead of '$12.50', and 123456 as '$1234.56' instead of '$1,234.56'. Prices should always have two decimals and commas between thousands, and a negative amount should look like '-$5.00'. Can you fix it?",
    source: {
      'src/money.ts': String.raw`export function formatPrice(cents: number): string {
  return "$" + cents / 100;
}
`,
    },
    test: {
      path: 'test/money.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { formatPrice } from "../src/money.ts";
`,
      visible: [
        String.raw`test("two decimals", () => {
  expect(formatPrice(1250)).toBe("$12.50");
});`,
      ],
      hidden: [
        String.raw`test("small amounts", () => {
  expect(formatPrice(5)).toBe("$0.05");
  expect(formatPrice(0)).toBe("$0.00");
});`,
        String.raw`test("thousands", () => {
  expect(formatPrice(123456)).toBe("$1,234.56");
  expect(formatPrice(100000000)).toBe("$1,000,000.00");
});`,
        String.raw`test("negative amounts", () => {
  expect(formatPrice(-500)).toBe("-$5.00");
  expect(formatPrice(-123456)).toBe("-$1,234.56");
});`,
      ],
    },
  }),
  task({
    id: 'coding-11',
    bug: 'parseCsvLine() splits on commas inside quoted fields and keeps doubled quotes',
    prompt: 'parseCsvLine() in src/csv.ts splits on every comma, even inside quotes, so a,"b,c",d gives four fields instead of a / b,c / d. A quoted field can hold commas, and two double quotes inside it stand for one ("say ""hi""" is say "hi"). Empty fields should stay as empty strings. Can you fix it?',
    source: {
      'src/csv.ts': String.raw`export function parseCsvLine(line: string): string[] {
  return line.split(",").map((field) => field.replace(/^"|"$/g, ""));
}
`,
    },
    test: {
      path: 'test/csv.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { parseCsvLine } from "../src/csv.ts";
`,
      visible: [
        String.raw`test("a comma inside quotes", () => {
  expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
});`,
      ],
      hidden: [
        String.raw`test("plain fields", () => {
  expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
});`,
        String.raw`test("doubled quotes", () => {
  expect(parseCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
});`,
        String.raw`test("empty fields", () => {
  expect(parseCsvLine("a,,b")).toEqual(["a", "", "b"]);
  expect(parseCsvLine("a,")).toEqual(["a", ""]);
  expect(parseCsvLine('"",z')).toEqual(["", "z"]);
});`,
        String.raw`test("one quoted field with several commas", () => {
  expect(parseCsvLine('"x,y,z"')).toEqual(["x,y,z"]);
});`,
      ],
    },
  }),
  task({
    id: 'coding-12',
    bug: 'slugify() only lowercases and swaps spaces for dashes',
    prompt: "slugify() in src/util/slug.ts turns 'Hello, World!' into 'hello,-world!'. A slug should only hold lowercase letters a to z, digits and single dashes between words, with no dash at either end, and accented letters should lose their accents ('Café Déjà Vu' becomes 'cafe-deja-vu'). Can you fix it?",
    source: {
      'src/util/slug.ts': String.raw`export function slugify(title: string): string {
  return title.toLowerCase().replace(/ /g, "-");
}
`,
    },
    test: {
      path: 'test/slug.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { slugify } from "../src/util/slug.ts";
`,
      visible: [
        String.raw`test("drops punctuation", () => {
  expect(slugify("Hello, World!")).toBe("hello-world");
});`,
      ],
      hidden: [
        String.raw`test("removes accents", () => {
  expect(slugify("Café Déjà Vu")).toBe("cafe-deja-vu");
});`,
        String.raw`test("collapses runs and trims dashes", () => {
  expect(slugify("  Many   spaces  ")).toBe("many-spaces");
  expect(slugify("Top 10 tips -- 2026 edition")).toBe("top-10-tips-2026-edition");
});`,
        String.raw`test("nothing usable gives an empty slug", () => {
  expect(slugify("!!!")).toBe("");
});`,
        String.raw`test("a slug stays as it is", () => {
  expect(slugify("already-a-slug")).toBe("already-a-slug");
});`,
      ],
    },
  }),
  task({
    id: 'coding-13',
    bug: 'backoffMs() is one doubling ahead and has no cap',
    prompt: 'backoffMs() in src/retry.ts should wait 100 ms before the first retry (attempt 1), then double each time (200, 400, and so on), and never more than 5000 ms. Right now attempt 1 gives 200 and late attempts grow without limit. Can you fix it?',
    source: {
      'src/retry.ts': String.raw`export const BASE_DELAY_MS = 100;
export const MAX_DELAY_MS = 5000;

export function backoffMs(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt;
}
`,
    },
    test: {
      path: 'test/retry.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { backoffMs } from "../src/retry.ts";
`,
      visible: [
        String.raw`test("the first retry waits 100 ms", () => {
  expect(backoffMs(1)).toBe(100);
});`,
      ],
      hidden: [
        String.raw`test("doubles each attempt", () => {
  expect([2, 3, 4, 5, 6].map((n) => backoffMs(n))).toEqual([200, 400, 800, 1600, 3200]);
});`,
        String.raw`test("caps at 5000 ms", () => {
  expect(backoffMs(7)).toBe(5000);
  expect(backoffMs(12)).toBe(5000);
});`,
        String.raw`test("very late attempts stay capped", () => {
  expect(backoffMs(2000)).toBe(5000);
});`,
      ],
    },
  }),
  task({
    id: 'coding-14',
    bug: 'parseTags() splits on commas without trimming, lowercasing or removing blanks and repeats',
    prompt: "parseTags() in src/tags.ts keeps spaces, blanks and repeats: ' Red, blue ,red,, ' gives [' Red', ' blue ', 'red', '', ' ']. It should trim each tag, lowercase it, drop empty ones and repeats, and keep the order each tag first appeared in, so that example gives ['red', 'blue']. Can you fix it?",
    source: {
      'src/tags.ts': String.raw`export function parseTags(text: string): string[] {
  return text.split(",");
}
`,
    },
    test: {
      path: 'test/tags.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { parseTags } from "../src/tags.ts";
`,
      visible: [
        String.raw`test("trims, lowercases and dedupes", () => {
  expect(parseTags(" Red, blue ,red,, ")).toEqual(["red", "blue"]);
});`,
      ],
      hidden: [
        String.raw`test("first-seen order", () => {
  expect(parseTags("B,b,A, a ,c")).toEqual(["b", "a", "c"]);
  expect(parseTags("Go, Rust,go ,TypeScript")).toEqual(["go", "rust", "typescript"]);
});`,
        String.raw`test("nothing but blanks", () => {
  expect(parseTags("")).toEqual([]);
  expect(parseTags(",,,")).toEqual([]);
});`,
        String.raw`test("a single tag", () => {
  expect(parseTags("ops")).toEqual(["ops"]);
});`,
      ],
    },
  }),
  task({
    id: 'coding-15',
    bug: '/health answers 200 to every method instead of 405 for anything but GET and HEAD',
    prompt: "POST /health answers 200 'ok', and so do PUT and DELETE. /health should only answer GET and HEAD; any other method should get 405 with an Allow header of 'GET, HEAD'. Unknown paths should stay 404 whatever the method. Can you fix it?",
    source: {},
    test: {
      path: 'test/health-methods.test.ts',
      header: String.raw`import { expect, test } from "bun:test";
import { routes } from "../src/routes.ts";

const call = (method: string, path = "/health") => routes(new Request("http://x" + path, { method }));
`,
      visible: [
        String.raw`test("POST /health is 405", () => {
  expect(call("POST").status).toBe(405);
});`,
      ],
      hidden: [
        String.raw`test("GET and HEAD still work", async () => {
  const res = call("GET");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
  expect(call("HEAD").status).toBe(200);
});`,
        String.raw`test("other methods get 405 with Allow", () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = call(method);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  }
});`,
        String.raw`test("unknown paths stay 404", () => {
  expect(call("GET", "/nope").status).toBe(404);
  expect(call("POST", "/nope").status).toBe(404);
});`,
      ],
    },
  }),
];

/** The counted run's seeds, one per task: codingTaskForSeed maps 200 to 214 onto coding-06 to coding-15, then coding-01 to coding-05. */
export const COUNTED_CODING_SEEDS: readonly number[] = Array.from({ length: CODING_TASKS.length }, (_, i) => 200 + i);

export function codingTaskForSeed(seed: number): CodingTask {
  const n = CODING_TASKS.length;
  return CODING_TASKS[((seed % n) + n) % n]!;
}

/** The task's files as HOME-relative paths under the target project, in path order, and the prompt. The fixture is not changed. */
export function applyCodingTask(fixture: Fixture, task: CodingTask): { project: string; files: Map<string, string>; prompt: string } {
  const project = fixture.manifest.projects[0]!.dir;
  const files = new Map(Object.keys(task.files).sort().map(p => [project + '/' + p, task.files[p]!] as const));
  return { project, files, prompt: task.prompt };
}

/** argv runs bun test on the copied project; by default the grader's own bun. The trial runner passes a no-network container. */
export async function gradeCodingTask(projectDir: string, task: CodingTask, timeoutMs = GRADE_TIMEOUT_MS, argv: (dir: string, testFile: string) => string[] = (_dir, testFile) => [process.execPath, 'test', './' + testFile]): Promise<CodingGrade> {
  const tmp = mkdtempSync(join(tmpdir(), 'first-wow-coding-'));
  try {
    const dir = join(tmp, 'project');
    cpSync(projectDir, dir, { recursive: true, filter: src => !['node_modules', '.git'].includes(basename(src)) });
    const testPath = join(dir, task.testFile);
    // The copy keeps the agent's symbolic links, so the hidden test goes only into a regular file inside the copy.
    try {
      mkdirSync(dirname(testPath), { recursive: true });
      if (!realpathSync(dirname(testPath)).startsWith(realpathSync(dir) + sep)) throw new Error(dirname(task.testFile) + ' leaves the project');
      rmSync(testPath, { force: true });
      writeFileSync(testPath, task.hidden, { flag: 'wx' });
    } catch (e) {
      return { passed: false, pass: 0, fail: 0, output: 'hidden test not installed: ' + (e as Error).message };
    }
    const proc = Bun.spawn({
      cmd: argv(dir, task.testFile),
      cwd: dir,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      timeout: timeoutMs,
    });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const count = (word: string) => Number(new RegExp('^\\s*(\\d+) ' + word + '\\s*$', 'm').exec(stderr + '\n' + stdout)?.[1] ?? 0);
    const pass = count('pass'), fail = count('fail');
    const text = ((proc.signalCode ? 'killed (' + proc.signalCode + '), timeout ' + timeoutMs + ' ms\n' : '') + stdout + '\n' + stderr).trim();
    return { passed: code === 0 && !proc.signalCode && fail === 0 && pass === task.hiddenCases, pass, fail, output: text.length > OUTPUT_MAX ? text.slice(-OUTPUT_MAX) : text };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
