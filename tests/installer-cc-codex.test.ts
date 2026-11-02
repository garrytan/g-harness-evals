// internal-task, the installer rung for Claude Code and Codex (docs/gbrain-arm.md, "The install ladder"): what gbrain setup
// claude-code|codex --instructions-only writes at gbrain image build (gbrain#7989), applied by each adapter under
// HE_GBRAIN_INSTALL=gbrain-installer. Keyless, three layers:
//   1. build-install, always on: gbrain/build-install.ts builds the installer view with a stand-in gbrain (tests/fixtures/installer/
//      gbrain, which writes the files setup writes at 5fd43d5a, and with HE_STAND_IN_LAUNCHER=1 also gbrain#8424's hook launcher, as
//      2c469d1b does) and, with HE_GBRAIN_BIN naming a compiled gbrain, with the real one.
//   2. process level, always on: each adapter applies a view exported by gbrain/export-install.sh, with a stand-in CLI
//      (tests/fixtures/installer/bin) that runs the UserPromptSubmit hooks the real CLI runs (Claude Code: settings.json; Codex:
//      hooks.json groups config.toml trusts), so ready, gbrain-install.json and the per-turn hook count are checked; the refusals
//      are HE-ADAPTER-006.
//   3. container level, with docker and images built from this checkout (HE_GBRAIN_INSTALLER_IMAGE or harness-eval/gbrain:dev, whose view
//      must carry the hook, so a gbrain at or after 5fd43d5a; harness-eval/claude-code:dev, harness-eval/codex:dev): the real CLIs serve two turns against fake model endpoints in this
//      process, with the world's gbrain tap in front of a fake gbrain. The block and the rule reach the model on every turn, the
//      hook ran once per turn by gbrain's own heartbeat, and gbrain's tools are offered beside the rule.
// Cells without the installer stay covered, unchanged, by tests/claude-code-adapter.test.ts and tests/codex-adapter.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TurnRequest } from '../runner/contracts.ts';
import { exportInstallView, type InstallViewManifest } from '../runner/trial/gbrain.ts';
import { turnHookRuns as runnerTurnRuns } from '../runner/trial/trial.ts';
import { containerHostAddress } from '../runner/trial/world.ts';
import { BRAIN_FIRST_LEDGER, HOOK_GBRAIN_BIN, HOOK_HEARTBEAT, HOOK_LAUNCHER, INSTALLER_BLOCK_BEGIN, buildInstaller, bundleDigest, fileEntries, listFiles, type InstallerRecord } from '../gbrain/build-install.ts';
import { createWorldServer, type WorldServer } from '../world/services/server.ts';
import { startFakeResponses } from './fixtures/fake-responses.ts';
import { startWorld, world } from './world-helpers.ts';

