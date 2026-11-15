#!/usr/bin/env bun
// The readers gstack's own depth rule expects on each review unit, per host, for the exposure gate of the
// review-real-bugs eval (docs/benchmarks/2026-11-review-real-bugs, plan "Exposure gate").
//
//   bun scripts/review-bugs/depth.ts --gstack <gstack checkout at the pin> --suite <noloss suite.json>
//     --source <owner/repo>=<full clone>... [--base-branch <owner/repo>=<name>]... [--hosts claude,codex,openclaw,hermes]
//     [--ship-panel] --out <file>
//
// For each unit it builds a throwaway repository the way gstack-evals review-units does (the head and its ancestry, the
// base branch and origin/<base> at the merge base of head and the unit's base, no remote), then:
//
// - /review: runs the pin's own scope helpers (bin/gstack-diff-scope and bin/gstack-state-matrix detect) and counts
//   DIFF_LINES as Step 4.5 does, and applies Step 4.5's selection rule (review/sections/review-army.md, whose sha256 at the
//   pin is REVIEW_ARMY_SHA256; the script refuses a checkout whose section differs, because the rule below is transcribed
//   from it). Adaptive gating is empty: every trial starts from a fresh gstack state root, so no specialist has hit-rate
//   history. The Red Team counts as required only above 200 changed lines; its other trigger (a specialist reported a
//   CRITICAL) depends on the session, so it is listed under conditional and never required. The Claude adversarial
//   subagent is always required where the host's render has Step 4.8's subagent.
// - Hosts: each host's /review is rendered from the pin with scripts/gen-skill-docs.ts --host <host> into a scratch dir,
//   and a host gets the Review Army readers only when its render carries the army marker, and adversarial-native only when
//   it carries the adversarial marker. At 1d3c63c5 claude has both, codex only the adversarial subagent, and openclaw and
//   hermes neither (hosts/define-host.ts CROSS_MODEL_RESOLVERS). A C2 cell that runs Sol through Claude Code is the claude
//   host. The outside voice (Codex or Claude through its CLI) is not an Agent subagent and is never a required reader.
// - ship-panel (--ship-panel, claude host only): runs bin/gstack-review-plan --base <base> and takes its DISPATCH lines;
//   a specialist line with two or more checklists is the batched reader, as gstack-evals' readers.ts names it. For the
//   exposure gate (exposure.ts --skill ship), ship_panel_gate names what the reader map can see: every checklist a
//   DISPATCH line names (a batched or merged reader covers each of its checklists, as exposure.ts counts a launch that
//   names two or more), plus adversarial-native for an adversarial line that names none. The outside voice is never in it.
//
// Output: { expected: { <host>: { <unit>: [readers] } }, ship_panel: { claude: { <unit>: [readers] } },
//   ship_panel_gate: { claude: { <unit>: [readers] } }, details }.
// Keyless: no model call, no network, every gstack helper runs with env -i and a scratch HOME.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GSTACK_PIN = "1d3c63c53d17faf0456c564bc5950f18b370d0ef";
export const REVIEW_ARMY_SHA256 = "78329b64640260cd8831ca81a9189f3f8dcade9c406431631d3f2cd798cd3967";
export const ARMY_MARKER = "Dispatching N specialists";
export const ADVERSARIAL_MARKER = "Think like an attacker and a chaos engineer";
export const HOSTS = ["claude", "codex", "openclaw", "hermes"] as const;
export type Host = (typeof HOSTS)[number];
export const ADVERSARIAL = "adversarial-native";
export const BATCHED = "batched";

export interface Scope {
  diffLines: number;
  signals: Record<string, boolean>;
  stateMachine: "true" | "false" | "unknown";
}

export interface HostCaps {
  army: boolean;
  adversarial: boolean;
}

export class DepthError extends Error {
  constructor(readonly code: string, message: string) {
    super(code + " " + message);
  }
}

/** Step 4.5's selection at the pin, with no adaptive gating and no force flags. */
export function armyReaders(s: Scope): { required: string[]; conditional: string[] } {
  const on = (k: string) => s.signals[k] === true;
  const sm = s.stateMachine !== "false";
  const conditional = s.diffLines > 200 ? [] : ["red-team"];
  if (s.diffLines < 50) return { required: sm ? ["state-machines"] : [], conditional };
  const picked = ["testing", "maintainability"];
  if (on("SCOPE_AUTH") || (on("SCOPE_BACKEND") && s.diffLines > 100)) picked.push("security");
  if (on("SCOPE_BACKEND") || on("SCOPE_FRONTEND")) picked.push("performance");
  if (on("SCOPE_MIGRATIONS")) picked.push("data-migration");
  if (on("SCOPE_API")) picked.push("api-contract");
  if (on("SCOPE_FRONTEND")) picked.push("design");
  if (s.diffLines > 100) picked.push("simplification");
  if (sm) picked.push("state-machines");
  if (s.diffLines > 200) picked.push("red-team");
  return { required: picked, conditional };
}

