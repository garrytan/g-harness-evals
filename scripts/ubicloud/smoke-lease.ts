// The default smoke lease for vm-shard.sh, derived from what the metering proxy reserves.
//
// The proxy reserves a call's worst case against the lease before forwarding: the prompt's input tokens plus the output
// cap (--max-output-tokens, 128000 by default) at the model's list price (runner/ledger/budget-ledger.ts, reservationUsd).
// A lease below one reservation refuses the smoke's first call, so the smoke fails before any model is reached
// (gbrain-memory-2026-10's first fan-out: a $0.50 lease against a $1.42 Sonnet reservation, six VMs, exit 4).
//
// Usage: bun scripts/ubicloud/smoke-lease.ts --prereg <prereg.json> --cells a,b [--max-output-tokens 128000]
// Prints one figure in dollars: twice the largest per-call reservation among the named harness cells at an input
// allowance of 50,000 tokens (one full reservation on top of what a one-trial smoke has already spent), rounded up to
// the next $0.50 and never under $1. Exit 2 when a cell's model has no list price; the proxy would refuse it too.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INPUT_ALLOWANCE_TOKENS = 50_000;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const preregPath = flag('--prereg');
const cellIds = flag('--cells')?.split(',').filter(Boolean) ?? [];
const maxOutputTokens = Number(flag('--max-output-tokens') ?? 128000);
if (!preregPath || cellIds.length === 0 || !Number.isFinite(maxOutputTokens) || maxOutputTokens < 0) {
  console.error('smoke-lease: usage: --prereg <prereg.json> --cells a,b [--max-output-tokens <n>]');
  process.exit(2);
}

// Resolved from the working directory so the pinned checkout's own price table answers, whatever commit this file came from.
// chatPrice and reservationUsd are the proxy's own lookup and formula (priceRequest in budget-ledger.ts), so a model the
// proxy prices (its overrides, the harness rows, a dated snapshot id) gets a figure here, and one it refuses is refused here.
// A request that writes the prompt cache reserves its input at the cache-write rate, a few percent more; the doubling covers it.
const ledger = await import(resolve(process.cwd(), 'runner/ledger/budget-ledger.ts')) as typeof import('../../runner/ledger/budget-ledger.ts');
const prereg = JSON.parse(readFileSync(preregPath, 'utf8')) as { cells: Array<{ id: string; model?: string; harness?: string; harness_mode?: string }> };
const cells = prereg.cells.filter(c => cellIds.includes(c.id) && c.harness !== 'scripted' && c.harness_mode !== 'scripted');

let worst = 0;
for (const cell of cells) {
  const model = cell.model ?? '';
  const price = model ? ledger.chatPrice(model) : undefined;
  if (!price) { console.error(`smoke-lease: no list price for ${cell.model ?? 'no model'} (cell ${cell.id}); the proxy would refuse its calls too`); process.exit(2); }
  const [provider, ...rest] = model.split(':');
  const reservation = ledger.reservationUsd({
    provider, model: rest.join(':'), kind: 'chat', input: price.input, output: price.output, cache_read: price.cache_read, cache_write: price.cache_write,
    inputTokens: INPUT_ALLOWANCE_TOKENS, maxOutputTokens, ...(price.long ? { long: price.long } : {}),
  });
  console.error(`smoke-lease: ${cell.id} ${cell.model}: one call reserves up to $${reservation.toFixed(2)} (${INPUT_ALLOWANCE_TOKENS} input tokens, ${maxOutputTokens} output tokens)`);
  worst = Math.max(worst, reservation);
}
const lease = Math.max(1, Math.ceil(worst * 2 / 0.5) * 0.5);
console.log(lease.toFixed(2));
