// internal-task gate F: one list of provider key names. scripts/ubicloud/provider-keys.sh is what run-shard.sh forwards to a VM,
// what vm-run.sh hands to the metering proxy alone, and what the keyless steps of vm-shard.sh and merge-pass.sh drop.
//
// Value: protects=a new provider key (GEMINI_API_KEY, XAI_API_KEY) reaching the proxy and no keyless step, from one edit;
// fails_when=a script keeps its own hand list, the registry drifts from the proxy's KEY_ENV, or run_scrubbed would pass a
// key to a process KEEP does not name; seam=the registry sourced in a scrubbed bash; no_claim=a VM run.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEY_ENV } from '../runner/proxy/metering-proxy.ts';

const ROOT = join(import.meta.dir, '..');
const REGISTRY = join(ROOT, 'scripts/ubicloud/provider-keys.sh');
const PATH = process.env.PATH ?? '/usr/bin:/bin';
const sourced = (expr: string) => spawnSync('bash', ['--noprofile', '--norc', '-c', '. "$0"; ' + expr, REGISTRY], { env: { PATH }, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const PROVIDER = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'PARTICLE_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY'];
const NAMED = /\b(ANTHROPIC|OPENAI|PARTICLE|OPENROUTER|GEMINI|XAI)_API_KEY\b/g;

describe('the provider key registry', () => {
  test('lists the six model keys, matches the metering proxy\'s KEY_ENV (VOYAGE_API_KEY aside), and drops two more keys in keyless steps', () => {
    expect(sourced('printf "%s\\n" "${provider_keys[@]}"')).toEqual(PROVIDER);
    expect([...sourced('printf "%s\\n" "${provider_keys[@]}"')].sort()).toEqual(Object.values(KEY_ENV).filter((k) => k !== 'VOYAGE_API_KEY').sort());
    expect(sourced('printf "%s\\n" "${keyless_keys[@]}"')).toEqual([...PROVIDER, 'UBICLOUD_API_KEY', 'CURSOR_API_KEY']);
    expect(sourced('printf "%s\\n" "${keyless_unset[@]}"')).toEqual([...PROVIDER, 'UBICLOUD_API_KEY', 'CURSOR_API_KEY'].flatMap((k) => ['-u', k]));
  });

  const scripts = ['scripts/frontier-harbor/vm-run.sh', 'scripts/ubicloud/run-shard.sh', 'scripts/ubicloud/vm-shard.sh', 'scripts/ubicloud/merge-pass.sh'];
  for (const file of scripts) {
    // merge-pass.sh stays out of the public export (scripts/public-export), so the public copy skips it.
    test.skipIf(!existsSync(join(ROOT, file)))(file + ' sources the registry and keeps no hand list of provider keys', () => {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
      expect(lines.some((l) => /^\s*\. ".*provider-keys\.sh"/.test(l))).toBe(true);
      const lists = lines.filter((l) => !l.trimStart().startsWith('#') && new Set(l.match(NAMED) ?? []).size > 1);
      expect(lists).toEqual([]);
    });
  }

  test('the keyless steps unset keyless_unset, and run-shard.sh uploads the registry beside vm-shard.sh and forwards provider_keys', () => {
    const shard = readFileSync(join(ROOT, 'scripts/ubicloud/vm-shard.sh'), 'utf8');
    expect(shard).toContain('. "$(cd "$(dirname "$0")" && pwd)/provider-keys.sh"');
    expect(shard.match(/env "\$\{keyless_unset\[@\]\}"/g)).toHaveLength(3);
    const run = readFileSync(join(ROOT, 'scripts/ubicloud/run-shard.sh'), 'utf8');
    expect(run).toContain("vssh 'mkdir -p ~/shard/bin && cat > ~/shard/bin/provider-keys.sh' < \"$here/provider-keys.sh\"");
    expect(run).toContain('for k in "${provider_keys[@]}"; do if [ -n "${!k:-}" ]; then printf \'export %s=%q\\n\' "$k" "${!k}"; fi; done;');
  });

  test('vm-run.sh holds GEMINI_API_KEY and XAI_API_KEY for the proxy: no longer unset, checked per provider, and passed only where KEEP names them', () => {
    const src = readFileSync(join(ROOT, 'scripts/frontier-harbor/vm-run.sh'), 'utf8');
    expect(src).not.toMatch(/^unset .*\bGEMINI_API_KEY\b/m);
    expect(src).toContain('google) [ -n "${OPENROUTER_API_KEY:+x}" ] ||');
    expect(src).toContain('xai) [ -n "${XAI_API_KEY:+x}" ] ||');
    expect(src).toContain('--upstream google=http://127.0.0.1:8799/google --upstream xai=http://127.0.0.1:8799/xai');
    const fn = src.match(/^run_scrubbed\(\) \{\n[\s\S]*?\n\}\n/m)![0];
    const canary = 'fake-provider-key-canary-' + randomBytes(8).toString('hex');
    const probe = (keep: string) => spawnSync('bash', ['--noprofile', '--norc', '-c', '. "$0"; ' + fn + '(KEEP="' + keep + '" run_scrubbed python3 -c \'import os, sys; sys.stdout.write(",".join(k for k in ("GEMINI_API_KEY", "XAI_API_KEY") if k in os.environ))\')', REGISTRY],
      { env: { PATH, GEMINI_API_KEY: canary, XAI_API_KEY: canary }, encoding: 'utf8' });
    expect(probe('SHOOTOUT_PROXY_CONTROL_TOKEN').stdout).toBe('');
    expect(probe('${provider_keys[*]} SHOOTOUT_PROXY_CONTROL_TOKEN').stdout).toBe('GEMINI_API_KEY,XAI_API_KEY');
    expect(probe('${provider_keys[*]} SHOOTOUT_PROXY_CONTROL_TOKEN').stderr).not.toContain(canary);
  });
});
