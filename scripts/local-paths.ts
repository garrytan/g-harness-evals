/**
 * Machine-local paths (the custody identity's drive copy, a drive copy of published receipts) are not written in code.
 * Each one comes from its environment variable when set, else from config/local-paths.json, a private-checkout file the
 * public export leaves out. When neither has it, the path is undefined and the caller asks for a flag or skips.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCAL_PATHS_FILE = join(import.meta.dir, '..', 'config', 'local-paths.json');

export const LOCAL_PATH_ENV = {
  custody_identity: 'HE_CUSTODY_IDENTITY',
  gsta135_drive_copy: 'HE_GSTA135_DRIVE_COPY',
} as const;

export type LocalPathKey = keyof typeof LOCAL_PATH_ENV;

export function localPath(key: LocalPathKey, env: Record<string, string | undefined> = process.env, file = LOCAL_PATHS_FILE): string | undefined {
  const fromEnv = env[LOCAL_PATH_ENV[key]];
  if (fromEnv) return fromEnv;
  if (!existsSync(file)) return undefined;
  const value = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}
