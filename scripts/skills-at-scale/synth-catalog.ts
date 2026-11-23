#!/usr/bin/env bun
// A synthetic, nested skill catalog ladder for the skills-at-scale keyless checks (internal-task-a, internal-task-b), used until the real
// public ladder exists. Every skill is invented: names from a fixed word list, descriptions from fixed sentence parts, bodies
// from fixed paragraphs, so nothing private or copyrighted is in it. Lengths follow what real catalogs hold (names of 3 to 31
// characters; a quarter of the descriptions short like Hermes's bundled skills, half of 100 to 300 characters, a quarter long
// like community packs; bodies of 1 to 12 KB). Each skill names one made-up tool word that no other skill uses, so a request
// can name exactly one skill without naming the skill itself.
//
//   bun scripts/skills-at-scale/synth-catalog.ts --out <ladder dir> [--sizes 100,351,700,1500] [--seed 20261119]
//
// Writes <ladder>/<n>/skills/<name>/SKILL.md and <ladder>/<n>/manifest.json for each size. The rungs are nested: the
// smallest rung is the target skills, spread evenly over the alphabet of the largest rung, and each bigger rung adds skills
// spread the same way. manifest.json lists {name, description, tool_word, target, sha256} and the catalog's sha256.

import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULT_SIZES = [100, 351, 700, 1500];
export const DEFAULT_SEED = 20261119;

const WORDS = ('api audit backup billing blog branch budget build cache calendar canary changelog chart chat checkout cli cloud code ' +
  'commit compliance config contract cost coverage cron css csv dashboard data database debug deploy design diagram diff dns docker ' +
  'docs domain draft email embed env error eval event excel export feature figma file finance firewall font form git graph grant ' +
  'health helm hiring hook html http image incident index infra inventory invoice ios issue jira json kafka kanban key kubernetes ' +
  'label lambda latency layout lead legal lint load log logo map markdown meeting memo metric migration mobile mock monitor ' +
  'newsletter note notebook oauth onboard ops order outage package page parser patch payment pdf perf pipeline pitch plan plugin ' +
  'podcast policy postgres pr pricing privacy profile prompt proto proxy python query queue quota react readme recipe redis ' +
  'refactor release report repo research resume retro review risk roadmap route rust sales scan schema scraper sdk search secret ' +
  'security seo server shell sitemap slack slide snapshot spec sprint sql sre stack storage stripe style survey sync tax team ' +
  'template terraform test ticket timeline token trace translate triage tweet type ui upload usage ux vendor video vote vpc ' +
  'web webhook wiki workflow xml yaml zone').split(' ');
const VERBS = ['write', 'review', 'check', 'build', 'fix', 'plan', 'draft', 'migrate', 'summarize', 'triage', 'debug', 'design', 'test', 'audit', 'ship', 'clean', 'format', 'explain', 'compare', 'score'];
const OPENERS = ['Use when the user asks to', 'Helps', 'Guides the agent to', 'Step by step workflow to', 'Use this skill to', 'Checklist to'];
const MIDDLES = ['with the', 'through the', 'using the', 'by running the', 'from the output of the'];
const TAILS = [
  'Covers the common failure cases and what to check first.',
  'Includes a short checklist and the commands to run.',
  'Asks for confirmation before anything is deleted or sent.',
  'Works on a local checkout and on a remote host over ssh.',
  'Keeps a log of every step so the work can be resumed.',
  'Prefers small changes, each one tested before the next.',
  'Writes the result as Markdown that a reviewer can read in a minute.',
  'Explains each decision in plain words and links the sources it used.',
  'Stops and asks when a step would spend money or touch production.',
  'Handles large inputs by splitting them into pages first.',
];
const PARAS = [
  'Read the request and restate the goal in one sentence before starting.',
  'List the files or records the task touches, and read each one before changing it.',
  'Run the smallest check that could catch a mistake, then the full check once the change is done.',
  'When a command fails, read its error, fix the cause and run it again; do not retry blindly.',
  'Write the result where the user asked for it, and say what changed and what was left out.',
  'If the input is ambiguous, pick the most likely reading, say which one, and carry on.',
  'Keep secrets out of logs and output; read a key by name, never print it.',
  'Finish with a short summary: what was done, what was checked, and anything still open.',
];
const SYLL = ['ka', 'zo', 'ri', 'mu', 'te', 'vel', 'qua', 'nix', 'bor', 'lim', 'sha', 'dru', 'pek', 'wan', 'fyl', 'gor', 'tis', 'hap', 'jor', 'xel'];

