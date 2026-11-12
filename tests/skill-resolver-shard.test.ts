import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QM_PULL_SANDBOX_IMAGE, setTEnv, skillArmImage } from '../runner/trial/set-t.ts';
import { armImagesToBuild, checkSkillRoot, shardSkillNeeds } from '../scripts/skill-resolver/shard-kit.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('skill-arm cell images (internal-task)', () => {
  test('push harnesses run in harness-eval/<h>:skills-kit, QM in its config\'s arm image, other cells in none', () => {
    expect(skillArmImage({ harness: 'openclaw', skill_arm: 'native', config: 'skills-native' })).toBe('harness-eval/openclaw:skills-kit');
    expect(skillArmImage({ harness: 'codex', skill_arm: 'no-catalog', config: 'skills-no-catalog' })).toBe('harness-eval/codex:skills-kit');
    expect(skillArmImage({ harness: 'qm', skill_arm: 'native', config: 'pi-skills-native' })).toBe('harness-eval/qm:harn52-arm-catalog');
    expect(skillArmImage({ harness: 'qm', skill_arm: 'resolver-on', config: 'pi-skills-push' })).toBe('harness-eval/qm:harn52-arm-catalog');
    expect(skillArmImage({ harness: 'qm', skill_arm: 'qm-pull', config: 'pi-skills-pull' })).toBe('harness-eval/qm:harn52-arm-pull');
    expect(skillArmImage({ harness: 'qm', skill_arm: 'no-catalog', config: 'pi-skills-none' })).toBe('harness-eval/qm:harn52-arm-none');
    expect(skillArmImage({ harness: 'openclaw' })).toBeUndefined();
    expect(() => skillArmImage({ id: 'x', harness: 'qm', skill_arm: 'native', config: 'pi' })).toThrow(/HE-PREREG-004/);
  });

  test('only the pull arm sets its own sandbox image', () => {
    expect(setTEnv({ skill_arm: 'qm-pull', config: 'pi-skills-pull' })).toEqual({ HE_SKILL_ARM: 'qm-pull', HE_HARNESS_CONFIG: 'pi-skills-pull', QM_SANDBOX_IMAGE: QM_PULL_SANDBOX_IMAGE });
    expect(setTEnv({ skill_arm: 'native', config: 'pi-skills-native' })).toEqual({ HE_SKILL_ARM: 'native', HE_HARNESS_CONFIG: 'pi-skills-native' });
  });
});

