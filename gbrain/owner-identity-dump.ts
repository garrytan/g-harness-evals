// Owner-identity store dump, run by gbrain's own bun against a stopped brain (runner/grade/owner-identity-store.ts): opens the
// brain at GBRAIN_HOME with gbrain's engine (HE_GBRAIN_SRC, default /opt/gbrain/src) and prints one JSON document on stdout with
// every live page (slug, type, title, frontmatter, compiled truth, timeline text and rows, source kind), every fact row, the
// owner member (config access.owner_member), the facts:absorb rows of ingest_log and every facts-absorb job's status and creation time.
// Read-only: SELECT statements and one config read inside a READ ONLY transaction, so the dump never changes the brain it grades.
//
//   GBRAIN_HOME=/brain bun gbrain/owner-identity-dump.ts

export {};

const gbrain = process.env.HE_GBRAIN_SRC ?? '/opt/gbrain/src';
if (!process.env.GBRAIN_HOME) { console.error('owner-identity-dump: GBRAIN_HOME is not set'); process.exit(2); }
const { loadConfig, toEngineConfig } = await import(`${gbrain}/core/config.ts`);
const { createEngine } = await import(`${gbrain}/core/engine-factory.ts`);
const { VERSION } = await import(`${gbrain}/version.ts`);

const config = loadConfig();
const engine = await createEngine(toEngineConfig(config));
await engine.connect(toEngineConfig(config));
type Row = Record<string, unknown>;
const q = (sql: string) => engine.executeRaw(sql, []) as Promise<Row[]>;
try {
  const factColumns = new Set((await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'facts'`)).map((r) => String(r.column_name)));
  const optional = (c: string) => (factColumns.has(c) ? `f.${c}` : `NULL AS ${c}`);
  await q('BEGIN READ ONLY');
  const pages = await q(`SELECT p.id, p.source_id, p.slug, p.type, p.title, p.frontmatter, p.compiled_truth, p.timeline, p.source_kind
    FROM pages p WHERE p.deleted_at IS NULL ORDER BY p.source_id, p.slug`);
  const timeline = await q(`SELECT t.page_id, t.date::text AS date, t.source, t.summary, t.detail FROM timeline_entries t ORDER BY t.page_id, t.id`);
  const facts = await q(`SELECT f.id, f.source_id, f.entity_slug, f.fact, f.context, f.kind, f.visibility, f.source, f.source_session,
    ${optional('attributed_to')}, ${optional('source_markdown_slug')}, f.expired_at::text AS expired_at, f.superseded_by
    FROM facts f ORDER BY f.id`);
  const iso = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const absorb = await q(`SELECT id, source_ref, summary, ${iso('created_at')} AS created_at FROM ingest_log WHERE source_type = 'facts:absorb' ORDER BY id`);
  const jobs = await q(`SELECT status, ${iso('created_at')} AS created_at FROM minion_jobs WHERE name = 'facts-absorb' ORDER BY id`);
  await q('ROLLBACK');
  const owner = await engine.getConfig('access.owner_member').catch(() => null);
  const byPage = new Map<unknown, Row[]>();
  for (const t of timeline) byPage.set(t.page_id, [...(byPage.get(t.page_id) ?? []), t]);
  process.stdout.write(JSON.stringify({
    gbrain_version: VERSION,
    owner_member: owner ?? null,
    pages: pages.map(({ id, ...p }) => ({ ...p, timeline_entries: (byPage.get(id) ?? []).map(({ page_id: _, ...t }) => t) })),
    facts,
    absorb_log: absorb,
    absorb_jobs: jobs,
  }) + '\n');
} finally {
  await engine.disconnect();
}
