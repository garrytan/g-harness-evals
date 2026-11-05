/**
 * Writes identity.json from the code at HEAD. Run once, at origin/main,
 * before the price table moved to JSON: bun tests/fixtures/price-table/generate-identity.ts
 * See identity-cases.ts for why it is not rerun to make a failing test pass.
 */
import { writeFileSync } from 'node:fs';
import { buildCases, evaluate, snapshotExports } from './identity-cases.ts';

const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
const cases = buildCases().map(c => ({ ...c, expected: evaluate(c.model, c.request) }));
const fixture = { generated_from: head, exports: snapshotExports(), cases };
writeFileSync(new URL('./identity.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n');
console.log(`wrote ${cases.length} cases from ${head}`);
