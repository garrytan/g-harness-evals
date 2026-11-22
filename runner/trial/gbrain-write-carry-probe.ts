// internal-task: two informational write-carry probes, run inside the gbrain image (docker run --network none, the script mounted
// read-only, gbrain at /opt/gbrain), each on a fresh scratch brain with two members, keyless. They record whether a page or a fact
// one credential writes can be read by another member's token or by an unbound (public-only) token; they never decide a preflight.
//
//   write_carry_member_only: alice's token bound with `gbrain auth rescope --member alice` and no --sources (at gbrain 0.60.613.0
//     its writes land in the unruled default source). Rows: put_page (expected to cross at the stable pin, gbrain internal-task will
//     stamp it readable_by alice) and remember with no source_id (expected private: gbrain files it on memory/members/alice,
//     readable_by alice).
//   write_carry_attested_actor: a no-grant shared-agent token (no member, no --sources) rescoped --may-act-for '*' writes a page
//     naming alice as the audience (X-Gbrain-On-Behalf-Of and request-level _meta.on_behalf_of); a second no-grant token rescoped
//     --attest-actor qm (alice linked with gbrain access member link --qm) writes one naming alice in x-qm-actor. gbrain says such writes are still shared pages and out of its fix.
//
// Readers per shape: alice (member-bound, the write's own member, a positive control), bob (member-bound) and public-only
// (unbound), through search, query, recall, get_page, list_pages and _meta.brain_hot_memory. A row records outcomes only (did
// the write land, did the marker come back), never gbrain's wording, so it reads the same on a later pin. Prints one JSON object;
// token values stay in this process.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const GBRAIN = ['bun', '/opt/gbrain/src/cli.ts'];
const READ_TOOLS = ['search', 'query', 'recall', 'get_page', 'list_pages', 'hot_memory'] as const;
type ReadTool = (typeof READ_TOOLS)[number];

interface Write { label: string; tool: string; landed: boolean; error: string | null }
interface Read { reader: string; write: string; tool: ReadTool; returned: boolean }

const marker = () => crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(36), '').toUpperCase();

