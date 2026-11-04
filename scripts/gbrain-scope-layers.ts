#!/usr/bin/env bun
// internal-task (C4 prereg, Freeze gate 3): rows outside each member's grant with each gbrain scope layer off, keyless.
//
//   env -i PATH=$PATH HOME=$HOME bun scripts/gbrain-scope-layers.ts [--split dev] [--brain member|company]
//       [--image harness-eval/gbrain:dev] [--out <dir>]
//
// Starts the brain's sidecar from the image (no model call, no key), seeds one DM fact per member on the member brain, and runs
// search, query, recall and list_pages per member four ways: both layers (the member's rescoped token and its source_ids),
// the token alone, the source_ids alone (the unscoped token) and neither (the unscoped token, what QM's memory provider under
// one credential reads). Writes layers.json and layers.md under --out (default ~/.capy/work/gbrain-scope-layers/<brain>-<split>)
// and prints the table. runner/trial/gbrain.ts probeScopeLayers does the work.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_GBRAIN_IMAGE, SCOPE_LAYERS, probeScopeLayers } from '../runner/trial/gbrain.ts';

type Result = Awaited<ReturnType<typeof probeScopeLayers>>;

const LAYER_WORDS: Record<(typeof SCOPE_LAYERS)[number], string> = {
  both: 'member token + source_ids',
  token: 'member token only',
  sources: 'unscoped token + source_ids',
  neither: 'unscoped token only',
};

/** The receipt table: one row per layer and tool. */
export function renderLayers(r: Result): string {
  const out = [
    `# gbrain scope layers on the ${r.brain} brain (${r.split})`,
    '',
    `Image ${r.image_id}. ${r.members} members, ${r.queries.length} queries per search, query and recall, list_pages paged to the end. Seeded DM facts: ${r.seeded.filter((s) => s.ok).length} of ${r.seeded.length}. A row is outside when its source_id is not in the requesting member's grant.`,
    '',
    '| Layers on | Tool | Calls | Rows | Rows outside the grant | Of those, seeded DM facts | Rows without source_id |',
    '|---|---|---:|---:|---:|---:|---:|',
  ];
  for (const layer of SCOPE_LAYERS) for (const [tool, n] of Object.entries(r.layers[layer])) out.push(`| ${LAYER_WORDS[layer]} | ${tool} | ${n.calls} | ${n.rows} | ${n.outside} | ${n.outside_seeded_facts} | ${n.unattributed} |`);
  return out.join('\n') + '\n';
}

if (import.meta.main) {
  const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
  const split = arg('split', 'dev') as 'dev' | 'heldout';
  const brain = arg('brain', 'member') as 'company' | 'member';
  const out = resolve(arg('out', join(homedir(), '.capy', 'work', 'gbrain-scope-layers', `${brain}-${split}`)));
  mkdirSync(out, { recursive: true });
  const r = await probeScopeLayers(arg('image', DEFAULT_GBRAIN_IMAGE), split, join(out, 'sidecar'), { brain });
  writeFileSync(join(out, 'layers.json'), JSON.stringify(r, null, 1) + '\n');
  writeFileSync(join(out, 'layers.md'), renderLayers(r));
  console.log(renderLayers(r));
  console.log(`LAYERS: ${out}`);
}
