#!/usr/bin/env bun
// The gbrain arm's build (internal-task plan, "Arms" item 3): gbrain's newest release installed in the task image at build
// time, an empty keyless brain (gbrain init --pglite --no-embedding) with a small synthetic page set, the logging relay
// (gbrain-relay.ts) in front of gbrain serve, and one cell per tool surface at the 150 rung:
//   full        gbrain serve --surface full
//   starter     gbrain serve --surface starter
//   verbs       gbrain serve --surface full --advertise verbs
//   registered  the surface `gbrain setup claude-code` registers on this release (its --dry-run --json target), served
//               the same way through the relay. Setup also writes hooks and a CLAUDE.md block, which this cell does not
//               install; the dry-run record is kept beside the tool lists. gbrain has setup only for claude-code and codex.
// The image records gbrain's version, the release tag and commit, the setup dry-runs and every cell's tools/list.
//
//   bun scripts/mcp-at-scale/gbrain.ts build --out <dir> [--tag v0.60.743.0]
// writes <dir>/gbrain-image/ (the build context), builds it, and writes <dir>/gbrain-image.json (version, release, setup
// dry-runs, per-cell serve flags, tool counts and hashes) and <dir>/gbrain-tools-<cell>.json (each cell's tools/list).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUN_IMAGE, MAIN_IMAGE, treeSha256 } from './materialize.ts';

const HERE = import.meta.dir;
export const GBRAIN_REPO = 'https://github.com/garrytan/gbrain.git';
export const GBRAIN_HOME = '/srv/gbrain';
export const GBRAIN_DIR = '/opt/he-gbrain';
export const GBRAIN_EVIDENCE = '/he-gbrain-evidence';
export const GBRAIN_LOG = GBRAIN_EVIDENCE + '/calls.jsonl';
export const GBRAIN_SOCKET = GBRAIN_EVIDENCE + '/mcp.sock';
export const SETUP_HARNESSES = ['claude-code', 'codex'] as const;
export const FORCED_CELLS: Record<string, string[]> = {
  full: ['--surface', 'full'],
  starter: ['--surface', 'starter'],
  verbs: ['--surface', 'full', '--advertise', 'verbs'],
};
export type GbrainCell = 'full' | 'starter' | 'verbs' | 'registered';
export const GBRAIN_CELLS: GbrainCell[] = ['full', 'starter', 'verbs', 'registered'];

const versionKey = (t: string) => t.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
const byVersion = (a: string, b: string) => { const x = versionKey(a), y = versionKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };

/** The newest v-tag in gbrain's repository and its commit (git ls-remote; peeled tags win). */
export function newestRelease(lsRemote?: string): { tag: string; commit: string } {
  const text = lsRemote ?? Bun.spawnSync(['git', 'ls-remote', '--tags', GBRAIN_REPO], { stdout: 'pipe', stderr: 'pipe' }).stdout.toString();
  const commits = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(v\d+(?:\.\d+)*)(\^\{\})?$/.exec(line.trim());
    if (m && (m[3] || !commits.has(m[2]!))) commits.set(m[2]!, m[1]!);
  }
  const tags = [...commits.keys()].sort(byVersion);
  if (!tags.length) throw new Error('HE-MCP-020 no release tag found in ' + GBRAIN_REPO);
  const tag = tags[tags.length - 1]!;
  return { tag, commit: commits.get(tag)! };
}

/** A small public-safe synthetic brain: a made-up company, its people, projects and meetings. */
export function syntheticPages(): Record<string, string> {
  const page = (title: string, type: string, body: string) => '---\ntitle: ' + title + '\ntype: ' + type + '\n---\n\n# ' + title + '\n\n' + body.trim() + '\n';
  return {
    'companies/heronworks.md': page('Heronworks', 'company', 'Heronworks makes warehouse sorting robots. Founded 2021 in Rotterdam. About 40 staff. Customers include [[companies/kestrel-freight]].'),
    'companies/kestrel-freight.md': page('Kestrel Freight', 'company', 'Kestrel Freight runs three distribution centres and pilots Heronworks sorters at its Utrecht site.'),
    'people/mira-solberg.md': page('Mira Solberg', 'person', 'CEO of [[companies/heronworks]]. Prefers written updates on Fridays. Owns the Series A plan.'),
    'people/tomas-ekwueme.md': page('Tomas Ekwueme', 'person', 'Head of engineering at [[companies/heronworks]]. Leads [[projects/sorter-v3]]. Allergic to peanuts; order lunch accordingly.'),
    'people/ana-ruiz.md': page('Ana Ruiz', 'person', 'Operations lead at [[companies/kestrel-freight]]. Main contact for the Utrecht pilot.'),
    'projects/sorter-v3.md': page('Sorter v3', 'project', 'Third-generation sorting arm. Target: 1,200 parcels an hour. Status: field trial at Utrecht since 2026-09-14. Blocker: gripper wear after 300 hours.'),
    'projects/series-a.md': page('Series A plan', 'project', 'Raise 12 million euros by March 2027. Lead investor shortlist: Gannet Capital, Plover Partners. Owner: [[people/mira-solberg]].'),
    'meetings/2026-10-02-utrecht-pilot-review.md': page('Utrecht pilot review, 2026-10-02', 'meeting', 'Attendees: [[people/ana-ruiz]], [[people/tomas-ekwueme]]. Throughput reached 950 parcels an hour. Decision: replace grippers every 250 hours until v3.1. Next review 2026-11-06.'),
    'meetings/2026-10-20-board-prep.md': page('Board prep, 2026-10-20', 'meeting', 'Attendees: [[people/mira-solberg]]. Agreed to show the Utrecht numbers at the November board meeting.'),
    'notes/office-wifi.md': page('Office wifi', 'note', 'The guest network is called heron-guest. Ask reception for the weekly code.'),
  };
}