async function shape(name: string, port: number, setup: (gb: (args: string[]) => string, mint: (n: string, bind?: string[]) => void) => void, writes: Array<{ label: string; token: string; tool: string; args: (m: string, q: string) => Record<string, unknown>; headers?: Record<string, string>; meta?: Record<string, unknown> }>) {
  const home = join('/tmp', name);
  rmSync(home, { recursive: true, force: true }); mkdirSync(home, { recursive: true });
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: home, GBRAIN_HOME: home, GBRAIN_TELEMETRY: '0', NO_COLOR: '1' };
  const tokens: Record<string, string> = {};
  const gb = (args: string[]) => {
    const r = spawnSync(GBRAIN[0]!, [...GBRAIN.slice(1), ...args], { env, encoding: 'utf8', timeout: 120_000 });
    const out = (r.stdout ?? '') + (r.stderr ?? '');
    if (r.status !== 0) throw new Error(`gbrain ${args.slice(0, 3).join(' ')} exited ${r.status}: ${out.replace(/gbrain_[0-9a-f]+/g, '<token>').slice(-300)}`);
    return out;
  };
  const create = (n: string, bind: string[]) => { try { return gb(['auth', 'create', n]); } catch (e) { if (!/credential_scope_required/.test(String(e))) throw e; return gb(['auth', 'create', n, ...(bind.length ? bind : ['--reads-unscoped', '--yes'])]); } };
  const mint = (n: string, bind: string[] = []) => { const t = /gbrain_[0-9a-f]+/.exec(create(n, bind))?.[0]; if (!t) throw new Error(`gbrain auth create ${n} printed no token`); tokens[n] = t; };
  gb(['init', '--pglite', '--non-interactive', '--no-embedding']);
  for (const m of ['alice', 'bob']) gb(['access', 'member', 'add', m]);
  for (const m of ['alice', 'bob']) { mint(`tok-${m}`, ['--member', m]); gb(['auth', 'rescope', '--token', `tok-${m}`, '--member', m]); }
  mint('tok-public');
  setup(gb, mint);
  const srv = Bun.spawn([...GBRAIN, 'serve', '--http', '--port', String(port), '--surface', 'full'], { env: { ...env, GBRAIN_HTTP_RATE_LIMIT_IP: '1000000', GBRAIN_HTTP_RATE_LIMIT_TOKEN: '1000000' }, stdout: 'ignore', stderr: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (const deadline = Date.now() + 90_000; ; await Bun.sleep(300)) {
      if (await fetch(`${url}/health`).then((r) => r.ok, () => false)) break;
      if (Date.now() > deadline) throw new Error('gbrain serve --http not healthy after 90 s');
    }
    let id = 1;
    const call = async (token: string, tool: string, args: Record<string, unknown>, headers: Record<string, string> = {}, meta?: Record<string, unknown>) => {
      const res = await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens[token]}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: tool, arguments: args, ...(meta ? { _meta: meta } : {}) } }) });
      const text = await res.text();
      const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('') || text;
      try { return (JSON.parse(data) as { result?: Record<string, unknown> }).result ?? null; } catch { return null; }
    };
    const parts = (r: Record<string, unknown> | null) => {
      if (!r) return { hot: '', rest: '' };
      const meta = (r._meta ?? {}) as Record<string, unknown>;
      const { brain_hot_memory, ...otherMeta } = meta;
      return { hot: JSON.stringify(brain_hot_memory ?? ''), rest: JSON.stringify({ ...r, _meta: otherMeta }) };
    };
    const made: Array<{ label: string; tool: string; secret: string; query: string; slug: string | null; landed: boolean; error: string | null }> = [];
    for (const w of writes) {
      const secret = 'WC' + marker();
      const query = 'wcq' + marker().toLowerCase();
      const args = w.args(secret, query);
      const r = await call(w.token, w.tool, { ...args, request_id: crypto.randomUUID() }, w.headers, w.meta);
      const rest = parts(r).rest;
      const code = r?.isError === true ? (/"code\\?":\s*\\?"([a-z_]+)/.exec(rest)?.[1] ?? 'tool_error') : null;
      made.push({ label: w.label, tool: w.tool, secret, query, slug: typeof args.slug === 'string' ? args.slug : null, landed: r !== null && r.isError !== true, error: r === null ? 'no_reply' : code });
    }
    const reads: Read[] = [];
    for (const reader of ['tok-alice', 'tok-bob', 'tok-public']) {
      const seen: Record<string, Set<ReadTool>> = Object.fromEntries(made.map((m) => [m.label, new Set<ReadTool>()]));
      const scan = (tool: ReadTool, r: Record<string, unknown> | null) => {
        const { hot, rest } = parts(r);
        for (const m of made) { if (rest.includes(m.secret)) seen[m.label]!.add(tool); if (hot.includes(m.secret)) seen[m.label]!.add('hot_memory'); }
      };
      for (const m of made) {
        for (const tool of ['search', 'query'] as const) scan(tool, await call(reader, tool, { query: m.query }));
        scan('recall', await call(reader, 'recall', { query: m.query, question: m.query }));
        if (m.slug) scan('get_page', await call(reader, 'get_page', { slug: m.slug }));
      }
      // list_pages carries slugs, not text: a write is listed when its slug comes back.
      for (let offset = 0; offset < 10_000; offset += 100) {
        const r = await call(reader, 'list_pages', { limit: 100, offset, sort: 'slug' });
        const { hot, rest } = parts(r);
        for (const m of made) { if (m.slug && rest.includes(JSON.stringify(m.slug).slice(1, -1))) seen[m.label]!.add('list_pages'); if (hot.includes(m.secret)) seen[m.label]!.add('hot_memory'); }
        if (!rest.includes('"truncated":true') && !rest.includes('listing_truncated')) break;
      }
      for (const m of made) for (const tool of READ_TOOLS) reads.push({ reader: reader.replace(/^tok-/, ''), write: m.label, tool, returned: seen[m.label]!.has(tool) });
    }
    return {
      shape: name,
      writes: made.map(({ label, tool, landed, error, slug }) => ({ label, tool, landed, error, page: slug !== null })),
      reads,
      crossed: Object.fromEntries(made.map((m) => [m.label, [...new Set(reads.filter((r) => r.write === m.label && r.reader !== 'alice' && r.returned).map((r) => `${r.reader}:${r.tool}`))]])),
    };
  } finally { srv.kill(); await srv.exited; }
}

const out: Record<string, unknown> = { gbrain_version: (await Bun.file('/opt/gbrain/VERSION').text().catch(() => '')).trim() || null };
const page = (secret: string, query: string) => ({ slug: `notes/write-carry-${query}`, content: `---\ntitle: Write carry ${query}\n---\nThe ${query} handoff code is ${secret}.\n` });
const tries: Array<[string, () => Promise<unknown>]> = [
  ['write_carry_member_only', () => shape('member-only', 3241, () => undefined, [
    { label: 'put_page', token: 'tok-alice', tool: 'put_page', args: page },
    { label: 'remember', token: 'tok-alice', tool: 'remember', args: (s, q) => ({ fact: `Alice told the bot in her DM that her ${q} code is ${s}.`, provenance: 'harness-evals write-carry probe' }) },
  ])],
  ['write_carry_attested_actor', () => shape('attested-actor', 3242, (gb, mint) => {
    mint('tok-agent', ['--may-act-for', '*']); gb(['auth', 'rescope', '--token', 'tok-agent', '--may-act-for', '*']);
    mint('tok-attest'); gb(['auth', 'rescope', '--token', 'tok-attest', '--attest-actor', 'qm', '--attest-ops', 'put_page,remember']);
    gb(['access', 'member', 'link', 'alice', '--qm', 'alice']);
  }, [
    { label: 'may_act_for put_page', token: 'tok-agent', tool: 'put_page', args: page, headers: { 'x-gbrain-on-behalf-of': 'alice' }, meta: { on_behalf_of: ['alice'] } },
    { label: 'attested_actor put_page', token: 'tok-attest', tool: 'put_page', args: page, headers: { 'x-qm-actor': 'alice' } },
  ])],
];
for (const [name, run] of tries) {
  try { out[name] = await run(); } catch (e) { out[name] = { error: (e as Error).message.replace(/gbrain_[0-9a-f]+/g, '<token>') }; }
}
console.log(JSON.stringify(out));
