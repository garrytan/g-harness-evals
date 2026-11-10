import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');

describe('README harness rankings', () => {
  test('each ranked task set states the thinking or effort settings its rows ran at', () => {
    const start = readme.indexOf('## Harness rankings');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = readme.indexOf('\n## ', start + 1);
    const sections = readme.slice(start, end < 0 ? undefined : end).split('\n### ').slice(1);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const title = section.split('\n')[0];
      expect({ title, settings: /Settings[^\n]*(effort|thinking)/i.test(section) }).toEqual({ title, settings: true });
    }
  });
});
