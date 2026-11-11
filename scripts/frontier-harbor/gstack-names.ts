// Which gstack skills an arm's skill tree lists, by host (internal-task).
//
// A lock is gstack's loadout.lock.json for one render (gstack-modules render), or the none arm's lock gstack-arm.ts
// writes (no files). A canonical skill is the gstack source directory of a skill (the module id skill:<dir>). Each host
// lists a skill under its own name, and every name comes from the lock's file paths, never from bare words:
//   claude  <dir>/SKILL.md, listed as <dir>; the router (the render's root SKILL.md) as gstack
//   codex   .agents/skills/gstack-<dir>/SKILL.md (a dir already named gstack or gstack-* keeps its name), listed under its
//           frontmatter name, which is <dir> (gstack's codex host keeps the source name; agents/openai.yaml carries the
//           gstack-<dir> display name); nameMap and canonicalName also take the folder name gstack-<dir>
//   hermes  .hermes/skills/gstack-<dir>/SKILL.md, listed as gstack-<dir> (gstack's hermes host makes the frontmatter name
//           match the directory), all in Hermes's one gstack category
// skills.json records each host's frontmatter names, and tests/frontier-harbor-gstack-arm.test.ts checks this map
// against them.

export type GstackHost = 'claude' | 'codex' | 'hermes';
export const GSTACK_HOSTS: readonly GstackHost[] = ['claude', 'codex', 'hermes'];

export interface LockFile { path: string; bytes: number; sha256: string }
export interface Lock {
  schema_version: number;
  loadout: string;
  spec: string;
  spec_sha256: string | null;
  host: string;
  model?: string | null;
  install_root?: string | null;
  plan_mode?: boolean;
  gstack_version?: string | null;
  excluded: string[];
  total_bytes?: number;
  files: LockFile[];
}

/** Skill dirs whose own name already starts with gstack, which codex and hermes list unprefixed (the router and gstack-upgrade). */
export const GSTACK_PREFIXED = new Set(['gstack', 'gstack-upgrade']);

const SKILL_DIR = /^[a-z0-9][a-z0-9-]*$/;

/** The directory a host renders a canonical skill into. */
export function skillDir(skill: string, host: GstackHost): string {
  return host === 'claude' || GSTACK_PREFIXED.has(skill) ? skill : 'gstack-' + skill;
}

/** The canonical skill a rendered directory holds (the inverse of skillDir). */
export function dirSkill(dir: string, host: GstackHost): string {
  if (host === 'claude' || GSTACK_PREFIXED.has(dir)) return dir;
  if (!dir.startsWith('gstack-')) throw new Error(host + ' renders gstack skills as gstack-<dir>, not ' + dir);
  return dir.slice('gstack-'.length);
}

/** The name a host lists a canonical skill under. */
export function listedName(skill: string, host: GstackHost): string {
  return host === 'hermes' ? skillDir(skill, host) : skill;
}

/** The canonical skill a host-listed name stands for (the inverse of listedName). */
export function canonicalName(name: string, host: GstackHost): string {
  if (host === 'codex' && name.startsWith('gstack-') && !GSTACK_PREFIXED.has(name)) return dirSkill(name, host);
  return host === 'hermes' ? dirSkill(name, host) : name;
}

/** The SKILL.md path of a canonical skill inside a render of the host, relative to the render's root. */
export function skillPath(skill: string, host: GstackHost): string {
  if (host === 'claude') return skill === 'gstack' ? 'SKILL.md' : skill + '/SKILL.md';
  return (host === 'codex' ? '.agents/skills/' : '.hermes/skills/') + skillDir(skill, host) + '/SKILL.md';
}

/** The canonical skills the lock's files render on the host. */
function rendered(lock: Lock, host: GstackHost): string[] {
  if (lock.host !== host && lock.files.length) throw new Error('the lock is a ' + lock.host + ' render, not ' + host);
  const out: string[] = [];
  for (const f of lock.files) {
    const parts = f.path.split('/');
    if (host === 'claude') {
      if (parts.length === 1 && parts[0] === 'SKILL.md') out.push('gstack');
      else if (parts.length === 2 && parts[1] === 'SKILL.md' && SKILL_DIR.test(parts[0]!) && parts[0] !== 'gstack') out.push(parts[0]!);
    } else {
      const root = host === 'codex' ? '.agents' : '.hermes';
      if (parts.length === 4 && parts[0] === root && parts[1] === 'skills' && parts[3] === 'SKILL.md' && SKILL_DIR.test(parts[2]!)) out.push(dirSkill(parts[2]!, host));
    }
  }
  return out.sort();
}

/** Listed name -> canonical skill dir, for every skill the lock's tree renders on the host. Codex also maps each folder
 *  name (gstack-<dir>) to its skill, so a listing read by either name resolves; listedNames gives the listed names only. */
export function nameMap(lock: Lock, host: GstackHost): Map<string, string> {
  return new Map(rendered(lock, host).flatMap((s): Array<[string, string]> => (host === 'codex' && skillDir(s, host) !== s ? [[s, s], [skillDir(s, host), s]] : [[listedName(s, host), s]])));
}

/** The names the host lists the lock's rendered skills under, sorted. */
export function listedNames(lock: Lock, host: GstackHost): string[] {
  return rendered(lock, host).map((s) => listedName(s, host)).sort();
}

/** The canonical skill dirs present in the lock, sorted. */
export function lockSkills(lock: Lock): string[] {
  const host = lock.host as GstackHost;
  if (!lock.files.length) return [];
  if (!GSTACK_HOSTS.includes(host)) throw new Error('lock host ' + lock.host + ' is not claude, codex or hermes');
  return [...new Set(nameMap(lock, host).values())].sort();
}
