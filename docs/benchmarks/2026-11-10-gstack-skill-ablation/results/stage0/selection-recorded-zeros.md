# Arm selection (stage 0): gstack-skill-ablation-2026-11

Rule: minus arm: excludable on every frontier host (claude, codex), fit yes, open rate >= 0.4 on a frontier model; top 3 by pooled open count over the frontier models' full trials, ties by larger summed listing bytes, then name. diet: every excludable skill no stage-0 full trial of any model opened. put-back order: smallest summed listing bytes first, then name.

## Minus arms

No skill is eligible.

## Diet

53 skills, 25278 listing bytes on claude + codex.

Spec: `full,-skill:benchmark,-skill:benchmark-models,-skill:browse,-skill:canary,-skill:captain,-skill:careful,-skill:claude-code,-skill:codex,-skill:context-restore,-skill:context-save,-skill:cso,-skill:design-consultation,-skill:design-html,-skill:design-motion,-skill:design-review,-skill:design-shotgun,-skill:deslop-shared-libs,-skill:devex-review,-skill:diagram,-skill:document-generate,-skill:eval-plan,-skill:freeze,-skill:guard,-skill:health,-skill:ios-clean,-skill:ios-design-review,-skill:ios-fix,-skill:ios-qa,-skill:ios-sync,-skill:land-and-deploy,-skill:landing-report,-skill:learn,-skill:make-pdf,-skill:modernize,-skill:open-gstack-browser,-skill:pair-agent,-skill:plan-tune,-skill:qa-only,-skill:retro,-skill:review,-skill:runaway-stopper,-skill:scrape,-skill:setup-browser-cookies,-skill:setup-deploy,-skill:setup-gbrain,-skill:skillify,-skill:spec,-skill:sync-gbrain,-skill:test-audit,-skill:ubicloud,-skill:unfreeze,-skill:verify,-skill:write-skill`

spec_sha256: `ab021fbd8c6daf9ad6a79d2a4a997588255d16cce6e21e6fe435bc8132eae469`

Put-back order if gstack refuses the render: codex, learn, test-audit, land-and-deploy, deslop-shared-libs, modernize, claude-code, runaway-stopper, context-save, eval-plan, scrape, unfreeze, ubicloud, health, review, canary, retro, verify, write-skill, spec, freeze, careful, setup-browser-cookies, browse, qa-only, guard, context-restore, cso, design-shotgun, landing-report, sync-gbrain, setup-deploy, plan-tune, setup-gbrain, skillify, benchmark, document-generate, design-motion, captain, open-gstack-browser, diagram, ios-sync, ios-fix, make-pdf, devex-review, design-consultation, ios-clean, design-review, pair-agent, benchmark-models, design-html, ios-design-review, ios-qa.

## Open rates (scored stage-0 full trials)

| Skill | Opus 5.5 (Claude Code) (n 34) | GPT-6.1 Sol (Codex) (n 40) | Particle-1 (Hermes), low-cost (n 0) | Eligible |
|---|---|---|---|---|

Truncated captures (cut at the proxy's size cap; opens after the cap are unobserved): opus full 0, opus none 0, sol none 0, sol full 0.

Never opened by any model: 64 skills (every row is in selection.json).
