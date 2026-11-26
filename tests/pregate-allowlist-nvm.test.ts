// The pregate allowlist entry for the vendored nvm v0.40.2 (scripts/frontier-harbor/vendor/nvm-v0.40.2/nvm.sh): line 568
// of nvm's .nvmrc parser trims a key with nvm_echo and a sed expression, which gstack-redact reports as env.kv. The entry
// covers that one file and that exact value ending its line, so a credential added after it, or any other value, still fails.
import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const LINE = "      key=$(nvm_echo \"${key}\" | command sed 's/^[[:space:]]*//;s/[[:space:]]*$//')";
const fakeKey = () => [['sk', 'ant', 'api03'].join('-'), randomBytes(48).toString('hex').slice(0, 93) + 'AA'].join('-');
const entries = () => (JSON.parse(readFileSync(join(ROOT, '.gstack', 'pregate.json'), 'utf8')).allowlist as Array<{ finding: string; paths?: string[]; pattern?: string }>)
  .filter((e) => e.paths?.some((p) => p.includes('/vendor/nvm-')));

test('the nvm entry is env.kv on the one vendored nvm.sh, matching only its whole trim value at the end of the line', () => {
  const found = entries();
  expect(found).toEqual([expect.objectContaining({ finding: 'env.kv', paths: ['scripts/frontier-harbor/vendor/nvm-v0.40.2/nvm.sh'] })]);
  // gstack-pregate tests the pattern as ^(?:pattern)(?![\w-]) on the line from the finding's column, which gstack-redact
  // puts at the value
  const re = new RegExp('^(?:' + found[0]!.pattern + ')(?![\\w-])');
  const at = (line: string) => line.slice(line.indexOf('key=') + 4);
  expect(re.test(at(LINE))).toBe(true);
  expect(re.test(at(LINE + '\r'))).toBe(true);
  expect(re.test(at(LINE + ' # ' + fakeKey()))).toBe(false);
  expect(re.test(at(LINE + '; API_KEY=' + fakeKey()))).toBe(false);
  expect(re.test(at(LINE.replace("s/^[[:space:]]*//", 's/^ *//')))).toBe(false);
  expect(re.test(at('      key=' + fakeKey()))).toBe(false);
});
