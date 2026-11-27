// The owner-identity analysis config (internal-task): what a preregistration states under heldout.owner_identity, or what
// scripts/owner-identity/analyze.ts --config passes. No imports, so the preregistration and claim checks can read it.

export const SDD_KINDS = ['g_vs_n_harness', 'g_vs_n_pooled', 'b_vs_g_harness', 'b_vs_g_pooled', 'p_vs_g', 'harness_vs_harness'] as const;

/** Fractions throughout: 0.06 is six points. */
export interface AnalysisConfig {
  seed?: number;
  draws?: number;
  /** The preregistered smallest detectable difference of each comparison kind. */
  sdd: Record<(typeof SDD_KINDS)[number], number>;
  /** Row P (extraction p_model, default opus) against the G cells of model on family I, non-inferiority with this margin. */
  p_vs_g?: { model: string; p_model?: string; margin: number };
  /** The design effect where it cannot be estimated (no events, or every fact a hit); default the mean facts per task. */
  design_effect_fallback?: number;
}

const frac = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;

export function analysisConfigProblems(c: unknown): string[] {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['owner_identity must be an object with sdd (and p_vs_g for a row P claim)'];
  const o = c as Partial<AnalysisConfig>;
  const p: string[] = [];
  if (o.seed !== undefined && !Number.isSafeInteger(o.seed)) p.push('owner_identity.seed must be an integer');
  if (o.draws !== undefined && !(Number.isSafeInteger(o.draws) && o.draws >= 1000)) p.push('owner_identity.draws must be an integer of at least 1000');
  if (!o.sdd || typeof o.sdd !== 'object') p.push(`owner_identity.sdd must name ${SDD_KINDS.join(', ')}`);
  else for (const k of SDD_KINDS) if (!frac((o.sdd as Record<string, unknown>)[k])) p.push(`owner_identity.sdd.${k} must be a fraction between 0 and 1`);
  const pv = o.p_vs_g;
  if (pv !== undefined && !(pv && typeof pv.model === 'string' && pv.model && frac(pv.margin) && (pv.p_model === undefined || typeof pv.p_model === 'string'))) p.push('owner_identity.p_vs_g must be {"model": "<the model of the G cells>", "margin": <fraction>, "p_model": "opus" (the default)}');
  if (o.design_effect_fallback !== undefined && !(typeof o.design_effect_fallback === 'number' && o.design_effect_fallback >= 1)) p.push('owner_identity.design_effect_fallback must be a number >= 1');
  return p;
}
