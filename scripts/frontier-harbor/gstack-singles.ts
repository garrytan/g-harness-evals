// gstack-arm.ts singles (internal-task): every single-skill removal per host at one gstack pin, rendered keylessly in the
// gstack arm builder, with each skill's listing cost. Writes <out>/skills.json and <out>/locks/<host>/{full,none}.lock.json
// (with --all-locks, every single-removal lock too, as locks/<host>/minus-<skill>.lock.json).
//
// skills.json, per canonical skill (the gstack source dir) and host:
//   rendered_as     the name the full render gives it on the host, or null when the host's render leaves it out
//   listed_as       the name the host lists it under for the model, or null when the render leaves it out or the host
//                   does not list it (HIDES_DISABLED; per host, hosts.<host>.unlisted names them)
//   listing_bytes   UTF-8 bytes of that name plus its description as the host lists it: Claude and Codex the whole
//                   frontmatter description; Hermes its first 57 characters and "..." when it is longer than 60
//                   (gstack hosts/hermes.ts: Hermes's skills index, agent/skill_utils.py SKILL_PROMPT_DESC_LIMIT = 60)
//   single_removal  { spec, spec_sha256, lock_sha256, files } when gstack renders full,-skill:<dir>, else
//                   { spec, refusal: <gstack code>, message }
// and per host the full render's lock summary and the absolute-path check of its tree (every path the tree names under
// the skills root, the checkout or the Harbor target resolves inside the uploaded runtime and tree).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armSha, buildHost, checkPin, layout, loadRuntime, noneLock, readArm, refusalCode, specSha256, treeUnresolved, walk } from './gstack-arm.ts';
import { canonicalName, GSTACK_HOSTS, listedName, lockSkills, skillPath, type GstackHost, type Lock } from './gstack-names.ts';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** name, description and disable-model-invocation from a SKILL.md frontmatter (plain scalars, quoted scalars and block
 *  scalars). */
export function frontmatter(text: string): { name: string | null; description: string | null; disable_model_invocation: boolean } {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return { name: null, description: null, disable_model_invocation: false };
  const lines = m[1]!.split('\n');
  const field = (key: string): string | null => {
    const i = lines.findIndex((l) => l.startsWith(key + ':'));
    if (i < 0) return null;
    let v = lines[i]!.slice(key.length + 1).trim();
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      const body: string[] = [];
      for (const l of lines.slice(i + 1)) { if (/^\s+\S/.test(l) || l === '') body.push(l.trim()); else break; }
      return (v.startsWith('|') ? body.join('\n') : body.join(' ')).trim();
    }
    if ((v.startsWith('"') && v.endsWith('"'))) v = JSON.parse(v) as string;
    else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    return v;
  };
  return { name: field('name'), description: field('description'), disable_model_invocation: field('disable-model-invocation') === 'true' };
}

/** Hosts that leave a rendered skill out of the model's skill listing when its frontmatter sets
 *  disable-model-invocation: true. Claude Code does (land-and-deploy and modernize at the pin); Codex and Hermes list
 *  them (the internal-task install check's first requests). */
export const HIDES_DISABLED: Record<GstackHost, boolean> = { claude: true, codex: false, hermes: false };

/** The rendered skills of a lock that the host does not list, read from the SKILL.md files under the render's root. */
export function hostUnlisted(renderRoot: string, lock: Lock, host: GstackHost): string[] {
  if (!HIDES_DISABLED[host]) return [];
  return lockSkills(lock).filter((s) => frontmatter(readFileSync(join(renderRoot, skillPath(s, host)), 'utf8')).disable_model_invocation);
}

/** The description text a host shows in its skills listing. */
export function listedDescription(description: string, host: GstackHost): string {
  if (host !== 'hermes' || description.length <= 60) return description;
  return description.slice(0, 57) + '...';
}

