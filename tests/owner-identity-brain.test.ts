// owner-identity (GST-3217): the bot-visible brain built with --owner names that world member as gbrain's owner
// (gbrain access member add, then gbrain access owner set) and records it in the manifest; without --owner the build runs
// no access command. The build runs against a gbrain stand-in that records its argv, under buildBrain's keyless allowlist
// environment (keylessEnv), never a login shell.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBrain, pageList, type BrainManifest } from '../gbrain/build-brain.ts';
import { world } from './world-helpers.ts';

const ROOT = resolve(import.meta.dir, '..');
const WORLD = join(ROOT, 'world', 'seed', 'world.json');
const tmp = mkdtempSync(join(tmpdir(), 'he-gbrain-owner-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeStandIn(dir: string, argvLog: string, reportOwner: 'set' | 'wrong'): string {
  const path = join(dir, 'gbrain-standin.ts');
  writeFileSync(path, `import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const keyish = Object.keys(process.env).filter((k) => /KEY|SECRET|TOKEN/.test(k));
appendFileSync(${JSON.stringify(argvLog)}, JSON.stringify({ argv, keyish }) + '\\n');
const count = (d) => existsSync(d) ? readdirSync(d).reduce((n, e) => { const p = join(d, e); return n + (statSync(p).isDirectory() ? count(p) : e.endsWith('.md') ? 1 : 0); }, 0) : 0;
const [a, b, c] = argv;
if (a === '--version') console.log('gbrain 0.60.747.0');
else if (a === 'import') console.log(JSON.stringify({ status: 'success', imported: count(argv[1]), errors: 0 }));
else if (a === 'access' && b === 'member') console.log(JSON.stringify({ member: { id: argv[3], status: 'enabled', groups: [] }, groups_created: [], bound: null }, null, 2));
else if (a === 'access' && b === 'owner' && c === 'set') console.log(JSON.stringify({ owner: argv[3], bound_credentials: [], reads_restricted: false }, null, 2));
else if (a === 'access' && b === 'owner') console.log(JSON.stringify({ owner: ${JSON.stringify(reportOwner)} === 'set' ? ${JSON.stringify('__OWNER__')} : 'someone-else', bound_credentials: [], reads_restricted: false }, null, 2));
`);
  return path;
}

const employee = world.members.find((m) => m.kind === 'employee' && m.split !== 'heldout')!;
const agent = world.members.find((m) => m.kind === 'agent')!;

function build(name: string, owner?: string, reportOwner: 'set' | 'wrong' = 'set'): { manifest: BrainManifest; calls: Array<{ argv: string[]; keyish: string[] }> } {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const argvLog = join(dir, 'argv.jsonl');
  const standIn = writeStandIn(dir, argvLog, reportOwner);
  writeFileSync(standIn, readFileSync(standIn, 'utf8').replace('__OWNER__', owner ?? ''));
  const corpus = join(dir, 'corpus');
  for (const p of pageList(world, 'dev')) {
    mkdirSync(join(corpus, 'dev', ...p.slug.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(corpus, 'dev', `${p.slug}.md`), `# ${p.slug}\n`);
  }
  const manifest = buildBrain({ split: 'dev', corpus, worldPath: WORLD, out: join(dir, 'brain'), staging: join(dir, 'staging'), gbrain: ['bun', standIn], commit: 'test', corpusCommit: 'test', corpusRepo: 'test', ...(owner ? { owner } : {}), log: () => undefined }) as BrainManifest;
  const calls = readFileSync(argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[]; keyish: string[] });
  return { manifest, calls };
}

describe('build-brain --owner (gbrain stand-in)', () => {
  test('adds the owner as a member with its name and email, names it the owner after the import, and records it', () => {
    const { manifest, calls } = build('owner', employee.id);
    const argvs = calls.map((c) => c.argv);
    const add = argvs.findIndex((a) => a[0] === 'access' && a[1] === 'member' && a[2] === 'add');
    const set = argvs.findIndex((a) => a[0] === 'access' && a[1] === 'owner' && a[2] === 'set');
    const imp = argvs.findIndex((a) => a[0] === 'import');
    expect(argvs[add]).toEqual(['access', 'member', 'add', employee.id, '--name', employee.name, '--email', employee.email, '--json']);
    expect(argvs[set]).toEqual(['access', 'owner', 'set', employee.id, '--json']);
    expect(imp).toBeLessThan(add);
    expect(add).toBeLessThan(set);
    expect(manifest.owner).toMatchObject({ member: employee.id, name: employee.name, email: employee.email, owner_view: { owner: employee.id } });
    expect(calls.flatMap((c) => c.keyish)).toEqual([]);
  });

  test('without --owner no access command runs and the manifest has no owner field', () => {
    const { manifest, calls } = build('plain');
    expect(calls.some((c) => c.argv[0] === 'access')).toBe(false);
    expect('owner' in manifest).toBe(false);
  });

  test('a gbrain that reports another owner stops the build', () => {
    expect(() => build('wrong', employee.id, 'wrong')).toThrow(/gbrain access owner reports owner "someone-else"/);
  });

  test('--owner must name an employee of the world, on the keyword bot-visible brain', () => {
    const o = { split: 'dev' as const, corpus: tmp, worldPath: WORLD, out: join(tmp, 'never'), staging: join(tmp, 'never-staging'), gbrain: ['false'], commit: 't', corpusCommit: 't', corpusRepo: 't', log: () => undefined };
    expect(() => buildBrain({ ...o, owner: 'no-such-member' })).toThrow(/names no employee member/);
    expect(() => buildBrain({ ...o, owner: agent.id })).toThrow(/names no employee member/);
    expect(() => buildBrain({ ...o, owner: employee.id, brain: 'member' })).toThrow(/keyword bot-visible brain only/);
    expect(() => buildBrain({ ...o, owner: employee.id, labels: 'readers' })).toThrow(/keyword bot-visible brain only/);
  });
});
