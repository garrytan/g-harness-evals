import { describe, expect, test } from 'bun:test';
import { ALLOW, harnessOwned, scanText, TOKEN_PATTERNS, type Hit } from '../scripts/publish-audit.ts';

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
    scanText('sk-trial-' + 'a'.repeat(32) + ' Bearer sk-trial-' + 'b'.repeat(32) + ' trial-token:' + 'c'.repeat(32) + ' Bearer trial-token:' + 'd'.repeat(32) + ' Bearer dummy-from-container Bearer container-dummy-value', 'unit', hits, counts);
    expect(hits).toEqual([]);
    expect(counts['allowlisted:openai_or_generic_sk']).toBe(2);
    expect(counts['allowlisted:bearer']).toBe(3);
    expect(ALLOW.some((a) => a.test('sk-' + 'ant-' + 'x'.repeat(30)))).toBe(false);
  });
});

describe('publish-audit: the receipts check', () => {
  test('flags harness-owned files under a results tree and keeps the per-trial receipts the preregistrations name', () => {
    const t = 'docs/benchmarks/2026-10-25-gbrain-installer-hook/results/trials/oc-inst/si-01-quarrendon-seats/r1/';
    const kept = [t + 'logs/adapter.log', t + 'logs/turns/turn-0001.openclaw.json', t + 'state/hermes/SOUL.md', t + 'logs/gbrain-hook.openclaw.json', t + 'logs/gbrain-hook.hermes.log', t + 'events.jsonl', t + 'snapshot.json.gz', 'docs/benchmarks/2026-10-25-gbrain-installer-hook/results/ledger.sqlite'];
    const owned = [t + 'trial.json', t + 'state/openclaw/openclaw.json', t + 'workspace/AGENTS.md', t + 'gbrain/token', t + 'compose.serve.yaml', t + 'logs/stderr.log', t + 'logs/turns/turn-0002.openclaw.json', t + 'logs/gbrain-hook.hermes.json', 'docs/benchmarks/2026-10-25-gbrain-installer-hook/results/ledger.sqlite-wal'];
    expect(harnessOwned([...kept, ...owned])).toEqual(owned);
    // The receipts are exempt only at their own place in the trial layout: a look-alike under the harness's workspace is still harness-owned.
    const nested = [t + 'workspace/logs/gbrain-hook.hermes.log', t + 'workspace/state/hermes/SOUL.md', t + 'workspace/logs/gbrain-hook.openclaw.json', t + 'workspace/logs/turns/turn-0001.openclaw.json'];
    expect(harnessOwned(nested)).toEqual(nested);
  });

  test('keeps the instruction-route receipts at their own place in the trial layout only', () => {
    const t = 'docs/benchmarks/2026-10-31-anatomy-instruction-route/results/trials/openclaw-haiku-gbrain-route-hook-mu-v03-dev/cn-01-tamsin-cold-chain-site/r1/';
    const kept = [t + 'logs/instruction-route.json', t + 'logs/ready', t + 'logs/instruction-route.openclaw.json', t + 'logs/instruction-route.hermes.log'];
    const owned = [t + 'logs/ready.tmp', t + 'logs/instruction-route.hermes.json', t + 'logs/instruction-route.json.bak', t + 'workspace/logs/ready', t + 'workspace/logs/instruction-route.json', t + 'state/logs/instruction-route.openclaw.json'];
    expect(harnessOwned([...kept, ...owned])).toEqual(owned);
  });
});
