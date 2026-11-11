#!/usr/bin/env bun
// gstack-check.sh's report (internal-task): reads what the gstack install check left under <out> and writes
// <out>/gstack-check.json, plus each gstack cell's first model request, scrubbed, under <out>/first-requests/.
//
//   bun scripts/frontier-harbor/gstack-check.ts --out <gstack-check.sh out dir> --agents-rc <n> [--images all|none]
//
// Per cell of install-check-gstack-prereg.json: the skills the host listed in the first request the proxy forwarded
// (parseListing), the gstack ones being those the cell's none arm did not list; for a built arm they must be exactly the
// manifest's expected_listed, once each, and Harbor's copy must have left every listed SKILL.md in place; the none arm
// must list none of gstack's names, its container must have had no gstack, and no request may name a gstack path. Per
// host, gstack-skill-start must exit 0 twice with no packet leaving its network namespace (the kernel's own IPv6
// link-local housekeeping on the new interface, multicast listener reports and router and neighbor solicitations to
// ff02::, is counted apart). Per pinned task image, the
// install's needs (HOME /root, bash, sha256sum) and the built Bun running there, and the bun and node the image already
// ships (recorded). The agent check's vm-run.sh outcome, as agentsRun says. The report fails closed: every failed check
// adds a line to its "reasons", and it passes only when that list is empty. Exit 0 when everything passed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { canonicalName, listedName, type GstackHost } from './gstack-names.ts';
import { HOST_OF } from './gstack-arm.ts';

const HERE = import.meta.dir;

export interface Listed { name: string; where: string | null }

/** Every string of a request body, in order, joined by newlines. */
export function bodyText(body: unknown): string {
  const out: string[] = [];
  const walk = (x: unknown) => { if (typeof x === 'string') out.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  walk(body);
  return out.join('\n');
}

/** The skills a host's first request lists: Claude Code's Skill-tool block (name), Codex's skills section (name and
 *  file), Hermes's <available_skills> index (name and category). */
export function parseListing(text: string, host: GstackHost): Listed[] {
  if (host === 'claude') {
    const i = text.indexOf('The following skills are available for use with the Skill tool:');
    if (i < 0) return [];
    const block = text.slice(i).split('\n\n')[1] ?? '';
    return [...block.matchAll(/^- ([^:\n]+):/gm)].map((m) => ({ name: m[1]!, where: null }));
  }
  if (host === 'codex') return [...text.matchAll(/^- ([^:\n]+): .*?\(file: ([^)\n]+)\)$/gm)].map((m) => ({ name: m[1]!, where: m[2]! }));
  const i = text.indexOf('<available_skills>');
  const j = text.indexOf('</available_skills>', i);
  if (i < 0) return [];
  let category: string | null = null;
  const out: Listed[] = [];
  for (const line of text.slice(i, j < 0 ? undefined : j).split('\n')) {
    const cat = /^ {2}([^\s:][^:]*):/.exec(line);
    const item = /^ {4}- ([^:\n]+):/.exec(line);
    if (item) out.push({ name: item[1]!, where: category });
    else if (cat) category = cat[1]!;
  }
  return out;
}

/** The listed skills a gstack arm added: those not listed, at the same place, by the cell's none arm. Codex numbers its
 *  skill roots (r0, r1, ...) in order, and a gstack arm adds one, so the root number is not part of the place. */
export function gstackListed(arm: Listed[], none: Listed[]): Listed[] {
  const key = (l: Listed) => l.name + '\u0000' + (l.where ?? '').replace(/^r\d+\//, '');
  const base = new Set(none.map(key));
  return arm.filter((l) => !base.has(key(l)));
}

/** A captured body with anything shaped like a credential replaced. */
const VENDOR_PROMPT = /x-anthropic-billing[-]header|You are a Claude agent, built on Anthropic.{1,3}s Claude Agent SDK|You are Claude Code, Anthropic.{1,3}s official CLI/;

export function scrub(raw: string): string {
  return raw.replace(/"(?:[^"\\]|\\.)*"/g, (s) => (VENDOR_PROMPT.test(s) ? '"[vendor prompt text removed]"' : s)).replace(/("prompt_cache_key":\s*")[^"]*"/g, '$1REDACTED"').replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-REDACTED').replace(/trial-token:[A-Za-z0-9_.-]+/g, 'trial-token:REDACTED').replace(/(Bearer\s+)[A-Za-z0-9_.-]{12,}/g, '$1REDACTED');
}

