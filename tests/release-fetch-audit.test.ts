import { expect, test } from 'bun:test';
import { addTranscriptIdentities, auditTrial, baseIdentities, flagOf, mask, readCalls, repoFromTask } from '../scripts/frontier-harbor/release-fetch-audit.ts';

const BASE = '0123456789abcdef0123456789abcdef01234567';
let n = 0;
const step = (command: string, result: string, tool = 'Bash') => {
  const id = 'toolu_' + ++n;
  const args = tool === 'Read' ? { file_path: command } : { command };
  return { step_id: String(n), source: 'agent', tool_calls: [{ tool_call_id: id, function_name: tool, arguments: args }], observation: { results: [{ source_call_id: id, content: result }] } };
};
const run = (task: string, steps: any[]) => {
  const ids = baseIdentities(task, { repo: repoFromTask(task), base_commit: BASE });
  const calls = readCalls({ steps });
  addTranscriptIdentities(ids, calls, 'r/cell/' + task + '/a1');
  const hits = auditTrial(calls, ids);
  return { hits, flag: flagOf(hits), ids };
};

test('a clone of the upstream that the sandbox blocks is attempted, not fetched', () => {
  const r = run('acme__widget-12', [step('cd /tmp && git clone --depth 1 https://github.com/acme/widget.git up 2>&1 | tail -2', "fatal: unable to access 'https://github.com/acme/widget.git/': gnutls_handshake() failed")]);
  expect(r.flag).toBe('attempted');
  expect(r.hits).toHaveLength(1);
  expect(r.hits[0]).toMatchObject({ route: 'git clone', kind: 'code', outcome: 'failed', identity: 'acme/widget', identity_source: 'Harbor dataset tests/config.json' });
});

test('a successful go get of the module at @latest is fetched, with the module path taken from the go.mod the agent read', () => {
  const r = run('acme__widget-12', [
    step('/src/widget/go.mod', '     1\tmodule example.dev/widget\n     2\t\n     3\tgo 1.24\n', 'Read'),
    step('cd /tmp/x && go get example.dev/widget@latest', 'go: downloading example.dev/widget v1.4.0\ngo: added example.dev/widget v1.4.0'),
  ]);
  expect(r.flag).toBe('fetched');
  expect(r.hits[0]).toMatchObject({ route: 'go get', kind: 'code', outcome: 'succeeded', identity: 'example.dev/widget', identity_source: 'transcript r/cell/acme__widget-12/a1: go.mod' });
});

test('installs of unrelated dependencies are not flagged', () => {
  const r = run('acme__widget-12', [
    step('pip install requests==2.32.0 && npm install lodash@4 && go install github.com/itchyny/gojq/cmd/gojq@latest', 'Successfully installed requests-2.32.0\nadded 1 package\ngo: downloading github.com/itchyny/gojq v0.12.17'),
    step('curl -sS https://pypi.org/pypi/requests/json | head -c 100', '{"info":{"version":"2.32.3"}}'),
  ]);
  expect(r.hits).toEqual([]);
  expect(r.flag).toBe('none');
});

test('builds and installs of the local checkout are not flagged', () => {
  const r = run('acme__widget-12', [
    step('cd /widget && go build ./... && go test ./... 2>&1 | tail -3', 'ok  \texample.dev/widget\t0.2s'),
    step('pip install -e . && npm install && cargo build --release && mvn -q -pl core install -DskipTests', 'Successfully installed widget-0.0.0'),
    step('npx widget --help', 'Usage: widget [options]'),
  ]);
  expect(r.flag).toBe('none');
});

test('a quiet download of the package at another version that the agent then unpacks is fetched', () => {
  const r = run('acme__widget-12', [step("mkdir -p /tmp/ref && cd /tmp/ref && pip download widget==2.0.0 --no-deps -q -d . 2>&1 | tail -2; unzip -q -o *.whl -d x; grep -n 'def fix' x/widget/core.py", '12:def fix(self):')]);
  expect(r.flag).toBe('fetched');
  expect(r.hits[0]).toMatchObject({ route: 'pip download', identity: 'widget', identity_source: 'repo name', outcome: 'succeeded' });
});

test('the base commit is exempt, issue searches never flag, and other hosts flag by route', () => {
  const base = run('acme__widget-12', [step('curl -fsSL https://codeload.github.com/acme/widget/tar.gz/' + BASE + ' | tar -xz', '')]);
  expect(base.flag).toBe('none');
  const issues = run('acme__widget-12', [step('curl -s "https://api.github.com/search/issues?q=repo:acme/widget+crash"', '{"total_count": 3}')]);
  expect(issues.hits[0].kind).toBe('discussion');
  expect(issues.flag).toBe('none');
  const cdn = run('acme__widget-12', [step('B=https://cdn.jsdelivr.net/gh/acme/widget@main/src; curl -sS -w "%{http_code}\\n" $B/core.ts -o core.ts', '200')]);
  expect(cdn.flag).toBe('fetched');
  const mention = run('acme__widget-12', [step("cat > t.py <<'EOF'\n# see https://github.com/acme/widget/issues/7\nEOF\ngit status --short", '')]);
  expect(mention.hits).toEqual([]);
});

test('evidence masks token-looking strings and stays within 200 characters', () => {
  const fake = 'abcdefghijklmnopqrstuvwxyz' + '0123';
  expect(mask('curl -H "Authorization: Bearer ' + fake + '" https://x')).not.toContain('abcdefghijklmnop');
  expect(mask('GH_TOKEN=ghp_' + 'a'.repeat(36) + ' gh api repos/acme/widget')).toContain('<masked>');
  const r = run('acme__widget-12', [step('curl -sS https://raw.githubusercontent.com/acme/widget/main/src/core.ts?token=sk-' + 'b'.repeat(30) + ' ' + 'x'.repeat(300), 'curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL')]);
  expect(r.flag).toBe('attempted');
  expect(r.hits[0].evidence.length).toBeLessThanOrEqual(200);
  expect(r.hits[0].evidence).not.toContain('bbbbbbbbbbbb');
});
