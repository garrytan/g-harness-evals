#!/usr/bin/env bun
// The canary's monthly ledger lease: one budget ledger per month (canary-YYYY-MM, capped at the preregistered $1,000) that
// every per-tier lease is reserved from before a suite spends, and settled to the trials' metered usage afterwards. It uses
// runner/ledger/budget-ledger.ts; the ledger file travels on the canary-receipts branch (scripts/canary/receipts.sh).
//
//   bun scripts/canary/lease.ts status  --ledger <file>                                  {month, cap_usd, committed_usd, remaining_usd}
//   bun scripts/canary/lease.ts open    --ledger <file> --month YYYY-MM --cap-usd <n> --run-id <id>   prints the ledger run id
//   bun scripts/canary/lease.ts reserve --ledger <file> --budget-run <id> --usd <n> --what <text> [--keep-usd <n>]
//                                                          prints the reservation id; exit 20 when it does not fit
//   bun scripts/canary/lease.ts settle  --ledger <file> --budget-run <id> --entry <id> [--trials <trials.jsonl>]
//                                                          settles to the sum of usage.usd (no trials file: the reservation)
//   bun scripts/canary/lease.ts close   --ledger <file> --budget-run <id>
//
// --keep-usd holds back the month's T1 reserve: T2, T3 and bisect reserve only what leaves it untouched, so a used-up month
// still runs T0 and T1.
import { existsSync, readFileSync } from 'node:fs';
import { BudgetExceededError, BudgetRun, closeLedgers, closeRun, initLedger, ledgerStatus } from '../../runner/ledger/budget-ledger.ts';

export function remaining(ledger: string): { cap_usd: number; committed_usd: number; remaining_usd: number } {
  const s = ledgerStatus({ ledgerPath: ledger });
  const cap = s.totals.program_cap_usd ?? 0;
  return { cap_usd: cap, committed_usd: s.totals.committed_usd, remaining_usd: Math.max(0, cap - s.totals.committed_usd) };
}

export function usageUsd(path: string): number {
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return 0; }
  let usd = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { usd += (JSON.parse(line) as { usage?: { usd?: number } | null }).usage?.usd ?? 0; } catch { /* torn line */ }
  }
  return usd;
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const need = (n: string) => flag(n) ?? (() => { throw new Error(`${cmd}: ${n} is required`); })();
  const print = (v: unknown) => console.log(typeof v === 'string' ? v : JSON.stringify(v));
  try {
    const ledger = need('--ledger');
    if (cmd === 'status') print(remaining(ledger));
    else if (cmd === 'open') {
      const cap = Number(need('--cap-usd'));
      if (!existsSync(ledger)) initLedger({ ledgerPath: ledger, programCapUsd: cap, reason: `canary monthly lease canary-${need('--month')}` });
      const left = remaining(ledger).remaining_usd;
      if (left <= 0) { print('none'); process.exitCode = 20; }
      else print(BudgetRun.open({ runner: `canary-${need('--month')}:${need('--run-id')}`, budgetUsd: left, ledgerPath: ledger, programCapUsd: cap }).runId);
    } else if (cmd === 'reserve') {
      const usd = Number(need('--usd')), keep = Number(flag('--keep-usd') ?? 0);
      const left = remaining(ledger).remaining_usd;
      if (usd + keep > left + 1e-9) { console.error(`lease: $${usd.toFixed(2)} for ${need('--what')} does not fit: $${left.toFixed(2)} left, $${keep.toFixed(2)} held back for T1`); process.exitCode = 20; }
      else print(BudgetRun.join({ runId: need('--budget-run'), ledgerPath: ledger }).reserve(usd, need('--what')));
    } else if (cmd === 'settle') {
      const run = BudgetRun.join({ runId: need('--budget-run'), ledgerPath: ledger });
      const trials = flag('--trials');
      run.settle(need('--entry'), trials && existsSync(trials) ? { usd: usageUsd(trials) } : null);
      print(remaining(ledger));
    } else if (cmd === 'close') { closeRun(ledger, need('--budget-run')); print(remaining(ledger)); }
    else { console.error('usage: lease.ts status|open|reserve|settle|close --ledger <file> ...'); process.exitCode = 2; }
  } catch (error) {
    console.error('lease: ' + (error as Error).message);
    process.exitCode = error instanceof BudgetExceededError ? 20 : 1;
  } finally {
    closeLedgers();
  }
}
