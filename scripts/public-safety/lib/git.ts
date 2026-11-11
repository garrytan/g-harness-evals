// Git object helpers computed in-process: blob and tree ids (so the gate can name its own tree without git), and the
// commit parser behind the identity gate, which reads every `Key: value` line of the message whose value carries an
// email address, plus Co-authored-by and Signed-off-by lines that carry none.
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
  for (const m of message.matchAll(/^[ \t]*([A-Za-z][A-Za-z0-9-]*)[ \t]*:[ \t]*(.*)$/gm)) {
    const key = m[1]!.toLowerCase();
    const value = m[2]!;
    const bracketed = [...value.matchAll(/<([^<>]*@[^<>]*)>/g)].map((x) => x[1]!);
    const emails = bracketed.length ? bracketed : (value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? []);
    for (const email of emails) trailers.push({ key, email });
    if (!emails.length && (key === 'co-authored-by' || key === 'signed-off-by')) trailers.push({ key, email: /<([^>]*)>/.exec(value)?.[1] ?? value.trim() });
  }
  return { author: field('author'), committer: field('committer'), header, message, trailers };
}

// Which identity fields of a commit fail: an address outside the allowed forms is PS-IDENTITY, one the private pack
// lists is PS-PRIVATE-IDENTITY. An owner-accepted address (exact, any case) passes both, as author or committer only;
// in a trailer it is checked like any other address. Never returns the address itself.
export function identityProblems(c: Commit, allowed: RegExp[], accepted: string[], lp: LoadedPack | null): { code: string; field: string }[] {
  const out: { code: string; field: string }[] = [];
  const isAccepted = (email: string | undefined) => email !== undefined && accepted.some((a) => a.toLowerCase() === email.toLowerCase());
  const fields: [string, string | undefined][] = [['author', c.author?.email], ['committer', c.committer?.email], ...c.trailers.map((t, i): [string, string] => [t.key + '#' + (i + 1), t.email])];
  for (const [field, email] of fields) {
    if ((field === 'author' || field === 'committer') && isAccepted(email)) continue;
    if (email === undefined || !allowed.some((re) => re.test(email))) out.push({ code: 'PS-IDENTITY', field });
    if (email !== undefined && lp && lp.identities.has(identityDigest(lp.salt, email))) out.push({ code: 'PS-PRIVATE-IDENTITY', field });
  }
  return out;
}

// The commit header with an owner-accepted address on the author and committer lines (the first of each, the ones
// parseCommit reads) replaced by a noreply address, so the text scans do not flag the identity identityProblems accepted.
// The same address anywhere else stays in place.
export function maskAcceptedIdentity(header: string, accepted: string[]): string {
  const lower = accepted.map((a) => a.toLowerCase());
  let out = header;
  for (const k of ['author', 'committer']) out = out.replace(new RegExp('^(' + k + ' [^<\\n]*<)([^>\\n]*)>', 'm'), (m, open: string, email: string) => (lower.includes(email.toLowerCase()) ? open + 'noreply@github.com>' : m));
  return out;
}