type H = 'claude-code' | 'codex';
const HARNESSES: H[] = ['claude-code', 'codex'];
const ROOT = resolve(import.meta.dir, '..');
const FIXTURES = join(ROOT, 'tests/fixtures/installer');
const STAND_IN = join(FIXTURES, 'gbrain');
const STAND_IN_RULE = 'GBrain: before answering this turn, check GBrain first (stand-in rule).';
const NODE = Bun.which('node');
const PATH = [...(NODE ? [dirname(NODE)] : []), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const REAL_GBRAIN = process.env.HE_GBRAIN_BIN && existsSync(process.env.HE_GBRAIN_BIN) ? resolve(process.env.HE_GBRAIN_BIN) : null;
const CLAUDE_SETTINGS = join(ROOT, 'harnesses/claude-code/config/settings.json');
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(join(tmpdir(), 'he-installer-cc-codex-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
/** The stand-in as gbrain#8424 (2c469d1b, v0.60.547.0): setup also writes HOME/.gbrain/hook-launcher/gbrain-hook and the hook runs gbrain through it. */
const LAUNCHER_STAND_IN = join(tmp, 'gbrain-8424');
writeFileSync(LAUNCHER_STAND_IN, '#!/bin/sh\nHE_STAND_IN_LAUNCHER=1 exec node ' + STAND_IN + ' "$@"\n');
chmodSync(LAUNCHER_STAND_IN, 0o755);

/** The files each installer view holds under home/: what setup wrote, and the gbrain its hook runs. */
const EXPECTED: Record<H, string[]> = {
  'claude-code': [BRAIN_FIRST_LEDGER, HOOK_GBRAIN_BIN, 'claude/CLAUDE.md', 'claude/settings.json', 'claude/settings.json.bak'],
  codex: [BRAIN_FIRST_LEDGER, HOOK_GBRAIN_BIN, 'codex/AGENTS.md', 'codex/config.toml', 'codex/hooks.json'],
};

/** buildInstaller for one harness into out, setup run in state (absent or empty; removed after), under the test's scrubbed PATH. */
function build(h: H, gbrain: string, out: string, state: string) {
  const lines: string[] = [];
  const saved = process.env.PATH;
  process.env.PATH = PATH;
  try {
    const r = buildInstaller({ out, gbrain: [gbrain], brains: tmp, commit: 'f'.repeat(40), scratch: join(out, 'scratch'), brainHome: tmp, gbrainBin: gbrain, claudeSettings: CLAUDE_SETTINGS, harnessState: state }, out, h, (l) => lines.push(l));
    return { record: r.record as InstallerRecord, command: r.command!, lines };
  } finally {
    process.env.PATH = saved;
  }
}

/** A bundle root holding one harness's installer and a manifest shaped like build-install's, exported to view by export-install.sh. */
function exportView(h: H, gbrain: string, state: string, view: string): InstallViewManifest {
  const out = join(tmp, 'bundles', h + '-' + Math.random().toString(36).slice(2, 8));
  const built = build(h, gbrain, out, state);
  mkdirSync(state, { recursive: true });
  const files = fileEntries(out, listFiles(out).filter((f) => f.startsWith(h + '/installer/')));
  const manifest = { schema_version: 1, gbrain_commit: 'f'.repeat(40), gbrain_version: null, built_with: 'gbrain/build-install.ts', commands: [built.command], harnesses: { [h]: { installer: built.record } }, files, digest: bundleDigest(files) };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  const r = spawnSync('bash', [join(ROOT, 'gbrain/export-install.sh'), h, 'dev', view, 'gbrain-installer'], { encoding: 'utf8', env: { PATH, HE_INSTALL_SRC: out } });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(join(view, 'manifest.json'), 'utf8')) as InstallViewManifest;
}

const ruleOf = (view: InstallViewManifest) => (view.installer as InstallerRecord).turn_hook!.rule!;
const heartbeats = (state: string) => existsSync(join(state, HOOK_HEARTBEAT)) ? readFileSync(join(state, HOOK_HEARTBEAT), 'utf8').split('\n').filter((l) => l.includes('"event":"user-prompt"')).length : 0;

describe('build-install: the Claude Code and Codex installer views', () => {
  for (const h of HARNESSES) {
    test(h + ': setup runs in the state dir with gbrain at HOME/.local/bin/gbrain; the view keeps what it wrote, the binary and the rule, not the heartbeat; the state dir is removed', () => {
      const out = join(tmp, 'unit', h), state = join(tmp, 'unit-state', h);
      const { record, lines } = build(h, STAND_IN, out, state);
      expect(record.files).toEqual(EXPECTED[h].map((f) => h + '/installer/home/' + f));
      expect(listFiles(join(out, h, 'installer')).sort()).toEqual(EXPECTED[h].map((f) => 'home/' + f));
      expect(record.state_root).toBe(state);
      expect(record.gbrain_bin).toBe(join(state, HOOK_GBRAIN_BIN));
      expect(record.argv).toEqual(['gbrain', 'setup', h, '--instructions-only', '--gbrain-bin', join(state, HOOK_GBRAIN_BIN), '--json']);
      expect(record.block_version).toBe('v2');
      expect(record.turn_hook).toMatchObject({ action: 'write', rule: STAND_IN_RULE, files: (h === 'codex' ? ['codex/config.toml', 'codex/hooks.json'] : ['claude/settings.json']).map((f) => h + '/installer/home/' + f) });
      expect(existsSync(join(out, h, 'installer/home', HOOK_HEARTBEAT))).toBe(false);
      expect(existsSync(state)).toBe(false);
      expect(statSync(join(out, h, 'installer/home', HOOK_GBRAIN_BIN)).mode & 0o111).toBe(0o111);
      if (h === 'claude-code') {
        const seed = readFileSync(CLAUDE_SETTINGS);
        expect(record.seed).toEqual({ source: CLAUDE_SETTINGS, sha256: sha256(seed), bytes: seed.length });
        expect(readFileSync(join(out, h, 'installer/home/claude/settings.json.bak'))).toEqual(seed);
        expect(JSON.parse(readFileSync(join(out, h, 'installer/home/claude/settings.json'), 'utf8')).permissions).toEqual(JSON.parse(seed.toString()).permissions);
      }
      expect(lines.some((l) => l.startsWith(h + ': gbrain setup ' + h + ' --instructions-only in ' + state + ' wrote '))).toBe(true);
    });

    // Value: protects=the Claude Code and Codex installer views build at gbrain 2c469d1b and later; fails_when=setup's hook launcher is
    // refused, dropped from the view or the hook's files, or lands without its exec bit; why_new=gbrain#8424 broke the image build; seam=none.
    test(h + ': at gbrain#8424 the view also keeps the hook launcher the hook command runs, executable and alone in its directory, as part of the hook', () => {
      const out = join(tmp, 'unit-launcher', h), state = join(tmp, 'unit-launcher-state', h);
      const { record } = build(h, LAUNCHER_STAND_IN, out, state);
      const expected = [...EXPECTED[h], HOOK_LAUNCHER].sort();
      expect(record.files).toEqual(expected.map((f) => h + '/installer/home/' + f));
      expect(listFiles(join(out, h, 'installer')).sort()).toEqual(expected.map((f) => 'home/' + f));
      expect(readdirSync(join(out, h, 'installer/home', dirname(HOOK_LAUNCHER)))).toEqual(['gbrain-hook']);
      expect(statSync(join(out, h, 'installer/home', HOOK_LAUNCHER)).mode & 0o777).toBe(0o755);
      expect(readFileSync(join(out, h, 'installer/home', HOOK_LAUNCHER), 'utf8')).toStartWith('#!/bin/sh\n# gbrain hook launcher v1');
      expect(record.turn_hook).toMatchObject({ action: 'write', rule: STAND_IN_RULE, files: [HOOK_LAUNCHER, ...(h === 'codex' ? ['codex/config.toml', 'codex/hooks.json'] : ['claude/settings.json'])].map((f) => h + '/installer/home/' + f) });
      expect(readFileSync(join(out, h, 'installer/home', h === 'codex' ? 'codex/hooks.json' : 'claude/settings.json'), 'utf8')).toContain('GBRAIN_HOOK_LANE=turn-rule ' + join(state, HOOK_LAUNCHER) + ' ' + join(state, HOOK_GBRAIN_BIN) + ' hook user-prompt');
      expect(existsSync(state)).toBe(false);
    });
  }

  // Value: protects=the views build when gbrain#8437 (8352e7f0, v0.60.550.0) routes more commands than the turn hook through the launcher;
  // fails_when=a stdio MCP command naming the launcher is refused, or one naming another launcher is kept; why_new=internal-task scope; seam=none.
  test('a stdio MCP command in a file setup wrote that starts gbrain through the launcher keeps the launcher; one naming another launcher is refused', () => {
    for (const h of HARNESSES) {
      const withMcp = (name: string, launcherOf: string) => {
        const bin = join(tmp, 'gbrain-8437-' + h + '-' + name);
        const add = h === 'codex'
          ? 'printf \'[mcp_servers.gbrain]\\ncommand = "%s"\\nargs = ["%s", "serve"]\\n\' "' + launcherOf + '" "$5" >> "$CODEX_HOME/config.toml"'
          : 'node -e \'const f=process.argv[1],s=JSON.parse(require("fs").readFileSync(f,"utf8"));s.mcpServers={gbrain:{type:"stdio",command:process.argv[2],args:[process.argv[3],"serve"]}};require("fs").writeFileSync(f,JSON.stringify(s,null,2)+"\\n")\' "$CLAUDE_CONFIG_DIR/settings.json" "' + launcherOf + '" "$5"';
        writeFileSync(bin, '#!/bin/sh\nHE_STAND_IN_LAUNCHER=1 node ' + STAND_IN + ' "$@" || exit $?\n[ "$1" = setup ] && ' + add + '\nexit 0\n');
        chmodSync(bin, 0o755);
        return bin;
      };
      const out = join(tmp, 'unit-mcp-launcher', h), state = join(tmp, 'unit-mcp-launcher-state', h);
      const { record } = build(h, withMcp('ours', '$HOME/' + HOOK_LAUNCHER), out, state);
      expect(record.files).toContain(h + '/installer/home/' + HOOK_LAUNCHER);
      expect(record.turn_hook?.files).toContain(h + '/installer/home/' + HOOK_LAUNCHER);
      expect(readFileSync(join(out, h, 'installer/home', h === 'codex' ? 'codex/config.toml' : 'claude/settings.json'), 'utf8')).toContain(JSON.stringify(join(state, HOOK_LAUNCHER)));
      expect(() => build(h, withMcp('elsewhere', '/opt/other/.gbrain/hook-launcher/gbrain-hook'), join(tmp, 'unit-mcp-elsewhere', h), join(tmp, 'unit-mcp-elsewhere-state', h)))
        .toThrow(/start gbrain through .*\/opt\/other\/\.gbrain\/hook-launcher\/gbrain-hook.*the view keeps the launcher only where the commands it carries run it/);
    }
  });

  test('both installer views in one bundle share one gbrain binary (a hard link), not two copies', () => {
    const out = join(tmp, 'unit-shared');
    build('claude-code', STAND_IN, out, join(tmp, 'unit-shared-state-cc'));
    build('codex', STAND_IN, out, join(tmp, 'unit-shared-state-codex'));
    const a = statSync(join(out, 'claude-code/installer/home', HOOK_GBRAIN_BIN)), b = statSync(join(out, 'codex/installer/home', HOOK_GBRAIN_BIN));
    expect(b.ino).toBe(a.ino);
    expect(a.nlink).toBe(2);
    expect(b.mode & 0o111).toBe(0o111);
  });

  test('without a compiled gbrain, or without the Claude Code settings seed, the installer is recorded unavailable; a state dir that is not empty is refused', () => {
    const out = join(tmp, 'unit-unavailable');
    const opts = { out, gbrain: [STAND_IN], brains: tmp, commit: 'f'.repeat(40), scratch: join(out, 'scratch'), brainHome: tmp, harnessState: join(tmp, 'unavailable-state') };
    expect(buildInstaller(opts, out, 'codex', () => {}).record).toEqual({ unavailable: 'no compiled gbrain (--gbrain-bin); the codex turn hook runs gbrain inside the harness container' });
    expect((buildInstaller({ ...opts, gbrainBin: STAND_IN }, out, 'claude-code', () => {}).record as { unavailable: string }).unavailable).toContain('no Claude Code settings seed');
    mkdirSync(join(tmp, 'busy-state'), { recursive: true });
    writeFileSync(join(tmp, 'busy-state', 'x'), '');
    expect(() => buildInstaller({ ...opts, gbrainBin: STAND_IN, harnessState: join(tmp, 'busy-state') }, out, 'codex', () => {})).toThrow('is not empty');
  });

  test('a setup that fails, writes nothing, reports a hook it did not write, writes other files or no block, or a hook that prints no rule is recorded unavailable or refused', () => {
    const out = join(tmp, 'unit-wrapped');
    const attempt = (name: string, body: string) => {
      const bin = join(tmp, 'wrapped-gbrain-' + name);
      writeFileSync(bin, '#!/bin/sh\n' + body + '\n');
      chmodSync(bin, 0o755);
      const saved = process.env.PATH;
      process.env.PATH = PATH;
      try {
        return buildInstaller({ out, gbrain: [bin], brains: tmp, commit: 'f'.repeat(40), scratch: join(out, 'scratch'), brainHome: tmp, gbrainBin: bin, claudeSettings: CLAUDE_SETTINGS, harnessState: join(tmp, 'wrapped-state-' + name) }, out, 'codex', () => {}).record as { unavailable?: string };
      } finally {
        process.env.PATH = saved;
      }
    };
    const standIn = JSON.stringify(STAND_IN);
    expect(attempt('fails', 'echo \'{"error":{"message":"setup broke"}}\'; exit 2').unavailable).toBe('gbrain setup codex --instructions-only exited 2: setup broke');
    expect(attempt('silent', 'echo \'{"harness":"codex"}\'').unavailable).toStartWith('gbrain setup codex --instructions-only exited 0 and wrote nothing');
    expect(() => attempt('skips', 'node ' + standIn + ' "$@" | sed \'s/"action":"write","detail"/"action":"skip","detail"/\'')).toThrow('reports turn_hook skip');
    expect(() => attempt('extra', 'node ' + standIn + ' "$@" || exit $?; [ "$1" = setup ] && echo x > "$HOME/extra.txt"; exit 0')).toThrow('this bundle expects');
    expect(() => attempt('noblock', 'node ' + standIn + ' "$@" || exit $?; [ "$1" = setup ] && echo plain > "$CODEX_HOME/AGENTS.md"; exit 0')).toThrow('without the brain-first block');
    expect(() => attempt('norule', '[ "$1" = hook ] && { cat >/dev/null; exit 0; }; exec node ' + standIn + ' "$@"')).toThrow('exited 0 without the rule');
    expect(() => attempt('strayLauncher', 'node ' + standIn + ' "$@" || exit $?; [ "$1" = setup ] && mkdir -p "$HOME/.gbrain/hook-launcher" && echo x > "$HOME/' + HOOK_LAUNCHER + '"; exit 0')).toThrow('start gbrain through no hook launcher, and setup wrote');
    expect(() => attempt('unwrittenLauncher', 'node ' + standIn + ' "$@" || exit $?; [ "$1" = setup ] && sed -i "s|$5 hook|$HOME/' + HOOK_LAUNCHER + ' $5 hook|" "$CODEX_HOME/hooks.json"; exit 0')).toThrow('hook-launcher/gbrain-hook, and setup did not write');
    expect(attempt('killed', 'kill -9 $$').unavailable).toStartWith('gbrain setup codex --instructions-only was stopped (SIGKILL, 300 s timeout): ');
  });

  test('export-install.sh refuses a gbrain-docs view for Claude Code and Codex', () => {
    for (const h of HARNESSES) {
      const r = spawnSync('bash', [join(ROOT, 'gbrain/export-install.sh'), h, 'dev', join(tmp, 'never'), 'gbrain-docs'], { encoding: 'utf8', env: { PATH, HE_INSTALL_SRC: tmp } });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('HE-GBRAIN-006 gbrain documents no gbrain-docs install for ' + h);
    }
  });

  test.skipIf(!REAL_GBRAIN)('with the real compiled gbrain (HE_GBRAIN_BIN): the same files, the hook checked by setup itself, the rule gbrain prints', () => {
    for (const h of HARNESSES) {
      const out = join(tmp, 'real', h), state = join(tmp, 'real-state', h);
      const { record } = build(h, REAL_GBRAIN!, out, state);
      // gbrain#8424 (2c469d1b) and later also write the hook launcher; a590ad07 and earlier do not.
      const launcher = existsSync(join(out, h, 'installer/home', HOOK_LAUNCHER));
      expect(record.files).toEqual([...EXPECTED[h], ...(launcher ? [HOOK_LAUNCHER] : [])].sort().map((f) => h + '/installer/home/' + f));
      expect(record.turn_hook?.rule).toStartWith('GBrain:');
      expect(readFileSync(join(out, h, 'installer/home', h === 'codex' ? 'codex/AGENTS.md' : 'claude/CLAUDE.md'), 'utf8')).toContain(INSTALLER_BLOCK_BEGIN);
      expect(readFileSync(join(out, h, 'installer/home', h === 'codex' ? 'codex/hooks.json' : 'claude/settings.json'), 'utf8')).toContain('GBRAIN_HOOK_LANE=turn-rule ' + (launcher ? join(state, HOOK_LAUNCHER) + ' ' : '') + join(state, HOOK_GBRAIN_BIN) + ' hook user-prompt');
      if (h === 'codex') expect(readFileSync(join(out, h, 'installer/home/codex/config.toml'), 'utf8')).toContain('[hooks.state.' + JSON.stringify(join(state, 'codex/hooks.json') + ':user_prompt_submit:0:0') + ']');
    }
  }, 120_000);
});

// ---- process level ------------------------------------------------------------------------------------

/** Rewrites one file of an exported view and its digests, so only the adapter's own checks can refuse it. */
function rewriteView(view: string, rel: string, edit: (s: string) => string) {
  const file = join(view, 'home', rel);
  writeFileSync(file, edit(readFileSync(file, 'utf8')));
  const m = JSON.parse(readFileSync(join(view, 'manifest.json'), 'utf8')) as { files: Array<{ path: string; source_path: string; sha256: string }>; view_digest: string };
  m.files.find((f) => f.path === 'home/' + rel)!.sha256 = sha256(readFileSync(file));
  m.view_digest = sha256([...m.files].sort((a, b) => (a.source_path < b.source_path ? -1 : a.source_path > b.source_path ? 1 : 0)).map((f) => f.source_path + ' ' + f.sha256 + '\n').join(''));
  writeFileSync(join(view, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
}

interface Trial { dir: string; workspace: string; state: string; logs: string; turns: string; stubLog: string; view: string }
function trial(h: H): Trial {
  const dir = mkdtempSync(join(tmp, h + '-trial-'));
  const t = { dir, workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), stubLog: join(dir, 'stub.ndjson'), view: join(dir, 'view') };
  for (const d of [t.workspace, t.logs, t.turns]) mkdirSync(d);
  writeFileSync(join(t.workspace, 'instruction.md'), 'Say hello.');
  return t;
}
const adapter = (h: H) => join(ROOT, 'harnesses', h, 'adapter.sh');
const env = (h: H, t: Trial, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: join(FIXTURES, 'bin') + ':' + PATH, HE_WORKSPACE_DIR: t.workspace, HE_SESSION_STATE_DIR: t.state, HE_LOG_DIR: t.logs, HE_TURNS_DIR: t.turns,
  HE_MODEL_BASE_URL: 'http://127.0.0.1:1/installer-test/' + (h === 'codex' ? 'openai' : 'anthropic'), HE_MODEL_API_KEY: 'trial-token:installer-test.0123456789abcdef0123456789abcdef',
  HE_MODEL_NAME: h === 'codex' ? 'gpt-6-luna' : 'claude-haiku-5-5', HE_TIME_BUDGET_S: '20', HE_TASK_SLICE: 'multiuser', HE_TRIAL_ID: 'installer-test', STUB_LOG: t.stubLog,
  HE_GBRAIN_INSTALL: 'gbrain-installer', HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_INSTALL_DIR: t.view, ...extra,
});
const stubContexts = (t: Trial) => existsSync(t.stubLog) ? readFileSync(t.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { contexts: Array<string | null> }).contexts) : [];
const adapterLog = (t: Trial) => existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8') : '';
const installRecord = (logs: string) => JSON.parse(readFileSync(join(logs, 'gbrain-install.json'), 'utf8')) as { status: string; code: string | null; harness: string; install: string; view_digest: string; files: number; destinations: string[]; copied: string[]; turn_hook?: { status: string; command: string } };
const turnName = (n: number) => 'turn-' + String(n).padStart(4, '0');
const turnHookRuns = (logs: string, n: number) => (JSON.parse(readFileSync(join(logs, 'turns', turnName(n) + '.status.json'), 'utf8')) as { gbrain_turn_hook_runs?: number }).gbrain_turn_hook_runs;

function request(n: number, text: string): TurnRequest {
  return { turn: n, trial_id: 'installer-test', prompt: 'You are the workspace bot. Dana Okafor asks: ' + text,
    actor: { member: 'dana-okafor', slack_user_id: 'U0DANA', name: 'Dana Okafor', role: 'Account Manager', team: 'team-north' },
    channel: { id: 'D0DANA', name: 'dana-okafor', type: 'dm' }, text, ts: '1791986400.00000' + n, thread_ts: null, sim_now: '2026-10-14T09:00:00-05:00', time_budget_s: 120 };
}
async function until(pred: () => boolean, ms: number, what: string, detail: () => string = () => ''): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await Bun.sleep(100); }
  throw new Error('timed out after ' + ms + ' ms waiting for ' + what + '\n' + detail());
}
/** Post one turn request the runner's way (write, then rename) and wait for its response. */
async function turn(turns: string, n: number, text: string, ms: number, detail: () => string): Promise<{ exit: number }> {
  const req = join(turns, turnName(n) + '.request.json');
  writeFileSync(req + '.tmp', JSON.stringify(request(n, text)));
  renameSync(req + '.tmp', req);
  const res = join(turns, turnName(n) + '.response.json');
  await until(() => existsSync(res), ms, 'turn ' + n, detail);
  return JSON.parse(readFileSync(res, 'utf8')) as { exit: number };
}
async function stop(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const done = new Promise<number | null>((res) => child.once('exit', (c) => res(c)));
  child.kill('SIGTERM');
  return done;
}

