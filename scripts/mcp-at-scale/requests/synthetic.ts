// Synthetic request sets that pass sets.ts, built from a ladder's core tools: for tests, the dry runs and the keyless
// end-to-end check. Nothing here is a real request; the real sets come from Gemini 4 Carbon (prompts/) and the audit.
import type { Ladder } from '../catalog-load.ts';
import { SERVICE_WORDS, type GItem, type Item, type RItem, type Surfaces, type TItem } from './sets.ts';

/** A stand-in for gbrain's surfaces until the frozen release's tools/list dumps replace it. */
export const SYNTHETIC_SURFACES: Surfaces = {
  starter: ['search', 'get_page', 'put_page', 'list_pages', 'add_tag', 'add_link'],
  full: ['search', 'get_page', 'put_page', 'list_pages', 'add_tag', 'add_link', 'find_orphans', 'timeline', 'find_experts', 'chronicle_since', 'graph_neighbors', 'extract_facts'],
  verbs: ['ask', 'find', 'read', 'write', 'link', 'tag', 'remember'],
};

const pad = (n: number) => String(n).padStart(3, '0');

export function syntheticSets(ladder: Ladder, twins: Record<string, string[]>, o: { prefix?: string; perTool?: number; none?: number; tasks?: number; g?: number } = {}) {
  const p = o.prefix ?? '';
  const perTool = o.perTool ?? 8;
  const core = ladder.core.flatMap((c) => c.tools.map((t) => ({ server: c.server, tool: t })));
  const R: RItem[] = [];
  let n = 0;
  for (const t of core) {
    for (let k = 0; k < perTool; k++) {
      n++;
      const id = p + 'r-' + pad(n);
      const ref = (p + 'ref' + n).toUpperCase();
      const capability = k < Math.ceil(perTool * 3 / 8);
      const baitK = capability ? 1 : Math.ceil(perTool * 3 / 8) + 1;
      const twin = twins[t.server]?.[0] ?? null;
      const bait = perTool === 8 && k === baitK && twin !== null;
      const word = SERVICE_WORDS[t.server]?.[0] ?? t.server;
      const text = capability
        ? 'Synthetic request ' + n + ' for the job ' + t.tool.split(/[_-]/).filter((w) => !Object.values(SERVICE_WORDS).flat().includes(w)).join(' ') + ', reference ' + ref + '.'
        : 'Synthetic request ' + n + ' in ' + word + ': run the job with reference ' + ref + '.';
      R.push({ id, set: 'R', kind: 'tool', text, stratum: capability ? 'capability_only' : 'names_service', target: t, bait, bait_twin: bait ? twin : null,
        acceptable: [{ server: t.server, tool: t.tool, required: { query: { $ci: ref } } }] });
    }
  }
  for (let k = 1; k <= (o.none ?? 80); k++) R.push({ id: p + 'n-' + pad(k), set: 'R', kind: 'none', text: 'Synthetic question ' + k + ': what is ' + k + ' plus ' + (k + 1) + '?', stratum: 'no_tool', target: null, bait: false, acceptable: [] });

  const T: TItem[] = [];
  const servers = ladder.core;
  for (let k = 0; k < (o.tasks ?? 40); k++) {
    const steps = 2 + (k % 3);
    const fixtures = Array.from({ length: steps }, (_, s) => {
      const c = servers[(k + s) % servers.length]!;
      const tool = c.tools[(k + s) % c.tools.length]!;
      const key = (p + 'key-' + k + '-' + s).toUpperCase();
      return { id: 's' + (s + 1), server: c.server, tool, match: { ref: { $ci: s === 0 ? (p + 'start-' + k).toUpperCase() : (p + 'key-' + k + '-' + (s - 1)).toUpperCase() } },
        ...(s ? { after: ['s' + s] } : {}), result: { json: { next: key, note: 'synthetic step ' + (s + 1) } } };
    });
    const last = fixtures[fixtures.length - 1]!;
    T.push({ id: p + 't-' + pad(k + 1), set: 'T', kind: 'tool', text: 'Synthetic chained task ' + (k + 1) + ', starting from ' + (p + 'start-' + k).toUpperCase() + '.', fixtures,
      end_state: { fired: fixtures.map((f) => f.id) }, acceptable: [{ server: last.server, tool: last.tool, required: last.match }] });
  }

  const G: GItem[] = [];
  const g = o.g ?? 120;
  const fullOnly = SYNTHETIC_SURFACES.full.filter((t) => !SYNTHETIC_SURFACES.starter.includes(t));
  for (let k = 0; k < g; k++) {
    const half = k < g / 2 ? 'starter' : 'full_only';
    const tools = half === 'starter' ? SYNTHETIC_SURFACES.starter : fullOnly;
    const tool = tools[k % tools.length]!;
    const slug = (p + 'page-' + k).toLowerCase();
    G.push({ id: p + 'g-' + pad(k + 1), set: 'G', kind: 'tool', text: 'Synthetic brain request ' + (k + 1) + ' about ' + slug + '.', half_kind: half, target: { server: 'gbrain', tool },
      acceptable: [{ server: 'gbrain', tool, required: { slug: { $ci: slug } } }] });
  }
  return { R, T, G };
}

export const jsonl = (items: Item[]) => items.map((i) => JSON.stringify(i)).join('\n') + '\n';