export function reviewReaders(s: Scope, caps: HostCaps): { required: string[]; conditional: string[] } {
  const army = caps.army ? armyReaders(s) : { required: [], conditional: [] };
  return { required: [...army.required, ...(caps.adversarial ? [ADVERSARIAL] : [])].sort(), conditional: army.conditional };
}

/** A host's /review capabilities from its rendered skill text (SKILL.md plus its sections). */
export function hostCaps(rendered: string): HostCaps {
  return { army: rendered.includes(ARMY_MARKER), adversarial: rendered.includes(ADVERSARIAL_MARKER) };
}

export function parseScope(diffScope: string, stateMatrix: string, diffLines: number): Scope {
  const signals: Record<string, boolean> = {};
  for (const m of diffScope.matchAll(/^(SCOPE_[A-Z_]+)=(true|false)$/gm)) signals[m[1]!] = m[2] === "true";
  const sm = /^SCOPE_STATE_MACHINE=(true|false|unknown)$/m.exec(stateMatrix)?.[1] as Scope["stateMachine"] | undefined;
  return { diffLines, signals, stateMachine: sm ?? "unknown" };
}

/** gstack-review-plan's DISPATCH lines as reader names; the outside voice runs through a CLI, not as a subagent. */
export function parseReviewPlan(text: string): { depth: string | null; readers: string[]; gate: string[]; outside: boolean } {
  const depth = /^REVIEW_DEPTH: (\S+)/m.exec(text)?.[1] ?? null;
  const readers: string[] = [];
  const gate = new Set<string>();
  let outside = false;
  for (const m of text.matchAll(/^DISPATCH: (\S+) (\S+)(.*)$/gm)) {
    const [, role, name, rest] = m as unknown as [string, string, string, string];
    if (role === "outside-voice") {
      outside = true;
      continue;
    }
    const lists = /checklists=(\S+)/.exec(rest)?.[1]?.split(",").filter(Boolean) ?? [];
    for (const l of lists) gate.add(l);
    if (role === "specialist") readers.push(lists.length >= 2 ? BATCHED : lists[0] ?? name);
    else if (role === "adversarial-native") {
      readers.push(ADVERSARIAL);
      if (!lists.length) gate.add(ADVERSARIAL);
    } else {
      readers.push(name);
      if (!lists.length) gate.add(name);
    }
  }
  if (depth === null) throw new DepthError("E_DEPTH_PLAN", "gstack-review-plan printed no REVIEW_DEPTH line");
  return { depth, readers: readers.sort(), gate: [...gate].sort(), outside };
}

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

function run(cmd: string, args: string[], cwd: string, home: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", GSTACK_STATE_ROOT: join(home, ".gstack") }, timeout: 300_000 });
  if (r.status === 2 && cmd.endsWith("gstack-diff-scope") && /^SCOPE_ERROR=unmatched$/m.test(r.stdout ?? "")) return r.stdout;
  if (r.status !== 0) throw new DepthError("E_DEPTH_HELPER", [cmd, ...args].join(" ") + " in " + cwd + " exited " + r.status + ": " + (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | "));
  return r.stdout;
}

const git = (cwd: string, ...args: string[]) => run("git", args, cwd, cwd).trim();

function readTree(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir).sort().map((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? readTree(p) : n.endsWith(".md") ? readFileSync(p, "utf8") : "";
  }).join("\n");
}

function renderCaps(gstack: string, host: Host, scratch: string): HostCaps {
  const out = join(scratch, "render-" + host);
  run("bun", ["run", "scripts/gen-skill-docs.ts", "--host", host, "--out-dir", out], gstack, mkdtempSync(join(scratch, "home-")));
  const dirs = [join(out, "review"), join(out, ".agents", "skills", "gstack-review"), join(out, ".openclaw", "skills", "gstack-review"), join(out, ".hermes", "skills", "gstack-review")].filter(existsSync);
  if (dirs.length !== 1) throw new DepthError("E_DEPTH_RENDER", "the " + host + " render under " + out + " holds " + dirs.length + " review skill dirs, not 1");
  return hostCaps(readTree(dirs[0]!));
}

interface UnitRef {
  id: string;
  repo: string;
  head: string;
  base: string;
}

function buildUnit(u: UnitRef, source: string, baseBranch: string, dest: string): void {
  git(dest, "init", "-q");
  git(dest, "fetch", "-q", source, u.head, u.base);
  git(dest, "checkout", "-q", "-b", "pr", u.head);
  const mb = git(dest, "merge-base", u.head, u.base);
  git(dest, "update-ref", "refs/heads/" + baseBranch, mb);
  git(dest, "update-ref", "refs/remotes/origin/" + baseBranch, mb);
  git(dest, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/" + baseBranch);
}

const pairs = (vals: string[]) => new Map(vals.map((v) => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)] as const));

