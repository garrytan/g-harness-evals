// internal-task gate F: one list of provider key names. scripts/ubicloud/provider-keys.sh is what run-shard.sh forwards to a VM,
// what vm-run.sh hands to the metering proxy alone, and what the keyless steps of vm-shard.sh and merge-pass.sh drop.
//
// Value: protects=a new provider key (GEMINI_API_KEY, XAI_API_KEY) reaching the proxy and no keyless step, from one edit;
// fails_when=a script keeps its own hand list, the registry drifts from the proxy's KEY_ENV, or run_scrubbed would pass a
// key to a process KEEP does not name; seam=the registry sourced in a scrubbed bash; no_claim=a VM run.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    expect(run).toContain('for k in $(shard_keys "$shard_models" "$gemini_route"); do if [ -n "${!k:-}" ]; then printf \'export %s=%q\\n\' "$k" "${!k}"; fi; done;');
  });

  test('vm-run.sh holds GEMINI_API_KEY and XAI_API_KEY for the proxy: no longer unset, checked per provider, and passed only where KEEP names them', () => {
    const src = readFileSync(join(ROOT, 'scripts/frontier-harbor/vm-run.sh'), 'utf8');
    expect(src).not.toMatch(/^unset .*\bGEMINI_API_KEY\b/m);
    expect(src).toContain('google) if [ "$gemini_route" = native ]; then [ -n "${GEMINI_API_KEY:+x}" ] ||');
    expect(src).toContain('else [ -n "${OPENROUTER_API_KEY:+x}" ] ||');
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

// internal-task A2: GEMINI_API_KEY only where a cell calls Google directly: Gemini CLI's cells, and since amendment 2 of
// frontier-shootout-2026-11 the Gemini 4 Carbon and Hydrogen cells of Hermes, OpenClaw and Pi (every google: cell model).
//
// Value: protects=a shard with no google: cell model, or one on the OpenRouter fallback, never holding GEMINI_API_KEY on its VM
// or in its proxy; fails_when=run-shard.sh or vm-run.sh forwards every provider key again, or shard_keys drops a key a
// shard needs; seam=shard_keys, run-shard.sh's key upload block and vm-run.sh's proxy_keys lines, each run in a scrubbed
// bash with canary values; no_claim=a VM run.
describe('shard_keys: GEMINI_API_KEY only for a google: cell model on the native route', () => {
  const ALL_BUT_GEMINI = PROVIDER.filter((k) => k !== 'GEMINI_API_KEY');
  const keys = (models: string, route?: string) => sourced('shard_keys ' + JSON.stringify(models) + (route === undefined ? '' : ' ' + route));

  test('a shard with a google: model on the native route (named or by default) gets every key; any other shard every key but GEMINI_API_KEY', () => {
    expect(keys('google:gemini-4-carbon', 'native')).toEqual(PROVIDER);
    expect(keys('anthropic:claude-opus-5-5 google:gemini-4-hydrogen')).toEqual(PROVIDER);
    expect(keys('anthropic:claude-opus-5-5,google:gemini-4-carbon,google:gemini-3-flash-preview', 'native')).toEqual(PROVIDER);
    expect(keys('google:gemini-4-carbon', 'openrouter-fallback')).toEqual(ALL_BUT_GEMINI);
    expect(keys('openrouter:google/gemini-4-carbon openrouter:meta/muse-wonder xai:grok-4.7', 'native')).toEqual(ALL_BUT_GEMINI);
    expect(keys('anthropic:claude-opus-5-5,openai:gpt-6-astra', 'native')).toEqual(ALL_BUT_GEMINI);
    expect(keys('')).toEqual(ALL_BUT_GEMINI);
  });

  test('every shard of frontier-shootout-2026-11 with a Carbon or Hydrogen cell in Hermes, OpenClaw, Pi or Gemini CLI gets GEMINI_API_KEY, and no other shard does', () => {
    const dir = join(ROOT, 'docs/benchmarks/2026-11-16-frontier-shootout');
    const plans = readdirSync(dir).filter((f) => /^prereg-harbor-s\d+\.json$/.test(f)).sort();
    expect(plans.length).toBe(40);
    const gets: string[] = [];
    for (const f of plans) {
      const plan = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { cells: Array<{ model: string; harness: string }> };
      const gemini = plan.cells.some((c) => /^google:gemini-4-(carbon|hydrogen)$/.test(c.model) && ['hermes', 'openclaw', 'pi', 'gemini-cli'].includes(c.harness));
      expect([f, plan.cells.every((c) => !/gemini/.test(c.model) || c.model.startsWith('google:'))]).toEqual([f, true]);
      const k = keys(plan.cells.map((c) => c.model).join(' '), 'native');
      expect([f, k.includes('GEMINI_API_KEY')]).toEqual([f, gemini]);
      if (gemini) gets.push(f.slice('prereg-harbor-'.length, -'.json'.length));
    }
    expect(gets).toEqual(['s01', 's02', 's03', 's04', 's05', 's33', 's34']);
  });

  test('rules-at-scale run-shard.sh asks shard_keys with the shard\'s models, so a google: shard keeps GEMINI_API_KEY', () => {
    const src = readFileSync(join(ROOT, 'scripts/rules-at-scale/run-shard.sh'), 'utf8');
    expect(src).toContain('shard_keys "$models" native');
    expect(src).not.toContain('shard_keys "$harness"');
    expect(keys('google:gemini-4-carbon,anthropic:claude-opus-5-5', 'native')).toEqual(PROVIDER);
    expect(keys('gemini-cli', 'native')).toEqual(ALL_BUT_GEMINI);
  });

  const canary = 'fake-provider-key-canary-' + randomBytes(8).toString('hex');
  const env = { PATH, ...Object.fromEntries(PROVIDER.map((k) => [k, canary])) };
  const block = (file: string, from: RegExp, to: RegExp) => {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    const start = lines.findIndex((l) => from.test(l));
    const end = lines.findIndex((l, i) => i >= start && to.test(l));
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThanOrEqual(start);
    return lines.slice(start, end + 1).join('\n');
  };

  test('run-shard.sh uploads GEMINI_API_KEY to the VM only for a shard with a google: model whose -- arguments leave the route native', () => {
    const upload = block('scripts/ubicloud/run-shard.sh', /^\s*gemini_route=native$/, /\| vssh 'umask 077 && cat > ~\/\.ubirun-env'$/);
    const sent = (harnesses: string, extra: string[], installCheck = 0, models = harnesses === 'gemini-cli' ? 'google:gemini-4-carbon' : 'anthropic:claude-opus-5-5') => {
      const r = spawnSync('bash', ['--noprofile', '--norc', '-c', 'set -euo pipefail; . "$0"; vssh() { cat; }; install_check=' + installCheck + '; shard_harnesses=' + JSON.stringify(harnesses) + '; shard_models=' + JSON.stringify(models) + '; extra=(' + extra.map((a) => JSON.stringify(a)).join(' ') + ')\n' + upload, REGISTRY], { env, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain(canary);
      return r.stdout.split('\n').filter(Boolean).map((l) => l.match(/^export ([A-Z_]+)=/)![1]);
    };
    expect(sent('gemini-cli', [])).toEqual(PROVIDER);
    expect(sent('gemini-cli', ['--stage', 'main', '--gemini-cli-route', 'native'])).toEqual(PROVIDER);
    expect(sent('gemini-cli', ['--gemini-cli-route', 'openrouter-fallback'])).toEqual(ALL_BUT_GEMINI);
    expect(sent('claude-code codex', ['--stage', 'main'])).toEqual(ALL_BUT_GEMINI);
    expect(sent('grok-build', [])).toEqual(ALL_BUT_GEMINI);
    expect(sent('gemini-cli', [], 1)).toEqual([]);
    expect(sent('hermes', [], 0, 'google:gemini-4-carbon')).toEqual(PROVIDER);
    expect(sent('openclaw pi', ['--gemini-cli-route', 'openrouter-fallback'], 0, 'google:gemini-4-hydrogen')).toEqual(ALL_BUT_GEMINI);
    expect(sent('pi', [], 0, 'openrouter:moonshotai/kimi-k3.1-pro')).toEqual(ALL_BUT_GEMINI);
    expect(sent('cursor', [])).toEqual([]);
  });

  test('vm-run.sh unsets every provider key the shard does not need, and exports, keeps and fakes only proxy_keys', () => {
    const src = readFileSync(join(ROOT, 'scripts/frontier-harbor/vm-run.sh'), 'utf8');
    const keep = block('scripts/frontier-harbor/vm-run.sh', /^read -r -a proxy_keys <<< /, /^for k in "\$\{provider_keys\[@\]\}"; do case /);
    const left = (models: string, route: string) => {
      const r = spawnSync('bash', ['--noprofile', '--norc', '-c', 'set -euo pipefail; . "$0"; models=' + JSON.stringify(models) + '; gemini_route=' + route + '\n' + keep + '\nfor k in "${provider_keys[@]}"; do [ -z "${!k:+x}" ] || echo "$k"; done; echo "keep ${proxy_keys[*]}"', REGISTRY], { env, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(canary);
      return r.stdout.split('\n').filter(Boolean);
    };
    expect(left('google:gemini-4-carbon,google:gemini-3-flash-preview', 'native')).toEqual([...PROVIDER, 'keep ' + PROVIDER.join(' ')]);
    expect(left('google:gemini-4-carbon', 'openrouter-fallback')).toEqual([...ALL_BUT_GEMINI, 'keep ' + ALL_BUT_GEMINI.join(' ')]);
    expect(left('google:gemini-4-hydrogen', 'native')).toEqual([...PROVIDER, 'keep ' + PROVIDER.join(' ')]);
    expect(left('anthropic:claude-opus-5-5,openrouter:z-ai/glm-5.3', 'native')).toEqual([...ALL_BUT_GEMINI, 'keep ' + ALL_BUT_GEMINI.join(' ')]);
    expect(src).toContain('for k in "${proxy_keys[@]}"; do export "$k=$canary"; done; else export "${proxy_keys[@]}" 2>/dev/null || true; fi');
    expect(src).toContain('KEEP="${proxy_keys[*]} SHOOTOUT_PROXY_CONTROL_TOKEN" run_scrubbed');
    expect(src).not.toContain('KEEP="${provider_keys[*]}');
    expect(src).not.toMatch(/^\s*--allow-models .*--google-via openrouter/m);
    expect(src).toContain('[ "$gemini_route" = native ] || google_via=(--google-via openrouter)');
  });
});