/** The serve flags a gbrain setup --dry-run --json record registers (target.surface and target.advertise). */
export function setupServeArgs(setup: { target?: { surface?: string; advertise?: string | null } }): string[] {
  const t = setup.target;
  if (!t?.surface) throw new Error('HE-MCP-023 the gbrain setup dry-run names no surface');
  return ['--surface', t.surface, ...(t.advertise ? ['--advertise', t.advertise] : [])];
}

/** The harness sees stdio; only the networkless sidecar owns the real relay and its output. */
export function relayCommand(): { command: string; args: string[] } {
  return { command: '/usr/local/bin/bun', args: [GBRAIN_DIR + '/relay.js', '--connect', GBRAIN_SOCKET] };
}

export function relaySidecar(image: string, serveArgs: string[], trial: string) {
  return {
    image,
    pull_policy: 'never',
    network_mode: 'none',
    volumes: ['gbrain-evidence:' + GBRAIN_EVIDENCE],
    command: ['/usr/local/bin/bun', GBRAIN_DIR + '/relay.js', '--listen', GBRAIN_SOCKET, '--log', GBRAIN_LOG,
      '--trial', trial, '--env', 'GBRAIN_HOME=' + GBRAIN_HOME, '--', GBRAIN_DIR + '/bun/bin/gbrain', 'serve', ...serveArgs],
    healthcheck: { test: ['CMD', 'test', '-S', GBRAIN_SOCKET], interval: '1s', timeout: '2s', retries: 30 },
  };
}

/** The task image's build context: gbrain at the release, the brain, the relay, the tool-list dumps. */
export async function writeGbrainImage(out: string, release: { tag: string; commit: string }): Promise<{ dir: string; tag: string; sha256: string }> {
  const dir = join(out, 'gbrain-image');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'pages'), { recursive: true });
  const built = await Bun.build({ entrypoints: [join(HERE, 'gbrain-relay.ts')], target: 'bun', minify: false });
  if (!built.success) throw new Error('HE-MCP-021 bundling gbrain-relay.ts failed: ' + built.logs.map(String).join('; '));
  writeFileSync(join(dir, 'relay.js'), await built.outputs[0]!.text());
  for (const [p, body] of Object.entries(syntheticPages())) { mkdirSync(join(dir, 'pages', p, '..'), { recursive: true }); writeFileSync(join(dir, 'pages', p), body); }
  const g = GBRAIN_DIR + '/bun/bin/gbrain';
  const dump = (cell: string, args: string[]) => 'bun ' + GBRAIN_DIR + '/relay.js --dump ' + GBRAIN_DIR + '/tools-' + cell + '.json --env GBRAIN_HOME=' + GBRAIN_HOME + ' -- ' + g + ' serve ' + args.join(' ');
  writeFileSync(join(dir, 'Dockerfile'), [
    'FROM ' + BUN_IMAGE + ' AS bun',
    'FROM ' + MAIN_IMAGE,
    'COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun',
    'ENV BUN_INSTALL=' + GBRAIN_DIR + '/bun',
    'RUN mkdir -p ' + GBRAIN_DIR + ' && bun install -g github:garrytan/gbrain#' + release.tag + ' && ln -s ' + g + ' /usr/local/bin/gbrain && ' + g + ' --version > ' + GBRAIN_DIR + '/version.txt'
      + " && echo '" + JSON.stringify(release) + "' > " + GBRAIN_DIR + '/release.json',
    'COPY relay.js ' + GBRAIN_DIR + '/relay.js',
    'COPY pages ' + GBRAIN_DIR + '/pages',
    'RUN mkdir -p ' + GBRAIN_HOME + ' && GBRAIN_HOME=' + GBRAIN_HOME + ' ' + g + ' init --pglite --no-embedding --non-interactive --json > ' + GBRAIN_DIR + '/init.json'
      + ' && GBRAIN_HOME=' + GBRAIN_HOME + ' ' + g + ' import ' + GBRAIN_DIR + '/pages --no-embed --allow-noncanonical-root --json > ' + GBRAIN_DIR + '/import.json',
    ...SETUP_HARNESSES.map((h) => 'RUN mkdir -p /tmp/he-setup-' + h + ' && HOME=/tmp/he-setup-' + h + ' GBRAIN_HOME=' + GBRAIN_HOME + ' ' + g + ' setup ' + h + ' --gbrain-bin ' + g + ' --dry-run --json > ' + GBRAIN_DIR + '/setup-' + h + '.json; rm -rf /tmp/he-setup-' + h),
    ...Object.entries(FORCED_CELLS).map(([cell, args]) => 'RUN ' + dump(cell, args)),
    'RUN bun ' + GBRAIN_DIR + '/relay.js --dump ' + GBRAIN_DIR + '/tools-registered.json --args-from ' + GBRAIN_DIR + '/setup-claude-code.json --env GBRAIN_HOME=' + GBRAIN_HOME + ' -- ' + g + ' serve',
    'WORKDIR /app',
    '',
  ].join('\n'));
  const sha256 = treeSha256(dir);
  return { dir, tag: 'he-mcp-gbrain:' + release.tag.replace(/^v/, '') + '-' + sha256.slice(0, 12), sha256 };
}

