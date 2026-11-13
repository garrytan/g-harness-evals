# gstack skill ablation (main stage): gstack-skill-ablation-2026-11

Seed 7, 10000 draws, alpha 0.05, non-inferiority margin 10 points. Pass rates are task means with task bootstrap 95% intervals. Differences are arm minus reference, in percentage points.

Pooled models: opus, sol.

Truncated captures (cut at the proxy's size cap; opens after the cap are unobserved): opus none 0, opus full 0, opus minus-verify 2, opus diet 0, sol none 0, sol full 0, sol minus-verify 0, sol diet 0.

Diet spec: `full,-skill:benchmark,-skill:benchmark-models,-skill:browse,-skill:canary,-skill:captain,-skill:careful,-skill:claude-code,-skill:codex,-skill:context-restore,-skill:context-save,-skill:cso,-skill:design-consultation,-skill:design-html,-skill:design-motion,-skill:design-review,-skill:design-shotgun,-skill:deslop-shared-libs,-skill:devex-review,-skill:diagram,-skill:document-generate,-skill:eval-plan,-skill:freeze,-skill:guard,-skill:health,-skill:ios-clean,-skill:ios-design-review,-skill:ios-fix,-skill:ios-qa,-skill:ios-sync,-skill:land-and-deploy,-skill:landing-report,-skill:learn,-skill:make-pdf,-skill:modernize,-skill:open-gstack-browser,-skill:pair-agent,-skill:plan-tune,-skill:qa-only,-skill:retro,-skill:review,-skill:runaway-stopper,-skill:scrape,-skill:setup-browser-cookies,-skill:setup-deploy,-skill:setup-gbrain,-skill:skillify,-skill:spec,-skill:sync-gbrain,-skill:test-audit,-skill:ubicloud,-skill:unfreeze,-skill:write-skill`.

## Opus 5.5 (Claude Code)

Role frontier; headroom: passed; pooled.

| Arm | Cell | Scored / trials | Pass rate [95% CI] | Tokens per trial (input / cached / output / total) | Listing bytes | Opened body tokens | Cost per solve [95% CI] |
|---|---|---|---|---|---|---|---|
| none | opus-none | 168 / 168 | 70.2% [53.0%, 85.7%] | 825685 / 783467 / 15364 / 841050 | n/a | n/a | $0.9611 [$0.5019, $1.5146] |
| full | opus-full | 168 / 168 | 66.7% [50.6%, 81.0%] | 748842 / 705411 / 14502 / 763343 | 5919 | 0 | $0.9724 [$0.5560, $1.4841] |
| diet | opus-diet | 168 / 168 | 67.3% [49.4%, 83.3%] | 820443 / 773140 / 16332 / 836775 | 967 | 0 | $1.0671 [$0.5271, $1.7766] |
| minus-verify | opus-minus-verify | 168 / 168 | 67.9% [51.2%, 82.7%] | 843449 / 796220 / 15056 / 858505 | 5833 | 0 | $1.0264 [$0.5549, $1.6447] |

| Comparison | Tasks | Arm / reference | Difference [95% CI] | p | Holm p | Worse / better | Token ratio [95% CI] |
|---|---|---|---|---|---|---|---|
| minus-verify - full | 21 | 67.9% / 66.7% | +1.2 [-4.8, +7.7] | 0.8549 | 1.0000 | 5 / 6 | 1.12x [0.93x, 1.42x] |
| diet - full | 21 | 67.3% / 66.7% | +0.6 [-7.7, +9.5] | 1.0000 | 1.0000 | 6 / 6 | 1.10x [0.85x, 1.46x] |
| full - none | 21 | 66.7% / 70.2% | -3.6 [-10.7, +3.6] | 0.4332 | 1.0000 | 7 / 3 | 0.91x [0.67x, 1.21x] |

## GPT-6.1 Sol (Codex)

Role frontier; headroom: passed; pooled.

| Arm | Cell | Scored / trials | Pass rate [95% CI] | Tokens per trial (input / cached / output / total) | Listing bytes | Opened body tokens | Cost per solve [95% CI] |
|---|---|---|---|---|---|---|---|
| none | sol-none | 160 / 160 | 63.7% [48.1%, 78.1%] | 449606 / 414926 / 9985 / 459591 | n/a | n/a | $0.4453 [$0.2655, $0.7654] |
| full | sol-full | 160 / 160 | 66.9% [49.4%, 82.5%] | 547150 / 504206 / 9887 / 557037 | 28282 | 1028 | $0.5033 [$0.2958, $0.9279] |
| diet | sol-diet | 160 / 160 | 63.1% [47.5%, 77.5%] | 504909 / 466333 / 10625 / 515534 | 5678 | 1398 | $0.7937 [$0.4238, $1.4135] |
| minus-verify | sol-minus-verify | 160 / 160 | 63.1% [46.9%, 78.8%] | 520572 / 480248 / 9424 / 529996 | 27939 | 39 | $0.4934 [$0.2920, $0.8748] |

| Comparison | Tasks | Arm / reference | Difference [95% CI] | p | Holm p | Worse / better | Token ratio [95% CI] |
|---|---|---|---|---|---|---|---|
| minus-verify - full | 20 | 63.1% / 66.9% | -3.8 [-10.0, +1.9] | 0.3418 | 1.0000 | 7 / 5 | 0.95x [0.83x, 1.05x] |
| diet - full | 20 | 63.1% / 66.9% | -3.8 [-11.9, +2.5] | 0.5000 | 1.0000 | 5 / 4 | 0.93x [0.86x, 1.00x] |
| full - none | 20 | 66.9% / 63.7% | +3.1 [-3.8, +10.0] | 0.5000 | 1.0000 | 3 / 5 | 1.21x [1.10x, 1.42x] |

## Particle-1 (Hermes), low-cost

Role low-cost; headroom: no scored trial; low-cost, never pooled.

| Arm | Cell | Scored / trials | Pass rate [95% CI] | Tokens per trial (input / cached / output / total) | Listing bytes | Opened body tokens | Cost per solve [95% CI] |
|---|---|---|---|---|---|---|---|

| Comparison | Tasks | Arm / reference | Difference [95% CI] | p | Holm p | Worse / better | Token ratio [95% CI] |
|---|---|---|---|---|---|---|---|
| minus-verify - full | 0 | n/a / n/a | n/a [no interval] | n/a | 1.0000 | 0 / 0 | n/a [no interval] |
| diet - full | 0 | n/a / n/a | n/a [no interval] | n/a | 1.0000 | 0 / 0 | n/a [no interval] |
| full - none | 0 | n/a / n/a | n/a [no interval] | n/a | 1.0000 | 0 / 0 | n/a [no interval] |

## Pooled readings

| Arm | Models | Tasks | Difference [95% CI] | 90% lower bound | Within-10 | Token ratio [95% CI] | MDD | Verdict |
|---|---|---|---|---|---|---|---|---|
| minus-verify | opus, sol | 41 | -1.2 [-5.5, +3.4] | -4.9 | yes | 1.05x [0.93x, 1.21x] | 4.4 points | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 4.4 points |
| diet | opus, sol | 41 | -1.5 [-7.3, +4.0] | -6.4 | yes | 1.03x [0.88x, 1.23x] | 5.6 points | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |

## Skills, ranked by pooled open rate, then listing bytes

| Rank | Skill | Fit | Pooled open rate | Listing bytes (claude / codex) | Kind | Verdict |
|---|---|---|---|---|---|---|
| 1 | verify | yes | 19.5% | 81 / 304 | minus arm | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 4.4 points |
| 2 | browse | no | 0.3% | 134 / 298 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 3 | careful | yes | 0.3% | 59 / 369 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 4 | office-hours | no | 0.0% | 51 / 763 | listing cost only | fit no |
| 5 | ios-qa | no | 0.0% | 51 / 752 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 6 | ios-design-review | no | 0.0% | 76 / 703 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 7 | design-html | no | 0.0% | 94 / 658 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 8 | qa | yes | 0.0% | 63 / 675 | not removable at the pin | claude: MODULE_EXCLUSION_UNSAFE; codex: MODULE_EXCLUSION_UNSAFE |
| 9 | benchmark-models | no | 0.0% | 65 / 660 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 10 | autoplan | yes | 0.0% | 172 / 539 | not removable at the pin | claude: MODULE_PINNED; codex: MODULE_PINNED |
| 11 | pair-agent | no | 0.0% | 60 / 642 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 12 | design-review | no | 0.0% | 203 / 498 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 13 | ios-clean | no | 0.0% | 94 / 603 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 14 | design-consultation | no | 0.0% | 227 / 442 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 15 | devex-review | no | 0.0% | 53 / 614 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 16 | make-pdf | no | 0.0% | 71 / 592 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 17 | ios-fix | no | 0.0% | 41 / 621 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 18 | plan-devex-review | no | 0.0% | 71 / 584 | listing cost only | fit no |
| 19 | ios-sync | no | 0.0% | 94 / 552 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 20 | diagram | no | 0.0% | 184 / 411 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 21 | open-gstack-browser | no | 0.0% | 104 / 486 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 22 | document-release | no | 0.0% | 53 / 531 | listing cost only | fit no |
| 23 | captain | no | 0.0% | 212 / 368 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 24 | design-motion | no | 0.0% | 97 / 466 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 25 | document-generate | no | 0.0% | 111 / 448 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 26 | benchmark | no | 0.0% | 55 / 502 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 27 | skillify | no | 0.0% | 103 / 441 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 28 | plan-tune | no | 0.0% | 108 / 413 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 29 | setup-gbrain | no | 0.0% | 166 / 355 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 30 | ship | no | 0.0% | 115 / 396 | listing cost only | fit no |
| 31 | plan-ceo-review | no | 0.0% | 53 / 450 | listing cost only | fit no |
| 32 | setup-deploy | no | 0.0% | 63 / 430 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 33 | sync-gbrain | no | 0.0% | 109 / 373 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 34 | landing-report | no | 0.0% | 74 / 391 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 35 | design-shotgun | no | 0.0% | 143 / 316 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 36 | context-restore | yes | 0.0% | 79 / 377 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 37 | cso | no | 0.0% | 113 / 343 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 38 | guard | yes | 0.0% | 86 / 368 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 39 | qa-only | yes | 0.0% | 63 / 390 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 40 | setup-browser-cookies | no | 0.0% | 110 / 321 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 41 | plan-design-review | no | 0.0% | 95 / 331 | listing cost only | fit no |
| 42 | freeze | yes | 0.0% | 75 / 347 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 43 | spec | yes | 0.0% | 78 / 339 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 44 | write-skill | no | 0.0% | 133 / 259 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 45 | gstack-upgrade | no | 0.0% | 51 / 327 | listing cost only | fit no |
| 46 | retro | no | 0.0% | 47 / 321 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 47 | canary | no | 0.0% | 45 / 318 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 48 | gstack | no | 0.0% | 49 / 311 | listing cost only | fit no |
| 49 | review | no | 0.0% | 50 / 306 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 50 | health | yes | 0.0% | 38 / 317 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 51 | ubicloud | no | 0.0% | 148 / 205 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 52 | unfreeze | yes | 0.0% | 99 / 250 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 53 | scrape | no | 0.0% | 109 / 239 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 54 | eval-plan | no | 0.0% | 169 / 169 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 55 | context-save | yes | 0.0% | 42 / 282 | diet group | FIX-METHOD: within-10, but the pooled token ratio is above 1; MDD 5.6 points |
| 56 | runaway-stopper | no | 0.0% | 113 / 205 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 57 | claude-code | no | 0.0% | unlisted / 301 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 58 | modernize | no | 0.0% | unlisted / 298 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 59 | deslop-shared-libs | no | 0.0% | 82 / 194 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 60 | land-and-deploy | no | 0.0% | unlisted / 267 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 61 | test-audit | no | 0.0% | 92 / 153 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 62 | learn | no | 0.0% | 30 / 213 | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 63 | codex | no | 0.0% | 55 / unlisted | listing cost only | fit no; in the diet arm, whose verdict is FIX-METHOD |
| 64 | plan-eng-review | yes | 0.0% | 53 / unlisted | not removable at the pin | claude: MODULE_EXCLUSION_UNSAFE |