describe.skipIf(!NODE)('the Claude Code and Codex adapters apply the installer view, process level', () => {
  let ws: WorldServer;
  beforeAll(() => { ws = startWorld('installer-process'); });
  afterAll(() => ws?.stop());

  for (const h of HARNESSES) {
    for (const [label, gbrain] of [[REAL_GBRAIN ? ' (real gbrain)' : '', REAL_GBRAIN ?? STAND_IN], [' (gbrain#8424 hook launcher)', LAUNCHER_STAND_IN]]) test(h + ': serve copies every file to its HOME path, ready says turn_hook ran, and each turn runs the hook once with the recorded rule' + label, async () => {
      const t = trial(h);
      const view = exportView(h, gbrain!, t.state, t.view);
      const launcher = view.files.some((f) => f.path === 'home/' + HOOK_LAUNCHER);
      if (gbrain === LAUNCHER_STAND_IN) expect(launcher).toBe(true);
      const child = spawn('bash', [adapter(h), 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: env(h, t, { HE_WORLD_MCP_URL: ws.url + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token }) });
      try {
        await until(() => existsSync(join(t.logs, 'ready')), 30_000, 'ready', () => adapterLog(t));
        const rec = installRecord(t.logs);
        const dests = [join(t.state, '.gbrain'), join(t.state, '.local/bin'), join(t.state, h === 'codex' ? 'codex' : 'claude'), ...(launcher ? [join(t.state, dirname(HOOK_LAUNCHER))] : [])].sort();
        expect(rec).toMatchObject({ status: 'ok', code: null, harness: h, install: 'gbrain-installer', view_digest: view.view_digest, files: view.files.length, destinations: dests });
        expect(rec.turn_hook?.status).toBe('ran');
        for (const f of view.files) {
          const dest = join(t.state, f.path.replace(/^home\//, ''));
          if (f.path === 'home/codex/config.toml') expect(readFileSync(dest, 'utf8').endsWith('\n' + readFileSync(join(t.view, f.path), 'utf8'))).toBe(true);
          else expect(sha256(readFileSync(dest))).toBe(f.sha256);
        }
        if (launcher) {
          expect(readdirSync(join(t.state, dirname(HOOK_LAUNCHER)))).toEqual(['gbrain-hook']);
          expect(statSync(join(t.state, HOOK_LAUNCHER)).mode & 0o777).toBe(statSync(join(t.view, 'home', HOOK_LAUNCHER)).mode & 0o777);
          expect(rec.turn_hook?.command).toContain(join(t.state, HOOK_LAUNCHER) + ' ');
        }
        const ready = JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8'));
        expect(ready.gbrain_install).toEqual({ status: 'ok', install: 'gbrain-installer', files: view.files.length, view_digest: view.view_digest, destinations: dests.join(','), turn_hook: 'ran' });
        expect(JSON.parse(readFileSync(join(t.logs, 'gbrain-hook.' + h + '.json'), 'utf8'))).toMatchObject({ exit: 0, rule_matches: true });
        expect(adapterLog(t)).toContain('gbrain-installer install: ok ' + view.files.length + ' ' + view.view_digest + ' ' + dests.join(',') + ' ran');
        expect(heartbeats(t.state)).toBe(1);
        for (const n of [1, 2]) {
          expect((await turn(t.turns, n, 'ping ' + n, 30_000, () => adapterLog(t))).exit).toBe(0);
          expect(turnHookRuns(t.logs, n)).toBe(1);
        }
        // Issue #153: the runner reads the same files into install_bundle.turn_hook.turn_runs; a turn with no status file is null.
        expect(runnerTurnRuns(t.logs, [1, 2, 3])).toEqual([1, 1, null]);
        expect(stubContexts(t)).toEqual([[ruleOf(view)], [ruleOf(view)]]);
        expect(heartbeats(t.state)).toBe(3);
        expect(adapterLog(t)).toContain("gbrain's UserPromptSubmit hook ran 1 time(s) in this turn");
        expect(readdirSync(t.workspace)).toEqual(['instruction.md']);
      } finally {
        expect(await stop(child)).toBe(0);
      }
    }, 90_000);

    test(h + ': a view installed for another HOME, a destination that is already taken, or gbrain-docs is HE-ADAPTER-006, exit 2, no turn', () => {
      // Another state root: the hook command, the ledger and Codex's trust key name paths this trial does not have.
      let t = trial(h);
      const elsewhere = join(tmp, 'elsewhere-' + h);
      exportView(h, STAND_IN, elsewhere, t.view);
      mkdirSync(t.state);
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, t) }).status).toBe(2);
      expect(adapterLog(t)).toContain('HE-ADAPTER-006 the install bundle could not be applied: the view was installed with HOME ' + JSON.stringify(elsewhere));
      expect(installRecord(t.logs)).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: h, copied: [] });
      expect(stubContexts(t)).toEqual([]);
      // A destination setup would have created already exists (Codex), or the settings.json is not the seed setup merged into (Claude Code).
      t = trial(h);
      exportView(h, STAND_IN, t.state, t.view);
      const taken = join(t.state, h === 'codex' ? 'codex/AGENTS.md' : 'claude/settings.json');
      mkdirSync(dirname(taken), { recursive: true });
      writeFileSync(taken, h === 'codex' ? 'my own instructions\n' : '{"permissions":{}}\n');
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, t) }).status).toBe(2);
      expect(adapterLog(t)).toContain(h === 'codex' ? 'the destination exists and gbrain setup would not have created it: ' + taken : 'is not the seed gbrain setup merged its hook into');
      expect(installRecord(t.logs).copied).toEqual([]);
      expect(stubContexts(t)).toEqual([]);
      // A changed file in the view is refused before anything is copied.
      t = trial(h);
      exportView(h, STAND_IN, t.state, t.view);
      const instructions = join(t.view, 'home', h === 'codex' ? 'codex/AGENTS.md' : 'claude/CLAUDE.md');
      writeFileSync(instructions, readFileSync(instructions, 'utf8') + 'tampered\n');
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, t) }).status).toBe(2);
      expect(adapterLog(t)).toContain('HE-ADAPTER-006 the install bundle could not be applied: digest mismatch for home/' + (h === 'codex' ? 'codex/AGENTS.md' : 'claude/CLAUDE.md'));
      expect(installRecord(t.logs).copied).toEqual([]);
      // gbrain-docs is still refused outright.
      t = trial(h);
      mkdirSync(t.state);
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, t, { HE_GBRAIN_INSTALL: 'gbrain-docs' }) }).status).toBe(2);
      expect(installRecord(t.logs)).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', install: 'gbrain-docs' });
      expect(stubContexts(t)).toEqual([]);
    }, 60_000);

    test(h + ': a hook that does not print the recorded rule, two turn-rule entries, a view carrying more than setup writes, or (Codex) an untrusted hash is HE-ADAPTER-006, exit 2, no turn', () => {
      const refused = (change: (t: Trial) => void, reason: string) => {
        const t = trial(h);
        exportView(h, STAND_IN, t.state, t.view);
        change(t);
        expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, t) }).status).toBe(2);
        expect(adapterLog(t)).toContain('HE-ADAPTER-006 the install bundle could not be applied: ');
        expect(adapterLog(t)).toContain(reason);
        expect(installRecord(t.logs)).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: h });
        expect(stubContexts(t)).toEqual([]);
      };
      refused((t) => {
        const m = JSON.parse(readFileSync(join(t.view, 'manifest.json'), 'utf8')) as InstallViewManifest;
        (m.installer as InstallerRecord).turn_hook!.rule = 'GBrain: some other rule.';
        writeFileSync(join(t.view, 'manifest.json'), JSON.stringify(m, null, 1) + '\n');
      }, 'did not print the rule the bundle recorded');
      refused((t) => rewriteView(t.view, h === 'codex' ? 'codex/hooks.json' : 'claude/settings.json', (s) => {
        const doc = JSON.parse(s) as { hooks: { UserPromptSubmit: unknown[] } };
        doc.hooks.UserPromptSubmit.push(structuredClone(doc.hooks.UserPromptSubmit.at(-1)));
        return JSON.stringify(doc, null, 2) + '\n';
      }), h === 'codex' ? 'hooks.json holds 2 gbrain turn-rule UserPromptSubmit groups, not one' : 'settings.json holds 2 gbrain turn-rule UserPromptSubmit entries, not one');
      if (h === 'codex') {
        refused((t) => rewriteView(t.view, 'codex/config.toml', (s) => s + '[mcp_servers.extra]\nurl = "http://127.0.0.1:1/mcp"\n'), "the view's config.toml holds more than the one [hooks.state] trust table gbrain setup writes");
        refused((t) => rewriteView(t.view, 'codex/config.toml', (s) => s.replace(/sha256:[0-9a-f]{64}/, 'sha256:' + '0'.repeat(64))), 'so Codex would not run it');
      } else {
        refused((t) => rewriteView(t.view, 'claude/settings.json', (s) => JSON.stringify({ ...JSON.parse(s), env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } }, null, 2) + '\n'), "the view's settings.json differs from the seed by more than the gbrain turn-rule hook");
      }
    }, 60_000);

    test(h + ': a hook launcher with another file beside it, without its exec bit, or a command naming a launcher the view does not place, is HE-ADAPTER-006, exit 2, no turn', () => {
      const other = trial(h);
      exportView(h, LAUNCHER_STAND_IN, other.state, other.view);
      rewriteView(other.view, h === 'codex' ? 'codex/hooks.json' : 'claude/settings.json', (s) => s.split(join(other.state, HOOK_LAUNCHER)).join('/opt/other/.gbrain/hook-launcher/gbrain-hook'));
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, other) }).status).toBe(2);
      expect(adapterLog(other)).toContain('starts gbrain through /opt/other/.gbrain/hook-launcher/gbrain-hook, not the hook launcher the view places at ' + join(other.state, HOOK_LAUNCHER));
      expect(stubContexts(other)).toEqual([]);
      // A command naming the launcher in a view that carries none (setup before gbrain#8424 wrote the hook without it).
      const none = trial(h);
      exportView(h, STAND_IN, none.state, none.view);
      rewriteView(none.view, h === 'codex' ? 'codex/hooks.json' : 'claude/settings.json', (s) => s.split(join(none.state, HOOK_GBRAIN_BIN) + ' hook').join(join(none.state, HOOK_LAUNCHER) + ' ' + join(none.state, HOOK_GBRAIN_BIN) + ' hook'));
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, none) }).status).toBe(2);
      expect(adapterLog(none)).toContain('starts gbrain through ' + join(none.state, HOOK_LAUNCHER) + ', which the view does not place');
      expect(stubContexts(none)).toEqual([]);
      // A launcher that lost its exec bit (the copy keeps the view's mode).
      const noexec = trial(h);
      exportView(h, LAUNCHER_STAND_IN, noexec.state, noexec.view);
      chmodSync(join(noexec.view, 'home', HOOK_LAUNCHER), 0o644);
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, noexec) }).status).toBe(2);
      expect(adapterLog(noexec)).toContain('the hook launcher ' + join(noexec.state, HOOK_LAUNCHER) + ' is not executable');
      expect(stubContexts(noexec)).toEqual([]);
      const t = trial(h);
      exportView(h, LAUNCHER_STAND_IN, t.state, t.view);
      mkdirSync(join(t.state, dirname(HOOK_LAUNCHER)), { recursive: true });
      writeFileSync(join(t.state, dirname(HOOK_LAUNCHER), 'bunfig.toml'), 'preload = ["./x.ts"]\n');
      expect(spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: env(h, t) }).status).toBe(2);
      expect(adapterLog(t)).toContain('HE-ADAPTER-006 the install bundle could not be applied: ' + join(t.state, dirname(HOOK_LAUNCHER)) + ' holds bunfig.toml beside the hook launcher');
      expect(installRecord(t.logs)).toMatchObject({ status: 'error', code: 'HE-ADAPTER-006', harness: h });
      expect(stubContexts(t)).toEqual([]);
    }, 60_000);
  }
});

