// scripts/local-paths.ts: machine-local paths come from an env var, else config/local-paths.json (private checkout only),
// else undefined, so no drive path is written in code.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCAL_PATH_ENV, LOCAL_PATHS_FILE, localPath } from '../scripts/local-paths.ts';

describe('local paths', () => {
  test.skipIf(!existsSync(LOCAL_PATHS_FILE))('config/local-paths.json (left out of the public export) names a path for every key', () => {
    expect(LOCAL_PATHS_FILE.endsWith(join('config', 'local-paths.json'))).toBe(true);
    for (const key of Object.keys(LOCAL_PATH_ENV) as Array<keyof typeof LOCAL_PATH_ENV>) {
      expect(typeof localPath(key, {})).toBe('string');
    }
  });

  test('the env var wins, then the config file; with neither the path is undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'local-paths-'));
    const file = join(dir, 'local-paths.json');
    writeFileSync(file, JSON.stringify({ custody_identity: '/from/config' }));
    expect(localPath('custody_identity', { HE_CUSTODY_IDENTITY: '/from/env' }, file)).toBe('/from/env');
    expect(localPath('custody_identity', {}, file)).toBe('/from/config');
    expect(localPath('gsta135_drive_copy', {}, file)).toBeUndefined();
    expect(localPath('custody_identity', {}, join(dir, 'absent.json'))).toBeUndefined();
  });
});
