#!/usr/bin/env bun
// The keyless model side of the MCP-at-scale cells: a slot broker stand-in and a model upstream in one process, for the
// listing map and the search-effort captures (no metering proxy, no lease, nothing counted, no key read or passed).
//
// The broker (POST /bind on 127.0.0.1) hands each agent class the upstream's address with the trial in the path
// (http://<gateway>:<port>/<trial>/<provider>), as scripts/frontier-harbor/delivery-smoke.sh's stub does. The upstream
// strips the trial, appends { n, at, trial, path, body } to bodies.jsonl, and answers:
//   mode "listing": scripts/frontier-harbor/fake-upstream.ts's reply(), so the first reply is text and the turn ends;
//   mode "search":  a scripted model (search-script.ts) that searches for a target tool with the harness's own search
//                   mechanism, calls it, then ends with text; the captures become the search-effort parser fixtures.
// Gemini countTokens is answered locally (four characters per token), as the metering proxy does.
import { appendFileSync } from 'node:fs';
import { reply } from '../frontier-harbor/fake-upstream.ts';
import { scriptedReply, type SearchTarget } from './search-script.ts';

export interface UpstreamOptions { gateway: string; port: number; brokerPort: number; bodies: string; mode: 'listing' | 'search'; target?: SearchTarget; replyDelayMs?: number }

export function splitTrial(path: string): { trial: string | null; rest: string } {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9._-]*)(\/(?:anthropic|openai|google|particle|openrouter|xai)\/.*)$/.exec(path);
  return m ? { trial: m[1]!, rest: m[2]! } : { trial: null, rest: path };
}

export function startUpstream(o: UpstreamOptions) {
  let n = 0;
  const upstream = Bun.serve({
    hostname: o.gateway, port: o.port, idleTimeout: 120,
    async fetch(req) {
      const url = new URL(req.url);
      const { trial, rest } = splitTrial(url.pathname);
      const raw = req.method === 'POST' ? await req.text() : '';
      let body: Record<string, any> = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      n += 1;
      if (raw) appendFileSync(o.bodies, JSON.stringify({ n, at: new Date().toISOString(), trial, path: rest, body: raw }) + '\n');
      if (/:countTokens$/.test(rest)) return Response.json({ totalTokens: Math.ceil(raw.length / 4) });
      if (o.replyDelayMs) await Bun.sleep(o.replyDelayMs);
      if (o.mode === 'search' && o.target) {
        const r = scriptedReply(rest, body, n, o.target);
        if (r) return r;
      }
      return reply(rest, body, n);
    },
  });
  const broker = Bun.serve({
    hostname: '127.0.0.1', port: o.brokerPort,
    async fetch(req) {
      if (req.method !== 'POST' || new URL(req.url).pathname !== '/bind') return new Response('not found', { status: 404 });
      const b = (await req.json()) as { trial: string; model: string };
      return Response.json({ token: 'keyless-' + b.trial, base_url: 'http://' + o.gateway + ':' + o.port + '/' + b.trial + '/' + b.model.split(':')[0] });
    },
  });
  return { stop: () => { upstream.stop(true); broker.stop(true); } };
}
