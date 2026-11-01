// Re-stamp a copied brain's source checkouts so their writes work at serve time (internal-task). gbrain keeps a checkout per
// source: the default source's under <brain>/.gbrain/content, and each federated source of a company or member brain at
// <brain>/sources/<id> (gbrain/build-brain.ts). gbrain stamps each checkout's inode and birth time. The image copies the brain
// to /brains/<name> and the entrypoint copies it back to /brain for every trial, so each checkout is a new directory at its
// recorded path and gbrain refuses writes to it (recovery_required, physical_root_directory_changed). gbrain's exit for a checkout restored at its recorded path is the self-transfer with
// --confirm-relocated-root: writer status, transfer prepare, a fresh status, transfer accept. This runs those four steps for
// every source named on the command line in one process on one engine (four CLI calls per source would add seconds per
// source to every trial). Run by gbrain/entrypoint.sh with GBRAIN_HOME set, before gbrain serve starts:
//
//   bun /opt/sidecar/gbrain/rebind-sources.ts <source id>...
//
// Prints one line per source and exits non-zero on the first refusal, naming the source and gbrain's error.

export {};

const gbrain = process.env.HE_GBRAIN_SRC ?? '/opt/gbrain/src';
const home = process.env.GBRAIN_HOME;
if (!home) { console.error('rebind-sources: GBRAIN_HOME is not set'); process.exit(2); }
const ids = process.argv.slice(2);
const { loadConfig, toEngineConfig } = await import(`${gbrain}/core/config.ts`);
const { persistenceConfigForBrain } = await import(`${gbrain}/core/persistence/local-client.ts`);
const { runPersistenceAdministration } = await import(`${gbrain}/core/persistence/administration.ts`);
const { createEngine } = await import(`${gbrain}/core/engine-factory.ts`);

const config = persistenceConfigForBrain(loadConfig(), 'host', []);
const engine = await createEngine(toEngineConfig(config));
await engine.connect(toEngineConfig(config));
const admin = (operation: string, params: Record<string, unknown>) => runPersistenceAdministration(engine, operation, params, config, 'owner') as Promise<Record<string, any>>;
let failed = false;
for (const id of ids) {
  try {
    const status = await admin('writer_status', { source_id: id });
    const prepared = await admin('writer_transfer_prepare', { source_id: id, self_transfer: true, confirm_relocated_root: true, admin_intent: 'writer_transfer_prepare', expected_state: status.admin_state });
    const fresh = await admin('writer_status', { source_id: id });
    const path = (status.bindings as Array<{ source_id: string; local_path: string | null }>).find((b) => b.source_id === id)?.local_path;
    if (!path?.startsWith(`${home}/`)) throw new Error(`its checkout ${path ?? '(none)'} is not inside GBRAIN_HOME ${home}`);
    const accepted = await admin('writer_transfer_accept', { source_id: id, path, expected_epoch: prepared.owner_epoch, manifest: prepared.manifest.digest,
      self_transfer: true, confirm_relocated_root: true, admin_intent: 'writer_transfer_accept', expected_state: fresh.admin_state });
    if (accepted.transferred !== true || accepted.binding?.state !== 'active') throw new Error(`transfer accept returned ${JSON.stringify(accepted).slice(0, 300)}`);
    console.log(`${id} re-stamped at ${accepted.binding.local_path} (owner epoch ${accepted.binding.owner_epoch}, ${prepared.manifest.file_count} files)`);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.error(`rebind-sources: ${id}: ${e.code ?? 'error'}: ${e.message ?? String(error)}`);
    failed = true;
    break;
  }
}
await engine.disconnect();
process.exit(failed ? 1 : 0);
