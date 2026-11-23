#!/usr/bin/env bun
// The skills-at-scale arms inside a harness container (internal-task-a, internal-task-b). Compiled to bin/sas-arm in the kit
// (scripts/skills-at-scale/build-kit.ts) and run by the adapter before ready, on HE_HARNESS_CONFIG skills-catalog,
// skills-gbrain-setup or skills-gbrain-pins (OpenClaw also takes each with -default-limits).
//
//   sas-arm <harness> <config> --dest <the harness's own skills folder>
//
//   skills-catalog       the catalog in the harness's own skills folder, nothing from gbrain (the native arm)
//   skills-gbrain-setup  the catalog, then gbrain's own installer as a user runs it: gbrain setup <harness>
//                        --skill-loading resolve (OpenClaw: --agent main), then gbrain doctor --only skill_resolver must pass
//                        and the catalog's index must be fresh
//   skills-gbrain-pins   the same, then gbrain skills pin add <id> --catalog <catalog> --line "<line>" for each of the kit's pins
// OpenClaw: every arm lifts the load cut before setup runs, raising skills.limits.maxCandidatesPerRoot and
// maxSkillsLoadedPerSource to fit the root. gbrain setup prints only the first as its skill_resolver_host_load_cut fix, but
// OpenClaw 2026.10.6 also stops loading a source at maxSkillsLoadedPerSource (200 by default), so the first alone loads no more
// skills; the -printed-fix variants raise only maxCandidatesPerRoot, as printed, and the -default-limits variants leave
// OpenClaw's limits at their defaults.
// OpenClaw also gets 'openclaw skills list --json --agent main' kept as sas-host-skills.json (what it loaded and shows).
// Hermes also takes each with -system-preamble: after the arm, config.yaml's agent.system_prompt gets the kit's
// system-preamble.md (the task preamble's fixed text, systemPreamble below), for cells whose turns carry only the per-turn
// header and the member's message (scripts/skills-at-scale/preamble.turn.md).
//
// Writes $HE_LOG_DIR/sas-arm.json (the arm, the kit, the install, every command with its exit code, the doctor check and
// the index status) and prints one line: 'ok <json for ready.sas_arm>', or 'HE-ADAPTER-007 <what failed and the fix>' with exit 1.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SAS_HARNESSES = ['claude-code', 'codex', 'hermes', 'openclaw', 'pi'] as const;
export type SasHarness = (typeof SAS_HARNESSES)[number];
export type SasArm = 'catalog' | 'gbrain-setup' | 'gbrain-pins';
export const SAS_CONFIGS = ['skills-catalog', 'skills-gbrain-setup', 'skills-gbrain-pins'] as const;
/** gbrain's catalog name for the harness's own skills, the one setup builds. */
export const GBRAIN_CATALOG: Record<SasHarness, string> = { 'claude-code': 'claude-code-user', codex: 'codex-user', hermes: 'hermes-user', openclaw: 'openclaw-main', pi: 'pi-user' };

export const OPENCLAW_LIMITS = { '': 'fit', '-printed-fix': 'printed-fix', '-default-limits': 'default' } as const;
export type Limits = (typeof OPENCLAW_LIMITS)[keyof typeof OPENCLAW_LIMITS];
export type ParsedConfig = { arm: SasArm; limits: Limits | null; system_preamble?: true };
/** The arm a config names, or an error string. */
export function parseConfig(h: string, config: string): ParsedConfig | string {
  if (!(SAS_HARNESSES as readonly string[]).includes(h)) return 'harness ' + h + ' has no skills-at-scale arm';
  const suffix = (['-printed-fix', '-default-limits', '-system-preamble'] as const).find((x) => config.endsWith(x)) ?? '';
  const base = config.slice(0, config.length - suffix.length);
  if (!(SAS_CONFIGS as readonly string[]).includes(base)) return config + ' is not a skills-at-scale config (' + SAS_CONFIGS.join(', ') + ')';
  if (suffix === '-system-preamble') return h === 'hermes' ? { arm: base.slice('skills-'.length) as SasArm, limits: null, system_preamble: true } : config + ': system-preamble is a Hermes variant';
  if (suffix && h !== 'openclaw') return config + ': ' + suffix.slice(1) + ' is an OpenClaw variant';
  return { arm: base.slice('skills-'.length) as SasArm, limits: h === 'openclaw' ? OPENCLAW_LIMITS[suffix] : null };
}