export type SynthSkill = { name: string; description: string; tool_word: string; body: string };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n invented skills, sorted by name. The same seed gives the same skills on every machine. */
export function synthSkills(n: number, seed = DEFAULT_SEED): SynthSkill[] {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const names = new Set<string>(), tools = new Set<string>();
  const out: SynthSkill[] = [];
  while (out.length < n) {
    const parts = 1 + Math.floor(r() * 3) + (r() < 0.2 ? 1 : 0);
    const name = Array.from({ length: parts }, () => pick(WORDS)).join('-').slice(0, 31).replace(/-+$/, '');
    if (name.length < 3 || names.has(name)) continue;
    let tool = '';
    while (!tool || tools.has(tool)) tool = Array.from({ length: 3 + Math.floor(r() * 2) }, () => pick(SYLL)).join('');
    names.add(name);
    tools.add(tool);
    const band = r();
    const target = band < 0.25 ? 45 + Math.floor(r() * 35) : band < 0.75 ? 100 + Math.floor(r() * 200) : 300 + Math.floor(r() * 600);
    const topic = name.replace(/-/g, ' ');
    let description = pick(OPENERS) + ' ' + pick(VERBS) + ' ' + topic + ' work ' + pick(MIDDLES) + ' ' + tool + ' tool.';
    const tails = [...TAILS].sort(() => r() - 0.5);
    for (let t = 0; description.length < target; t++) description += ' ' + tails[t % tails.length];
    const bodyTarget = 1000 + Math.floor(r() * 11000);
    let body = '# ' + topic + '\n\nThis skill uses the ' + tool + ' tool.\n\n## Steps\n\n';
    let i = 1;
    while (body.length < bodyTarget) body += i++ + '. ' + pick(PARAS) + '\n';
    out.push({ name, description, tool_word: tool, body });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Indices of k items spread evenly over a sorted list of n (k <= n). */
export function spread(n: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => Math.floor(((i + 0.5) * n) / k));
}

/** The nested rungs, sizes ascending; the first rung holds the targets, spread evenly over the largest rung's names. */
export function ladder(skills: SynthSkill[], sizes: number[]): { size: number; names: string[] }[] {
  const sorted = [...sizes].sort((a, b) => a - b);
  if (sorted.at(-1)! !== skills.length) throw new Error('the largest rung must hold every skill');
  const chosen = new Set<number>();
  const rungs: { size: number; names: string[] }[] = [];
  for (const size of sorted) {
    const rest = skills.map((_, i) => i).filter((i) => !chosen.has(i));
    for (const j of spread(rest.length, size - chosen.size)) chosen.add(rest[j]!);
    rungs.push({ size, names: [...chosen].sort((a, b) => a - b).map((i) => skills[i]!.name) });
  }
  return rungs;
}

export const skillMd = (s: SynthSkill) => '---\nname: ' + s.name + '\ndescription: ' + JSON.stringify(s.description) + '\n---\n\n' + s.body;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function writeLadder(out: string, sizes = DEFAULT_SIZES, seed = DEFAULT_SEED) {
  const skills = synthSkills(Math.max(...sizes), seed);
  const byName = new Map(skills.map((s) => [s.name, s]));
  const rungs = ladder(skills, sizes);
  const targets = new Set(rungs[0]!.names);
  for (const { size, names } of rungs) {
    const dir = join(out, String(size));
    rmSync(dir, { recursive: true, force: true });
    const rows = names.map((n) => {
      const s = byName.get(n)!, md = skillMd(s);
      mkdirSync(join(dir, 'skills', n), { recursive: true });
      writeFileSync(join(dir, 'skills', n, 'SKILL.md'), md);
      return { name: n, description: s.description, tool_word: s.tool_word, target: targets.has(n), sha256: sha256(md) };
    });
    const catalog_sha256 = sha256(rows.map((r) => r.name + ' ' + r.sha256).join('\n'));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ schema_version: 1, kind: 'synthetic', seed, size, catalog_sha256, skills: rows }, null, 1) + '\n');
    console.log('RUNG ' + size + ' ' + dir + ' catalog_sha256=' + catalog_sha256.slice(0, 16));
  }
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const out = v('--out');
  if (!out) { console.error('usage: synth-catalog.ts --out <ladder dir> [--sizes 100,351,700,1500] [--seed n]'); process.exit(2); }
  writeLadder(resolve(out), v('--sizes') ? v('--sizes')!.split(',').map(Number) : DEFAULT_SIZES, v('--seed') ? Number(v('--seed')) : DEFAULT_SEED);
}
