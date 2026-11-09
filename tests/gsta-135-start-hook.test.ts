// internal-task-a's start hook arm (gstack internal-task-b, opt-in, b9fda18c): the overlay
// wrapper's image switch, pinned-tree check, config seed and hook status gate
// (harnesses/_gstack/wrapper-lib.sh, both overlay adapters with stub gstack
// checkouts, no docker), the overlay Dockerfiles' build arg and label, and
// discovery.sh's --start-hook candidate form (dry runs against a stubbed
// docker). Keyless: every spawned process gets PATH and HOME and nothing else.
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dir, '..');
const LIB = join(ROOT, 'harnesses', '_gstack', 'wrapper-lib.sh');
const tmp = mkdtempSync(join(tmpdir(), 'harn18-hook-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? tmp };
const dir = (p: string) => mkdtempSync(join(tmp, p + '-'));
const read = (p: string) => readFileSync(p, 'utf8');

/** A stub gstack checkout in a git repository: setup records its environment and whether the config existed, then prints the
 *  ready line and exits SETUP_EXIT; bin/gstack-harness prints STATUS_OUT. Returns the directory and its HEAD. */
function fakeGstack(host: string) {
  const d = dir('gstack');
  mkdirSync(join(d, 'bin'));
  writeFileSync(join(d, 'VERSION'), '9.9.9\n');
  writeFileSync(join(d, 'setup'), [
    '#!/usr/bin/env bash',
    'cfg=$([ "' + host + '" = openclaw ] && echo "$OPENCLAW_STATE_DIR/openclaw.json" || echo "$HERMES_HOME/config.yaml")',
    '{ echo "hook=${GSTACK_HARNESS_START_HOOK-unset}"; echo "config_path=${OPENCLAW_CONFIG_PATH-unset}"; echo "config_existed=$([ -e "$cfg" ] && echo yes || echo no)"; } > "$HE_LOG_DIR/setup-env.txt"',
    'echo "gstack ready (' + host + ')"',
    'exit ${SETUP_EXIT:-0}',
  ].join('\n') + '\n');
  chmodSync(join(d, 'setup'), 0o755);
  writeFileSync(join(d, 'bin', 'gstack-harness'), 'console.log(process.env.STATUS_OUT ?? "' + host + '\\tall\\t/x\\t1 files\\t9.9.9\\tvisible to harness: yes\\tid");\n');
  const git = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env: ENV, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fake gstack');
  return { d, sha: git('rev-parse', 'HEAD') };
}

/** Run a bash snippet with wrapper-lib.sh sourced. */
function withLib(snippet: string, env: Record<string, string> = {}) {
  const d = dir('lib');
  const r = spawnSync('bash', ['-c', 'set -euo pipefail; . "' + LIB + '"; ' + snippet], { env: { ...ENV, HE_LOG_DIR: d, HE_SESSION_STATE_DIR: d, HE_TRIAL_ID: 't', ...env }, encoding: 'utf8' });
  return { ...r, dir: d, log: existsSync(join(d, 'gstack-register.log')) ? read(join(d, 'gstack-register.log')) : '' };
}

describe('wrapper-lib.sh: the start hook switch, the pinned tree, the config seed', () => {
  test('the image decides GSTACK_HARNESS_START_HOOK: on is 1, off or unset is 0 whatever was inherited, anything else is exit 2', () => {
    expect(withLib('wrap_start_hook_mode; echo $GSTACK_HARNESS_START_HOOK', { GSTACK_IMAGE_START_HOOK: 'on', GSTACK_HARNESS_START_HOOK: '0' }).stdout).toBe('1\n');
    expect(withLib('wrap_start_hook_mode; echo $GSTACK_HARNESS_START_HOOK', { GSTACK_IMAGE_START_HOOK: 'off', GSTACK_HARNESS_START_HOOK: '1' }).stdout).toBe('0\n');
    expect(withLib('wrap_start_hook_mode; echo $GSTACK_HARNESS_START_HOOK', { GSTACK_HARNESS_START_HOOK: 'on' }).stdout).toBe('0\n');
    const bad = withLib('wrap_start_hook_mode', { GSTACK_IMAGE_START_HOOK: 'yes' });
    expect(bad.status).toBe(2);
    expect(bad.log).toContain("FAIL: GSTACK_IMAGE_START_HOOK must be on or off, not 'yes'");
  });
  test('the installed tree must be at GSTACK_IMAGE_COMMIT: equal passes and is logged, another commit or none named is exit 2', () => {
    const g = fakeGstack('openclaw');
    const ok = withLib('wrap_gstack_present; echo present', { GSTACK_DIR: g.d, GSTACK_IMAGE_COMMIT: g.sha });
    expect(ok.stdout).toBe('present\n');
    expect(ok.log).toContain('pin: ' + g.d + ' HEAD ' + g.sha + ' equals GSTACK_IMAGE_COMMIT');
    const other = withLib('wrap_gstack_present; echo present', { GSTACK_DIR: g.d, GSTACK_IMAGE_COMMIT: 'b'.repeat(40) });
    expect(other.status).toBe(2);
    expect(other.stdout).toBe('');
    expect(other.log).toContain('the installed gstack tree is at ' + g.sha + ', not the pinned ' + 'b'.repeat(40) + ' this image names; refusing to start');
    expect(other.log).toContain('exit 2 (harness_error) before any model request');
    for (const c of [undefined, 'none']) {
      const r = withLib('wrap_gstack_present', { GSTACK_DIR: g.d, ...(c ? { GSTACK_IMAGE_COMMIT: c } : {}) });
      expect(r.status).toBe(2);
      expect(r.log).toContain('exists but this image names no gstack commit');
    }
    const notGit = dir('plain');
    const r = withLib('wrap_gstack_present', { GSTACK_DIR: notGit, GSTACK_IMAGE_COMMIT: g.sha });
    expect(r.status).toBe(2);
    expect(r.log).toContain('rev-parse HEAD failed');
  });
  test('no gstack: start_hook off none; an image that says on with no gstack is exit 2', () => {
    const none = withLib('wrap_gstack_present || echo none', { GSTACK_DIR: join(tmp, 'absent') });
    expect(none.stdout).toBe('none\n');
    expect(none.log).toContain('start_hook: off none (no gstack in this image)');
    const on = withLib('wrap_gstack_present || echo none', { GSTACK_DIR: join(tmp, 'absent'), GSTACK_IMAGE_START_HOOK: 'on' });
    expect(on.status).toBe(2);
    expect(on.log).toContain('says GSTACK_IMAGE_START_HOOK=on but has no');
  });
  test('the config seed copies the counted adapter\'s template only when the file is absent, the OpenAI one for an /openai URL and the Particle one for a /particle URL', () => {
    const cfg = join(ROOT, 'harnesses', 'hermes', 'config');
    const a = withLib('wrap_seed_config "$HE_LOG_DIR/c.yaml" config.yaml config.openai.yaml', { GSTACK_WRAP_CONFIG_DIR: cfg, HE_MODEL_BASE_URL: 'http://p/slot/anthropic' });
    expect(read(join(a.dir, 'c.yaml'))).toBe(read(join(cfg, 'config.yaml')));
    expect(a.log).toContain('config: seeded ' + a.dir + '/c.yaml from ' + cfg + '/config.yaml before registration');
    const o = withLib('wrap_seed_config "$HE_LOG_DIR/c.yaml" config.yaml config.openai.yaml', { GSTACK_WRAP_CONFIG_DIR: cfg, HE_MODEL_BASE_URL: 'http://p/slot/openai/' });
    expect(read(join(o.dir, 'c.yaml'))).toBe(read(join(cfg, 'config.openai.yaml')));
    const p = withLib('wrap_seed_config "$HE_LOG_DIR/c.yaml" config.yaml config.openai.yaml', { GSTACK_WRAP_CONFIG_DIR: cfg, HE_MODEL_BASE_URL: 'http://p/slot/particle' });
    expect(read(join(p.dir, 'c.yaml'))).toBe(read(join(cfg, 'config.particle.yaml')));
    const ocCfg = join(ROOT, 'harnesses', 'openclaw', 'config');
    const oc = withLib('wrap_seed_config "$HE_LOG_DIR/c.json" openclaw.json openclaw.openai.json', { GSTACK_WRAP_CONFIG_DIR: ocCfg, HE_MODEL_BASE_URL: 'http://p/slot/particle/' });
    expect(read(join(oc.dir, 'c.json'))).toBe(read(join(ocCfg, 'openclaw.particle.json')));
    const kept = withLib('echo mine > "$HE_LOG_DIR/c.yaml"; wrap_seed_config "$HE_LOG_DIR/c.yaml" config.yaml config.openai.yaml', { GSTACK_WRAP_CONFIG_DIR: cfg });
    expect(read(join(kept.dir, 'c.yaml'))).toBe('mine\n');
    expect(kept.log).toContain('already exists, left as it is');
    const missing = withLib('wrap_seed_config "$HE_LOG_DIR/c.yaml" nope.yaml nope.yaml', { GSTACK_WRAP_CONFIG_DIR: cfg });
    expect(missing.status).toBe(2);
    expect(missing.log).toContain('no config template ' + cfg + '/nope.yaml');
  });
  test('setup exit 4 is the inactive hook, as a harness error', () => {
    const r = withLib('wrap_setup_exit hermes 4');
    expect(r.status).toBe(2);
    expect(r.log).toContain('FAIL: setup --host hermes exited 4: the skills are registered but the start hook is not active (HARNESS_HOOK_INACTIVE');
    expect(withLib('wrap_setup_exit hermes 1').log).toContain('FAIL: setup --host hermes exited 1 (gstack-setup.log)');
  });
  test('the status gate: on needs start hook: active, off refuses an active hook, and one start_hook: line is logged', () => {
    const g = fakeGstack('hermes');
    const gate = (hook: string, status: string) => withLib('wrap_start_hook_mode; wrap_start_hook_check; echo passed', { GSTACK_DIR: g.d, GSTACK_IMAGE_START_HOOK: hook, STATUS_OUT: status });
    const on = gate('on', 'hermes\tall\t/x\n  start hook: active');
    expect(on.stdout).toBe('passed\n');
    expect(on.log).toContain('start_hook: on active');
    expect(on.log).toContain('  start hook: active');
    for (const s of ['hermes\tall\t/x\n  start hook: written - hermes plugins list does not show gstack-start', 'hermes\tall\t/x']) {
      const r = gate('on', s);
      expect(r.status).toBe(2);
      expect(r.log).toMatch(/FAIL: start hook: the image says on, but gstack-harness status shows it (written|absent), not active/);
    }
    const offActive = gate('off', 'hermes\tall\t/x\n  start hook: active');
    expect(offActive.status).toBe(2);
    expect(offActive.log).toContain('the image says off, but gstack-harness status shows it active');
    const off = gate('off', 'hermes\tall\t/x');
    expect(off.stdout).toBe('passed\n');
    expect(off.log).toContain('start_hook: off absent');
  });
});

describe('the overlay adapters with the start hook', () => {
  const real = join(tmp, 'real-adapter.sh');
  writeFileSync(real, '#!/usr/bin/env bash\necho "real $* budget=$HE_TIME_BUDGET_S"\n');
  chmodSync(real, 0o755);
  const adapter = (h: string) => {
    const p = join(tmp, h + '-adapter-' + Math.random().toString(36).slice(2) + '.sh');
    writeFileSync(p, read(join(ROOT, 'harnesses', h, 'gstack', 'adapter.sh')).replace('. /opt/harness/gstack/wrapper-lib.sh', '. ' + LIB));
    return p;
  };
  const run = (h: 'openclaw' | 'hermes', gstackDir: string, extra: Record<string, string> = {}) => {
    const state = dir('state'), logs = dir('logs');
    const r = spawnSync('bash', [adapter(h), 'run'], { encoding: 'utf8', env: { ...ENV, HE_LOG_DIR: logs, HE_SESSION_STATE_DIR: state, HE_TIME_BUDGET_S: '600', HE_TRIAL_ID: 't', GSTACK_DIR: gstackDir, GSTACK_WRAP_REAL: real,
      GSTACK_WRAP_CONFIG_DIR: join(ROOT, 'harnesses', h, 'config'), HE_GSTACK_HERMES_MODE: 'oneshot', ...extra } });
    const setupEnv = existsSync(join(logs, 'setup-env.txt')) ? read(join(logs, 'setup-env.txt')) : '';
    return { ...r, state, logs, setupEnv, log: read(join(logs, 'gstack-register.log')) };
  };
  const active = (h: string) => h + '\tall\t/x\t1 files\t9.9.9\tvisible to harness: yes\tid\n  start hook: active';

  test('OpenClaw, hook on: the config is seeded before setup, setup sees GSTACK_HARNESS_START_HOOK=1 without OPENCLAW_CONFIG_PATH, the gate passes', () => {
    const g = fakeGstack('openclaw');
    const r = run('openclaw', g.d, { GSTACK_IMAGE_COMMIT: g.sha, GSTACK_IMAGE_START_HOOK: 'on', STATUS_OUT: active('openclaw'), OPENCLAW_CONFIG_PATH: '' });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toMatch(/^real run budget=(600|59[0-9])\n$/);
    expect(r.setupEnv).toBe('hook=1\nconfig_path=unset\nconfig_existed=yes\n');
    expect(read(join(r.state, 'openclaw', 'openclaw.json'))).toBe(read(join(ROOT, 'harnesses', 'openclaw', 'config', 'openclaw.json')));
    expect(r.log).toContain('start_hook: on active');
    const same = run('openclaw', g.d, { GSTACK_IMAGE_COMMIT: g.sha, GSTACK_IMAGE_START_HOOK: 'on', STATUS_OUT: active('openclaw') });
    expect(same.status).toBe(0);
  });
  test('OpenClaw, hook off: setup keeps OPENCLAW_CONFIG_PATH and sees GSTACK_HARNESS_START_HOOK=0 even when 1 was inherited', () => {
    const g = fakeGstack('openclaw');
    const r = run('openclaw', g.d, { GSTACK_IMAGE_COMMIT: g.sha, GSTACK_HARNESS_START_HOOK: '1', OPENCLAW_CONFIG_PATH: '/harness-state/openclaw/openclaw.json' });
    expect(r.status).toBe(0);
    expect(r.setupEnv).toBe('hook=0\nconfig_path=/harness-state/openclaw/openclaw.json\nconfig_existed=yes\n');
    expect(r.log).toContain('start_hook: off absent');
  });
  test('OpenClaw, hook on: setup exit 4, an inactive status, roots other than parent and a foreign OPENCLAW_CONFIG_PATH are exit 2 before the real adapter', () => {
    const g = fakeGstack('openclaw');
    const on = { GSTACK_IMAGE_COMMIT: g.sha, GSTACK_IMAGE_START_HOOK: 'on', STATUS_OUT: active('openclaw') };
    const cases: [Record<string, string>, string][] = [
      [{ SETUP_EXIT: '4' }, 'exited 4: the skills are registered but the start hook is not active (HARNESS_HOOK_INACTIVE'],
      [{ STATUS_OUT: 'openclaw\tall\t/x\n  start hook: written - status loaded, not enabled' }, 'gstack-harness status shows it written, not active'],
      [{ HE_GSTACK_OPENCLAW_ROOTS: 'both' }, 'HE_GSTACK_OPENCLAW_ROOTS=both is refused with it'],
      [{ OPENCLAW_CONFIG_PATH: '/elsewhere/openclaw.json' }, 'OPENCLAW_CONFIG_PATH=/elsewhere/openclaw.json is not the profile'],
    ];
    for (const [extra, msg] of cases) {
      const r = run('openclaw', g.d, { ...on, ...extra });
      expect([msg, r.status]).toEqual([msg, 2]);
      expect(r.stdout).not.toContain('real run');
      expect(r.log).toContain(msg);
    }
  });
  test('Hermes, hook on: the config is seeded before setup and setup sees GSTACK_HARNESS_START_HOOK=1; a moved tree is exit 2', () => {
    const g = fakeGstack('hermes');
    const r = run('hermes', g.d, { GSTACK_IMAGE_COMMIT: g.sha, GSTACK_IMAGE_START_HOOK: 'on', STATUS_OUT: active('hermes') });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.setupEnv).toContain('hook=1\n');
    expect(r.setupEnv).toContain('config_existed=yes\n');
    expect(read(join(r.state, 'hermes', 'config.yaml'))).toBe(read(join(ROOT, 'harnesses', 'hermes', 'config', 'config.yaml')));
    expect(r.log).toContain('start_hook: on active');
    execFileSync('git', ['-C', g.d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'moved'], { env: ENV });
    const moved = run('hermes', g.d, { GSTACK_IMAGE_COMMIT: g.sha, GSTACK_IMAGE_START_HOOK: 'on', STATUS_OUT: active('hermes') });
    expect(moved.status).toBe(2);
    expect(moved.setupEnv).toBe('');
    expect(moved.log).toContain('not the pinned ' + g.sha + ' this image names; refusing to start');
  });
  test('the Hermes overlay keeps the approval line where discovery.sh reads it (line 73) and the seed on the runtime-check line', () => {
    const lines = read(join(ROOT, 'harnesses', 'hermes', 'gstack', 'adapter.sh')).split('\n');
    expect(lines[72]).toStartWith('wrap_log "approval: ');
    expect(lines.find(l => l.startsWith('wrap_runtime_check'))).toBe('wrap_runtime_check; wrap_seed_config "$HERMES_HOME/config.yaml" config.yaml config.openai.yaml');
  });
});

describe('the overlay Dockerfiles\' start hook build arg', () => {
  test('GSTACK_START_HOOK defaults off, is refused with GSTACK_COMMIT=none or any other value, is baked as GSTACK_IMAGE_START_HOOK and labelled', () => {
    for (const h of ['openclaw', 'hermes']) {
      const src = read(join(ROOT, 'harnesses', h, 'gstack', 'Dockerfile'));
      expect(src).toContain('ARG GSTACK_START_HOOK=off\n');
      expect(src).toContain('GSTACK_IMAGE_COMMIT=${GSTACK_COMMIT} GSTACK_IMAGE_START_HOOK=${GSTACK_START_HOOK}');
      expect(src).toContain('org.harness-eval.gstack.start_hook="${GSTACK_START_HOOK}"');
      expect(src).toContain('GSTACK_HARNESS_START_HOOK=0 ./setup --host ' + h + ' --no-browser');
      expect(src).toContain('test "$(git rev-parse HEAD)" = "${GSTACK_COMMIT}"');
      const guard = src.match(/^RUN case "\$\{GSTACK_START_HOOK\}"[\s\S]*?fi\n/m)![0].replace(/^RUN /, '').replace(/\\\n/g, ' ');
      const sh = (hook: string, commit: string) => spawnSync('sh', ['-c', guard.replaceAll('${GSTACK_START_HOOK}', hook).replaceAll('${GSTACK_COMMIT}', commit)], { encoding: 'utf8' });
      expect(sh('on', 'b'.repeat(40)).status).toBe(0);
      expect(sh('off', 'none').status).toBe(0);
      expect(sh('on', 'none').status).toBe(1);
      expect(sh('on', 'none').stderr).toContain('GSTACK_START_HOOK=on needs a gstack commit');
      expect(sh('1', 'b'.repeat(40)).status).toBe(1);
    }
  });
});

describe('discovery.sh --start-hook candidate', () => {
  const sh = join(ROOT, 'scripts/gsta-135/discovery.sh');
  const repo = dir('repo');
  const g = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: ENV }).trim();
  g('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'VERSION'), '1\n'); g('add', '.'); g('commit', '-qm', 'one');
  const c1 = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'VERSION'), '2\n'); g('add', '.'); g('commit', '-qm', 'two');
  const c2 = g('rev-parse', 'HEAD');
  const ceilings = join(tmp, 'ceilings.json');
  writeFileSync(ceilings, JSON.stringify({ task1: 0.41, task2: 0.21, task3: 0.11, per_harness: {}, source: 'test', derived_at: '2026-11-01T00:00:00Z' }));
  const noRuntime = join(tmp, 'runtime-none.json');
  writeFileSync(noRuntime, '{}');
  // A docker stub: .Id is sha256:stub-<tag suffix>; the commit label maps gstack-<sha8> through STUB_MAP and gstack-none to none;
  // the start_hook label is STUB_HOOK_ON (default on) for a -hook tag and STUB_HOOK_OFF (default off) otherwise; hermes_mode is chat.
  const bin = join(tmp, 'bin'); mkdirSync(bin);
  const map = join(tmp, 'map'); mkdirSync(map);
  for (const c of [c1, c2]) writeFileSync(join(map, c.slice(0, 8)), c);
  writeFileSync(join(bin, 'docker'), [
    '#!/usr/bin/env bash',
    'if [ "$1" = image ] && [ "$2" = inspect ]; then',
    '  tag=$3 fmt=$5',
    '  case "$fmt" in',
    '    *.Id*) echo "sha256:stub-${tag##*:}" ;;',
    '    *gstack.commit*) case "$tag" in *:gstack-none*) echo none ;; *) cat "$STUB_MAP/$(sed -E \'s/.*gstack-([0-9a-f]{8}).*/\\1/\' <<< "$tag")" ;; esac ;;',
    '    *start_hook*) case "$tag" in *-hook*) echo "${STUB_HOOK_ON-on}" ;; *) echo "${STUB_HOOK_OFF-off}" ;; esac ;;',
    '    *hermes_mode*) echo chat ;;',
    '  esac',
    '  exit 0',
    'fi',
    'echo "stub docker: unexpected $*" >&2; exit 1',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'docker'), 0o755);
  const env = (extra: Record<string, string> = {}) => ({ ...ENV, PATH: bin + ':' + ENV.PATH, STUB_MAP: map, ...extra });
  const three = 'none,baseline:' + c1 + ',candidate:' + c2;
  const runD = (id: string, extra: string[], e: Record<string, string>, arms = three) =>
    spawnSync('bash', [sh, '--arms', arms, '--gstack-dir', repo, '--run-id', id, '--ceilings', ceilings, '--runtime-preflight', noRuntime, '--hermes-mode', 'chat', '--dry-run', ...extra], { cwd: ROOT, env: { ...e, HOME: tmp }, encoding: 'utf8' });
  const outDir = (id: string) => join(ROOT, 'results/gsta-135/runs', id + '-dry-run');

  test('the candidate\'s images take the -hook tags, the manifest records start_hook per arm and the rule, 144 rows at --trials 8', () => {
    const id = 'test-harn18-hook-' + process.pid;
    try {
      const r = runD(id, ['--start-hook', 'candidate', '--trials', '8', '--per-trial-usd', '1.00', '--panel-cap-usd', '28'], env());
      expect({ status: r.status, stderr: r.stderr.slice(-600) }).toMatchObject({ status: 0 });
      expect(r.stdout).toMatch(/manifest .* 144 rows, lease \$6\.\d+ per trial \(R_max \$5\.\d+\), cap \$28, hermes chat/);
      const m = JSON.parse(read(join(outDir(id), 'manifest.json')));
      expect(m.arms.candidate.images.openclaw.tag).toBe('harness-eval/openclaw:gstack-' + c2.slice(0, 8) + '-hook');
      expect(m.arms.candidate.images.hermes).toEqual({ tag: 'harness-eval/hermes:gstack-' + c2.slice(0, 8) + '-hook-chat', digest: 'sha256:stub-gstack-' + c2.slice(0, 8) + '-hook-chat' });
      expect(m.arms.baseline.images.openclaw.tag).toBe('harness-eval/openclaw:gstack-' + c1.slice(0, 8));
      expect([m.arms.none.start_hook, m.arms.baseline.start_hook, m.arms.candidate.start_hook]).toEqual(['off', 'off', 'on']);
      expect(m.start_hook.arm).toBe('candidate');
      expect(m.start_hook.rule).toContain('infra:no_model_request(harness_error), never a score');
      expect(m.order).toHaveLength(144);
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
  test('with --start-hook every image must carry the label explicitly; without it, absent is off and on is refused', () => {
    const id = 'test-harn18-hooklbl-' + process.pid;
    try {
      const absent = runD(id, ['--start-hook', 'candidate', '--trials', '1'], env({ STUB_HOOK_OFF: '' }));
      expect(absent.status).toBe(2);
      expect(absent.stderr).toContain('image harness-eval/openclaw:gstack-none carries org.harness-eval.gstack.start_hook=<none>, not off (--start-hook candidate); rebuild it with --build-arg GSTACK_START_HOOK=off');
      const candOff = runD(id, ['--start-hook', 'candidate', '--trials', '1'], env({ STUB_HOOK_ON: 'off' }));
      expect(candOff.status).toBe(2);
      expect(candOff.stderr).toContain('-hook carries org.harness-eval.gstack.start_hook=off, not on (--start-hook candidate); rebuild it with --build-arg GSTACK_START_HOOK=on');
      const baseOn = runD(id, ['--trials', '1'], env({ STUB_HOOK_OFF: 'on' }));
      expect(baseOn.status).toBe(2);
      expect(baseOn.stderr).toContain('carries org.harness-eval.gstack.start_hook=on, but no --start-hook names the none arm');
      const old = runD(id, ['--trials', '1'], env({ STUB_HOOK_OFF: '' }));
      expect({ status: old.status, stderr: old.stderr.slice(-400) }).toMatchObject({ status: 0 });
      const m = JSON.parse(read(join(outDir(id), 'manifest.json')));
      expect(m.arms.candidate.images.openclaw.tag).toBe('harness-eval/openclaw:gstack-' + c2.slice(0, 8));
      expect(m.arms.candidate.start_hook).toBeUndefined();
      expect(m.start_hook).toBeNull();
    } finally { rmSync(outDir(id), { recursive: true, force: true }); }
  }, 120_000);
  test('--start-hook takes candidate only, and only in panel mode', () => {
    const bad = runD('test-harn18-hookbad-' + process.pid, ['--start-hook', 'baseline'], env());
    expect(bad.status).toBe(64);
    expect(bad.stderr).toContain('--start-hook takes candidate');
    const disc = spawnSync('bash', [sh, '--start-hook', 'candidate', '--dry-run', '--run-id', 'test-harn18-hookdisc-' + process.pid], { cwd: ROOT, env: env(), encoding: 'utf8' });
    expect(disc.status).toBe(64);
    expect(disc.stderr).toContain('--start-hook is a panel option');
  });
});
