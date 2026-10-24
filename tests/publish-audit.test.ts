import { describe, expect, test } from 'bun:test';
import { ALLOW, scanText, TOKEN_PATTERNS, type Hit } from '../scripts/publish-audit.ts';

const j = (...parts: string[]) => parts.join('');

describe('publish-audit: the scanner', () => {
  test('finds every token shape it is asked for and reports a redacted sample', () => {
    const hits: Hit[] = []; const counts: Record<string, number> = {};
    const text = [j('xox', 'b-', '1234567890-abcdefghij'), j('sk-', 'ant-', 'api03-', 'Z'.repeat(30)), j('gbrain', '_', '0123456789abcdef0123'), 'Authorization: Bearer ' + 'q'.repeat(40), j('gh', 'p_', 'A'.repeat(36)), j('AKIA', 'ABCDEFGHIJKLMNOP')].join(' ');
    scanText(text, 'unit', hits, counts);
    expect(Object.keys(TOKEN_PATTERNS).length).toBeGreaterThanOrEqual(8);
    expect(counts).toMatchObject({ slack_bot: 1, anthropic: 1, gbrain: 1, bearer: 1, github: 1, aws: 1 });
    expect(hits.every((h) => h.sample.length < 24 && !h.sample.includes('Z'.repeat(10)))).toBe(true);
  });
  test('allowlists trial tokens and the test suite placeholders, nothing else', () => {
    const hits: Hit[] = []; const counts: Record<string, number> = {};
    scanText('sk-trial-' + 'a'.repeat(32) + ' Bearer sk-trial-' + 'b'.repeat(32) + ' Bearer dummy-from-container Bearer container-dummy-value', 'unit', hits, counts);
    expect(hits).toEqual([]);
    expect(counts['allowlisted:openai_or_generic_sk']).toBe(2);
    expect(counts['allowlisted:bearer']).toBe(3);
    expect(ALLOW.some((a) => a.test('sk-' + 'ant-' + 'x'.repeat(30)))).toBe(false);
  });
});
