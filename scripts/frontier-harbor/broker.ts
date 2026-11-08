#!/usr/bin/env bun
// The trial slot broker of the frontier Harbor path (internal-task). vm-run.sh runs it on 127.0.0.1 beside the metering proxy;
// it is the only process besides the proxy that holds the proxy's control token (SHOOTOUT_PROXY_CONTROL_TOKEN, from its
// environment). At agent setup each class in agents.py posts its trial here:
//
//   POST /bind {trial, cell, attempt, harness, model, models, job?}  ->  {token, base_url}
//
// The broker binds slot <trial> in the metering proxy (meter key <trial>, a fresh token trial-token:<trial>.<32 hex>, the
// slot's model list, and with --capture the trial's capture directory <job>/<trial>/proxy-capture under the proxy's
// --capture-bodies root; <job> is the Harbor job the class names, <cell>__a<attempt> with an optional __<stage>, and
// <cell>__a<attempt> when it names none) and returns only the token and the slot's base URL on the containers' gateway. A trial binds once:
// a second bind of the same trial (a Harbor retry, which this path turns off) is refused 409. A model outside the run's
// --models list is refused 403. Each bind appends one line to --log (trial, cell, attempt, harness, model, models, time;
// never the token), which to-trials.ts reads to tie a Harbor trial to its meter key.
//
//   POST /unbind-all   unbinds every slot it bound (vm-run.sh calls it before draining the meter)
//   GET /binds         the bind lines so far
//
//   bun scripts/frontier-harbor/broker.ts --listen 127.0.0.1:8791 --proxy http://127.0.0.1:8790
//       --gateway http://172.17.0.1:8790 --models anthropic:claude-opus-5-5,... --log <binds.jsonl> [--capture]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export interface BindLine { at: string; trial: string; cell: string | null; attempt: number | null; harness: string; model: string; models: string[]; job?: string }
export interface BrokerOptions { proxy: string; gateway: string; models: string[]; log: string; controlToken: string | null; capture?: boolean; fetch?: typeof fetch }

/** The capture directory of a trial, relative to the proxy's --capture-bodies root (the run's Harbor jobs directory):
 *  <job>/<trial>/proxy-capture, beside the trial's agent/ and verifier/ directories and never mounted into its container. */
export const captureDir = (cell: string, attempt: number, trial: string, job?: string) => (job ?? cell + '__a' + attempt) + '/' + trial + '/proxy-capture';

/** A job name a trial of this cell and attempt may run under: <cell>__a<attempt>, or that plus __<stage> (plan.ts shardJobs). */
export const jobOk = (job: string, cell: string, attempt: number) => job === cell + '__a' + attempt || (job.startsWith(cell + '__a' + attempt + '__') && SLOT.test(job.slice((cell + '__a' + attempt + '__').length)));

const SLOT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODEL = /^(anthropic|openai):[A-Za-z0-9._-]+$/;

export function readBinds(log: string): BindLine[] {
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as BindLine) : [];
}

export function createBroker(o: BrokerOptions) {
  const send = o.fetch ?? fetch;
  const bound = new Set(readBinds(o.log).map((b) => b.trial));
  const control = (path: string, body: unknown) => send(o.proxy.replace(/\/$/, '') + path, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(o.controlToken ? { 'x-proxy-control': o.controlToken } : {}) },
  });
  const err = (status: number, message: string) => Response.json({ error: message }, { status });
  return async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/binds') return Response.json(readBinds(o.log));
    if (req.method === 'POST' && path === '/unbind-all') {
      for (const trial of bound) await control('/__proxy/unbind', { slot: trial });
      return Response.json({ unbound: bound.size });
    }
    if (req.method !== 'POST' || path !== '/bind') return err(404, 'no route');
    const b = await req.json().catch(() => null) as Partial<BindLine> | null;
    if (!b || typeof b.trial !== 'string' || !SLOT.test(b.trial)) return err(400, 'trial must be letters, digits, dot, underscore or dash');
    if (typeof b.harness !== 'string' || typeof b.model !== 'string' || !MODEL.test(b.model)) return err(400, 'harness and a provider:model model are required');
    const models = Array.isArray(b.models) && b.models.length ? b.models.map(String) : [b.model];
    if (!models.includes(b.model)) return err(400, 'models must include the cell model');
    const outside = models.filter((m) => !MODEL.test(m) || !o.models.includes(m));
    if (outside.length) return err(403, 'model(s) outside this run: ' + outside.join(', '));
    if (o.capture && (typeof b.cell !== 'string' || !SLOT.test(b.cell) || !Number.isInteger(b.attempt))) return err(400, 'a capturing broker needs the cell and attempt of the trial');
    if (b.job !== undefined && (typeof b.job !== 'string' || typeof b.cell !== 'string' || !Number.isInteger(b.attempt) || !jobOk(b.job, b.cell, b.attempt!))) return err(400, 'job must be <cell>__a<attempt>, optionally with __<stage>');
    if (bound.has(b.trial)) return err(409, 'trial ' + b.trial + ' is already bound; a trial binds once (retries are off)');
    bound.add(b.trial);
    const token = 'trial-token:' + b.trial + '.' + randomBytes(16).toString('hex');
    const res = await control('/__proxy/bind', { slot: b.trial, key: b.trial, token, models, ...(o.capture ? { capture: captureDir(b.cell!, b.attempt!, b.trial, b.job) } : {}) });
    if (!res.ok) { bound.delete(b.trial); return err(502, 'the metering proxy refused the bind (' + res.status + ')'); }
    const line: BindLine = { at: new Date().toISOString(), trial: b.trial, cell: b.cell ?? null, attempt: b.attempt ?? null, harness: b.harness, model: b.model, models, ...(b.job ? { job: b.job } : {}) };
    appendFileSync(o.log, JSON.stringify(line) + '\n');
    return Response.json({ token, base_url: o.gateway.replace(/\/$/, '') + '/' + b.trial + '/' + b.model.split(':')[0] });
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const need = (n: string) => flag(n) ?? (console.error('broker.ts needs ' + n), process.exit(2));
  const [host, port] = need('--listen').split(':') as [string, string];
  if (host !== '127.0.0.1') { console.error('broker.ts listens on 127.0.0.1 only'); process.exit(2); }
  const handle = createBroker({ proxy: need('--proxy'), gateway: need('--gateway'), models: need('--models').split(',').filter(Boolean), log: need('--log'), controlToken: process.env.SHOOTOUT_PROXY_CONTROL_TOKEN ?? null, capture: argv.includes('--capture') });
  Bun.serve({ hostname: host, port: Number(port), fetch: handle });
  console.log('frontier-harbor broker on ' + host + ':' + port);
}