export function singles(o: { commit: string; out: string; hosts: GstackHost[]; work?: string; allLocks?: boolean }): void {
  const pin = checkPin({ repo: 'garrytan/gstack', commit: o.commit });
  const rt = loadRuntime();
  const work = o.work ?? join(o.out, '.singles-work');
  const catalog = JSON.parse(readFileSync(join(import.meta.dir, 'gstack-catalog.json'), 'utf8')) as { commit: string; skills: string[]; pinned: string[] };
  if (catalog.commit !== pin.commit) throw new Error('scripts/frontier-harbor/gstack-catalog.json is for gstack ' + catalog.commit + ', not ' + pin.commit + '; regenerate it with gstack-modules list --json at the pin');
  const skills: Record<string, Record<string, unknown>> = Object.fromEntries(catalog.skills.map((s) => [s, {}]));
  const hosts: Record<string, unknown> = {};
  for (const host of o.hosts) {
    const out = join(work, host);
    const arms = [{ id: 'full', spec: 'full', keep: true }, ...catalog.skills.map((s) => ({ id: 'minus-' + s, spec: 'full,-skill:' + s, keep: false }))];
    buildHost({ pin, rt, host, home: rt.home, out, runtime: true, arms, log: join(work, host + '.log') });
    const full = readArm(out, 'full', 'full', host);
    if (!('lock' in full)) throw new Error(host + ': gstack refused the full render: ' + full.refusal);
    const l = layout(host, rt.home);
    const tree = join(out, 'arms', 'full', 'tree');
    const rendered = lockSkills(full.lock);
    const unlisted = hostUnlisted(tree + l.tree, full.lock, host);
    let listingTotal = 0;
    for (const skill of rendered) {
      const name = listedName(skill, host);
      const text = readFileSync(join(tree + l.tree, skillPath(skill, host)), 'utf8');
      const fm = frontmatter(text);
      if (fm.name !== name) throw new Error(host + ': ' + skillPath(skill, host) + ' has frontmatter name ' + fm.name + ', not ' + name);
      if (canonicalName(name, host) !== skill || !skills[skill]) throw new Error(host + ': listed name ' + name + ' maps to ' + skill + ', which is not a skill of the catalog');
      const desc = listedDescription(fm.description ?? '', host);
      const hidden = unlisted.includes(skill);
      const bytes = hidden ? 0 : Buffer.byteLength(name + desc, 'utf8');
      listingTotal += bytes;
      skills[skill]![host] = { listed_as: hidden ? null : name, rendered_as: name, path: skillPath(skill, host), listing_bytes: hidden ? null : bytes };
    }
    for (const s of catalog.skills) {
      const cellRow = (skills[s]![host] ??= { listed_as: null, rendered_as: null, listing_bytes: null }) as Record<string, unknown>;
      const spec = 'full,-skill:' + s;
      const res = readArm(out, 'minus-' + s, spec, host);
      if ('refusal' in res) cellRow.single_removal = { spec, refusal: refusalCode(res.refusal) ?? 'exit ' + res.exit, message: res.refusal.trim().split('\n')[0] };
      else {
        const raw = readFileSync(join(out, 'arms', 'minus-' + s, 'loadout.lock.json'));
        cellRow.single_removal = { spec, spec_sha256: armSha(res.lock), lock_sha256: sha256(raw), files: res.lock.files.length };
        if (armSha(res.lock) !== specSha256(spec)) throw new Error(host + ': gstack hashed ' + spec + ' as ' + armSha(res.lock));
        if (o.allLocks) { mkdirSync(join(o.out, 'locks', host), { recursive: true }); writeFileSync(join(o.out, 'locks', host, 'minus-' + s + '.lock.json'), raw); }
      }
    }
    const bad = treeUnresolved(out, 'full', l);
    const checked = walk(tree).filter((f) => f.endsWith('.md')).length;
    hosts[host] = {
      render_model: full.lock.model, install_root: full.lock.install_root, plan_mode: full.lock.plan_mode, gstack_version: full.lock.gstack_version,
      full: { spec_sha256: armSha(full.lock), files: full.lock.files.length, total_bytes: full.lock.total_bytes, rendered: rendered.length, listed: rendered.length - unlisted.length, listing_bytes: listingTotal },
      unlisted,
      path_check: { markdown_files: checked, unresolved: bad },
      layout: l,
    };
    mkdirSync(join(o.out, 'locks', host), { recursive: true });
    writeFileSync(join(o.out, 'locks', host, 'full.lock.json'), readFileSync(join(out, 'arms', 'full', 'loadout.lock.json')));
    writeFileSync(join(o.out, 'locks', host, 'none.lock.json'), JSON.stringify(noneLock(host), null, 2) + '\n');
  }
  const doc = {
    schema: 'gstack-skill-ablation-skills/1',
    gstack_pin: pin,
    gstack_version: (Object.values(hosts)[0] as { gstack_version?: string } | undefined)?.gstack_version ?? null,
    generated_by: 'bun scripts/frontier-harbor/gstack-arm.ts singles --commit ' + pin.commit + ' --out <this folder>',
    home: rt.home,
    bun: rt.bun.version,
    pinned: catalog.pinned,
    listing_bytes_rule: 'UTF-8 bytes of the listed name plus the description as the host lists it: Claude Code and Codex the whole frontmatter description; Hermes the first 57 characters and "..." past 60 (gstack hosts/hermes.ts).',
    hosts,
    skills,
  };
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'skills.json'), JSON.stringify(doc, null, 2) + '\n');
  if (!existsSync(join(o.out, 'skills.json'))) throw new Error('skills.json was not written');
  console.log('skills.json: ' + catalog.skills.length + ' skills x ' + o.hosts.length + ' host(s)');
}

/** gstack-arm.ts locks: each arm rendered at the pin on each host, written as locks/<host>/<id>.lock.json. */
export function armLocks(o: { commit: string; out: string; hosts: GstackHost[]; work?: string; arms: Array<{ id: string; spec: string }> }): void {
  const pin = checkPin({ repo: 'garrytan/gstack', commit: o.commit });
  const rt = loadRuntime();
  const work = o.work ?? join(o.out, '.locks-work');
  for (const host of o.hosts) {
    const out = join(work, host);
    buildHost({ pin, rt, host, home: rt.home, out, runtime: true, arms: o.arms.map((a) => ({ ...a, keep: false })), log: join(work, host + '.log') });
    const locks = o.arms.map((a) => {
      const res = readArm(out, a.id, a.spec, host);
      if ('refusal' in res) throw new Error(host + ': gstack refused ' + a.spec + ' (' + (refusalCode(res.refusal) ?? 'exit ' + res.exit) + '): ' + res.refusal.trim().split('\n')[0]);
      if (armSha(res.lock) !== specSha256(a.spec)) throw new Error(host + ': gstack hashed ' + a.spec + ' as ' + armSha(res.lock));
      return { a, files: res.lock.files.length, raw: readFileSync(join(out, 'arms', a.id, 'loadout.lock.json')) };
    });
    mkdirSync(join(o.out, 'locks', host), { recursive: true });
    for (const l of locks) {
      writeFileSync(join(o.out, 'locks', host, l.a.id + '.lock.json'), l.raw);
      console.log(host + ': locks/' + host + '/' + l.a.id + '.lock.json, ' + l.files + ' files');
    }
  }
}

export { GSTACK_HOSTS, type Lock };