// Value: protects=a counted installer run's results can be committed; fails_when=the ~207 MB gbrain an installer trial copies into its
// state dir is no longer ignored or pruned; why_new=the /ship adversarial review found nothing kept it out of a results PR; seam=none.
test('the gbrain binary an installer trial copies into its state dir is ignored by git and pruned by run-shard.sh', () => {
  const trialBin = 'docs/benchmarks/2026-11-01-x/results/trials/cc-gbrain-installer/sc-01-north-two-asks/r1/state/.local/bin/gbrain';
  expect(spawnSync('git', ['check-ignore', '-q', '--no-index', trialBin], { cwd: ROOT }).status).toBe(0);
  expect(readFileSync(join(ROOT, 'scripts', 'run-shard.sh'), 'utf8')).toContain("'state/.local/bin/gbrain'");
});

// ---- container level ----------------------------------------------------------------------------------

const haveDocker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const imagePresent = (image: string) => spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;
const INSTALLER_IMAGE = process.env.HE_GBRAIN_INSTALLER_IMAGE ?? 'harness-eval/gbrain:dev';
const bundleInstallers = (() => {
  if (!haveDocker || !imagePresent(INSTALLER_IMAGE)) return null;
  const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'cat', INSTALLER_IMAGE, '/install/manifest.json'], { encoding: 'utf8' });
  return r.status === 0 ? (JSON.parse(r.stdout) as { harnesses: Record<string, { installer?: { turn_hook?: unknown } } | undefined> }).harnesses : null;
})();
// The view must carry the hook: at a pin before 5fd43d5a (32366ac2, say) setup writes the block alone for these harnesses, and preflight refuses that view.
const containerReady = (h: H) => !!bundleInstallers?.[h]?.installer?.turn_hook && imagePresent('harness-eval/' + h + ':dev');

