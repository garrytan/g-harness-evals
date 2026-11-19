// HARN-116: print the facts extraction model gbrain resolves for the brain at GBRAIN_HOME, as one JSON line
// {"model": "<provider:model>", "source": "<gbrain's name for what chose it>"}, from gbrain's own resolveFactsExtractionModel
// (src/core/facts/extract.ts) on the brain's engine, so the brain's config (facts.extraction_model, models.tier.reasoning,
// models.default) and the environment (GBRAIN_MODEL, which provider key is set) count exactly as they do when gbrain extracts.
// Run by gbrain/entrypoint.sh under HE_GBRAIN_LLM=proxy, before gbrain serve starts (PGLite takes one process at a time):
//
//   bun /opt/sidecar/gbrain/extraction-model.ts
//
// It makes no model call. Exits 2, printing nothing on stdout, when the gbrain checkout has no such resolver.

export {};

const gbrain = process.env.HE_GBRAIN_SRC ?? '/opt/gbrain/src';
if (!process.env.GBRAIN_HOME) { console.error('extraction-model: GBRAIN_HOME is not set'); process.exit(2); }
const extract = await import(`${gbrain}/core/facts/extract.ts`) as { resolveFactsExtractionModel?: (engine?: unknown) => Promise<{ model: string; source: string }> };
if (typeof extract.resolveFactsExtractionModel !== 'function') { console.error(`extraction-model: ${gbrain}/core/facts/extract.ts has no resolveFactsExtractionModel`); process.exit(2); }
const { loadConfig, toEngineConfig } = await import(`${gbrain}/core/config.ts`);
const { persistenceConfigForBrain } = await import(`${gbrain}/core/persistence/local-client.ts`);
const { createEngine } = await import(`${gbrain}/core/engine-factory.ts`);

const config = persistenceConfigForBrain(loadConfig(), 'host', []);
const engine = await createEngine(toEngineConfig(config));
await engine.connect(toEngineConfig(config));
try {
  const { model, source } = await extract.resolveFactsExtractionModel(engine);
  console.log(JSON.stringify({ model, source }));
} finally {
  await engine.disconnect();
}