describe('shard-kit.ts', () => {
  test('a shard needs the kit images of its skill-arm cells only', () => {
    expect(shardSkillNeeds([
      { id: 'a', harness: 'openclaw', skill_arm: 'native' }, { id: 'b', harness: 'qm', skill_arm: 'native', config: 'pi-skills-native' },
      { id: 'c', harness: 'qm', skill_arm: 'no-catalog', config: 'pi-skills-none' }, { id: 'd', harness: 'hermes' },
    ])).toEqual({ push: ['openclaw'], qmConfigs: ['pi-skills-native', 'pi-skills-none'] });
    expect(shardSkillNeeds([{ id: 'd', harness: 'hermes' }])).toEqual({ push: [], qmConfigs: [] });
    expect(() => shardSkillNeeds([{ id: 'e', harness: 'qm', skill_arm: 'native', config: 'pi' }])).toThrow(/no arm image/);
  });

  test('the skill root must match every pinned input', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-root-'));
    try {
      mkdirSync(join(root, 'kit', 'bin'), { recursive: true });
      mkdirSync(join(root, 'inputs', 'catalog'), { recursive: true });
      writeFileSync(join(root, 'kit', 'bin', 'gbrain'), 'glibc');
      writeFileSync(join(root, 'gbrain-linux-x64-musl'), 'musl');
      writeFileSync(join(root, 'inputs', 'setp.jsonl'), 'rows\n');
      const md = '---\nname: a\n---\n';
      for (const dir of ['inputs', 'kit']) { mkdirSync(join(root, dir, 'catalog', 'skills', 'a'), { recursive: true }); writeFileSync(join(root, dir, 'catalog', 'skills', 'a', 'SKILL.md'), md); }
      const c1 = sha(['a', sha(md), sha('SKILL.md\t' + sha(md))].join('\t'));
      writeFileSync(join(root, 'inputs', 'catalog', 'manifest.json'), JSON.stringify({ catalog_hash: c1 }));
      writeFileSync(join(root, 'kit', 'kit.json'), JSON.stringify({ catalog_hash: c1, gbrain_version: 'gbrain 0.60.633.0', gbrain: { stand_in: false } }));
      const inputs = {
        '.skill-resolver/setp.jsonl': { sha256: sha('rows\n') }, '.skill-resolver/catalog/manifest.json': { catalog_hash: c1 },
        resolver: { tag: 'v0.60.633.0', binary_sha256: { 'linux-x64': sha('glibc'), 'linux-x64-musl': sha('musl') } },
      };
      expect(checkSkillRoot(root, inputs)).toEqual([]);
      writeFileSync(join(root, 'gbrain-linux-x64-musl'), 'other');
      writeFileSync(join(root, 'inputs', 'setp.jsonl'), 'changed\n');
      writeFileSync(join(root, 'kit', 'kit.json'), JSON.stringify({ catalog_hash: 'c2', gbrain_version: '0.60.640.0', gbrain: { stand_in: true } }));
      const problems = checkSkillRoot(root, inputs).join('\n');
      expect(problems).toMatch(/gbrain-linux-x64-musl has sha256/);
      expect(problems).toMatch(/setp.jsonl has sha256/);
      expect(problems).toMatch(/stand-in/);
      expect(problems).toMatch(/gbrain_version 0.60.640.0/);
      expect(problems).toMatch(/kit.json catalog_hash/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the installed skill files are hashed, so a kit whose stated catalog_hash is right but whose skill bytes differ fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-root-'));
    try {
      mkdirSync(join(root, 'kit', 'bin'), { recursive: true });
      writeFileSync(join(root, 'kit', 'bin', 'gbrain'), 'glibc');
      writeFileSync(join(root, 'gbrain-linux-x64-musl'), 'musl');
      const md = '---\nname: a\n---\n';
      for (const dir of ['inputs', 'kit']) { mkdirSync(join(root, dir, 'catalog', 'skills', 'a', 'ref'), { recursive: true }); writeFileSync(join(root, dir, 'catalog', 'skills', 'a', 'SKILL.md'), md); writeFileSync(join(root, dir, 'catalog', 'skills', 'a', 'ref', 'x.md'), 'x'); }
      const c1 = sha(['a', sha(md), sha('ref/x.md\t' + sha('x') + '\nSKILL.md\t' + sha(md))].join('\t'));
      writeFileSync(join(root, 'inputs', 'catalog', 'manifest.json'), JSON.stringify({ catalog_hash: c1 }));
      writeFileSync(join(root, 'kit', 'kit.json'), JSON.stringify({ catalog_hash: c1, gbrain_version: 'gbrain 0.60.633.0', gbrain: { stand_in: false } }));
      const inputs = { '.skill-resolver/catalog/manifest.json': { catalog_hash: c1 }, resolver: { tag: 'v0.60.633.0', binary_sha256: { 'linux-x64': sha('glibc'), 'linux-x64-musl': sha('musl') } } };
      expect(checkSkillRoot(root, inputs)).toEqual([]);
      writeFileSync(join(root, 'kit', 'catalog', 'skills', 'a', 'ref', 'x.md'), 'substituted');
      expect(checkSkillRoot(root, inputs)).toEqual([join(root, 'kit', 'catalog', 'skills') + ' hashes to catalog ' + sha(['a', sha(md), sha('ref/x.md\t' + sha('substituted') + '\nSKILL.md\t' + sha(md))].join('\t')).slice(0, 12) + ', the preregistration pins ' + c1.slice(0, 12)]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('--skip-build still builds the arm images a first-cell smoke left out (a QM shard that mixes arms)', () => {
    const needs = { push: ['openclaw'], qmConfigs: ['pi-skills-native', 'pi-skills-none', 'pi-skills-pull'] };
    const built = new Set(['harness-eval/openclaw:skills-kit', 'harness-eval/qm:harn52-arm-catalog', 'harness-eval/qm:harn52-arm-pull']);
    expect(armImagesToBuild(needs, false, (t) => built.has(t))).toEqual(needs);
    expect(armImagesToBuild(needs, true, (t) => built.has(t))).toEqual({ push: [], qmConfigs: ['pi-skills-none', 'pi-skills-pull'] });
    expect(armImagesToBuild(needs, true, () => true)).toEqual({ push: [], qmConfigs: [] });
  });
});
