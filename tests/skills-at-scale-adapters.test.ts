/**
 * The skills-at-scale configs in the five adapters (internal-task; scripts/skills-at-scale/README.md), keyless and with no docker:
 * each adapter refuses a skills-at-scale config on the run entry (the arms are applied for the serve entry only), only
 * OpenClaw takes the -printed-fix and -default-limits variants, and Pi's arms keep its agent dir at <state>/pi, where the
 * catalog lands at <state>/pi/skills. Every process gets a scrubbed environment and a placeholder key.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HARNESSES = ['claude-code', 'codex', 'hermes', 'openclaw', 'pi'] as const;

function runEntry(h: string, config: string): { exit: number | null; log: string } {
  const d = mkdtempSync(join(tmpdir(), 'sas-adapter-'));
  try {
    const r = spawnSync('bash', [join('harnesses', h, 'adapter.sh'), 'run'], {
      env: { PATH: '/usr/bin:/bin', HOME: d, HE_LOG_DIR: join(d, 'logs'), HE_SESSION_STATE_DIR: join(d, 'state'), HE_WORKSPACE_DIR: join(d, 'ws'),
        HE_MODEL_BASE_URL: 'http://127.0.0.1:1/t/' + (h === 'codex' ? 'openai' : 'anthropic'), HE_MODEL_API_KEY: 'placeholder', HE_MODEL_NAME: 'm', HE_HARNESS_CONFIG: config },
      encoding: 'utf8', timeout: 20_000,
    });
    let log = '';
    try { log = readFileSync(join(d, 'logs', 'adapter.log'), 'utf8'); } catch { /* no log */ }
    return { exit: r.status, log };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

describe('skills-at-scale configs in the adapters', () => {
  for (const h of HARNESSES) {
    test(h + ' refuses each skills-at-scale config on the run entry', () => {
      for (const config of ['skills-catalog', 'skills-gbrain-setup', 'skills-gbrain-pins']) {
        const r = runEntry(h, config);
        expect(r.exit).toBe(2);
        expect(r.log).toContain('HE-ADAPTER-007 HE_HARNESS_CONFIG=' + config);
      }
    });
  }
  test('only OpenClaw names the -printed-fix and -default-limits variants', () => {
    for (const h of HARNESSES) {
      const src = readFileSync(join('harnesses', h, 'adapter.sh'), 'utf8');
      expect(src.includes('skills-gbrain-setup-printed-fix')).toBe(h === 'openclaw');
      expect(src.includes('skills-gbrain-setup-default-limits')).toBe(h === 'openclaw');
    }
  });
  test('Pi keeps its agent dir at <state>/pi on the arms, so the catalog lands in /harness-state/pi/skills', () => {
    const src = readFileSync(join('harnesses', 'pi', 'adapter.sh'), 'utf8');
    expect(src).toContain('[ -z "$sas_config" ] || export PI_CODING_AGENT_DIR="$HE_SESSION_STATE_DIR/pi"');
    expect(src).toContain('--dest "$PI_CODING_AGENT_DIR/skills"');
  });
});
