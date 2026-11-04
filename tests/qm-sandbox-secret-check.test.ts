// C4 gate 5 (internal-task): the probe parser and the clean rule of harnesses/qm/sandbox-secret-check.ts, keyless. The live check
// needs docker and the QM images; this covers the parts that decide pass or fail.
import { expect, test } from 'bun:test';
import { parseProbe, probe, probeClean } from '../harnesses/qm/sandbox-secret-check.ts';

const clean = ['G5_SCOPE scratch', 'G5_ENV_NAMES HOME PATH', 'G5_ENV_VALUE_HITS 0', 'G5_ENV_NAME_HITS 0', 'G5_PROC_ENVIRON readable=2 value_hits=0 name_hits=0',
  'G5_PROCS sh', 'G5_FILE_VALUE_HITS 0', 'G5_FILE_NAME_HITS 0', 'G5_MOUNTS /:overlay', 'G5_DOCKER_SOCK absent', 'G5_UID 0', 'G5_DONE'].join('\n');

test('the probe never carries the value whole, only its two halves', () => {
  const p = probe('scoped', 'abc123', 'def456');
  expect(p).not.toContain('abc123def456');
  expect(p).toContain("printf '%s%s' 'abc123' 'def456'");
});

test('a clean probe parses and passes', () => {
  const r = parseProbe(clean)!;
  expect(r).toMatchObject({ scope: 'scratch', env_names: ['HOME', 'PATH'], proc_environ: { readable: 2, value_hits: 0, name_hits: 0 }, docker_sock: 'absent', done: true });
  expect(probeClean(r)).toBe(true);
});

test('any hit, a docker socket, an unfinished probe or no readable environ fails', () => {
  for (const [from, to] of [['G5_ENV_VALUE_HITS 0', 'G5_ENV_VALUE_HITS 1'], ['G5_ENV_NAME_HITS 0', 'G5_ENV_NAME_HITS 1'], ['value_hits=0', 'value_hits=1'], ['name_hits=0', 'name_hits=1'],
    ['G5_FILE_VALUE_HITS 0', 'G5_FILE_VALUE_HITS 2'], ['G5_FILE_NAME_HITS 0', 'G5_FILE_NAME_HITS 1'], ['G5_DOCKER_SOCK absent', 'G5_DOCKER_SOCK present'], ['G5_DONE', ''], ['readable=2', 'readable=0'], ['G5_ENV_VALUE_HITS 0', 'G5_ENV_VALUE_HITS x']]) {
    expect(probeClean(parseProbe(clean.replace(from, to))!)).toBe(false);
  }
  expect(parseProbe('no probe here')).toBeNull();
});
