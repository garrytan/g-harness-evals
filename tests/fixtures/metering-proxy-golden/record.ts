// Re-records golden.json from a checkout's proxy (keyless): bun tests/fixtures/metering-proxy-golden/record.ts <checkout root> <out file>
// The committed golden.json came from origin/harn18/h10-schema at 2f3839d7 (runner/ extracted with git archive), before H10 PR 5;
// re-recording it from origin/main at 3cf4fde1 (after internal-task's ablation proxy, #188) gives the same file. Re-recorded from origin/main
// at 205c1432 (after #293's usage-line schema v1 adds cache_write_tokens, cache_write_1h_tokens and reasoning_tokens to forwarded lines).
// Re-recorded by the change that marks a call whose usage is unknown: the lost-connection line gains usage_unknown and reported_usd; the ledger is unchanged.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { drive, snapshot } from './drive.ts';

const [root, out] = process.argv.slice(2);
if (!root || !out) { console.error('usage: bun tests/fixtures/metering-proxy-golden/record.ts <checkout root> <out file>'); process.exit(2); }
const { MeteringProxy } = await import(join(resolve(root), 'runner/proxy/metering-proxy.ts'));
const { BudgetRun, readLedger, closeLedgers } = await import(join(resolve(root), 'runner/ledger/budget-ledger.ts'));
const { usageLog, ledgerPath } = await drive(MeteringProxy, BudgetRun, mkdtempSync(join(tmpdir(), 'golden-')));
const snap = snapshot(readFileSync(usageLog, 'utf8'), readLedger(ledgerPath).entries);
closeLedgers();
writeFileSync(out, JSON.stringify(snap, null, 1) + '\n');
console.log(`wrote ${out}: ${snap.usage.length} usage lines, ${snap.ledger.length} ledger entries`);
