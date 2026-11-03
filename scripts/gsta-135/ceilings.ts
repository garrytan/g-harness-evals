#!/usr/bin/env bun
/**
 * Skill-use panel per-cell cost ceilings (plan decision 4 as amended by findings
 * eng-outside-5 and ceo-native-5), derived from free inputs and written with
 * their arithmetic:
 *
 *   bun scripts/gsta-135/ceilings.ts [--run-dir results/gsta-135/runs/gsta-135-discovery-2026-10]
 *                                    [--gstack-dir ~/.capy/work/he/gsta135/gstack] [--preflight-dir results/gsta-135/preflight]
 *                                    [--out results/gsta-135/preflight/ceilings.md] [--json results/gsta-135/preflight/ceilings.json]
 *                                    [--panel-cap-usd 20] [--per-trial-usd 1.00] [--max-tokens 128000]
 *
 * Inputs: the discovery run's cells.jsonl (settled cost per trial) and
 * proxy-usage.ndjson (input, output and cache-read tokens per forwarded
 * request; the proxy's usage line carries no cache-write count, so the written
 * tokens are inferred from the gap between the settled cost and the three
 * logged categories at the proxy's rates); the Opus rates from the gstack
 * checkout's lib/pricing.ts and from the proxy's own table
 * (runner/ledger/budget-ledger.ts CHAT_PRICE_OVERRIDES), compared; the
 * prompt-dump sizes from every preflight receipt that has requests.ndjson
 * (bytes measured; tokens estimated at the proxy's 3 bytes per token and
 * labelled unvalidated, because the fake endpoint's usage is fabricated and
 * never a token measurement); the task fixtures' changed-line counts from
 * make-task.sh. The median ceiling per cell is the discovery gstack-arm cost
 * (both panel arms register gstack) plus one skill read and one helper run at
 * the measured input growth. The JSON is what discovery.sh copies into the
 * panel manifest; the Markdown is the receipt.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHAT_PRICE_OVERRIDES } from '../../runner/ledger/budget-ledger.ts';
import { PANEL_HARNESSES, PANEL_MODEL, PANEL_TASKS, PLACEHOLDER_CEILINGS, PROXY_BYTES_PER_TOKEN, panelOrder, rMax, leaseUsd } from './lease.ts';
import { wilson } from './report.ts';

const ROOT = resolve(import.meta.dir, '../..');
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const runDir = resolve(ROOT, arg('--run-dir', 'results/gsta-135/runs/gsta-135-discovery-2026-10'));
const gstackDir = resolve(arg('--gstack-dir', join(homedir(), '.capy/work/he/gsta135/gstack')));
const preflightDir = resolve(ROOT, arg('--preflight-dir', 'results/gsta-135/preflight'));
const outMd = resolve(ROOT, arg('--out', 'results/gsta-135/preflight/ceilings.md'));
const outJson = resolve(ROOT, arg('--json', 'results/gsta-135/preflight/ceilings.json'));
const panelCap = Number(arg('--panel-cap-usd', '20'));
const perTrial = Number(arg('--per-trial-usd', '1'));
const maxTokens = Number(arg('--max-tokens', '128000'));

// report.ts keeps its median private, so the one line stays here; wilson is report.ts's, the interval printed beside every count.
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const usd = (n: number) => '$' + n.toFixed(4);
const pct = (x: number) => (100 * x).toFixed(1) + '%';

if (import.meta.main) {
  const problems: string[] = [];
  // 1. Rates from both tables.
  const proxyRow = CHAT_PRICE_OVERRIDES[`anthropic:${PANEL_MODEL}`];
  let gstackRow: { input: number; output: number; cached: number | null } | null = null;
  const pricingPath = join(gstackDir, 'lib/pricing.ts');
  if (existsSync(pricingPath)) {
    const m = readFileSync(pricingPath, 'utf8').match(new RegExp(`'${PANEL_MODEL}':\\s*\\{\\s*input_per_mtok:\\s*([\\d.]+),\\s*output_per_mtok:\\s*([\\d.]+)(?:,\\s*cached_input_per_mtok:\\s*([\\d.]+))?`));
    if (m) gstackRow = { input: Number(m[1]), output: Number(m[2]), cached: m[3] ? Number(m[3]) : null };
    else problems.push(`no ${PANEL_MODEL} row found in ${pricingPath}`);
  } else problems.push(`gstack checkout not found at ${gstackDir}; its lib/pricing.ts rates are not compared`);
  const ratesAgree = gstackRow !== null && gstackRow.input === proxyRow.input && gstackRow.output === proxyRow.output && gstackRow.cached === proxyRow.cache_read;

  // 2. The discovery run: per-trial settled cost and per-request tokens.
  interface Cell { trial_id: string; harness: string; task: number; arm: string; termination: string; usd_spent: number; requests_forwarded: number | null }
  interface Line { at: string; key: string; outcome: string; input_tokens?: number; output_tokens?: number; cached_tokens?: number | null; actual_usd?: number; reserved_usd?: number }
  const cellsPath = join(runDir, 'cells.jsonl'), usagePath = join(runDir, 'proxy-usage.ndjson');
  const measured = existsSync(cellsPath) && existsSync(usagePath);
  const cells: Cell[] = measured ? readFileSync(cellsPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const lines: Line[] = measured ? readFileSync(usagePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  if (!measured) problems.push(`discovery run not found at ${runDir} (results/ is not committed); the ceilings below are internal-task's placeholders, not measured`);
  const forwarded = (trial: string) => lines.filter(l => l.key === `trial-token:${trial}` && l.outcome === 'forwarded' && (l.input_tokens ?? 0) > 0).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const repriced = (ls: Line[], rates: { input: number; output: number; cached: number | null }) =>
    ls.reduce((n, l) => n + (((l.input_tokens ?? 0) - (l.cached_tokens ?? 0)) * rates.input + (l.cached_tokens ?? 0) * (rates.cached ?? rates.input) + (l.output_tokens ?? 0) * rates.output) / 1e6, 0);
  const trialRows = cells.filter(c => c.termination === 'completed').map(c => {
    const ls = forwarded(c.trial_id);
    const atProxy = repriced(ls, { input: proxyRow.input, output: proxyRow.output, cached: proxyRow.cache_read ?? null });
    const settled = ls.reduce((n, l) => n + (l.actual_usd ?? 0), 0);
    const writtenTokens = proxyRow.cache_write ? (settled - atProxy) / ((proxyRow.cache_write - proxyRow.input) / 1e6) : NaN;
    // Hermes also sends short side requests (a few hundred tokens) between its turns; the context and its steps are read from the conversation's own requests.
    const inputs = ls.map(l => l.input_tokens ?? 0).filter(v => v >= 1000);
    const growth = inputs.map((v, i) => (i ? v - inputs[i - 1] : 0));
    return { ...c, requests: ls.length, settled, at_proxy_logged: atProxy, at_gstack: gstackRow ? repriced(ls, gstackRow) : NaN, written_tokens: writtenTokens,
      last_input: Math.max(0, ...inputs), max_growth: Math.max(0, ...growth), outputs: ls.map(l => l.output_tokens ?? 0), max_reserved: Math.max(0, ...ls.map(l => l.reserved_usd ?? 0)) };
  });
  const cost = (h: string, t: number, arm: string) => trialRows.find(r => r.harness === h && r.task === t && r.arm === arm);
  const skillTrial = cost('openclaw', 1, 'gstack');
  const deltaSkill = skillTrial ? skillTrial.max_growth : 22_056;
  const outMed = trialRows.length ? median(trialRows.flatMap(r => r.outputs)) : 130;
  // One helper run: gstack-skill-start's STATUS block, measured keyless in the gstack checkout at the pin (GSTACK_SESSION_KIND=spawned,
  // a scratch state root, no key in the environment) and kept as the receipt helper-output.txt beside the preflight receipts;
  // without the checkout the receipt's size is used, and without either the value measured once on 2026-10-28 with that command.
  const helperCommand = 'GSTACK_SESSION_KIND=spawned GSTACK_EPHEMERAL=1 GSTACK_STATE_ROOT=<scratch> bin/gstack-skill-start --skill review --model claude';
  const helperReceipt = join(preflightDir, 'helper-output.txt');
  let helperBytes = 1538, helperSource = `measured once on 2026-10-28 at bd8907d6 with ${helperCommand}; neither the gstack checkout nor ${helperReceipt} was available to re-measure`;
  if (existsSync(join(gstackDir, 'bin/gstack-skill-start'))) {
    const scratch = mkdtempSync(join(tmpdir(), 'gsta135-helper-'));
    try {
      const run = spawnSync(join(gstackDir, 'bin/gstack-skill-start'), ['--skill', 'review', '--model', 'claude'], { cwd: gstackDir, encoding: 'utf8', timeout: 60_000, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GSTACK_SESSION_KIND: 'spawned', GSTACK_EPHEMERAL: '1', GSTACK_STATE_ROOT: scratch } });
      if (run.status === 0 && run.stdout.includes('SKILL_START_PROTO')) {
        helperBytes = Buffer.byteLength(run.stdout); helperSource = `measured now in ${gstackDir} with ${helperCommand}; receipt ${helperReceipt}; the count moves by a few bytes between runs with the scratch path and session id in the STATUS lines`;
        mkdirSync(preflightDir, { recursive: true }); writeFileSync(helperReceipt, run.stdout);
      } else problems.push(`gstack-skill-start in ${gstackDir} did not produce its STATUS block (exit ${run.status}); the helper run size falls back`);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  } else if (existsSync(helperReceipt)) { helperBytes = Buffer.byteLength(readFileSync(helperReceipt, 'utf8')); helperSource = `the receipt ${helperReceipt} (${helperCommand}, measured earlier)`; }
  else problems.push(`helper run size not re-measured: ${helperSource}`);
  const deltaHelper = Math.ceil(helperBytes / PROXY_BYTES_PER_TOKEN);
  const cw = proxyRow.cache_write ?? proxyRow.input, cr = proxyRow.cache_read ?? proxyRow.input;
  const extraTurn = (grown: number, context: number) => (grown * cw + context * cr + outMed * proxyRow.output) / 1e6;

  const placeholders: Record<number, number> = { 1: PLACEHOLDER_CEILINGS.task1, 2: PLACEHOLDER_CEILINGS.task2, 3: PLACEHOLDER_CEILINGS.task3 };
  const perHarness: Record<string, Record<string, { base_usd: number; none_usd: number | null; skill_read_usd: number; helper_run_usd: number; ceiling_usd: number; source: string }>> = {};
  for (const task of PANEL_TASKS) {
    perHarness[`task${task}`] = {};
    for (const h of PANEL_HARNESSES) {
      const g = cost(h, task, 'gstack'), n = cost(h, task, 'none');
      if (!g) { perHarness[`task${task}`][h] = { base_usd: placeholders[task], none_usd: null, skill_read_usd: 0, helper_run_usd: 0, ceiling_usd: placeholders[task], source: 'placeholder (internal-task)' }; continue; }
      const skill = task === 3 ? 0 : extraTurn(deltaSkill, g.last_input);
      const helper = task === 3 ? 0 : extraTurn(deltaHelper, g.last_input + deltaSkill);
      perHarness[`task${task}`][h] = { base_usd: g.settled, none_usd: n?.settled ?? null, skill_read_usd: skill, helper_run_usd: helper, ceiling_usd: g.settled + skill + helper, source: `discovery ${g.trial_id}` };
    }
  }
  const ceilings = Object.fromEntries(PANEL_TASKS.map(t => [`task${t}`, Math.max(...PANEL_HARNESSES.map(h => perHarness[`task${t}`][h].ceiling_usd))]));

  // 3. Prompt dumps from the preflight receipts (bytes measured, tokens estimated).
  const dumps: Array<{ probe: string; requests: number; first_body_bytes: number; est_tokens_at_3_bytes: number; max_tokens: number | null; cache_control: boolean }> = [];
  if (existsSync(preflightDir)) {
    for (const d of readdirSync(preflightDir).sort()) {
      const p = join(preflightDir, d, 'requests.ndjson');
      if (!existsSync(p)) continue;
      const reqs = readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      const first = reqs.find(r => r.body && typeof r.body === 'object' && r.body.model) ?? reqs[0];
      const body = JSON.stringify(first?.body ?? {});
      dumps.push({ probe: d, requests: reqs.length, first_body_bytes: Buffer.byteLength(body), est_tokens_at_3_bytes: Math.ceil(Buffer.byteLength(body) / 3), max_tokens: first?.body?.max_tokens ?? null, cache_control: body.includes('"cache_control"') });
    }
  }

  // 4. Fixture sizes from make-task.sh, generated into a scratch directory.
  const scratch = mkdtempSync(join(tmpdir(), 'gsta135-ceilings-'));
  const fixtures: Array<{ task: number; changed_lines: string; instruction: string }> = [];
  try {
    for (const t of PANEL_TASKS) {
      const dir = join(scratch, `t${t}`);
      const mk = spawnSync('bash', [join(ROOT, 'scripts/gsta-135/make-task.sh'), String(t), dir], { encoding: 'utf8' });
      if (mk.status !== 0) { problems.push(`make-task.sh ${t} failed: ${mk.stderr}`); continue; }
      const ws = join(dir, 'workspace');
      let changed = 'no workspace (control)';
      if (existsSync(ws)) {
        const diff = t === 1 ? spawnSync('git', ['-C', ws, 'diff', '--numstat'], { encoding: 'utf8' }).stdout : spawnSync('git', ['-C', ws, 'show', '--numstat', '--format=', 'HEAD'], { encoding: 'utf8' }).stdout;
        changed = diff.trim().split('\n').filter(Boolean).map(l => { const [a, d, f] = l.split('\t'); return `${f}: +${a} -${d}`; }).join(', ') || 'none';
      }
      fixtures.push({ task: t, changed_lines: changed, instruction: readFileSync(join(dir, 'instruction.md'), 'utf8').trim() });
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }

  // 5. The panel: order, lease, expected spend, the cap.
  const order = panelOrder(5);
  const r = rMax({ model: PANEL_MODEL, maxTokens });
  const lease = leaseUsd(perTrial, r.r_max_usd);
  const baseOf = (h: string, t: number) => perHarness[`task${t}`][h].base_usd;
  const ceilOf = (h: string, t: number) => perHarness[`task${t}`][h].ceiling_usd;
  const atBase = order.reduce((n, o) => n + baseOf(o.harness, o.task), 0);
  const atCeiling = order.reduce((n, o) => n + ceilOf(o.harness, o.task), 0);
  // What a hard cap admits, in the manifest order, when every admitted trial settles at the given per-cell cost: the rule is
  // settled + lease <= cap before each lease, so the last trial is admitted only while settled <= cap - lease.
  const admits = (cap: number, costOf: (h: string, t: number) => number) => { let settled = 0, n = 0; for (const o of order) { if (settled + lease > cap + 1e-9) break; settled += costOf(o.harness, o.task); n++; } return { admitted: n, settled_usd: settled }; };
  const capForAll = (costOf: (h: string, t: number) => number) => order.slice(0, -1).reduce((n, o) => n + costOf(o.harness, o.task), 0) + lease;
  const capAdmits = Object.fromEntries([panelCap, 15, 20].filter((c, i, a) => a.indexOf(c) === i).map(c => [c.toFixed(2), { at_ceilings: admits(c, ceilOf), at_discovery_costs: admits(c, baseOf) }]));
  const capForAll60 = { at_ceilings: capForAll(ceilOf), at_discovery_costs: capForAll(baseOf) };
  const softWorstCase = panelCap - perTrial + lease;
  const maxObservedReservation = Math.max(0, ...trialRows.map(t => t.max_reserved));
  const w = { k0: wilson(0, 5), k3: wilson(3, 5), k5: wilson(5, 5) };
  const w10 = { k1: wilson(1, 10), k6: wilson(6, 10), k8: wilson(8, 10) };
  const separated = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) => (a.lo > b.hi || b.lo > a.hi ? 'separates' : 'overlaps');
  const iv = (x: { lo: number; hi: number }) => `[${pct(x.lo)}, ${pct(x.hi)}]`;

  const md: string[] = [];
  md.push('# internal-task panel cost ceilings (derived ' + new Date().toISOString().slice(0, 10) + ')', '');
  md.push('Written by scripts/gsta-135/ceilings.ts. Every number below is read from the files named; nothing is paid for.', '');
  if (problems.length) md.push('Limits of this derivation:', ...problems.map(p => '- ' + p), '');
  md.push('## Rates', '');
  md.push(`- Proxy table (runner/ledger/budget-ledger.ts CHAT_PRICE_OVERRIDES, anthropic:${PANEL_MODEL}): input $${proxyRow.input}, output $${proxyRow.output}, cache read $${proxyRow.cache_read}, cache write $${proxyRow.cache_write} per Mtok. The settled cost of every trial used these.`);
  md.push(gstackRow ? `- gstack table (${pricingPath}): input $${gstackRow.input}, output $${gstackRow.output}, cached input $${gstackRow.cached ?? 'n/a'} per Mtok; the table states that it excludes prompt-cache writes.` : '- gstack table: not read (see the limits above).');
  md.push(ratesAgree ? '- The two tables agree on the three categories gstack prices (input, output, cache read). They differ on cache writes: the proxy charges them at $' + proxyRow.cache_write + ' per Mtok, gstack prices them at the input rate, so a gstack estimate of a turn that writes the cache is low by $' + ((proxyRow.cache_write ?? 0) - proxyRow.input) + ' per Mtok written. The ceilings below use the proxy rates, the ones the panel settles at.' : '- The tables differ on at least one of input, output or cache read; see the two rows above. The ceilings below use the proxy rates.');
  md.push('');
  md.push('## Discovery run, per trial (' + runDir.replace(ROOT + '/', '') + ')', '');
  md.push('Settled is the proxy\'s actual_usd; "logged categories" prices the input, cache-read and output tokens the usage line carries at the proxy rates; the gap is the cache-write premium, from which the written tokens are inferred (the usage line carries no write count). Reserved is the largest single reservation the proxy took in the trial at max_tokens 128,000.', '');
  md.push('| trial | requests | settled | logged categories (proxy rates) | same at gstack rates | inferred cache-write tokens | largest input (tokens) | largest input step | largest reservation |', '|---|---|---|---|---|---|---|---|---|');
  for (const t of trialRows) md.push(`| ${t.trial_id} | ${t.requests} | ${usd(t.settled)} | ${usd(t.at_proxy_logged)} | ${Number.isNaN(t.at_gstack) ? 'n/a' : usd(t.at_gstack)} | ${Math.round(t.written_tokens).toLocaleString('en-US')} | ${t.last_input.toLocaleString('en-US')} | ${t.max_growth.toLocaleString('en-US')} | ${usd(t.max_reserved)} |`);
  md.push('');
  md.push('## Ceiling arithmetic per cell', '');
  md.push(`Both panel arms register gstack, so the discovery gstack-arm trial is the measured analog of a baseline-arm trial (the no-gstack cost is listed for scale). The candidate's extra work is one skill read and one helper run, each one more turn over a cached context: new tokens at the cache-write rate ($${cw}), the prior context at the cache-read rate ($${cr}), and a median output of ${outMed} tokens at $${proxyRow.output}. The skill read grows the prompt by ${deltaSkill.toLocaleString('en-US')} tokens (the largest input step in ${skillTrial?.trial_id ?? 'the placeholder'}, the one discovery trial that read the router and gstack-review/SKILL.md; steps are between consecutive requests of at least 1,000 input tokens, so Hermes's short side requests do not count as steps). The helper run grows it by ${deltaHelper} tokens (gstack-skill-start's STATUS block, ${helperBytes} bytes, ${helperSource}, at the proxy's ${PROXY_BYTES_PER_TOKEN} bytes per token). Task 3 is the control: its ceiling is the measured control cost with no extras, because a skill read there is what the bar counts against. The per-task ceiling for the manifest is the larger of the two harnesses.`, '');
  md.push('| cell | source | no-gstack cost | base (gstack arm) | + skill read | + helper run | median ceiling |', '|---|---|---|---|---|---|---|');
  for (const task of PANEL_TASKS) for (const h of PANEL_HARNESSES) { const c = perHarness[`task${task}`][h]; md.push(`| task ${task} ${h} | ${c.source} | ${c.none_usd === null ? 'n/a' : usd(c.none_usd)} | ${usd(c.base_usd)} | ${usd(c.skill_read_usd)} | ${usd(c.helper_run_usd)} | ${usd(c.ceiling_usd)} |`); }
  md.push('', `Manifest ceilings: task1 ${usd(ceilings.task1)}, task2 ${usd(ceilings.task2)}, task3 ${usd(ceilings.task3)} (internal-task's placeholders were ${usd(PLACEHOLDER_CEILINGS.task1)}, ${usd(PLACEHOLDER_CEILINGS.task2)}, ${usd(PLACEHOLDER_CEILINGS.task3)}).`, '');
  md.push('Hermes caveat (finding ceo-native-7): the Hermes rows come from one-shot discovery trials; the panel runs Hermes in chat mode, whose system prompt is larger and which re-enables skill_manage and delegation. The prompt-dump table below is the free measurement of that prompt where Lane A\'s preflight has produced one; the Hermes ceilings should be re-derived from a chat-mode receipt before the bars are applied to Hermes.', '');
  md.push('## Prompt dumps (preflight receipts with requests.ndjson)', '');
  md.push('Bytes are measured from the recorded body. Tokens are an estimate at the proxy\'s 3 bytes per token and are unvalidated: the fake endpoint reports input_tokens 1 whatever the body, so no free turn measures tokens (finding eng-outside-4). The paid discovery turns above are the only measured token counts.', '');
  if (dumps.length) { md.push('| probe | requests | first body bytes | est. tokens (3 B/tok, unvalidated) | max_tokens stated | cache_control |', '|---|---|---|---|---|---|'); for (const d of dumps) md.push(`| ${d.probe} | ${d.requests} | ${d.first_body_bytes.toLocaleString('en-US')} | ${d.est_tokens_at_3_bytes.toLocaleString('en-US')} | ${d.max_tokens ?? 'none'} | ${d.cache_control} |`); }
  else md.push('No preflight receipt with requests.ndjson under ' + preflightDir + '.');
  md.push('', '## Task fixtures (scripts/gsta-135/make-task.sh)', '');
  for (const f of fixtures) md.push(`- task ${f.task}: "${f.instruction}"; changed lines: ${f.changed_lines}`);
  md.push('', '## Lease and panel cap', '');
  md.push(`- max_tokens pin ${maxTokens.toLocaleString('en-US')} for both harnesses (what both sent in the discovery probe). R_max = ${usd(r.r_max_usd)}: the proxy's own reservation for a request at the input bound (${r.inputs.context_tokens.toLocaleString('en-US')} context tokens x ${r.inputs.bytes_per_token} bytes = ${r.inputs.body_bytes.toLocaleString('en-US')} body bytes, bounded to ${r.inputs.bounded_input_tokens.toLocaleString('en-US')} input tokens at $${r.inputs.input_rate_per_mtok} with the cache-write premium = ${usd(r.inputs.input_usd)}, plus ${maxTokens.toLocaleString('en-US')} output tokens at $${r.inputs.output_rate_per_mtok} = ${usd(r.inputs.output_usd)}). The largest reservation the discovery run took was ${usd(maxObservedReservation)}.`);
  md.push(`- Lease per trial = ${perTrial.toFixed(2)} + R_max = ${usd(lease)}. The proxy admits a request while settled plus the new reservation fits the lease, so a trial is refused only once its settled spend passes $${perTrial.toFixed(2)} (termination ceiling:lease after a forwarded request; infra:reservation_refused if the first request does not fit). That holds for serial requests only (k = 1): the ledger's reserve() checks settled plus every open reservation plus the new one against the lease, so two concurrent requests near R_max refuse each other with settled near zero (chat-mode Hermes exposes delegate_task, which can fan out). Such a 402 is read from the ledger's created_at/settled_at overlap and classified infra:reservation_refused, not ceiling:lease; a reservation the proxy charged in full for an upstream failure (a 5xx with no usage that is not the provider's own not-billed error, such as a gateway's 529 page) is usd_charged_reservation on the row, outside the $1.00 bar and inside the cap, and a 402 after it is infra:upstream. A provider's own 5xx error (an Anthropic 529 overloaded_error) settles at $0, and a trial that did not complete after one is infra:upstream too.`);
  md.push(`- Expected spend for 60 trials: ${usd(atBase)} at the discovery costs, ${usd(atCeiling)} at the ceilings above. Panel cap: $${panelCap.toFixed(2)} (the Captain raised it from $15.00 to $20.00 on 2026-10-28 on internal-task's arithmetic below, the per-trial bar unchanged at $1.00 and max_tokens unchanged; the extra $5.00 comes out of the lane budget), enforced by discovery.sh before every lease (settled + reserved-unknown + ${usd(lease)} must fit, else the remaining rows are not_run:panel_cap). The enforced worst case is therefore the cap, $${panelCap.toFixed(2)}, not 60 x $1.00: no lease opens that could take the total past it, and no trial can settle more than its lease. The old "$60 worst case" assumed 60 trials each stopping at exactly $1.00, which the per-trial lease does not promise (a trial can settle up to ${usd(lease)}) and the cap does.`);
  md.push('', '## What the cap admits', '');
  md.push(`The hard rule admits a lease only while settled + open reservations + ${usd(lease)} fits the cap, so the last trial is admitted only while settled is at most cap minus ${usd(lease)} (${usd(panelCap - lease)} at $${panelCap.toFixed(2)}). In the manifest order, with every admitted trial settling at its cell's figure: ${Object.entries(capAdmits).map(([c, a]) => `a $${c} hard cap admits ${a.at_ceilings.admitted} of 60 trials at the ceilings above (${usd(a.at_ceilings.settled_usd)} settled when it stops) and ${a.at_discovery_costs.admitted} of 60 at the discovery costs (${usd(a.at_discovery_costs.settled_usd)})`).join('; ')}. Admitting all 60 needs a cap of ${usd(capForAll60.at_ceilings)} at the ceilings and ${usd(capForAll60.at_discovery_costs)} at the discovery costs (the first 59 settled plus one whole lease). The alternative soft rule, settled + open reservations + ${perTrial.toFixed(2)} <= cap, admits a lease while settled is at most cap minus $${perTrial.toFixed(2)}, so its hard worst case is cap - ${perTrial.toFixed(2)} + ${usd(lease)} = cap + R_max = ${usd(softWorstCase)} at $${panelCap.toFixed(2)}, while the realistic overshoot is one request past $${perTrial.toFixed(2)} (the lease refuses the next one). The default --panel-cap-usd is $20.00 (the Captain's 2026-10-28 decision, above); the manifest carries these figures as cap_admits and cap_for_all_60.`);
  md.push('', '## What n=5 per cell can show', '');
  md.push(`Wilson 95% intervals at n=5: 0/5 is ${iv(w.k0)}, 3/5 is ${iv(w.k3)}, 5/5 is ${iv(w.k5)}. internal-task's bar "opens in at least 3 of 5" is met by a count, but "strictly above baseline" compares two such intervals: 3/5 against 0/5 overlaps (${iv(w.k3)} against ${iv(w.k0)}), so that pair is "meets the bars; improvement inconclusive at n=5"; only 5/5 against 0/5 (${iv(w.k5)} against ${iv(w.k0)}) separates. The discovery run saw OpenClaw open the skill with gstack registered at bd8907d6 and no helper run (gsta135-openclaw-t1-gstack), so a baseline count of 0 opens is not assured. Five repeats of one seed per task measure that seed, not the task class. At n=10 per cell (120 trials, about ${usd(atBase * 2)} at the discovery costs, ${usd(atCeiling * 2)} at the ceilings; cap $30) 6/10 against 1/10 ${separated(w10.k6, w10.k1)} (${iv(w10.k6)} against ${iv(w10.k1)}) and 8/10 against 1/10 ${separated(w10.k8, w10.k1)} (${iv(w10.k8)} against ${iv(w10.k1)}). The $${panelCap.toFixed(2)} recommendation buys counts with these intervals and nothing finer.`);
  mkdirSync(resolve(outMd, '..'), { recursive: true });
  writeFileSync(outMd, md.join('\n') + '\n');
  const json = { ...ceilings, per_harness: perHarness, source: measured ? runDir.replace(ROOT + '/', '') : 'placeholder (internal-task)', derived_at: new Date().toISOString(), delta_skill_tokens: deltaSkill, delta_helper_tokens: deltaHelper, helper_output_bytes: helperBytes, helper_output_source: helperSource, median_output_tokens: outMed,
    rates: { proxy: proxyRow, gstack: gstackRow, agree_on_logged_categories: ratesAgree }, lease_usd: lease, r_max_usd: r.r_max_usd, panel_cap_usd: panelCap, expected_usd: { at_discovery_costs: atBase, at_ceilings: atCeiling }, cap_admits: capAdmits, admitted_at_ceilings: capAdmits[panelCap.toFixed(2)].at_ceilings.admitted, cap_for_all_60: capForAll60, soft_rule_worst_case_usd: softWorstCase, wilson_n5: w, wilson_n10: w10, problems };
  writeFileSync(outJson, JSON.stringify(json, null, 2) + '\n');
  console.log(JSON.stringify(json));
  process.stderr.write(`[ceilings] wrote ${outMd} and ${outJson}\n`);
}
