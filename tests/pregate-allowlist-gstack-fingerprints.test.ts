// The pregate allowlist entry for scripts/frontier-harbor/gstack-fingerprints.json: its session line (the session block of
// delivery-pin.json written as assignments) reads to gstack-redact as env.kv. The entry covers that one file and that exact
// value up to its closing quote, so a credential added to the line, or any other value, still fails.
import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const VALUE = 'GSTACK_SESSION_KIND=unattended GSTACK_EPHEMERAL=1 GSTACK_STATE_ROOT=/tmp/he-delivery/gstack-state';
const LINE = '  "session": "' + VALUE + '",';
const fakeKey = () => [['sk', 'ant', 'api03'].join('-'), randomBytes(48).toString('hex').slice(0, 93) + 'AA'].join('-');
const entries = () => (JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')).allowlist as Array<{ finding: string; paths?: string[]; pattern?: string }>)
  .filter((e) => e.paths?.includes('scripts/frontier-harbor/gstack-fingerprints.json'));

test('the gstack fingerprints entry is env.kv on that one file, matching only the whole session value', () => {
  const found = entries();
  expect(found).toEqual([expect.objectContaining({ finding: 'env.kv', paths: ['scripts/frontier-harbor/gstack-fingerprints.json'] })]);
  // gstack-pregate tests the pattern as ^(?:pattern)(?![\w-]) on the line from the finding's column, which gstack-redact
  // puts at the value, just inside its opening quote
  const re = new RegExp('^(?:' + found[0]!.pattern + ')(?![\\w-])');
  const at = (line: string) => line.slice(line.indexOf('GSTACK_SESSION_KIND'));
  expect(re.test(at(LINE))).toBe(true);
  expect(re.test(at(LINE.replace(VALUE, VALUE + ' API_KEY=' + fakeKey())))).toBe(false);
  expect(re.test(at(LINE.replace(VALUE, VALUE + fakeKey())))).toBe(false);
  expect(re.test(at(LINE.replace('/tmp/', '/var/')))).toBe(false);
  expect(re.test(at(LINE.replace('unattended', fakeKey())))).toBe(false);
});
