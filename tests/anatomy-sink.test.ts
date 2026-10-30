import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const docker = spawnSync('docker', ['image', 'inspect', 'harness-eval/anatomy-sink:dev'], { encoding: 'utf8' }).status === 0
  && spawnSync('docker', ['image', 'inspect', 'curlimages/curl:latest'], { encoding: 'utf8' }).status === 0;

describe('anatomy egress sink (internal-task)', () => {
  test.skipIf(!docker)('a direct outside connection from a container produces a dns line and a tcp line with the host name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anatomy-sink-'));
    const name = `anat-sink-test-${process.pid}`;
    try {
      expect(spawnSync('docker', ['run', '-d', '--rm', '--name', name, '-v', `${dir}:/out`, 'harness-eval/anatomy-sink:dev', '--log', '/out/egress.ndjson', '--mode', 'refuse']).status).toBe(0);
      let lines: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 50 && !lines.some((l) => l.kind === 'ready'); i++) {
        spawnSync('sleep', ['0.2']);
        try { lines = readFileSync(join(dir, 'egress.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { /* not yet */ }
      }
      const ip = String(lines.find((l) => l.kind === 'ready')!.address);
      spawnSync('docker', ['run', '--rm', '--dns', ip, 'curlimages/curl:latest', '-s', '-m', '5', 'http://update.anatomy-test.example/check'], { encoding: 'utf8', timeout: 30_000 });
      spawnSync('sleep', ['1']);
      lines = readFileSync(join(dir, 'egress.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.some((l) => l.kind === 'dns' && l.qname === 'update.anatomy-test.example')).toBe(true);
      expect(lines.some((l) => l.kind === 'tcp' && l.port === 80 && l.host === 'update.anatomy-test.example')).toBe(true);
    } finally {
      spawnSync('docker', ['rm', '-f', name]);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
