#!/usr/bin/env node
// Local embeddings for the skill-resolver eval's offline arms (internal-task). bge-small-en-v1.5 (MIT), q8, CLS pooling,
// normalised, run on this machine through transformers.js, so no request text leaves it.
//
//   npm install --prefix <deps> @huggingface/transformers@3   (once; outside the repository)
//   node scripts/skill-resolver/embed.mjs --deps <deps> --catalog <dir|catalog.jsonl> --set <set.jsonl> --out <vectors.json>
//
// Skill text is "<name>: <description>". Query text is what the labels were judged on: the request (or text) field, or, for a
// row with prev_user_text (set R), runner/trial/skill-requests.ts composeRequest's "Previous message from the same user: ...
// Current message: ..." (offline-rankers.ts queryText; node cannot import the TypeScript, so it is written out here).
// Output: {model, skills:{name:vec},
// queries:{id:vec}, timing:{index_ms, query_p50_ms, query_p95_ms}}.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const a = process.argv.slice(2);
const v = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const [deps, catalog, set, out] = ['--deps', '--catalog', '--set', '--out'].map(v);
if (!deps || !catalog || !set || !out) { console.error('usage: embed.mjs --deps <dir> --catalog <c> --set <s> --out <o>'); process.exit(2); }
const mod = await import(pathToFileURL(createRequire(join(deps, 'x.js')).resolve('@huggingface/transformers')).href);
const pipeline = mod.pipeline ?? mod.default.pipeline;
const MODEL = 'Xenova/bge-small-en-v1.5';
const skills = catalog.endsWith('.jsonl')
  ? readFileSync(catalog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : JSON.parse(readFileSync(join(catalog, 'manifest.json'), 'utf8')).skills;
const rows = readFileSync(set, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ext = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
const t0 = Date.now();
const S = {};
for (let i = 0; i < skills.length; i += 64) {
  const batch = skills.slice(i, i + 64);
  const vecs = (await ext(batch.map((s) => s.name + ': ' + (s.description ?? '')), { pooling: 'cls', normalize: true })).tolist();
  batch.forEach((s, j) => { S[s.name] = vecs[j]; });
}
const indexMs = Date.now() - t0;
const Q = {}; const lat = [];
const queryText = (r) => (r.prev_user_text ? 'Previous message from the same user: ' + r.prev_user_text + '\n\nCurrent message: ' : '') + (r.request ?? r.text ?? '');
for (const r of rows) { const s = Date.now(); Q[r.id] = (await ext([queryText(r)], { pooling: 'cls', normalize: true })).tolist()[0]; lat.push(Date.now() - s); }
lat.sort((x, y) => x - y);
writeFileSync(out, JSON.stringify({ model: MODEL, skills: S, queries: Q, timing: { index_ms: indexMs, query_p50_ms: lat[Math.floor(lat.length / 2)], query_p95_ms: lat[Math.floor(lat.length * 0.95)] } }));
console.log('EMBED skills=' + skills.length + ' queries=' + rows.length + ' index_ms=' + indexMs + ' p50=' + lat[Math.floor(lat.length / 2)] + ' p95=' + lat[Math.floor(lat.length * 0.95)]);
