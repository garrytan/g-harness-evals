#!/usr/bin/env bun
// gbrain's installer route inside QM's core (internal-task-a, internal-task-b), keyless. QM embeds Pi, so the route a user would try is
// gbrain setup pi --skill-loading resolve inside the core container. This builds harness-eval/qm:sas-gbrain-pi on the pinned,
// unchanged harness-eval/qm:dev: Bun from oven/bun:<bun> (Alpine, musl), gbrain installed the way its README says (bun install
// -g github:garrytan/gbrain#<commit>; a compiled musl build cannot set up Pi, since setup builds a Node library from gbrain's
// source), the rung's skills in /home/node/.pi/agent/skills (setup needs a Pi skill folder, and QM keeps its own skills in its
// database), then gbrain setup pi and gbrain doctor --only skill_resolver at image build. Then one keyless QM cell through
// scripts/skill-resolver/step0/qm/qm-listing.ts (OpenAI route, as qm-listing-map.ts) on that image with the rung as QM's catalog layer, and a search of every
// captured model request for a gbrain block (<relevant_skills>, <pinned_skills>) or the extension's name.
//
//   bun scripts/skills-at-scale/qm-installer-check.ts --rung <rung dir> --out <dir> [--gbrain <tag> [--gbrain-commit <sha>]] [--musl-gbrain <compiled binary>]
//
// --musl-gbrain also runs setup with a compiled musl gbrain (bun build --compile --target=bun-linux-x64-musl) and records
// its answer. Writes <out>/qm-installer.json and <out>/cell/ (the qm-listing.ts cell). Exits 1 when setup or the cell fails.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PIN, gbrainRelease } from './build-kit.ts';

const REPO = resolve(import.meta.dir, '..', '..');
const ENV = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };
const sh = (cmd: string[], input?: string) => spawnSync(cmd[0]!, cmd.slice(1), { encoding: 'utf8', env: ENV, cwd: REPO, input, maxBuffer: 64 << 20 });
const IMAGE = 'harness-eval/qm:sas-gbrain-pi';

