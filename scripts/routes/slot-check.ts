// internal-task (H10): the host-side check of a skill-route slot bundle (harnesses/routes/slots/README.md). Runs on the host only,
// in preflight (wired by H10 PR 5) and in tests, never inside a harness container: the Hermes image has neither bun nor node,
// so an adapter re-checks only bundle_sha256, with sha256sum.
//
//   bun scripts/routes/slot-check.ts <bundle dir> [<bundle dir> ...]
//
// Exit 0 when every bundle passes, printing one "ok" line each; exit 1 on the first refusal, with an HE-ADAPTER-007 line.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { SLOT_ID } from '../../runner/contracts.ts';

const ROOT = join(import.meta.dir, '..', '..');
export const INSTRUCTION_SHA256 = '4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f';
/** Every file in a bundle, slot.json included, adds up to at most this many bytes. */
export const SLOT_MAX_BYTES = 256 * 1024;
/** Hermes shows 57 characters of a skill description (agent/skill_utils.py SKILL_PROMPT_DESC_LIMIT 60 minus the ellipsis). */
export const SLOT_MAX_DESCRIPTION_CHARS = 57;
export const SLOT_MAX_TOLD_SENTENCE_BYTES = 60;
/** A skill name: Claude Code's rule (lowercase letters, digits and hyphens, at most 64 characters). */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SlotJson {
  slot_id: string;
  owner: string;
  skill_name: string;
  description: string;
  told_sentence: string;
  bundle_sha256: string;
  source: string;
  notes: string;
}

export class SlotCheckError extends Error {
  constructor(dir: string, why: string) { super(`HE-ADAPTER-007 slot bundle ${dir}: ${why}`); }
}

/** Every regular file under dir, as bundle-relative paths with "/" separators, refusing a symlink, a special file, a path
 *  segment ".." or a name sha256sum would escape (a backslash or a newline). */
function walk(dir: string, fail: (why: string) => never, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel))) {
    const path = rel ? `${rel}/${name}` : name;
    if (name === '..' || name === '.' || /[\\\n\r]/.test(name)) fail(`refused path ${JSON.stringify(path)}`);
    const st = lstatSync(join(dir, path));
    if (st.isSymbolicLink()) fail(`${path} is a symlink`);
    if (st.isDirectory()) { out.push(...walk(dir, fail, path)); continue; }
    if (!st.isFile()) fail(`${path} is not a regular file`);
    out.push(path);
  }
  return out;
}

const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** bundle_sha256: the sha256 of the sha256sum listing of every file but the top-level slot.json, sorted by path bytes, one
 *  "<hex>  <path>\n" line each. The same digest in a container:
 *  cd <bundle> && find . -type f ! -path ./slot.json | sed 's|^\./||' | LC_ALL=C sort | xargs -d '\n' sha256sum | sha256sum */
export function bundleSha256(dir: string): string {
  const fail = (why: string): never => { throw new SlotCheckError(dir, why); };
  const files = walk(dir, fail).filter((f) => f !== 'slot.json').sort(byBytes);
  return sha256(files.map((f) => `${sha256(readFileSync(join(dir, f)))}  ${f}\n`).join(''));
}