export const TURN_OPEN = 'A member is writing to you now.', RULES_OPEN = 'How to work here:';
/** The task preamble's fixed text for a system prompt: the preamble with its per-turn part (from TURN_OPEN up to RULES_OPEN, the
 *  member, place, time and message that scripts/skills-at-scale/preamble.turn.md puts in the user turn) replaced by one line. */
export function systemPreamble(preamble: string): string {
  const i = preamble.indexOf(TURN_OPEN), j = preamble.indexOf(RULES_OPEN);
  if (i < 0 || j < i) throw new Error('the preamble has no "' + TURN_OPEN + '" before "' + RULES_OPEN + '"');
  return preamble.slice(0, i) + 'Each member turn says who is writing, where and when, then gives their message.\n\n' + preamble.slice(j);
}

/** The installer command line a user runs for the harness. */
export function setupArgv(h: SasHarness): string[] {
  return ['setup', h, '--skill-loading', 'resolve', ...(h === 'openclaw' ? ['--agent', 'main'] : [])];
}

/** gbrain's install checks run the harness's own check (hermes hooks doctor, openclaw plugins inspect, pi --help) with an
 *  environment that keeps HOME but drops HERMES_HOME, OPENCLAW_STATE_DIR, OPENCLAW_CONFIG_PATH and PI_CODING_AGENT_DIR
 *  (src/core/setup/turn-hook-check.ts hookEnv at v0.60.742.0), so on a host that moves the harness's state, as every adapter
 *  here does, the check reads the default location and finds nothing. A user's install keeps the defaults, so the arm links
 *  each default location to the adapter's: the harness itself still reads its state through its own variable. */
export function defaultPathLinks(h: SasHarness, home: string): Record<string, string> {
  const want: [string, string | undefined][] = h === 'hermes' ? [[join(home, '.hermes'), process.env.HERMES_HOME]]
    : h === 'openclaw' ? [[join(home, '.openclaw'), process.env.OPENCLAW_STATE_DIR]]
    : h === 'pi' ? [[join(home, '.pi', 'agent'), process.env.PI_CODING_AGENT_DIR]] : [];
  const made: Record<string, string> = {};
  for (const [link, target] of want) {
    if (!target || target === link || existsSync(link)) continue;
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(target, link);
    made[link] = target;
  }
  return made;
}

/** Hermes seeds its bundled skills into $HERMES_HOME/skills at install and again on each start (tools/skills_sync.py). A user
 *  has them before gbrain is installed, and gbrain's index must hold them from the first turn, so the arm seeds them first,
 *  the way Hermes's profile code does (hermes_cli/profiles.py seed_profile_skills). */
const SEED_HERMES = 'py=$(head -1 "$(command -v hermes)" | sed "s/^#!//") && "$py" -c "import hermes_cli, os, sys, json; sys.path.insert(0, os.path.dirname(os.path.dirname(hermes_cli.__file__))); from tools.skills_sync import sync_skills; r = sync_skills(quiet=True); print(len(r.get(\'copied\', [])))"';

/** a < b for dotted numeric versions. */
export function versionBelow(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d < 0; }
  return false;
}

type Cmd = { argv: string[]; exit: number | null; out: string; stdout: string };

