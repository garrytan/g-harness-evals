import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditPrompt, auditSet, parseAudit } from '../scripts/v03/audit.ts';
import type { FactsFile } from '../scripts/v03/types.ts';
import type { World } from '../world/types.ts';

// scripts/v03/audit.ts with a keyless fake auditor: prompt contents, answer parsing, the fail-closed path and the cache.

const repo = join(import.meta.dir, '..');
const world = JSON.parse(readFileSync(join(repo, 'world/seed/world.json'), 'utf8')) as World;
const facts = (JSON.parse(readFileSync(join(repo, 'tasks/multiuser/v0.3/dev-facts.json'), 'utf8')) as FactsFile).facts;
const tasks = join(repo, 'tasks/multiuser/v0.3/dev');

describe('v0.3 audit (fake auditor)', () => {
  test('the prompt carries the case, the passing replies, the asker and each record with its neighbours', () => {
    const p = auditPrompt(join(tasks, 'sy-02-marrow-agrisupply-sites'), world, facts);
    expect(p).toContain('## The case (task.toml)');
    expect(p).toContain('## A reply script that passes every predicate');
    expect(p).toContain('the asker can read it');
    expect(p).toContain('  >> hollis-mbeki');
    expect(p).toContain('Marrow Agri sent a screenshot');
  });

  test('answers parse only with known codes', () => {
    expect(parseAudit('x {"codes":[],"notes":"fine"} y')).toEqual({ codes: [], notes: 'fine' });
    expect(parseAudit('{"codes":["AMBIGUOUS_ASK","AMBIGUOUS_ASK"]}')!.codes).toEqual(['AMBIGUOUS_ASK']);
    expect(parseAudit('{"codes":["MADE_UP"]}')).toBeNull();
    expect(parseAudit('no json')).toBeNull();
  });

  test('a set audit flags what the auditor names, fails closed on two unparseable answers, and caches', async () => {
    const out = mkdtempSync(join(tmpdir(), 'v03-audit-'));
    let calls = 0;
    const transport = async (req: { prompt: string }) => {
      calls += 1;
      if (req.prompt.includes('id = "sc-01')) return 'not json';
      if (req.prompt.includes('id = "sy-03')) return '{"codes":["ANSWER_NOT_SUPPORTED"],"notes":"x"}';
      return '{"codes":[],"notes":"sound"}';
    };
    const r1 = await auditSet({ tasks, world, facts, out, leaseUsd: 1, runId: 'audit-test', transport });
    expect(r1.length).toBe(20);
    expect(r1.find((r) => r.id.startsWith('sc-01'))!.codes).toEqual(['AUDIT_UNPARSEABLE']);
    expect(r1.find((r) => r.id.startsWith('sy-03'))!.codes).toEqual(['ANSWER_NOT_SUPPORTED']);
    expect(r1.filter((r) => r.codes.length).length).toBe(2);
    expect(calls).toBe(21);
    await auditSet({ tasks, world, facts, out, leaseUsd: 1, runId: 'audit-test', transport });
    expect(calls).toBe(21);
  });
});
