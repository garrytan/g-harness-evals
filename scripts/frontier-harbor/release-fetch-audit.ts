#!/usr/bin/env bun
// The registry-release contamination count of fable-diagnosis-2026-11 (PREREGISTRATION.md, Contamination guard, as
// widened by amendments/2026-11-15-contamination-rule.md): a trial counts when it fetched the task repository's own
// code, package, release or tag at any ref other than the task's base commit, from any host.
//
//   bun scripts/frontier-harbor/release-fetch-audit.ts --trials <trials.jsonl> --trajectories <root> [--dataset <dir>]
//       --out <dir>
//
// <root>/<shard>/results/trials/<cell>/<task>/<a1|a2>/harbor/agent/trajectory.json is each trial's Harbor ATIF
// trajectory (shard is the cell's sNN suffix). Egress and proxy logs were not kept per trial, so the transcript is the
// only source: every tool call that runs a command (Bash, Monitor) or fetches a URL (a web tool), and its result.
// --dataset is the Harbor copy of the tasks (swe_rebench_fetch.py fetch output); only <task>/tests/config.json's repo and
// base_commit are read. Without it the repository comes from the task id and no base-commit ref is exempt.
//
// The task's identities: its GitHub owner/repo (dataset or task id), other GitHub names its git remotes point at
// ("git remote -v" output in any trial of the task), package names from manifests an agent printed in any trial of the
// task (go.mod module, package.json name, Cargo.toml and pyproject.toml name, pom.xml groupId:artifactId), and the repo
// name itself as a package name. Each identity keeps where it came from.
//
// A call is a hit when it addresses one of those identities through a fetch route: git clone/fetch/pull/ls-remote/
// submodule of the upstream or of a remote pointing at it; a GitHub, jsDelivr, unpkg, esm.sh, Go module proxy, npm, PyPI,
// crates.io or Maven Central URL; go get/mod download/install of the module at a version, go list -m -versions;
// npm/pnpm/yarn/bun add/install/view/pack (npx/dlx only with a version); pip/uv install/download/index; cargo
// add/install/search/info; mvn dependency:get; gh repo/api/release/search. A hit is "code" when the route would deliver
// code (a clone, an archive, a package file, a raw file, a code search) and "metadata" when it lists refs or versions or
// probes the upstream. Its outcome comes from the call's result: succeeded, failed or unclear. A trial is "fetched" when a
// code hit succeeded, "attempted" when it has any other hit, "none" otherwise. Issue and pull request searches on the
// repo are recorded as "discussion" and never flag a trial. Builds of the local checkout and installs of other packages
// name no identity, so they are not hits.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Call { id: string; tool: string; text: string; file?: string; result: string | null }
export type Kind = 'code' | 'metadata' | 'discussion';
export type Outcome = 'succeeded' | 'failed' | 'unclear';
export interface Hit { call_id: string; route: string; kind: Kind; outcome: Outcome; identity: string; identity_source: string; evidence: string }
export type Flag = 'fetched' | 'attempted' | 'none';
export type Bucket = 'github' | 'go' | 'npm' | 'pypi' | 'crate' | 'maven';
export interface Identities { repo: string; base_commit: string | null; repo_source: string; names: Record<Bucket, Record<string, string>>; remotes: Record<string, string> }
interface Match { route: string; kind: Kind; identity: string; index: number }