export async function main(argv: string[]): Promise<number> {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--ship-panel") flags.set(a, []);
    else if (a.startsWith("--") && i + 1 < argv.length) flags.set(a, [...(flags.get(a) ?? []), argv[++i]!]);
    else throw new DepthError("E_USAGE", "unknown argument " + JSON.stringify(a));
  }
  const one = (f: string) => flags.get(f)?.[0];
  const gstack = one("--gstack");
  const suiteFile = one("--suite");
  const outFile = one("--out");
  if (!gstack || !suiteFile || !outFile) throw new DepthError("E_USAGE", "needs --gstack, --suite and --out");
  const head = git(gstack, "rev-parse", "HEAD");
  if (head !== GSTACK_PIN) throw new DepthError("E_DEPTH_PIN", gstack + " is at " + head + ", not the pin " + GSTACK_PIN);
  if (git(gstack, "status", "--porcelain")) throw new DepthError("E_DEPTH_PIN", gstack + " has uncommitted changes");
  const army = sha256(readFileSync(join(gstack, "review", "sections", "review-army.md")));
  if (army !== REVIEW_ARMY_SHA256) throw new DepthError("E_DEPTH_RULE", "review/sections/review-army.md hashes to " + army + ", not " + REVIEW_ARMY_SHA256 + "; the transcribed rule no longer matches");
  const hosts = (one("--hosts") ?? HOSTS.join(",")).split(",") as Host[];
  for (const h of hosts) if (!HOSTS.includes(h)) throw new DepthError("E_USAGE", "--hosts takes " + HOSTS.join(", "));
  const sources = pairs(flags.get("--source") ?? []);
  const branches = pairs(flags.get("--base-branch") ?? []);
  const suite = JSON.parse(readFileSync(suiteFile, "utf8")) as { id: string; units: UnitRef[] };
  const scratch = mkdtempSync(join(tmpdir(), "review-depth-"));
  try {
    const caps = Object.fromEntries(hosts.map((h) => [h, renderCaps(gstack, h, scratch)])) as Record<Host, HostCaps>;
    const expected: Record<string, Record<string, string[]>> = Object.fromEntries(hosts.map((h) => [h, {}]));
    const shipPanel: Record<string, string[]> = {};
    const shipGate: Record<string, string[]> = {};
    const details: Record<string, unknown> = {};
    for (const u of suite.units) {
      const source = sources.get(u.repo);
      if (!source) throw new DepthError("E_USAGE", "no --source for " + u.repo);
      const baseBranch = branches.get(u.repo) ?? "main";
      const dir = mkdtempSync(join(scratch, "unit-"));
      buildUnit(u, source, baseBranch, dir);
      const home = mkdtempSync(join(scratch, "home-"));
      const mb = git(dir, "merge-base", "origin/" + baseBranch, "HEAD");
      const diffLines = git(dir, "diff", mb, "--numstat").split("\n").filter(Boolean).reduce((n, l) => {
        const [a, d] = l.split("\t");
        return n + (Number(a) || 0) + (Number(d) || 0);
      }, 0);
      const scope = parseScope(run(join(gstack, "bin", "gstack-diff-scope"), [baseBranch], dir, home), run(join(gstack, "bin", "gstack-state-matrix"), ["detect", "--base", baseBranch], dir, home), diffLines);
      const perHost: Record<string, unknown> = {};
      for (const h of hosts) {
        const r = reviewReaders(scope, caps[h]);
        expected[h]![u.id] = r.required;
        perHost[h] = { caps: caps[h], ...r };
      }
      let plan: ReturnType<typeof parseReviewPlan> | null = null;
      if (flags.has("--ship-panel")) {
        plan = parseReviewPlan(run(join(gstack, "bin", "gstack-review-plan"), ["--base", baseBranch], dir, home));
        shipPanel[u.id] = plan.readers;
        shipGate[u.id] = plan.gate;
      }
      details[u.id] = { diff_lines: diffLines, merge_base: mb, scope, review: perHost, ...(plan ? { ship_panel: plan } : {}) };
      rmSync(dir, { recursive: true, force: true });
    }
    const out = { schema_version: 1, suite: suite.id, gstack: { repo: "garrytan/gstack", sha: GSTACK_PIN }, rule: { review_army_sha256: REVIEW_ARMY_SHA256, army_marker: ARMY_MARKER, adversarial_marker: ADVERSARIAL_MARKER }, expected, ...(flags.has("--ship-panel") ? { ship_panel: { claude: shipPanel }, ship_panel_gate: { claude: shipGate } } : {}), details };
    writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
    console.log("wrote " + outFile + ": " + suite.units.length + " units, hosts " + hosts.join(", ") + (flags.has("--ship-panel") ? ", ship-panel" : ""));
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof DepthError ? e.message : "E_DEPTH_INTERNAL " + (e as Error).message);
    process.exit(2);
  }
}
