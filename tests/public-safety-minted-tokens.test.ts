// The public-safety gate's shape rules for the tokens this repository mints and for the provider key formats its lanes
// hold: rules.json provider-key-shape (PS-KEY-SHAPE) and the he-* token rules in scripts/public-safety/gitleaks.toml.
//
// Value: protects=a minted proxy, judge, Lane B, bind, control or bearer token, or a provider key in a format gitleaks'
// default rules do not know, is refused even when it contains one of gitleaks' stopwords, and is never printed;
// fails_when=any shape below passes the range check, a fixture placeholder the tests and pins use is refused, or a key
// spelled with unicode escapes passes; why_new=internal-task found gitleaks' generic rule skips values with stopwords and
// knows none of these shapes; seam=bun check.ts on synthetic repositories; no_claim=a bare 64-hex or base64 token with
// no name beside it, which only a broad rule could catch.
import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { check, gitleaksReady, rand, repo } from './public-safety-fixture.ts';

const tmp = mkdtempSync(join(tmpdir(), 'he-public-safety-minted-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const READY = gitleaksReady();
let n = 0;
const fresh = () => { const r = repo(join(tmp, 'r' + ++n)); r.commit({ 'docs/methods.md': '# Methods\n' }, 'base'); r.g('checkout', '-q', '-b', 'feature'); return r; };
const range = (r: ReturnType<typeof fresh>) => check(['--base', 'main', '--head', 'feature', '--no-cache'], { cwd: r.dir });
const flagged = (stdout: string) => [...stdout.matchAll(/^PS-(?:GITLEAKS|KEY-SHAPE) (\S+):(\d+) /gm)].map((m) => m[1] + ':' + m[2]);
const hex = (len: number, word: string) => { const h = randomBytes(len).toString('hex').slice(0, len - word.length); const i = Math.floor(h.length / 2); return h.slice(0, i) + word + h.slice(i); };
const alnum = (len: number, word: string) => { const s = rand(len - word.length); const i = Math.floor(s.length / 2); return s.slice(0, i) + word + s.slice(i); };
const lower = (len: number) => { let s = ''; while (s.length < len) s += randomBytes(len).toString('hex').replace(/[^a-z0-9]/g, ''); return s.slice(0, len); };
const TID = 'cc-opus-55-t007-r1';

const SHAPES: Record<string, () => string> = {
  'trial-token': () => 'trial-' + 'token:' + TID + '.' + hex(32, 'dead'),
  'judge-token': () => 'judge-' + 'primary:' + TID + '.' + hex(32, 'cafe'),
  'trial-token-runner-id': () => 'trial-' + 'token:' + 'harbor-2026-11/cc-opus-55/fix-css/r3' + '.' + hex(32, 'dead'),
  'judge-token-lease-id': () => 'judge-' + 'secondary:' + 'qm-s1/lease+2026-11-28' + '.' + hex(32, 'beef'),
  'laneb-token': () => 'lane' + 'b-' + hex(48, 'feed'),
  'anthropic-no-digits': () => 'sk-' + 'ant-' + 'oat-' + alnum(93, 'yaml') + 'AA',
  'anthropic-with-digits': () => 'sk-' + 'ant-' + 'api03-' + alnum(93, 'hero') + 'AA',
  'openai-project': () => 'sk-' + 'proj-' + alnum(156, 'lazy'),
  'openrouter-v2': () => 'sk-' + 'or-v2-' + hex(64, 'beef'),
  'xai': () => 'xai' + '-' + alnum(80, 'vpn'),
  'google-aq': () => 'A' + 'Q.' + alnum(50, 'yaml'),
  'google-aiza': () => 'AI' + 'za' + alnum(35, 'hero'),
  'ubicloud': () => 'pa' + 't-' + lower(26) + '-' + alnum(32, 'lazy'),
  'particle': () => 'prt' + '-' + rand(4) + '_' + alnum(38, 'vpn'),
};
const CONTEXTS: Record<string, (v: string) => string> = {
  log: (v) => 'POST /v1/messages HTTP/1.1\nx-request-id: 1\nvalue ' + v + '\n',
  json: (v) => JSON.stringify({ run: 'x', note: v }) + '\n',
};

test.skipIf(!READY)('every minted token and provider key shape is refused on its own line, with a stopword inside it, and never printed', () => {
  const r = fresh();
  const files: Record<string, string> = {};
  const values: string[] = [];
  const want: string[] = [];
  for (const [shape, make] of Object.entries(SHAPES)) {
    for (const [ctx, wrap] of Object.entries(CONTEXTS)) {
      const v = make();
      values.push(v);
      const path = 'notes/' + shape + '.' + ctx + '.txt';
      files[path] = wrap(v);
      want.push(path + ':' + (files[path]!.split('\n').findIndex((l) => l.includes(v)) + 1));
    }
  }
  const bind = hex(64, 'dead');
  files['notes/bind.sh'] = 'curl -X POST 127.0.0.1:8790/__proxy/bind -d ' + JSON.stringify(JSON.stringify({ slot: 'laneb', token: bind })) + '\n';
  const control = alnum(22, 'hero');
  files['notes/control.sh'] = 'curl -H "x-proxy-' + 'control: ' + control + '" 127.0.0.1:8790/__proxy/usage\n';
  const slot = hex(64, 'cafe');
  files['notes/slot.sh'] = 'slot_' + 'token=' + slot + '\n';
  const bearer = alnum(40, 'yaml');
  files['notes/bearer.log'] = 'GET /mcp\nAuthorization: Bearer ' + bearer + '\n';
  const arg = alnum(22, 'lazy');
  files['notes/proxy-argv.log'] = 'spawn bun runner/proxy/metering-proxy.ts --listen 127.0.0.1:0 --control-' + 'token ' + arg + ' --allow-models x\n';
  const bearerTrial = 'trial-' + 'token:t9.' + hex(32, 'cafe');
  files['notes/bearer-trial.log'] = 'GET /v1/models\nAuthorization: Bearer ' + bearerTrial + '\n';
  const quoted = hex(64, 'feed');
  files['notes/headers.py.log'] = "request headers: {'authorization': 'Bearer " + quoted + "', 'accept': '*/*'}\n";
  values.push(bind, control, slot, bearer, arg, quoted, bearerTrial);
  want.push('notes/bind.sh:1', 'notes/control.sh:1', 'notes/slot.sh:1', 'notes/bearer.log:2', 'notes/proxy-argv.log:1', 'notes/headers.py.log:1', 'notes/bearer-trial.log:2');
  r.commit(files, 'add canaries');
  const out = range(r);
  expect(out.status).toBe(1);
  const got = new Set(flagged(out.stdout));
  for (const w of want) expect(got.has(w), w).toBe(true);
  for (const v of values) expect(out.all).not.toContain(v);
}, 300_000);

test.skipIf(!READY)('made-up fixture suffixes and documented placeholders pass', () => {
  const r = fresh();
  const tt = (s: string) => 'trial-' + 'token:golden.' + s;
  r.commit({
    'tests/fixtures/golden.json': JSON.stringify({
      ANTHROPIC_API_KEY: tt('0123456789abcdef'.repeat(2)),
      OPENAI_API_KEY: tt('0'.repeat(28) + '0001'),
      HE_MODEL_API_KEY: tt('00112233445566778899aabbccddeeff'),
      judge: 'judge-' + 'secondary:run.' + 'f'.repeat(32),
    }, null, 2) + '\n',
    'harnesses/x/pin.json': JSON.stringify({ api_key: 'Authorization: Bearer HE_MODEL_API_KEY', mcp: 'headers.Authorization: Bearer world-token-golden' }, null, 2) + '\n',
    'tests/x.test.ts': "expect(seen).toMatchObject({ authorization: 'Bearer " + tt('0123456789abcdef'.repeat(2)) + "' });\n",
    'scripts/x.sh': 'curl -H "x-proxy-' + 'control: $SHOOTOUT_PROXY_CONTROL_TOKEN" http://127.0.0.1/\nslot_' + 'token=SLOT_TOKEN_FROM_ENV\n',
  }, 'add placeholders');
  const out = range(r);
  expect(flagged(out.stdout)).toEqual([]);
  expect(out.status).toBe(0);
}, 300_000);

test.skipIf(!READY)('an ingest_tokens_sha256 key spelled with unicode escapes is still refused', () => {
  const r = fresh();
  const key = [...'ingest_tokens_sha256'].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const one = 'ingest_tokens_sha256'.replace('i', '\\u0069');
  const v1 = randomBytes(32).toString('hex');
  const v2 = randomBytes(32).toString('hex');
  r.commit({ 'notes/all.json': '{"' + key + '": "' + v1 + '"}\n', 'notes/one.json': '{"' + one + '": "' + v2 + '"}\n' }, 'add escaped keys');
  const out = range(r);
  expect(out.status).toBe(1);
  const got = new Set(flagged(out.stdout));
  expect(got.has('notes/all.json:1')).toBe(true);
  expect(got.has('notes/one.json:1')).toBe(true);
  for (const v of [v1, v2]) expect(out.all).not.toContain(v);
}, 300_000);