function main(argv: string[]): number {
  const [h, config] = argv;
  const dest = argv[argv.indexOf('--dest') + 1];
  const kit = process.env.HE_SAS_DIR || '/opt/skills-at-scale';
  const logs = process.env.HE_LOG_DIR || '/tmp';
  const home = process.env.HOME || '/harness-state';
  const recPath = join(logs, 'sas-arm.json');
  const rec: Record<string, any> = { status: 'error', harness: h, config, kit, dest, commands: [] as Record<string, unknown>[] };
  const write = () => writeFileSync(recPath, JSON.stringify(rec, null, 1) + '\n');
  const refuse = (msg: string): number => { rec.error = msg; write(); console.log('HE-ADAPTER-007 ' + msg); return 1; };
  const parsed = h && config ? parseConfig(h, config) : 'usage: sas-arm <harness> <config> --dest <dir>';
  if (typeof parsed === 'string') return refuse(parsed);
  if (!dest || argv.indexOf('--dest') < 0) return refuse('no --dest');
  const harness = h as SasHarness;
  Object.assign(rec, parsed);
  let kitJson: Record<string, any>;
  try { kitJson = JSON.parse(readFileSync(join(kit, 'kit.json'), 'utf8')); } catch { return refuse('the kit at ' + kit + ' has no readable kit.json; fix: build it with scripts/skills-at-scale/build-kit.ts'); }
  rec.kit_json = { gbrain_version: kitJson.gbrain_version, gbrain_commit: kitJson.gbrain_commit ?? null, gbrain_sha256: kitJson.gbrain_sha256, catalog_sha256: kitJson.catalog_sha256, skills: kitJson.skills, pins_sha256: kitJson.pins_sha256 ?? null };
  const src = join(kit, 'catalog', 'skills');
  if (!existsSync(src)) return refuse('the kit has no catalog/skills');
  const names = readdirSync(src).sort();
  mkdirSync(dest, { recursive: true });
  if (harness === 'hermes') {
    const seed = spawnSync('bash', ['-c', SEED_HERMES], { env: process.env, encoding: 'utf8', timeout: 120_000 });
    rec.commands.push({ argv: ['bash', '-c', 'sync_skills (Hermes bundled skills)'], exit: seed.status, out_tail: ((seed.stdout ?? '') + (seed.stderr ?? '')).slice(-2000) });
    if (seed.status !== 0) return refuse('seeding Hermes\'s bundled skills exited ' + seed.status + '; fix: check that hermes is on PATH and its tools.skills_sync imports');
    rec.hermes_bundled_seeded = (seed.stdout ?? '').trim().split('\n').pop();
  }
  const clash = names.filter((n) => existsSync(join(dest, n, 'SKILL.md')));
  if (clash.length) return refuse(dest + ' already holds ' + clash.length + ' skills named like catalog skills (' + clash.slice(0, 3).join(', ') + ')');
  rec.merged_into_category = names.filter((n) => existsSync(join(dest, n)));
  const kept = readdirSync(dest).sort();
  for (const n of names) cpSync(join(src, n), join(dest, n), { recursive: true });
  rec.install = { source: src, dest, skills: names.length, kept };

  const env = { ...process.env, PATH: join(home, '.local', 'bin') + ':' + (process.env.PATH ?? '/usr/bin:/bin') };
  const run = (cmd: string, args: string[], timeoutMs = 300_000): Cmd => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 << 20 });
    const c: Cmd = { argv: [cmd, ...args], exit: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '' };
    rec.commands.push({ argv: c.argv, exit: c.exit, out_tail: c.out.slice(-2000) });
    return c;
  };
  if (harness === 'openclaw') {
    const roots = readdirSync(dest).length;
    const keys = parsed.limits === 'fit' ? ['maxCandidatesPerRoot', 'maxSkillsLoadedPerSource'] : parsed.limits === 'printed-fix' ? ['maxCandidatesPerRoot'] : [];
    for (const k of keys) {
      const c = run('openclaw', ['config', 'set', 'skills.limits.' + k, String(roots)]);
      if (c.exit !== 0) return refuse('openclaw config set skills.limits.' + k + ' exited ' + c.exit);
    }
    rec.limits = { mode: parsed.limits, raised: Object.fromEntries(keys.map((k) => [k, roots])) };
  }
  if (parsed.arm !== 'catalog') {
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    if (!existsSync(join(bin, 'gbrain'))) symlinkSync(join(kit, 'bun', 'bin', 'gbrain'), join(bin, 'gbrain'));
    rec.default_path_links = defaultPathLinks(harness, home);
    const v = run('gbrain', ['--version']);
    rec.gbrain_version = v.out.trim().split('\n').pop();
    if (harness === 'openclaw') rec.openclaw_below_fix = versionBelow(String(rec.gbrain_version ?? '').replace(/^gbrain /, ''), kitJson.gbrain_pin?.openclaw_min_version ?? '0');
    const setup = run('gbrain', setupArgv(harness), 600_000);
    writeFileSync(join(logs, 'sas-setup.log'), setup.out);
    rec.setup = { argv: setup.argv, exit: setup.exit, host_load_cut: /skill_resolver_host_load_cut/.test(setup.out) };
    if (setup.exit !== 0) return refuse('gbrain ' + setupArgv(harness).join(' ') + ' exited ' + setup.exit + ' (sas-setup.log); fix: read its Fix line, or pin the newest gbrain or harness release that passes');
    const catalog = GBRAIN_CATALOG[harness];
    if (parsed.arm === 'gbrain-pins') {
      const pins = JSON.parse(readFileSync(join(kit, 'pins.json'), 'utf8')) as { id: string; line: string }[];
      for (const p of pins) {
        const c = run('gbrain', ['skills', 'pin', 'add', p.id, '--catalog', catalog, '--line', p.line]);
        if (c.exit !== 0) return refuse('gbrain skills pin add ' + p.id + ' --catalog ' + catalog + ' exited ' + c.exit);
      }
      rec.pins = pins.length;
      rec.pin_ids = pins.map((x) => x.id);
      const pl = run('gbrain', ['skills', 'pin', 'list', '--catalog', catalog, '--json']);
      try {
        const d = JSON.parse(pl.stdout) as { rendered: string[]; cut: string[]; unknown: string[]; block_tokens: number };
        rec.pins_rendered = { ids: d.rendered, cut: d.cut, unknown: d.unknown, block_tokens: d.block_tokens };
      } catch { return refuse('gbrain skills pin list --catalog ' + catalog + ' --json printed no JSON'); }
    }
    const doc = run('gbrain', ['doctor', '--only', 'skill_resolver', '--json']);
    let check: Record<string, any> | undefined;
    try { check = (JSON.parse(doc.stdout).checks as Record<string, any>[]).find((c) => c.name === 'skill_resolver'); } catch { /* reported below */ }
    rec.doctor = check ? { status: check.status, message: check.message } : { status: null, message: 'no skill_resolver check in the doctor output' };
    if (check?.status !== 'ok') return refuse('gbrain doctor --only skill_resolver says ' + JSON.stringify(rec.doctor) + '; fix: run its fix, then gbrain setup ' + harness + ' --skill-loading resolve again');
    const st = run('gbrain', ['skills', 'index', 'status', '--catalog', catalog, '--json']);
    let cat: Record<string, any> | undefined;
    try { cat = (JSON.parse(st.stdout).catalogs as Record<string, any>[]).find((c) => c.catalog === catalog); } catch { /* reported below */ }
    rec.index = cat ? { catalog, fresh: cat.fresh, stale_reason: cat.stale_reason, skills: cat.receipt?.skill_count ?? null, catalog_hash: cat.receipt?.catalog_hash ?? null, index_hash: cat.receipt?.index_hash ?? null } : { catalog, fresh: null };
    if (cat?.fresh !== true) return refuse('the ' + catalog + ' index is not fresh at trial start (' + JSON.stringify(rec.index) + '); fix: gbrain skills index build as skills index status prints');
  }
  if (parsed.system_preamble) {
    const config = join(process.env.HERMES_HOME || join(home, '.hermes'), 'config.yaml');
    const text = existsSync(join(kit, 'system-preamble.md')) ? readFileSync(join(kit, 'system-preamble.md'), 'utf8') : '';
    if (!text) return refuse('the kit has no system-preamble.md; fix: rebuild it with scripts/skills-at-scale/build-kit.ts');
    const cur = existsSync(config) ? readFileSync(config, 'utf8') : '';
    if (/^  system_prompt:/m.test(cur)) return refuse(config + ' already sets a system_prompt');
    const line = '  system_prompt: ' + JSON.stringify(text) + '\n';
    const at = cur.startsWith('agent:\n') ? 'agent:\n'.length : cur.indexOf('\nagent:\n') >= 0 ? cur.indexOf('\nagent:\n') + '\nagent:\n'.length : -1;
    writeFileSync(config, at >= 0 ? cur.slice(0, at) + line + cur.slice(at) : cur + (cur && !cur.endsWith('\n') ? '\n' : '') + 'agent:\n' + line);
    const back = run('bash', ['-c', 'py=$(head -1 "$(command -v hermes)" | sed "s/^#!//") && "$py" -c "import sys, yaml; sys.stdout.write((yaml.safe_load(open(sys.argv[1])).get(\'agent\') or {}).get(\'system_prompt\') or \'\')" "$0"', config]);
    if (back.stdout !== text) return refuse(config + ' does not parse back to agent.system_prompt equal to system-preamble.md');
    rec.system_preamble = { config, bytes: Buffer.byteLength(text), sha256: new Bun.CryptoHasher('sha256').update(text).digest('hex') };
  }
  if (harness === 'openclaw') {
    const l = run('openclaw', ['skills', 'list', '--json', '--agent', 'main']);
    writeFileSync(join(logs, 'sas-host-skills.json'), l.stdout);
    rec.host_skills = { exit: l.exit, file: join(logs, 'sas-host-skills.json') };
  }
  rec.status = 'ok';
  write();
  const ready = { arm: parsed.arm, config, catalog_sha256: kitJson.catalog_sha256, skills_installed: names.length, gbrain_version: rec.gbrain_version ?? null,
    doctor: rec.doctor?.status ?? null, index_fresh: rec.index?.fresh ?? null, pins: rec.pins ?? 0, limits: parsed.limits, ...(parsed.system_preamble ? { system_preamble: rec.system_preamble.sha256 } : {}), ...(rec.openclaw_below_fix ? { openclaw_below_fix: true } : {}) };
  console.log('ok ' + JSON.stringify(ready));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