/** Check one bundle directory; returns its slot.json or throws SlotCheckError (an HE-ADAPTER-007 message). */
export function checkSlot(dirArg: string, instructionPath = join(ROOT, 'harnesses', 'routes', 'instruction.md')): SlotJson {
  const dir = resolve(dirArg);
  const fail = (why: string): never => { throw new SlotCheckError(dirArg, why); };
  if (!existsSync(dir)) fail('does not exist');
  const top = lstatSync(dir);
  if (top.isSymbolicLink() || !top.isDirectory()) fail('is not a plain directory');
  const files = walk(dir, fail);
  for (const f of files) if (lstatSync(join(dir, f)).mode & 0o111) fail(`${f} has an executable bit`);
  const total = files.reduce((n, f) => n + lstatSync(join(dir, f)).size, 0);
  if (total > SLOT_MAX_BYTES) fail(`${total} bytes, over the ${SLOT_MAX_BYTES}-byte cap`);
  if (!files.includes('slot.json')) fail('has no slot.json');

  let slot: SlotJson;
  try { slot = JSON.parse(readFileSync(join(dir, 'slot.json'), 'utf8')); } catch (e) { return fail(`slot.json does not parse: ${(e as Error).message}`); }
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) fail('slot.json is not an object');
  for (const k of ['slot_id', 'owner', 'skill_name', 'description', 'told_sentence', 'bundle_sha256', 'source', 'notes'] as const) {
    if (typeof slot[k] !== 'string') fail(`slot.json ${k} is not a string`);
    if (k !== 'notes' && slot[k].length === 0) fail(`slot.json ${k} is empty`);
  }
  if (slot.slot_id.split('/').includes('..') || slot.skill_name.split('/').includes('..')) fail('slot.json names a ".." path');
  if (!SLOT_ID.test(slot.slot_id)) fail(`slot_id ${JSON.stringify(slot.slot_id)} does not match ${SLOT_ID}`);
  if (slot.slot_id !== basename(dir)) fail(`slot_id ${slot.slot_id} is not the directory name ${basename(dir)}`);
  if (!SKILL_NAME.test(slot.skill_name)) fail(`skill_name ${JSON.stringify(slot.skill_name)} does not match ${SKILL_NAME}`);
  if (/\n/.test(slot.description) || [...slot.description].length > SLOT_MAX_DESCRIPTION_CHARS) fail(`description is not one line of at most ${SLOT_MAX_DESCRIPTION_CHARS} characters`);
  if (/\n/.test(slot.told_sentence) || Buffer.byteLength(slot.told_sentence) > SLOT_MAX_TOLD_SENTENCE_BYTES) fail(`told_sentence is not one line of at most ${SLOT_MAX_TOLD_SENTENCE_BYTES} bytes`);
  if (!/^[0-9a-f]{64}$/.test(slot.bundle_sha256)) fail('bundle_sha256 is not 64 lowercase hex characters');

  const skillDir = `skill/${slot.skill_name}/`;
  const stray = files.filter((f) => f !== 'slot.json' && !f.startsWith(skillDir));
  if (stray.length) fail(`files outside slot.json and ${skillDir}: ${stray.join(', ')}`);
  const skillMd = `${skillDir}SKILL.md`;
  if (!files.includes(skillMd)) fail(`has no ${skillMd}`);
  const skillBytes = readFileSync(join(dir, skillMd));
  const m = /^---\n([\s\S]*?)\n---\n/.exec(skillBytes.toString('utf8'));
  if (!m) return fail(`${skillMd} has no front matter`);
  let fm: unknown;
  try { fm = Bun.YAML.parse(m[1]); } catch (e) { return fail(`${skillMd} front matter is not valid YAML: ${(e as Error).message}`); }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return fail(`${skillMd} front matter is not a YAML mapping`);
  const fields = fm as Record<string, unknown>;
  const extra = Object.keys(fields).filter((k) => k !== 'name' && k !== 'description');
  if (extra.length) fail(`${skillMd} front matter has keys other than name and description: ${extra.join(', ')}`);
  if (fields.name !== slot.skill_name) fail(`${skillMd} front matter name is not ${slot.skill_name}`);
  if (fields.description !== slot.description) fail(`${skillMd} front matter description is not slot.json's description`);
  const instruction = readFileSync(instructionPath);
  if (sha256(instruction) !== INSTRUCTION_SHA256) fail(`${instructionPath} is not the H10 rule (sha256 ${INSTRUCTION_SHA256})`);
  if (!skillBytes.subarray(Buffer.byteLength(m[0])).includes(instruction)) fail(`${skillMd} body does not carry the H10 rule bytes verbatim`);

  const digest = bundleSha256(dir);
  if (digest !== slot.bundle_sha256) fail(`bundle_sha256 ${slot.bundle_sha256} does not match the files (${digest})`);
  return slot;
}

if (import.meta.main) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: bun scripts/routes/slot-check.ts <bundle dir> [<bundle dir> ...]'); process.exit(2); }
  for (const d of dirs) {
    try {
      const slot = checkSlot(d);
      console.log(`ok ${slot.slot_id} skill=${slot.skill_name} bundle_sha256=${slot.bundle_sha256}`);
    } catch (e) {
      console.error(e instanceof SlotCheckError ? e.message : `HE-ADAPTER-007 slot bundle ${d}: ${(e as Error).message}`);
      process.exit(1);
    }
  }
}