const keyed = (file: string) => Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

/** The agent check's vm-run.sh outcome. It passes only when vm-run.sh exited 0: any other exit (a Harbor job that
 *  exited non-zero, a to-trials refusal, an undrained meter, a setup failure, or no exit code at all) fails it, because
 *  the counted run behind this smoke would hit the same failure. The pass also needs a trial record for every cell and
 *  complete accounting, and the fake-provider-key canary of that vm-run.sh (agents/canary.txt) must appear in no file
 *  of the folder. Each failed condition is one line of reasons. */
export function agentsRun(dir: string, rc: number | null, cellIds: string[]) {
  const recorded = existsSync(join(dir, 'trials.jsonl')) ? readFileSync(join(dir, 'trials.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => (JSON.parse(l) as { cell: string }).cell) : [];
  const accounting = existsSync(join(dir, 'accounting.json')) ? (JSON.parse(readFileSync(join(dir, 'accounting.json'), 'utf8')) as { complete?: boolean }).complete === true : false;
  const canary = join(dir, 'canary.txt');
  const hasCanary = existsSync(canary) && readFileSync(canary, 'utf8').length > 0;
  const canaryFiles = hasCanary ? spawnSync('grep', ['-rlF', '-f', canary, dir, '--exclude=canary.txt'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((f) => relative(dir, f)).sort() : [];
  const cellsMissing = cellIds.filter((c) => !recorded.includes(c));
  const reasons = [
    ...(rc === 0 ? [] : [rc === null || Number.isNaN(rc) ? 'agents: no vm-run.sh exit code was recorded' : `agents: vm-run.sh exited ${rc}`]),
    ...(cellsMissing.length ? [`agents: no trial record for ${cellsMissing.join(', ')}`] : []),
    ...(accounting ? [] : ['agents: accounting.json is missing or not complete']),
    ...(hasCanary ? [] : ['agents: no fake-key canary to scan for (canary.txt missing or empty)']),
    ...(canaryFiles.length ? [`agents: the fake-key canary appears in ${canaryFiles.join(', ')}`] : []),
  ];
  return {
    vm_run_exit: rc, trial_records: recorded.length, cells_without_record: cellsMissing, accounting_complete: accounting, canary_checked: hasCanary, canary_files: canaryFiles,
    reasons, pass: !reasons.length,
  };
}

/** One host's gstack-skill-start row (gstack-check.sh step 2) under <out>/skill-start. It passes only when the preamble
 *  extracted from the review skill actually calls gstack-skill-start (an empty one would run nothing and exit 0), both
 *  runs exited 0, the tcpdump sidecar started listening (a capture that never ran sees no packets), and no packet beyond
 *  the kernel's IPv6 link-local housekeeping left the namespace. */
export function skillStartRow(out: string, host: string) {
  const f = (n: string) => (existsSync(join(out, 'skill-start', host + '.' + n)) ? readFileSync(join(out, 'skill-start', host + '.' + n), 'utf8') : null);
  const capture = f('packets.txt');
  const captured = (capture ?? '').split('\n').filter((l) => /^\d{4}-\d\d-\d\d /.test(l));
  const packets = captured.filter((l) => !/ IP6 \S+ > ff02::[0-9a-f:]*: (HBH )?ICMP6, (multicast listener report|router solicitation|neighbor solicitation)/.test(l));
  const exits = [f('run1.exit'), f('run2.exit')].map((x) => (x === null || !x.trim() ? null : Number(x.trim())));
  const preamble = f('preamble.sh')?.trim() || null;
  const reasons = [
    ...(preamble?.includes('gstack-skill-start') ? [] : [`skill start (${host}): no gstack-skill-start preamble was extracted from the review skill`]),
    ...(exits.every((e) => e === 0) ? [] : [`skill start (${host}): the preamble exited ${exits.map((e) => (e === null ? 'unknown' : String(e))).join(' then ')}`]),
    ...(capture === null ? [`skill start (${host}): no packet capture was written`] : /^listening on /m.test(capture) ? [] : [`skill start (${host}): the tcpdump sidecar never started listening`]),
    ...(packets.length ? [`skill start (${host}): ${packets.length} packet(s) left the container`] : []),
  ];
  return { preamble, exits, link_local_housekeeping: captured.length - packets.length, packets: packets.length, first_packets: packets.slice(0, 5), status_lines: (f('run1.txt') ?? '').split('\n').filter((l) => /^[A-Z_]+: /.test(l)).slice(0, 40), reasons, pass: !reasons.length };
}

/** Every reason the whole check fails, in order: the agent run, each cell, each host's skill start, and the image probe,
 *  which must have run when it was asked for (images 'all'). The check passes only when this is empty. */
export function checkReasons(agents: { reasons: string[] }, cells: Record<string, { pass: boolean; note?: string; exception?: string | null }>, skillStart: Record<string, { reasons: string[] }>, images: { pass: boolean; cannot_install: Array<{ id: string }>; probed: number } | null, imagesWanted: 'all' | 'none'): string[] {
  return [
    ...agents.reasons,
    ...Object.entries(cells).filter(([, c]) => !c.pass).map(([id, c]) => `cell ${id}: failed${c.note ? ' (' + c.note + ')' : c.exception ? ' (' + c.exception + ')' : ''}`),
    ...Object.values(skillStart).flatMap((s) => s.reasons),
    ...(images === null ? (imagesWanted === 'all' ? ['images: the image probe was asked for but did not run'] : []) : images.pass ? [] : [images.probed ? `images: ${images.cannot_install.length} image(s) cannot take the install: ${images.cannot_install.map((i) => i.id).join(', ')}` : 'images: no image was probed']),
  ];
}

/** The pinned task images' probe rows (gstack-check.sh step 3) under <out>/images, or null when it did not run. An image
 *  passes with HOME /root, bash, sha256sum and the built Bun running there. The bun and node an image already ships are
 *  recorded, not refused. */
export function imageReport(out: string, bunVersion: string) {
  if (!existsSync(join(out, 'images', 'list.txt'))) return null;
  const ids = readFileSync(join(out, 'images', 'list.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]!);
  const rows: Record<string, Record<string, string>> = Object.fromEntries(ids.map((id) => [id, existsSync(join(out, 'images', id + '.txt')) ? keyed(join(out, 'images', id + '.txt')) : { probe: 'missing' }]));
  const bad = Object.entries(rows).filter(([, r]) => r.home !== '/root' || !r.bash || !r.sha256sum || r.bun !== bunVersion).map(([id, r]) => ({ id, ...r }));
  const tally = (k: string) => Object.values(rows).reduce((acc: Record<string, number>, r) => { const v = String(r[k] ?? ''); acc[v] = (acc[v] ?? 0) + 1; return acc; }, {});
  const ships = (k: string) => Object.entries(rows).filter(([, r]) => r[k]).map(([id, r]) => ({ id, found: r[k]! }));
  return { probed: ids.length, os: tally('os'), libc: tally('libc'), uid: tally('uid'), git_missing: Object.entries(rows).filter(([, r]) => !r.git).map(([id]) => id),
    ships_bun: ships('image_bun'), ships_node: ships('image_node'), cannot_install: bad, pass: ids.length > 0 && !bad.length };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const out = resolve(flag('--out') ?? '.');
  const prereg = JSON.parse(readFileSync(join(HERE, 'install-check-gstack-prereg.json'), 'utf8')) as { cells: Array<{ id: string; harness: string; gstack: { arm: string } }> };
  const run = join(out, 'agents', 'run');
  const first = (cell: string): { route: string; body: unknown; raw: string } | null => {
    const jobs = join(run, 'jobs', cell + '__a1');
    const trial = existsSync(jobs) ? readdirSync(jobs).find((d) => existsSync(join(jobs, d, 'proxy-capture', 'proxy-requests.ndjson'))) : undefined;
    if (!trial) return null;
    const line = readFileSync(join(jobs, trial, 'proxy-capture', 'proxy-requests.ndjson'), 'utf8').split('\n').find((l) => l.trim());
    if (!line) return null;
    const e = JSON.parse(line) as { route: string; body: unknown };
    return { route: e.route, body: e.body, raw: line };
  };
  const trialFile = (cell: string, rel: string) => {
    const jobs = join(run, 'jobs', cell + '__a1');
    const trial = existsSync(jobs) ? readdirSync(jobs).find((d) => existsSync(join(jobs, d, 'result.json'))) : undefined;
    const f = trial ? join(jobs, trial, rel) : null;
    return f && existsSync(f) ? readFileSync(f, 'utf8') : null;
  };
  mkdirSync(join(out, 'first-requests'), { recursive: true });
  const cells: Record<string, unknown> = {};
  for (const c of prereg.cells) {
    const host = HOST_OF[c.harness]!;
    const arm = c.gstack.arm;
    const noneCell = prereg.cells.find((x) => x.harness === c.harness && x.gstack.arm === 'none')!;
    const m = JSON.parse(readFileSync(join(run, 'gstack', 'cells', c.id + '.json'), 'utf8')) as { expected_listed: string[]; unlisted: string[]; harbor_skill_files: string[] };
    const req = first(c.id);
    const result = trialFile(c.id, 'result.json');
    const exception = result ? (JSON.parse(result) as { exception_info?: { exception_type?: string } | null }).exception_info?.exception_type ?? null : 'no result.json';
    const settings = trialFile(c.id, 'agent/harness_settings.json');
    const g = settings ? ((JSON.parse(settings) as { install_checks?: { gstack?: unknown } }).install_checks?.gstack ?? null) : null;
    if (!req) { cells[c.id] = { host, arm, pass: false, exception, note: 'no captured request' }; continue; }
    writeFileSync(join(out, 'first-requests', host + '-' + arm + '-first-request.json'), scrub(JSON.stringify({ route: req.route, body: req.body }, null, 1)) + '\n');
    const listing = parseListing(bodyText(req.body), host);
    const noneReq = first(noneCell.id);
    const base = noneReq ? parseListing(bodyText(noneReq.body), host) : [];
    const added = arm === 'none' ? [] : gstackListed(listing, base);
    const names = added.map((l) => canonicalName(l.name, host));
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    const want = [...m.expected_listed].sort();
    const got = [...new Set(names)].sort();
    const copy = trialFile(c.id, 'agent/gstack-skills-copy.txt')?.trim() ?? null;
    const row: Record<string, unknown> = { host, arm, route: req.route, exception, listed_total: listing.length, harness_builtin: base.length, gstack_listed: added.length, expected_listed: want.length, unlisted_by_host: m.unlisted, install: g };
    if (arm === 'none') {
      const gstackNames = new Set(JSON.parse(readFileSync(join(HERE, 'gstack-catalog.json'), 'utf8')).skills.map((s: string) => listedName(s, host)));
      const hits = listing.filter((l) => gstackNames.has(l.name) || /gstack/.test(l.where ?? ''));
      const reads = (req.raw.match(/\.local\/share\/gstack|skills\/gstack|gstack-skill-start/g) ?? []).length;
      Object.assign(row, { gstack_names_listed: hits.map((l) => l.name), gstack_reads: reads, pass: !exception && !hits.length && reads === 0 && Array.isArray((g as { found?: unknown[] } | null)?.found) && !(g as { found: unknown[] }).found.length });
    } else {
      const missing = want.filter((s) => !got.includes(s));
      const extra = got.filter((s) => !want.includes(s));
      Object.assign(row, { missing, extra, duplicates: dup, skills_copy: copy, pass: !exception && !missing.length && !extra.length && !dup.length && copy === 'checked ' + m.harbor_skill_files.length + ' missing 0' && typeof (g as { verify?: string } | null)?.verify === 'string' && (g as { verify: string }).verify.startsWith('ok ') });
    }
    cells[c.id] = row;
  }
  const skillStart = Object.fromEntries(['claude', 'codex', 'hermes'].map((host) => [host, skillStartRow(out, host)]));
  const images = imageReport(out, JSON.parse(readFileSync(join(HERE, 'gstack-runtime.json'), 'utf8')).bun.version as string);
  const agentsRc = flag('--agents-rc');
  const agents = agentsRun(join(out, 'agents'), agentsRc === undefined || !agentsRc.trim() ? null : Number(agentsRc), prereg.cells.map((c) => c.id));
  const reasons = checkReasons(agents, cells as Record<string, { pass: boolean }>, skillStart, images, flag('--images') === 'none' ? 'none' : 'all');
  const report = {
    schema: 'frontier-harbor-gstack-check/1',
    gstack_pin: JSON.parse(readFileSync(join(HERE, 'install-check-gstack-prereg.json'), 'utf8')).gstack_pin,
    agents,
    cells, skill_start: skillStart, images,
    reasons,
    pass: !reasons.length,
  };
  writeFileSync(join(out, 'gstack-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, (v as { pass: boolean }).pass])), skill_start: Object.fromEntries(Object.entries(skillStart).map(([k, v]) => [k, (v as { pass: boolean }).pass])), images: images ? (images as { pass: boolean }).pass : null, reasons, pass: report.pass }));
  process.exit(report.pass ? 0 : 1);
}
