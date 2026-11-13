# Arm selection (stage 0): gstack-skill-ablation-2026-11

Rule: minus arm: excludable on every frontier host (claude, codex), fit yes, open rate >= 0.4 on a frontier model; top 3 by pooled open count over the frontier models' full trials, ties by larger summed listing bytes, then name. diet: every excludable skill no stage-0 full trial of any model opened. put-back order: smallest summed listing bytes first, then name.

## Minus arms

| Rank | Arm | Spec | spec_sha256 | Pooled open trials | Listing bytes | Open rate |
|---|---|---|---|---|---|---|
| 1 | minus-verify | `full,-skill:verify` | `a9fd211ddbe0b041bb4d6e2aade31c4b9914d9cc5bb237cf281d3f4b8aab5286` | 17 | 385 | opus 0.0%, sol 42.5% |

## Diet

52 skills, 24893 listing bytes on claude + codex.

Spec: `full,-skill:benchmark,-skill:benchmark-models,-skill:browse,-skill:canary,-skill:captain,-skill:careful,-skill:claude-code,-skill:codex,-skill:context-restore,-skill:context-save,-skill:cso,-skill:design-consultation,-skill:design-html,-skill:design-motion,-skill:design-review,-skill:design-shotgun,-skill:deslop-shared-libs,-skill:devex-review,-skill:diagram,-skill:document-generate,-skill:eval-plan,-skill:freeze,-skill:guard,-skill:health,-skill:ios-clean,-skill:ios-design-review,-skill:ios-fix,-skill:ios-qa,-skill:ios-sync,-skill:land-and-deploy,-skill:landing-report,-skill:learn,-skill:make-pdf,-skill:modernize,-skill:open-gstack-browser,-skill:pair-agent,-skill:plan-tune,-skill:qa-only,-skill:retro,-skill:review,-skill:runaway-stopper,-skill:scrape,-skill:setup-browser-cookies,-skill:setup-deploy,-skill:setup-gbrain,-skill:skillify,-skill:spec,-skill:sync-gbrain,-skill:test-audit,-skill:ubicloud,-skill:unfreeze,-skill:write-skill`

spec_sha256: `c6dbd187f0a2824af41b2374d31aabbac901bbe70cc6f5131b4bb66af950037c`

Put-back order if gstack refuses the render: codex, learn, test-audit, land-and-deploy, deslop-shared-libs, modernize, claude-code, runaway-stopper, context-save, eval-plan, scrape, unfreeze, ubicloud, health, review, canary, retro, write-skill, spec, freeze, careful, setup-browser-cookies, browse, qa-only, guard, context-restore, cso, design-shotgun, landing-report, sync-gbrain, setup-deploy, plan-tune, setup-gbrain, skillify, benchmark, document-generate, design-motion, captain, open-gstack-browser, diagram, ios-sync, ios-fix, make-pdf, devex-review, design-consultation, ios-clean, design-review, pair-agent, benchmark-models, design-html, ios-design-review, ios-qa.

## Open rates (scored stage-0 full trials)

| Skill | Opus 5.5 (Claude Code) (n 34) | GPT-6.1 Sol (Codex) (n 40) | Particle-1 (Hermes), low-cost (n 0) | Eligible |
|---|---|---|---|---|
| verify | 0.0% (0) | 42.5% (17) | n/a (0) | yes |

Truncated captures (cut at the proxy's size cap; opens after the cap are unobserved): opus full 0, opus none 0, sol none 0, sol full 0.

Never opened by any model: 63 skills (every row is in selection.json).

Opens: re-measured, from docs/benchmarks/2026-11-10-gstack-skill-ablation/results/stage0/opens.json (ablation.ts opens), not the records' own.
