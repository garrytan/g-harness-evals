// Re-records golden.json from a checkout's proxy (keyless): bun tests/fixtures/proxy-install-slot/record.ts <checkout root> <out file>
// The committed golden.json came from origin/main at db705db2, before install slots: the usage log, the ledger and every answer
// for drive.ts's mix on a slot bound without install.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { snapshot } from '../metering-proxy-golden/drive.ts';
import { drive } from './drive.ts';

const [root, out] = process.argv.slice(2);
if (!root || !out) { console.error('usage: bun tests/fixtures/proxy-install-slot/record.ts <checkout root> <out file>'); process.exit(2); }
const { MeteringProxy } = await import(join(resolve(root), 'runner/proxy/metering-proxy.ts'));
const { BudgetRun, readLedger, closeLedgers } = await import(join(resolve(root), 'runner/ledger/budget-ledger.ts'));
const { usageLog, ledgerPath, answers } = await drive(MeteringProxy, BudgetRun, mkdtempSync(join(tmpdir(), 'install-golden-')));
const snap = { ...snapshot(readFileSync(usageLog, 'utf8'), readLedger(ledgerPath).entries), answers };
closeLedgers();
writeFileSync(out, JSON.stringify(snap, null, 1) + '\n');
console.log(`wrote ${out}: ${snap.usage.length} usage lines, ${snap.ledger.length} ledger entries, ${answers.length} answers`);