const EVIDENCE_CHARS = 200;
const BT = '\u0060';
const MANIFESTS = /(^|[\s/'"])(go\.mod|package\.json|Cargo\.toml|pyproject\.toml|setup\.cfg|pom\.xml)\b/;
const VENDORED = /node_modules|\.cargo\/registry|site-packages|pkg\/mod|\.m2\/repository|\/tmp\//;
const URL_FETCH = /\b(curl|wget|aria2c|git\s+(clone|fetch|pull|ls-remote|submodule)|gh\s+api|urlopen|urlretrieve|requests\.(get|head)|httpx\.(get|stream)|https?\.get)\b|\bfetch\(/;
const URL_LINE = /\n|;|&&|\|\|/;
const WEB_TOOL = /(web|fetch_url|^fetch$|url_fetch|read_url|brows)/i;
const URL_RE = /https?:\/\/[^\s'"<>)|;\\\u0060]+/g;
const SEP = /;|&&|\|\||\||\n|\$\(|\u0060|\(|\)/;

// ---- reading a trajectory

export function readCalls(trajectory: any): Call[] {
  const results = new Map<string, string>();
  for (const s of trajectory?.steps ?? []) for (const r of s?.observation?.results ?? []) {
    const c = r?.content;
    results.set(r?.source_call_id, typeof c === 'string' ? c : JSON.stringify(c ?? ''));
  }
  const calls: Call[] = [];
  for (const s of trajectory?.steps ?? []) for (const c of s?.tool_calls ?? []) {
    const a = c?.arguments ?? {};
    const tool = String(c?.function_name ?? '');
    const text = typeof a.command === 'string' ? a.command : typeof a.url === 'string' ? a.url : WEB_TOOL.test(tool) ? JSON.stringify(a) : '';
    calls.push({ id: String(c?.tool_call_id ?? ''), tool, text, file: typeof a.file_path === 'string' ? a.file_path : undefined, result: results.get(c?.tool_call_id) ?? null });
  }
  return calls;
}

// ---- identities

export const pypiNorm = (n: string) => n.toLowerCase().replace(/[-_.]+/g, '-');

export function repoFromTask(task: string): string {
  const [owner, rest] = task.split('__');
  return owner + '/' + rest.replace(/-\d+$/, '');
}

export function baseIdentities(task: string, config: { repo?: string; base_commit?: string } | null): Identities {
  const repo = config?.repo ?? repoFromTask(task);
  const source = config?.repo ? 'Harbor dataset tests/config.json' : 'task id';
  const name = repo.split('/')[1].toLowerCase();
  const guess = 'repo name';
  return {
    repo, base_commit: config?.base_commit?.toLowerCase() ?? null, repo_source: source,
    names: { github: { [repo.toLowerCase()]: source }, go: { ['github.com/' + repo.toLowerCase()]: 'repo URL' }, npm: { [name]: guess }, pypi: { [pypiNorm(name)]: guess }, crate: { [name]: guess }, maven: {} },
    remotes: {},
  };
}

const stripLineNo = (l: string) => l.replace(/^\s*\d+(→|\t|:|-)\s?/, '');

export function githubRepo(url: string): string | null {
  const m = url.match(/^(?:git\+)?(?:https?:\/\/|git@|ssh:\/\/git@|git:\/\/)(?:www\.)?github\.com[/:]([\w.\-]+)\/([\w.\-]+?)(?:\.git)?(?:[/?#]|$)/i);
  return m ? (m[1] + '/' + m[2]).toLowerCase() : null;
}

// Adds what one trial's transcript says about its task's identities: manifests the agent printed, remotes it listed.
export function addTranscriptIdentities(ids: Identities, calls: Call[], trialId: string): void {
  const repoName = ids.repo.split('/')[1].toLowerCase();
  const put = (bucket: Bucket, name: string, src: string) => {
    const key = bucket === 'pypi' ? pypiNorm(name) : bucket === 'maven' ? name : name.toLowerCase();
    const old = ids.names[bucket][key];
    if (!old || old === 'repo name') ids.names[bucket][key] = src;
  };
  for (const c of calls) {
    if (!c.result) continue;
    const lines = c.result.split('\n').map(stripLineNo);
    if (/git\s+remote\s+-v/.test(c.text)) for (const l of lines) {
      const m = l.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
      const gh = m ? githubRepo(m[2]) : null;
      if (m && gh && gh.split('/')[1] === repoName) { ids.remotes[m[1]] = gh; put('github', gh, 'transcript ' + trialId + ': git remote -v'); }
    }
    const target = c.tool === 'Read' ? c.file ?? '' : c.text;
    if (!MANIFESTS.test(target) || VENDORED.test(target)) continue;
    const src = (f: string) => 'transcript ' + trialId + ': ' + f;
    const body = lines.join('\n');
    if (/go\.mod/.test(target)) for (const m of body.matchAll(/^module\s+(\S+)/gm)) put('go', m[1], src('go.mod'));
    if (/package\.json/.test(target)) for (const m of body.matchAll(/^\s{0,2}"name"\s*:\s*"(@?[a-z0-9][\w.\-]*(?:\/[\w.\-]+)?)"/gm)) put('npm', m[1], src('package.json'));
    if (/Cargo\.toml/.test(target)) for (const m of body.matchAll(/^\[package\][^\[]*?^name\s*=\s*"([^"]+)"/gms)) put('crate', m[1], src('Cargo.toml'));
    if (/pyproject\.toml|setup\.cfg/.test(target)) for (const m of body.matchAll(/^\[(?:project|tool\.poetry|metadata)\][^\[]*?^name\s*=\s*"?([A-Za-z0-9._-]+)"?/gms)) put('pypi', m[1], src(/pyproject/.test(target) ? 'pyproject.toml' : 'setup.cfg'));
    if (/pom\.xml/.test(target)) {
      const own = body.replace(/<(parent|dependency|plugin|exclusion|extension)>[\s\S]*?<\/\1>/g, '');
      const g = own.match(/<groupId>\s*([\w.\-]+)\s*<\/groupId>/)?.[1] ?? body.match(/<parent>[\s\S]*?<groupId>\s*([\w.\-]+)\s*<\/groupId>/)?.[1];
      if (g) for (const m of own.matchAll(/<artifactId>\s*([\w.\-]+)\s*<\/artifactId>/g)) put('maven', g + ':' + m[1], src('pom.xml'));
    }
  }
}

// ---- routes

function npmName(spec: string): string | null {
  const m = spec.match(/^(@[\w.\-]+\/[\w.\-]+|[\w.\-]+)(?:@[^/]*)?/);
  return m ? m[1].toLowerCase() : null;
}

function goIdentity(mod: string, ids: Identities): string | null {
  const m = mod.toLowerCase();
  for (const id of Object.keys(ids.names.go)) if (m === id.toLowerCase() || m.startsWith(id.toLowerCase() + '/')) return id;
  for (const r of Object.keys(ids.names.github)) if (m === 'github.com/' + r || m.startsWith('github.com/' + r + '/')) return 'github.com/' + r;
  return null;
}

function segmentAt(text: string, index: number): string {
  const before = text.slice(0, index).split(SEP);
  const after = text.slice(index).split(SEP);
  return before[before.length - 1] + after[0];
}

function urlMatch(url: string, ids: Identities, segment: string): Omit<Match, 'index'> | null {
  let u: URL;
  try { u = new URL(url.replace(/\$\{?\w+\}?/g, 'x')); } catch { return null; }
  const host = u.hostname.toLowerCase(), path = decodeURIComponent(u.pathname), parts = path.split('/').filter(Boolean);
  const gh = (o: string, r: string) => { const k = (o + '/' + r.replace(/\.git$/, '')).toLowerCase(); return ids.names.github[k] !== undefined ? k : null; };
  const git = segment.match(/\bgit\s+(clone|fetch|pull|ls-remote|submodule)\b/)?.[1];
  if (host === 'github.com' || host === 'www.github.com') {
    const r = parts.length >= 2 ? gh(parts[0], parts[1]) : null;
    if (!r) return null;
    if (git) return { route: 'git ' + git, kind: git === 'ls-remote' ? 'metadata' : 'code', identity: r };
    const code = /^(archive|raw|blob|tree|commit|compare|zipball|tarball)$/.test(parts[2] ?? '') || (parts[2] === 'releases' && parts[3] === 'download');
    return { route: 'github.com', kind: code ? 'code' : /^(issues|pulls|pull)$/.test(parts[2] ?? '') ? 'discussion' : 'metadata', identity: r };
  }
  if (host === 'raw.githubusercontent.com' || host === 'codeload.github.com' || host === 'objects.githubusercontent.com') {
    const r = parts.length >= 2 ? gh(parts[0], parts[1]) : null;
    return r ? { route: host, kind: 'code', identity: r } : null;
  }
  if (host === 'api.github.com') {
    const inQuery = decodeURIComponent(u.search).match(/repo:([\w.\-]+)\/([\w.\-]+)/);
    if (parts[0] === 'search' && inQuery) {
      const r = gh(inQuery[1], inQuery[2]);
      return r ? { route: 'api.github.com/search/' + parts[1], kind: parts[1] === 'code' ? 'code' : 'discussion', identity: r } : null;
    }
    if (parts[0] !== 'repos' || parts.length < 3) return null;
    const r = gh(parts[1], parts[2]);
    if (!r) return null;
    const sub = parts[3] ?? '';
    const kind: Kind = /^(contents|tarball|zipball|git|compare)$/.test(sub) || (sub === 'commits' && parts.length > 4) ? 'code' : /^(issues|pulls)$/.test(sub) ? 'discussion' : 'metadata';
    return { route: 'api.github.com/repos', kind, identity: r };
  }
  if (host === 'cdn.jsdelivr.net' || host === 'data.jsdelivr.com') {
    const i = parts.indexOf('gh'), n = parts.indexOf('npm');
    const kind: Kind = host === 'cdn.jsdelivr.net' ? 'code' : 'metadata';
    if (i >= 0 && parts.length > i + 2) { const r = gh(parts[i + 1], parts[i + 2].split('@')[0]); return r ? { route: host + '/gh', kind, identity: r } : null; }
    const name = n >= 0 ? npmName(parts.slice(n + 1).join('/')) : null;
    return name && ids.names.npm[name] !== undefined ? { route: host + '/npm', kind, identity: name } : null;
  }
  if (host === 'unpkg.com' || host === 'esm.sh' || host === 'cdn.skypack.dev') {
    const name = npmName(parts.join('/'));
    return name && ids.names.npm[name] !== undefined ? { route: host, kind: 'code', identity: name } : null;
  }
  if (host === 'registry.npmjs.org' || host === 'registry.yarnpkg.com') {
    const name = npmName(parts.join('/'));
    return name && ids.names.npm[name] !== undefined ? { route: host, kind: path.includes('/-/') ? 'code' : 'metadata', identity: name } : null;
  }
  if (/^(proxy\.golang\.org|goproxy\.io|goproxy\.cn|sum\.golang\.org|pkg\.go\.dev)$/.test(host)) {
    const id = goIdentity(path.replace(/^\/(lookup\/)?/, '').split('/@')[0].split('@')[0], ids);
    return id ? { route: host, kind: /\/@v\/[^/]+\.(zip|mod)$/.test(path) ? 'code' : 'metadata', identity: id } : null;
  }
  if (host === 'pypi.org') {
    const name = /^(pypi|simple|project)$/.test(parts[0] ?? '') ? parts[1] : null;
    return name && ids.names.pypi[pypiNorm(name)] !== undefined ? { route: host, kind: 'metadata', identity: pypiNorm(name) } : null;
  }
  if (host === 'files.pythonhosted.org') {
    const name = (parts[parts.length - 1] ?? '').match(/^([A-Za-z0-9._]+?)-\d/)?.[1];
    return name && ids.names.pypi[pypiNorm(name)] !== undefined ? { route: host, kind: 'code', identity: pypiNorm(name) } : null;
  }
  if (host === 'crates.io' || host === 'static.crates.io' || host === 'index.crates.io') {
    const name = (host === 'crates.io' ? (parts[0] === 'api' ? parts[3] : parts[1]) : host === 'static.crates.io' ? parts[1] : parts[parts.length - 1])?.toLowerCase();
    if (!name || ids.names.crate[name] === undefined) return null;
    return { route: host, kind: host === 'static.crates.io' || path.endsWith('/download') ? 'code' : 'metadata', identity: name };
  }
  if (/^(repo1\.maven\.org|repo\.maven\.apache\.org|central\.sonatype\.com|search\.maven\.org)$/.test(host)) {
    const p = path.replace(/^\/maven2\//, '');
    for (const ga of Object.keys(ids.names.maven)) {
      const [g, a] = ga.split(':');
      if (p.startsWith(g.replace(/\./g, '/') + '/' + a + '/')) return { route: host, kind: /\.(jar|pom|zip|tar\.gz)$/.test(p) ? 'code' : 'metadata', identity: ga };
    }
  }
  return null;
}

function commandMatches(segment: string, ids: Identities): Omit<Match, 'index'>[] {
  const out: Omit<Match, 'index'>[] = [];
  const w = segment.trim().split(/\s+/).map((x) => x.replace(/^['"]|['"]$/g, ''));
  const args = (from: number, valued: RegExp = /^$/) => {
    const r: string[] = [];
    for (let i = from; i < w.length; i++) { if (w[i].startsWith('-')) { if (valued.test(w[i])) i++; continue; } r.push(w[i]); }
    return r;
  };
  for (let i = 0; i < w.length; i++) {
    const v = w[i], next = w[i + 1] ?? '';
    if (v === 'git' && /^(clone|fetch|pull|ls-remote|submodule)$/.test(next)) {
      const rest = args(i + 2, /^(-b|--branch|--depth|--filter|-o|--origin|--reference|-c|--config)$/);
      const urlRepo = rest.map(githubRepo).find((r) => r && ids.names.github[r] !== undefined);
      const named = /^(fetch|pull|ls-remote)$/.test(next) ? rest.find((r) => ids.remotes[r] || /^(origin|upstream)$/.test(r)) ?? (rest.length === 0 ? 'origin' : undefined) : undefined;
      const kind: Kind = next === 'ls-remote' ? 'metadata' : 'code';
      if (urlRepo) out.push({ route: 'git ' + next, kind, identity: urlRepo });
      else if (named) out.push({ route: 'git ' + next + ' ' + named, kind, identity: ids.remotes[named] ?? ids.repo.toLowerCase() });
    }
    if (v === 'go' && (next === 'get' || next === 'install' || (next === 'mod' && w[i + 2] === 'download') || (next === 'list' && w.includes('-m')))) {
      const versions = next === 'list' && (w.includes('-versions') || w.includes('-u'));
      for (const a of args(i + (next === 'mod' ? 3 : 2), /^(-f|-mod|-modfile)$/)) {
        const id = goIdentity(a.split('@')[0], ids);
        if (!id || ((next === 'install' || next === 'list') && !a.includes('@') && !versions)) continue;
        out.push({ route: 'go ' + (next === 'mod' ? 'mod download' : next), kind: next === 'list' ? 'metadata' : 'code', identity: id });
      }
    }
    if (/^(npm|pnpm|yarn|bun|npx)$/.test(v)) {
      const verb = v === 'npx' ? 'exec' : next;
      const kind: Kind | null = /^(view|info|show|v)$/.test(verb) ? 'metadata' : /^(install|i|add|pack|exec|dlx|x|create)$/.test(verb) ? 'code' : null;
      if (kind) for (const a of args(v === 'npx' ? i + 1 : i + 2, /^(--registry|--prefix|-C|--dir|--filter|-w|--workspace|-p|--package)$/)) {
        if (/^[./~]/.test(a) || (/^(exec|dlx|x|create)$/.test(verb) && !/.@\d/.test(a))) continue;
        const name = npmName(a);
        if (name && ids.names.npm[name] !== undefined) out.push({ route: v + ' ' + verb, kind, identity: name });
      }
    }
    const pipAt = /^pip3?$/.test(v) ? i + 1 : (v === 'uv' && next === 'pip') || (v === '-m' && /^pip3?$/.test(next)) ? i + 2 : v === 'uv' && next === 'add' ? i + 1 : -1;
    if (pipAt > 0) {
      const verb = w[pipAt] ?? '';
      const kind: Kind | null = /^(install|download|add)$/.test(verb) ? 'code' : verb === 'index' ? 'metadata' : null;
      if (kind) for (const a of args(pipAt + (verb === 'index' ? 2 : 1), /^(-d|--dest|-r|--requirement|-c|--constraint|-i|--index-url|--extra-index-url|-t|--target|--python|--platform|--python-version|--only-binary|--no-binary|-f|--find-links|-e|--editable|--group|--extra)$/)) {
        if (/^[./~]/.test(a) || a.includes('/')) continue;
        const name = a.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
        const route = (v === '-m' ? 'python -m pip' : v === 'uv' ? 'uv ' + next : v) + (verb === 'add' ? '' : ' ' + verb);
        if (name && ids.names.pypi[pypiNorm(name)] !== undefined) out.push({ route, kind, identity: pypiNorm(name) });
      }
    }
    if (v === 'cargo' && /^(add|install|search|info)$/.test(next)) {
      for (const a of args(i + 2, /^(--git|--branch|--tag|--rev|--path|--root|--registry|--features|-F|--manifest-path|--limit|-p|--package)$/)) {
        const name = a.split('@')[0].toLowerCase();
        if (ids.names.crate[name] !== undefined) out.push({ route: 'cargo ' + next, kind: /^(add|install)$/.test(next) ? 'code' : 'metadata', identity: name });
      }
    }
    if (v === 'mvn' || v === './mvnw') {
      const art = segment.match(/-Dartifact=([\w.\-]+):([\w.\-]+)/);
      if (art && /dependency:(get|copy|unpack)/.test(segment) && ids.names.maven[art[1] + ':' + art[2]] !== undefined) out.push({ route: 'mvn dependency:get', kind: 'code', identity: art[1] + ':' + art[2] });
    }
    if (v === 'gh' && /^(repo|api|release|search)$/.test(next)) {
      const m = segment.match(/(?:repos\/|--repo[ =]|-R[ =]?|clone\s+|repo:)([\w.\-]+)\/([\w.\-]+)/);
      const r = m ? (m[1] + '/' + m[2]).toLowerCase() : null;
      if (r && ids.names.github[r] !== undefined) {
        const sub = w[i + 2] ?? '';
        const kind: Kind = next === 'search' ? (sub === 'code' ? 'code' : 'discussion') : next === 'repo' ? (sub === 'clone' ? 'code' : 'metadata') : next === 'release' ? (sub === 'download' ? 'code' : 'metadata')
          : /\/(contents|tarball|zipball|git|compare)\b/.test(segment) ? 'code' : /\/(issues|pulls)\b/.test(segment) ? 'discussion' : 'metadata';
        out.push({ route: 'gh ' + next, kind, identity: r });
      }
    }
  }
  return out;
}

export function scanCall(call: Call, ids: Identities): Match[] {
  const text = call.text;
  if (!text) return [];
  const out: Match[] = [];
  const web = WEB_TOOL.test(call.tool);
  if (web || URL_FETCH.test(text)) for (const m of text.matchAll(URL_RE)) {
    const shas = m[0].toLowerCase().match(/[0-9a-f]{7,40}/g) ?? [];
    if (ids.base_commit && shas.some((s) => ids.base_commit!.startsWith(s))) continue;
    const before = text.slice(0, m.index).split(URL_LINE), line = before[before.length - 1] + text.slice(m.index).split(URL_LINE)[0];
    if (!web && !URL_FETCH.test(line) && !/^\s*(export\s+)?\w+=|^\s*for\s+\w+\s+in\b/.test(before[before.length - 1])) continue;
    const hit = urlMatch(m[0], ids, segmentAt(text, m.index ?? 0));
    if (hit) out.push({ ...hit, index: m.index ?? 0 });
  }
  const urlHits = [...out];
  let offset = 0;
  for (const seg of text.split(SEP)) {
    const at = text.indexOf(seg, offset);
    if (seg.trim()) for (const h of commandMatches(seg, ids)) {
      if (!urlHits.some((u) => u.identity === h.identity && u.index >= at && u.index < at + seg.length)) out.push({ ...h, index: at });
    }
    offset = at + seg.length;
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---- outcome

const FAIL = /Could not resolve host|Temporary failure in name resolution|SSL_ERROR_SYSCALL|gnutls_handshake|unable to access|Connection (refused|reset|timed out)|Failed to connect|curl: \(\d+\)|\b403\b|Forbidden|\b404\b|Not Found|No matching distribution|Could not find a version|E404|not in this registry|does not appear to be a git repository|Could not read from remote|unknown revision|no matching versions|invalid version|command not found|failed to run command|dial tcp|i\/o timeout|proxyconnect|blocked|denied|(^|\s)000(\s|$)/im;

// A download whose command then opens the artifact (unzip, zipfile, tar, diff) and whose result shows output and no
// download or archive error got the artifact even when the download step printed nothing (pip -q, curl -s).
const ARTIFACT_FAIL = /^ERROR:|No matching distribution|Could not find a version|curl: \(\d+\)|cannot find or open|End-of-central-directory|not a zip file|BadZipFile|^IndexError|No such file or directory|gzip: stdin/m;

export function outcomeOf(route: string, kind: Kind, identity: string, result: string | null, command = ''): Outcome {
  if (result === null || /moved to the background/.test(result)) return 'unclear';
  const r = result;
  const pkg = identity.split(/[/:]/).pop()!.replace(/[-_.]+/g, '[-_.]');
  const pkgFile = new RegExp('\\b' + pkg + '-v?\\d[\\w.+-]*\\.(whl|tar\\.gz|tgz|zip|crate|jar)\\b', 'i');
  const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const host = route.match(/^[a-z0-9-]+(\.[a-z0-9-]+)+/)?.[0];
  if (host && new RegExp('(connection to|resolve host:?|access .https?://)\\s*' + esc(host)).test(r)) return 'failed';
  let ok: boolean;
  if (/^(pip|uv|python -m pip)/.test(route)) ok = kind === 'metadata' ? /Available versions:/.test(r) : pkgFile.test(r) || /Successfully (downloaded|installed)|Saved /.test(r);
  else if (route.startsWith('git ls-remote')) ok = /^[0-9a-f]{40}\s+(HEAD|refs\/)/m.test(r);
  else if (route.startsWith('git ')) ok = /Cloning into|Receiving objects|\[new (branch|tag)\]|Updating [0-9a-f]+\.\.[0-9a-f]+/.test(r) && !/fatal:/.test(r);
  else if (route.startsWith('go ')) ok = kind === 'metadata' ? new RegExp(esc(identity) + '\\s+v\\d', 'i').test(r) : new RegExp('go: (downloading|added|upgraded) ' + esc(identity), 'i').test(r);
  else if (/^(npm|pnpm|yarn|bun|npx)/.test(route)) ok = kind === 'metadata' ? /\b\d+\.\d+\.\d+\b/.test(r) && !FAIL.test(r) : pkgFile.test(r) || /added \d+ package|\+ \S+@\d/.test(r);
  else if (route.startsWith('cargo')) ok = /Downloaded|Installed|Adding/.test(r) && !FAIL.test(r);
  else ok = /\bHTTP\/[\d.]+ 200\b|(^|\s)200(\s|$)|saved \[/m.test(r) || (!FAIL.test(r) && pkgFile.test(r));
  if (!ok && kind === 'code' && /\b(unzip|zipfile|tarfile|tar\s+-?[a-z]*x|diff\s+-r|jar\s+x)/.test(command) && r.trim() && !ARTIFACT_FAIL.test(r)) ok = true;
  if (ok) return 'succeeded';
  return FAIL.test(r) ? 'failed' : 'unclear';
}

export function flagOf(hits: Hit[]): Flag {
  if (hits.some((h) => h.kind === 'code' && h.outcome === 'succeeded')) return 'fetched';
  return hits.some((h) => h.kind !== 'discussion') ? 'attempted' : 'none';
}

export function mask(s: string): string {
  return s
    .replace(/\b(sk-[\w-]{8,}|gh[pousr]_\w{16,}|github_pat_\w{16,}|xox[abpr]-[\w-]+|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+|hf_\w{16,}|npm_\w{16,}|pypi-[\w-]{16,})/g, '<masked>')
    .replace(/((?:token|key|secret|password|passwd|authorization)\s*[=:]\s*["']?(?:Bearer\s+|token\s+)?)[^\s"'&<]{8,}/gi, '$1<masked>')
    .replace(/(Bearer\s+)[\w.\-]{16,}/g, '$1<masked>');
}

export function auditTrial(calls: Call[], ids: Identities): Hit[] {
  const hits: Hit[] = [];
  for (const c of calls) for (const m of scanCall(c, ids)) {
    const src = (Object.keys(ids.names) as Bucket[]).map((b) => ids.names[b][m.identity]).find((x) => x !== undefined) ?? (m.identity.startsWith('github.com/') ? 'repo URL' : 'unknown');
    const start = Math.max(0, m.index - 40);
    hits.push({ call_id: c.id, route: m.route, kind: m.kind, outcome: outcomeOf(m.route, m.kind, m.identity, c.result, c.text), identity: m.identity, identity_source: src, evidence: mask(c.text.replace(/\s+/g, ' ').slice(start, start + EVIDENCE_CHARS)) });
  }
  return hits;
}

// ---- the run

const ARM: Record<string, string> = { 'anthropic:claude-fable-5-2': 'Fable 5.2', 'anthropic:claude-opus-5-5': 'Opus 5.5' };

export function trajectoryPath(root: string, trialId: string): string {
  const [, cell, task, attempt] = trialId.split('/');
  return join(root, cell.split('-').pop()!, 'results', 'trials', cell, task, attempt, 'harbor', 'agent', 'trajectory.json');
}

export const LIMITS = [
  'Transcript only. A fetch that no tool result shows (a background command whose output the agent never read, a download inside a script that printed nothing) is invisible here.',
  'Package identities come from the repo name and from manifests and git remotes an agent printed in any trial of the task. A package the project publishes under another name that no trial printed is missed; Gradle fetches are not parsed.',
  'Success is read from text in the tool result (a downloaded file name, an HTTP 200, a ref listing). A compound command whose output mixes several steps can be misread, so every flagged trial was also read by hand.',
  'A fetched release counts whether or not it held the fix: a version older than the base commit, or one that differs only in unrelated files, is still another ref. The fetched count is an upper bound on trials that could have copied the fix.',
  'Issue and pull request searches on the task repo are recorded as "discussion" and never flag a trial: the rule covers code, packages, releases and tags.',
];

export function render(report: any): string {
  const L: string[] = [];
  L.push('# Registry-release contamination count, fable-diagnosis-2026-11', '');
  L.push("The rule (PREREGISTRATION.md, Contamination guard, widened by amendment 1): a trial counts when it fetched the task repository's own code, package, release or tag at any ref other than the task's base commit, from any host. Flagged trials stay in the primary analysis; this is a sensitivity line.", '');
  L.push('**Source:** egress and proxy logs were not kept per trial, so this count reads each trial\'s transcript (the Harbor ATIF trajectory: every tool call and its result). Written by ' + BT + 'scripts/frontier-harbor/release-fetch-audit.ts' + BT + '; per-trial detail in ' + BT + 'release-fetch.json' + BT + '.', '');
  L.push('| Arm | Trials | Attempted, no code came back | Fetched, code came back | Fetched trials that passed |', '|---|---|---|---|---|');
  for (const [arm, c] of Object.entries<any>(report.arms)) L.push('| ' + [arm, c.trials, c.attempted, c.fetched, c.fetched_pass].join(' | ') + ' |');
  L.push('', '"Attempted" trials have a hit but no successful code fetch: blocked or failed fetches, and version or ref listings and reachability probes of the upstream (pip index, npm view, git ls-remote, the repo page) whether or not they answered. The sensitivity line drops only the "fetched" trials.', '');
  for (const flag of ['fetched', 'attempted'] as const) {
    L.push('## ' + (flag === 'fetched' ? 'Fetched' : 'Attempted') + ' trials', '');
    const rows = report.trials.filter((t: any) => t.flag === flag);
    if (!rows.length) L.push('None.');
    for (const t of rows) {
      const h = t.hits.find((x: any) => (flag === 'fetched' ? x.kind === 'code' && x.outcome === 'succeeded' : x.kind !== 'discussion'));
      L.push('- ' + BT + t.trial_id + BT + ' (' + t.arm + ', ' + t.grade + '): ' + h.route + ' of ' + BT + h.identity + BT + ', ' + h.kind + ', ' + h.outcome + '; identity from ' + h.identity_source);
    }
    L.push('');
  }
  const byRoute: Record<string, Record<Outcome, number>> = {};
  for (const t of report.trials) for (const h of t.hits) if (h.kind !== 'discussion') {
    const k = h.route.split(' ').slice(0, 2).join(' ').replace(/ (origin|upstream)$/, '');
    (byRoute[k] ??= { succeeded: 0, failed: 0, unclear: 0 })[h.outcome as Outcome]++;
  }
  L.push('## Hits by route', '', 'Every hit (one fetch of an identity in one tool call), by route and outcome.', '', '| Route | Succeeded | Failed | Unclear |', '|---|---|---|---|');
  for (const [k, c] of Object.entries(byRoute).sort()) L.push('| ' + [k, c.succeeded, c.failed, c.unclear].join(' | ') + ' |');
  L.push('');
  L.push('## Limits of the method', '');
  for (const l of report.limits) L.push('- ' + l);
  L.push('');
  return L.join('\n');
}

if (import.meta.main) {
  const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const trialsPath = arg('--trials'), root = arg('--trajectories'), out = arg('--out'), dataset = arg('--dataset');
  if (!trialsPath || !root || !out) { console.error('usage: release-fetch-audit.ts --trials <jsonl> --trajectories <root> [--dataset <dir>] --out <dir>'); process.exit(2); }
  const trials = readFileSync(trialsPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const callsOf = new Map<string, Call[] | null>();
  const idsOf = new Map<string, Identities>();
  for (const t of trials) {
    const p = trajectoryPath(root, t.trial_id);
    const calls = existsSync(p) ? readCalls(JSON.parse(readFileSync(p, 'utf8'))) : null;
    callsOf.set(t.trial_id, calls);
    if (!idsOf.has(t.task)) {
      const cfgPath = dataset ? join(dataset, t.task, 'tests', 'config.json') : '';
      const cfg = cfgPath && existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : null;
      idsOf.set(t.task, baseIdentities(t.task, cfg ? { repo: cfg.repo, base_commit: cfg.base_commit } : null));
    }
    if (calls) addTranscriptIdentities(idsOf.get(t.task)!, calls, t.trial_id);
  }
  const rows = trials.map((t) => {
    const calls = callsOf.get(t.trial_id);
    const hits = calls ? auditTrial(calls, idsOf.get(t.task)!) : [];
    return { trial_id: t.trial_id, arm: ARM[t.model] ?? t.model, cell: t.cell, task: t.task, grade: t.grade, capture: calls ? 'atif' : 'none', tool_calls: calls?.length ?? 0, flag: flagOf(hits), hits };
  });
  const arms: Record<string, any> = {};
  for (const r of rows) {
    const a = (arms[r.arm] ??= { trials: 0, attempted: 0, fetched: 0, fetched_pass: 0, no_capture: 0, attempted_ids: [], fetched_ids: [] });
    a.trials++;
    if (r.capture === 'none') a.no_capture++;
    if (r.flag === 'attempted') { a.attempted++; a.attempted_ids.push(r.trial_id); }
    if (r.flag === 'fetched') { a.fetched++; a.fetched_ids.push(r.trial_id); if (r.grade === 'pass') a.fetched_pass++; }
  }
  const report = {
    schema: 'release-fetch-audit/1',
    rule: 'PREREGISTRATION.md Contamination guard, widened by amendments/2026-11-15-contamination-rule.md',
    source: 'transcript (Harbor ATIF trajectory tool calls and results); egress and proxy logs were not kept per trial',
    script: 'scripts/frontier-harbor/release-fetch-audit.ts',
    arms, limits: LIMITS,
    tasks: Object.fromEntries(idsOf),
    trials: rows,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'release-fetch.json'), JSON.stringify(report, null, 1) + '\n');
  writeFileSync(join(out, 'release-fetch.md'), render(report));
  for (const [arm, a] of Object.entries<any>(arms)) console.log(arm + ': trials ' + a.trials + ', attempted ' + a.attempted + ', fetched ' + a.fetched + ', no capture ' + a.no_capture);
}
