// Keyless checks on the skills-at-scale setup files that no other test reads: the gbrain pin, the recorded keyless outputs,
// the session models (R116: Opus 5.5 and GPT-6.2 Sol) and the QM, Gemini CLI and Pi helpers (internal-task).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { SESSION_MODEL } from '../scripts/skills-at-scale/session.ts';
import { qmCell, QM_ROUTES } from '../scripts/skills-at-scale/qm-listing-map.ts';
import { GEMINI_CLI_VERSION, GEMINI_SETTINGS } from '../scripts/skills-at-scale/gemini-listing.ts';
import { PI_TRACE_PROMPT, PI_TRACE_SKILL_ROOT } from '../scripts/skills-at-scale/pi-trace.ts';

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('skills-at-scale setup files', () => {
  test('the gbrain pin names one release by tag, full commit and asset sha256', () => {
    const pin = json('scripts/skills-at-scale/gbrain-pin.json');
    expect(pin.tag).toBe('v' + pin.version);
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.install).toBe('bun install -g github:garrytan/gbrain#' + pin.tag);
  });

  test('each recorded keyless output parses and says what it is', () => {
    for (const f of ['scripts/skills-at-scale/outputs/checks.json', 'scripts/skills-at-scale/outputs/hermes-ranked-text.json', 'scripts/skills-at-scale/outputs/map.json',
      'scripts/skills-at-scale/outputs/newest-releases.json', 'scripts/skills-at-scale/outputs/qm-map-plugin-dirs.json', 'scripts/skills-at-scale/outputs/qm-map.json']) {
      expect(json(f).schema_version).toBe(1);
    }
    expect(json('scripts/skills-at-scale/outputs/qm-installer.json').harness).toBe('qm');
    expect(json('scripts/skills-at-scale/outputs/map.json').cells.length).toBeGreaterThan(0);
  });

  test('sessions run Opus 5.5, and Codex runs GPT-6.2 Sol', () => {
    for (const [h, m] of Object.entries(SESSION_MODEL)) expect(m).toBe(h === 'codex' ? 'openai:gpt-6.2-sol' : 'anthropic:claude-opus-5-5');
  });

  test('QM: a Skills block places each catalog skill as the listing map does', () => {
    const desc = 'Draft the weekly hiring report from the applicant tracker.';
    const c = qmCell(2, 'native', [{ name: 'hiring-report', description: desc }, { name: 'offsite-plan', description: 'Plan a team offsite with an agenda.' }] as never,
      '## Skills\nUse a skill when it fits.\n- hiring-report — ' + desc, new Set(['hiring-report', 'offsite-plan']), {});
    expect(c.counts.with_description).toBe(1);
    expect(c.counts.loaded_not_shown).toBe(1);
    expect(Object.keys(QM_ROUTES)).toEqual(['deployment-layer', 'plugin-dirs']);
  });

  test('Gemini CLI and Pi helpers pin their version and paths', () => {
    expect(GEMINI_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(GEMINI_SETTINGS.privacy.usageStatisticsEnabled).toBe(false);
    expect(PI_TRACE_SKILL_ROOT).toBe('/harness-state/pi/skills');
    expect(PI_TRACE_PROMPT.length).toBeGreaterThan(0);
    expect(readFileSync('scripts/skills-at-scale/qm-installer-check.ts', 'utf8')).toContain('if (import.meta.main) {');
  });
});