/** What the built image recorded: gbrain's version, the release, the setup dry-runs and every cell's serve args and tools/list. */
export function readGbrainImage(tag: string): Record<string, any> {
  const cat = (f: string) => { const p = Bun.spawnSync(['docker', 'run', '--rm', '--entrypoint', 'cat', tag, GBRAIN_DIR + '/' + f], { stdout: 'pipe', stderr: 'pipe' }); if (p.exitCode !== 0) throw new Error('HE-MCP-022 reading ' + f + ' from ' + tag + ' failed: ' + p.stderr.toString().slice(-300)); return p.stdout.toString(); };
  const registered = setupServeArgs(JSON.parse(cat('setup-claude-code.json')));
  const cells: Record<string, any> = {};
  for (const cell of GBRAIN_CELLS) {
    const d = JSON.parse(cat('tools-' + cell + '.json'));
    cells[cell] = { serve_args: cell === 'registered' ? registered : FORCED_CELLS[cell], tools: d.tools.length, tools_chars: JSON.stringify(d.tools).length, instructions_chars: (d.instructions ?? '').length, tools_sha256: new Bun.CryptoHasher('sha256').update(JSON.stringify(d.tools)).digest('hex'), dump: d };
  }
  return { tag, version: cat('version.txt').trim(), release: JSON.parse(cat('release.json')), setup: Object.fromEntries(SETUP_HARNESSES.map((h) => [h, JSON.parse(cat('setup-' + h + '.json'))])), import: cat('import.json').trim().split('\n').pop(), cells };
}

/** Builds the gbrain task image and writes what it recorded next to it. */
export async function buildGbrain(out: string, tag?: string): Promise<Record<string, any>> {
  const release = tag ? newestRelease(Bun.spawnSync(['git', 'ls-remote', '--tags', GBRAIN_REPO], { stdout: 'pipe' }).stdout.toString().split('\n').filter((l) => l.includes('refs/tags/' + tag)).join('\n')) : newestRelease();
  mkdirSync(out, { recursive: true });
  const image = await writeGbrainImage(out, release);
  const p = Bun.spawnSync(['docker', 'build', '-q', '-t', image.tag, image.dir], { stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error('HE-MCP-021 docker build of the gbrain image failed: ' + p.stderr.toString().slice(-1500));
  const rec = readGbrainImage(image.tag);
  for (const [cell, c] of Object.entries(rec.cells as Record<string, any>)) { writeFileSync(join(out, 'gbrain-tools-' + cell + '.json'), JSON.stringify(c.dump, null, 1) + '\n'); delete c.dump; }
  const summary = { ...rec, context_sha256: image.sha256 };
  writeFileSync(join(out, 'gbrain-image.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const out = flag('--out');
  if (argv[0] !== 'build' || !out) { console.error('usage: gbrain.ts build --out <dir> [--tag vX.Y.Z]'); process.exit(2); }
  const s = await buildGbrain(out, flag('--tag'));
  console.log(JSON.stringify({ tag: s.tag, version: s.version, release: s.release, cells: Object.fromEntries(Object.entries(s.cells as Record<string, any>).map(([k, v]) => [k, { serve_args: v.serve_args, tools: v.tools, tools_chars: v.tools_chars, instructions_chars: v.instructions_chars }])) }));
}
