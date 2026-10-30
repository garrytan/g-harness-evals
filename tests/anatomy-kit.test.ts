// The anatomy kit's helper files (internal-task): the egress sink, the probe-skill image, count-tokens.ts's refusals and
// publish.sh end to end on a captured log. Keyless; every child process runs under an allowlisted environment.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { dissect, readLog } from '../scripts/anatomy/dissect.ts';
import { unpack } from '../scripts/anatomy/store.ts';

const ROOT = join(import.meta.dir, '..');
const A = join(ROOT, 'scripts', 'anatomy');
const env = (home: string) => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home });

describe('anatomy kit files (internal-task)', () => {
  test('scripts/anatomy/sink/sink.py compiles and scripts/anatomy/sink/Dockerfile runs it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-kit-'));
    const res = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', join(A, 'sink', 'sink.py')], { env: env(dir), encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    const docker = readFileSync(join(A, 'sink', 'Dockerfile'), 'utf8');
    expect(docker).toContain('COPY sink.py /sink.py');
    expect(docker).toContain('/sink.py"]');
  });

  test('scripts/anatomy/probe-skills/gen-skills.py writes one SKILL.md per size, never over the size', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-kit-'));
    const res = spawnSync('python3', [join(A, 'probe-skills', 'gen-skills.py'), join(dir, 'skills'), '4,12'], { env: env(dir), encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(readdirSync(join(dir, 'skills')).sort()).toEqual(['probe-12k', 'probe-4k']);
    for (const kb of [4, 12]) {
      const path = join(dir, 'skills', `probe-${kb}k`, 'SKILL.md');
      const text = readFileSync(path, 'utf8');
      expect(text.startsWith(`---\nname: probe-${kb}k\ndescription: `)).toBe(true);
      expect(statSync(path).size).toBeLessThanOrEqual(kb * 1024);
      expect(statSync(path).size).toBeGreaterThan(kb * 1024 - 100);
    }
  });

  test('scripts/anatomy/probe-skills/Dockerfile installs skills-entry.sh, which parses and hands over to the counted adapter', () => {
    const docker = readFileSync(join(A, 'probe-skills', 'Dockerfile'), 'utf8');
    expect(docker).toContain('COPY gen-skills.py /opt/anatomy/gen-skills.py');
    expect(docker).toContain('COPY skills-entry.sh /opt/anatomy/skills-entry.sh');
    expect(docker).toContain('ENTRYPOINT ["/opt/anatomy/skills-entry.sh"]');
    const entry = join(A, 'probe-skills', 'skills-entry.sh');
    expect(spawnSync('bash', ['-n', entry]).status).toBe(0);
    expect(readFileSync(entry, 'utf8')).toContain('exec /opt/harness/adapter.sh "$@"');
  });

  test('scripts/anatomy/count-tokens.ts: usage error without --capture, and a plain refusal when the key is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-kit-'));
    const usage = spawnSync(process.execPath, [join(A, 'count-tokens.ts')], { cwd: ROOT, env: env(dir), encoding: 'utf8' });
    expect(usage.status).toBe(64);
    expect(usage.stderr).toContain('usage: count-tokens.ts --capture');
    const nokey = spawnSync(process.execPath, [join(A, 'count-tokens.ts'), '--capture', dir], { cwd: ROOT, env: env(dir), encoding: 'utf8' });
    expect(nokey.status).not.toBe(0);
    expect(nokey.stderr).toContain('ANTHROPIC_API_KEY is not set');
  });

  test('scripts/anatomy/publish.sh turns a capture into a record and receipts that rebuild the log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-kit-'));
    const cap = join(dir, 'anatomy-capture-openclaw-spike-plain-test');
    mkdirSync(cap);
    const log = gunzipSync(readFileSync(join(ROOT, 'tests', 'fixtures', 'anatomy', 'openclaw-2026.10.6-spike.ndjson.gz'))).toString('utf8');
    writeFileSync(join(cap, 'fake.ndjson'), log);
    const sha = createHash('sha256').update(log).digest('hex');
    writeFileSync(join(cap, 'capture.json'), JSON.stringify({ harness: 'openclaw', config: 'spike', scenario: 'plain', gbrain: false, files: { 'fake.ndjson': sha } }));
    const out = join(dir, 'out');
    const res = spawnSync('bash', [join(A, 'publish.sh'), cap], { cwd: ROOT, env: { ...env(dir), ANATOMY_OUT: out }, encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('PUBLISH: anatomy-capture-openclaw-spike-plain-test -> records/openclaw-spike/plain.json');
    const rec = JSON.parse(readFileSync(join(out, 'records', 'openclaw-spike', 'plain.json'), 'utf8'));
    const { rows } = readLog(join(cap, 'fake.ndjson'));
    expect(rec).toEqual(JSON.parse(JSON.stringify(dissect(rows, { harness: 'openclaw', config: 'spike', source_log_sha256: sha }))));
    const receipts = join(out, 'receipts', 'anatomy-capture-openclaw-spike-plain-test');
    expect(existsSync(join(receipts, 'capture.json'))).toBe(true);
    expect(unpack(receipts)).toBe(log.endsWith('\n') ? log : log + '\n');
  });
});
