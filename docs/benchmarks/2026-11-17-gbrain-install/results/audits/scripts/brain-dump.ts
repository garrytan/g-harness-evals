// Read-only dump of where one or more brains hold their trial's nonce. Input: a JSON file [{trial_id, nonce, gbrain_dir}].
// Each brain.pglite is copied to a scratch dir first (pglite may replay its WAL on open), so the trial data is never written.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync, writeFileSync, existsSync, rmSync, lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const [listFile, outFile, scratch] = process.argv.slice(2);
const items = JSON.parse(readFileSync(listFile, 'utf8'));
const results: any[] = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : [];
const done = new Set(results.map(r => r.trial_id));
const big = (k: string, v: unknown) => typeof v === 'bigint' ? String(v) : v;
function rawHits(root: string, needle: string, skip: string): string[] {
  const out: string[] = []; const n = needle.toLowerCase();
  const visit = (p: string) => { let st; try { st = lstatSync(p); } catch { return; } if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { if (p === skip) return; for (const x of readdirSync(p)) visit(join(p, x)); return; }
    if (st.isFile() && readFileSync(p).toString('latin1').toLowerCase().includes(n)) out.push(relative(root, p)); };
  visit(root); return out.sort();
}
for (const it of items) {
  if (done.has(it.trial_id)) continue;
  const src = join(it.gbrain_dir, 'brain.pglite');
  const rec: any = { trial_id: it.trial_id, gbrain_dir_exists: existsSync(it.gbrain_dir), brain_pglite_exists: existsSync(src) };
  if (rec.brain_pglite_exists) {
    rec.raw_files_in_brain_pglite_holding = rawHits(src, it.nonce, '').length;
    rec.other_gbrain_files_holding = rawHits(it.gbrain_dir, it.nonce, src);
    const db = join(scratch, 'db');
    rmSync(db, { recursive: true, force: true });
    const cp = spawnSync('rsync', ['-a', '--no-links', '--exclude', '.gbrain-ipc-secret', src + '/', db + '/']);
    if (cp.status !== 0) throw new Error('copy failed ' + it.trial_id);
    const pg = await PGlite.create({ dataDir: db, extensions: { vector, pg_trgm } });
    try {
      const like = '%' + it.nonce + '%';
      const tables = (await pg.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")).rows.map((r: any) => r.table_name);
      rec.tables_holding = {};
      for (const t of tables) {
        const q = '"' + t.replace(/"/g, '""') + '"';
        const n = Number((await pg.query('select count(*)::int as n from ' + q + ' where ' + q + '::text ilike $1', [like])).rows[0].n);
        if (n) rec.tables_holding[t] = n;
      }
      rec.pages_total = Number((await pg.query('select count(*)::int as n from pages')).rows[0].n);
      rec.archive_pages_total = Number((await pg.query("select count(*)::int as n from pages where slug like 'conversations/%'")).rows[0].n);
      rec.pages_holding = JSON.parse(JSON.stringify((await pg.query('select slug, type, page_kind, deleted_at, source_kind, ingested_via, write_origin from pages where pages::text ilike $1 order by slug', [like])).rows, big));
      rec.facts_holding = JSON.parse(JSON.stringify((await pg.query('select id, entity_slug, kind, visibility, expired_at, valid_until, superseded_by, consolidated_into, source_session, source_markdown_slug, write_origin from facts where facts::text ilike $1 order by id', [like])).rows, big));
      rec.page_versions_holding = JSON.parse(JSON.stringify((await pg.query('select p.slug from page_versions v left join pages p on p.id = v.page_id where v::text ilike $1', [like]).catch(() => ({ rows: [{ error: 'query failed' }] }))).rows, big));
      rec.slugs_all = (await pg.query("select slug from pages order by slug")).rows.map((r: any) => r.slug);
    } finally { await pg.close(); rmSync(db, { recursive: true, force: true }); }
  }
  results.push(rec);
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(it.trial_id, JSON.stringify({ tables: rec.tables_holding, pages: rec.pages_holding?.map((p: any) => p.slug), facts: rec.facts_holding?.length, other: rec.other_gbrain_files_holding }));
}