if (import.meta.main) {
  const a = process.argv.slice(2);
  const v = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  if (!v('--rung') || !v('--out')) { console.error('usage: qm-installer-check.ts --rung <rung dir> --out <dir> [--gbrain <tag> [--gbrain-commit <sha>]] [--musl-gbrain <binary>]'); process.exit(2); }
  const rung = resolve(v('--rung')!), out = resolve(v('--out')!);
  const g = gbrainRelease(v('--gbrain'), v('--gbrain-commit'));
  rmSync(out, { recursive: true, force: true });
  const ctx = join(out, 'context');
  mkdirSync(ctx, { recursive: true });
  cpSync(join(rung, 'skills'), join(ctx, 'skills'), { recursive: true });
  const rec: Record<string, unknown> = { harness: 'qm', qm_image: 'harness-eval/qm:dev', qm_commit: sh(['docker', 'image', 'inspect', '-f', '{{index .Config.Labels "harness-eval.commit"}}', 'harness-eval/qm:dev']).stdout.trim(), gbrain: g, bun_image: PIN.bun_image + '-alpine' };
  const musl = v('--musl-gbrain');
  if (musl) {
    const r = sh(['docker', 'run', '--rm', '--entrypoint', 'sh', '-u', 'node', '-e', 'HOME=/tmp/h', '-v', resolve(musl) + ':/usr/local/bin/gbrain:ro', '-v', join(ctx, 'skills') + ':/cat:ro', 'harness-eval/qm:dev', '-c',
      'mkdir -p /tmp/h/.pi/agent/skills && cp -r /cat/* /tmp/h/.pi/agent/skills/ && gbrain --version && gbrain setup pi --skill-loading resolve 2>&1; echo "setup_exit=$?"']);
    rec.compiled_musl = { binary: resolve(musl), out: (r.stdout + r.stderr).split('\n').filter((l) => /setup_exit|Error|gbrain 0|Fix/.test(l)) };
  }
  const df = 'FROM ' + PIN.bun_image + '-alpine AS bun\nFROM harness-eval/qm:dev\nUSER root\nCOPY --from=bun /usr/local/bin/bun /usr/local/bin/bun\nUSER node\n' +
    'COPY --chown=node:node skills /home/node/.pi/agent/skills\n' +
    'RUN BUN_INSTALL=/home/node/.bun /usr/local/bin/bun install -g github:' + PIN.repo + '#' + g.commit + ' && test "$(/home/node/.bun/bin/gbrain --version)" = "gbrain ' + g.version + '"\n' +
    'ENV PATH=/home/node/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' +
    'RUN gbrain setup pi --skill-loading resolve > /home/node/sas-setup.log 2>&1; echo "setup_exit=$?" >> /home/node/sas-setup.log; gbrain doctor --only skill_resolver --json > /home/node/sas-doctor.json 2>/dev/null; true\n';
  const b = sh(['docker', 'build', '-q', '-f', '-', '-t', IMAGE, ctx], df);
  if (b.status !== 0) { console.error('docker build ' + IMAGE + ' failed: ' + (b.stderr ?? '').slice(-800)); process.exit(1); }
  const read = (f: string) => sh(['docker', 'run', '--rm', '--entrypoint', 'cat', IMAGE, f]).stdout;
  const setup = read('/home/node/sas-setup.log');
  let doctor: Record<string, unknown> | null = null;
  try { doctor = (JSON.parse(read('/home/node/sas-doctor.json')).checks as Record<string, unknown>[]).find((c) => c.name === 'skill_resolver') ?? null; } catch { /* below */ }
  rec.setup = { exit: Number(/setup_exit=(\d+)/.exec(setup)?.[1] ?? -1), lines: setup.split('\n').filter((l) => /^\s+(write|run|note|skip)\s|Error|Fix/.test(l)) };
  rec.doctor = doctor ? { status: doctor.status, message: doctor.message } : null;
  const probe = sh(['docker', 'build', '-q', '-f', 'scripts/skill-resolver/step0/qm/Dockerfile.qm-catalog', '--build-arg', 'BASE=' + IMAGE, '--target', 'native', '-t', 'harness-eval/qm:harn52-native', ctx]);
  if (probe.status !== 0) { console.error('probe image build failed: ' + (probe.stderr ?? '').slice(-800)); process.exit(1); }
  const m = JSON.parse(readFileSync(join(rung, 'manifest.json'), 'utf8')) as { catalog_sha256: string; skills: { name: string; description: string }[] };
  writeFileSync(join(ctx, 'manifest.json'), JSON.stringify({ catalog_hash: m.catalog_sha256, skills: m.skills.map((s) => ({ name: s.name, pack: 'synthetic', description: s.description })) }, null, 1) + '\n');
  const cell = sh(['bun', 'scripts/skill-resolver/step0/qm/qm-listing.ts', '--catalog', ctx, '--configs', 'native', '--providers', 'openai', '--out', join(out, 'cell')]);
  const dir = join(out, 'cell', 'qm-openai-native');
  const log = existsSync(join(dir, 'fake.ndjson')) ? readFileSync(join(dir, 'fake.ndjson'), 'utf8') : '';
  const summary = existsSync(join(dir, 'summary.json')) ? JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) : null;
  rec.cell = { requests: log.split('\n').filter(Boolean).length, error: summary?.notes?.error ?? (cell.status !== 0 ? (cell.stderr ?? '').slice(-500) : null), catalog_listed: summary?.listed_count ?? null,
    relevant_skills_blocks: (log.match(/<relevant_skills>/g) ?? []).length, pinned_skills_blocks: (log.match(/<pinned_skills>/g) ?? []).length, mentions_gbrain_skill_resolver: (log.match(/gbrain-skill-resolver/g) ?? []).length };
  writeFileSync(join(out, 'qm-installer.json'), JSON.stringify(rec, null, 1) + '\n');
  console.log('QM_INSTALLER ' + JSON.stringify({ setup_exit: (rec.setup as { exit: number }).exit, doctor: rec.doctor, cell: rec.cell }));
  process.exit((rec.setup as { exit: number }).exit === 0 && !(rec.cell as { error: unknown }).error ? 0 : 1);
}