/** A fake gbrain behind the world's tap: tools/list answers search and get_page. */
function fakeGbrain(token: string): { port: number; stop: () => void } {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
    if (req.headers.get('authorization') !== 'Bearer ' + token) return Response.json({ error: 'invalid_token' }, { status: 401 });
    const body = await req.json() as { id?: number; method?: string; params?: { protocolVersion?: string } };
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === 'initialize' ? { protocolVersion: body.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-gbrain', version: '0' } }
      : body.method === 'tools/list' ? { tools: ['search', 'get_page'].map((name) => ({ name, description: name + ' the brain', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } })) } : {};
    return new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port as number, stop: () => server.stop(true) };
}

/** A fake Anthropic messages endpoint that records every body and answers each with a short streamed reply. */
function fakeAnthropic(host: string, bodies: Array<Record<string, unknown>>): { port: number; stop: () => void } {
  const server = Bun.serve({ port: 0, hostname: host, async fetch(req) {
    const url = new URL(req.url);
    if (req.method !== 'POST' || !url.pathname.endsWith('/v1/messages')) return Response.json({ type: 'error', error: { type: 'not_found_error', message: url.pathname } }, { status: 404 });
    const body = await req.json() as Record<string, unknown>;
    bodies.push(body);
    const msg = { id: 'msg_fake', type: 'message', role: 'assistant', model: String(body.model ?? ''), content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(msg);
    const events: Array<[string, unknown]> = [
      ['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
      ['message_stop', { type: 'message_stop' }],
    ];
    return new Response(events.map(([e, d]) => 'event: ' + e + '\ndata: ' + JSON.stringify(d) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  } });
  return { port: server.port as number, stop: () => server.stop(true) };
}

/** The fake Responses endpoint behind a front that drops the /<slot>/openai prefix, as the metering proxy does when it forwards. */
function fakeOpenAI(host: string, bodies: Array<Record<string, unknown>>): { port: number; stop: () => void } {
  const fake = startFakeResponses({ log: null, onBody: (b: Record<string, unknown>) => bodies.push(b) });
  const front = Bun.serve({ port: 0, hostname: host, idleTimeout: 0, async fetch(req) {
    const u = new URL(req.url);
    return fetch('http://127.0.0.1:' + fake.port + u.pathname.replace(/^\/[^/]+\/openai/, '') + u.search, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.arrayBuffer() });
  } });
  return { port: front.port as number, stop: () => { front.stop(true); fake.stop(); } };
}

for (const h of HARNESSES) {
  describe.skipIf(!containerReady(h))(h + ' image with the installer view from ' + INSTALLER_IMAGE + ', container level', () => {
    test('two turns against a fake model endpoint: the block and the rule reach the model on every turn, the hook ran once per turn, gbrain is offered, nothing lands in /workspace', async () => {
      const dir = mkdtempSync(join(tmp, h + '-docker-'));
      const t = { workspace: join(dir, 'workspace'), state: join(dir, 'state'), logs: join(dir, 'logs'), turns: join(dir, 'turns'), view: join(dir, 'view') };
      for (const d of [t.workspace, t.state, t.logs, t.turns]) mkdirSync(d);
      writeFileSync(join(t.workspace, 'instruction.md'), '');
      const view = await exportInstallView(INSTALLER_IMAGE, h, 'dev', t.view, 'gbrain-installer');
      expect((view.installer as InstallerRecord).state_root).toBe('/harness-state');
      const rule = ruleOf(view);
      const gateway = containerHostAddress();
      const bodies: Array<Record<string, unknown>> = [];
      const model = h === 'codex' ? fakeOpenAI(gateway, bodies) : fakeAnthropic(gateway, bodies);
      const GBRAIN_TOKEN = 'gbrain_' + 'ab'.repeat(32);
      const gbrain = fakeGbrain(GBRAIN_TOKEN);
      const ws = createWorldServer({ world, split: 'dev', trialId: 'installer-' + h, eventsPath: null, hostname: gateway, port: 0 });
      ws.setGbrain({ url: 'http://127.0.0.1:' + gbrain.port, token: GBRAIN_TOKEN });
      const name = 'he-installer-' + h + '-' + process.pid;
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      const wsPort = new URL(ws.url).port;
      const vars: Record<string, string> = {
        HE_LOG_DIR: '/he-logs', HE_TURNS_DIR: '/he-turns', HE_SESSION_STATE_DIR: '/harness-state', HE_TRIAL_ID: 'installer-' + h, HE_TASK_SLICE: 'multiuser', HE_TIME_BUDGET_S: '120',
        HE_MODEL_BASE_URL: 'http://host.docker.internal:' + model.port + '/installer/' + (h === 'codex' ? 'openai' : 'anthropic'), HE_MODEL_API_KEY: 'trial-token:installer.0123456789abcdef0123456789abcdef',
        HE_MODEL_NAME: h === 'codex' ? 'gpt-6-luna' : 'claude-haiku-5-5',
        HE_WORLD_MCP_URL: 'http://host.docker.internal:' + wsPort + '/mcp', HE_WORLD_MCP_TOKEN: ws.credentials.bot.token,
        HE_GBRAIN_MCP_URL: 'http://host.docker.internal:' + wsPort + '/gbrain', HE_GBRAIN_MCP_TOKEN: ws.credentials.bot.token,
        HE_GBRAIN_INSTALL: 'gbrain-installer', HE_GBRAIN_SPLIT: 'dev', HE_GBRAIN_INSTALL_DIR: '/he-gbrain-install',
      };
      const args = ['run', '-d', '--name', name, '--user', process.getuid!() + ':' + process.getgid!(), '--network', 'bridge', '--add-host', 'host.docker.internal:host-gateway',
        '-v', t.workspace + ':/workspace', '-v', t.state + ':/harness-state', '-v', t.logs + ':/he-logs', '-v', t.turns + ':/he-turns', '-v', t.view + ':/he-gbrain-install:ro'];
      for (const [k, v] of Object.entries(vars)) args.push('-e', k + '=' + v);
      const log = () => (existsSync(join(t.logs, 'adapter.log')) ? readFileSync(join(t.logs, 'adapter.log'), 'utf8').slice(-4000) : '(no adapter.log)') + '\n' + spawnSync('docker', ['logs', '--tail', '40', name], { encoding: 'utf8' }).stderr;
      try {
        const run = spawnSync('docker', [...args, 'harness-eval/' + h + ':dev', 'serve'], { encoding: 'utf8' });
        expect(run.status, run.stderr).toBe(0);
        const running = () => spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', name], { encoding: 'utf8' }).stdout.trim() === 'true';
        await until(() => existsSync(join(t.logs, 'ready')) || !running(), 120_000, 'ready', log);
        expect(existsSync(join(t.logs, 'ready')), log()).toBe(true);
        expect(JSON.parse(readFileSync(join(t.logs, 'ready'), 'utf8')).gbrain_install).toMatchObject({ status: 'ok', install: 'gbrain-installer', files: view.files.length, view_digest: view.view_digest, turn_hook: 'ran' });
        expect(heartbeats(t.state)).toBe(1);
        for (const n of [1, 2]) {
          expect((await turn(t.turns, n, 'ping-' + n, 180_000, log)).exit, log()).toBe(0);
          expect(turnHookRuns(t.logs, n), log()).toBe(1);
        }
        expect(heartbeats(t.state)).toBe(3);
        const said = (b: Record<string, unknown>) => JSON.stringify(h === 'codex' ? b.input : b.messages);
        for (const n of [1, 2]) {
          const carrying = bodies.filter((b) => said(b).includes('ping-' + n));
          expect(carrying.length, 'ping-' + n + ': none of ' + bodies.length + ' requests carries the prompt').toBeGreaterThan(0);
          for (const b of carrying) expect(said(b)).toContain(JSON.stringify(rule).slice(1, -1));
        }
        const all = JSON.stringify(bodies);
        expect(all).toContain(JSON.stringify(readFileSync(join(t.view, 'home', h === 'codex' ? 'codex/AGENTS.md' : 'claude/CLAUDE.md'), 'utf8').split('\n').find((l) => l.startsWith('## '))!).slice(1, -1));
        expect(all).toMatch(h === 'codex' ? /get_page/ : /mcp__gbrain__get_page/);
        expect(readdirSync(t.workspace)).toEqual(['instruction.md']);
      } finally {
        spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
        model.stop(); gbrain.stop(); ws.stop();
      }
    }, 600_000);
  });
}
