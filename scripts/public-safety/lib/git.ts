// Git object helpers computed in-process: blob and tree ids (so the gate can name its own tree without git), and the
// commit parser behind the identity gate.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { identityDigest, type LoadedPack } from './pack.ts';

const sha1 = (...parts: (Buffer | string)[]) => { const h = createHash('sha1'); for (const p of parts) h.update(p); return h.digest(); };

export const blobId = (data: Buffer) => sha1('blob ' + data.length + '\0', data).toString('hex');

// The git tree id of a directory as it stands on disk: regular files only, mode 100755 when executable.
export function treeIdOfDir(dir: string): string {
  const entries = readdirSync(dir).map((name) => {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) return { name, key: name + '/', mode: '40000', id: Buffer.from(treeIdOfDir(p), 'hex') };
    if (!st.isFile()) throw new Error('the gate tree holds something other than files and directories');
    return { name, key: name, mode: st.mode & 0o111 ? '100755' : '100644', id: Buffer.from(blobId(readFileSync(p)), 'hex') };
  }).sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(e.mode + ' ' + e.name + '\0'), e.id]));
  return sha1('tree ' + body.length + '\0', body).toString('hex');
}

export interface Person { name: string; email: string }
export interface Commit { author: Person | null; committer: Person | null; header: string; message: string; trailers: { key: string; email: string }[] }

const person = (v: string): Person | null => { const m = /^(.*?)\s*<([^>]*)>/.exec(v); return m ? { name: m[1]!, email: m[2]! } : null; };

export function parseCommit(raw: Buffer): Commit {
  const text = raw.toString('utf8');
  const cut = text.indexOf('\n\n');
  const header = cut >= 0 ? text.slice(0, cut) : text;
  const message = cut >= 0 ? text.slice(cut + 2) : '';
  const field = (k: string) => { const m = new RegExp('^' + k + ' (.*)$', 'm').exec(header); return m ? person(m[1]!) : null; };
  const trailers: { key: string; email: string }[] = [];
  for (const m of message.matchAll(/^[ \t]*(co-authored-by|signed-off-by)[ \t]*:[ \t]*(.*)$/gim)) {
    const email = /<([^>]*)>/.exec(m[2]!)?.[1] ?? m[2]!.trim();
    trailers.push({ key: m[1]!.toLowerCase(), email });
  }
  return { author: field('author'), committer: field('committer'), header, message, trailers };
}

// Which identity fields of a commit fail: an address outside the allowed forms is PS-IDENTITY, one the private pack
// lists is PS-PRIVATE-IDENTITY. Never returns the address itself.
export function identityProblems(c: Commit, allowed: RegExp[], lp: LoadedPack | null): { code: string; field: string }[] {
  const out: { code: string; field: string }[] = [];
  const fields: [string, string | undefined][] = [['author', c.author?.email], ['committer', c.committer?.email], ...c.trailers.map((t, i): [string, string] => [t.key + '#' + (i + 1), t.email])];
  for (const [field, email] of fields) {
    if (email === undefined || !allowed.some((re) => re.test(email))) out.push({ code: 'PS-IDENTITY', field });
    if (email !== undefined && lp && lp.identities.has(identityDigest(lp.salt, email))) out.push({ code: 'PS-PRIVATE-IDENTITY', field });
  }
  return out;
}
