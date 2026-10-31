# Instruction followed (scripts/instruction-followed.ts)

A member turn is followed when a gbrain tool call (any outcome) sits inside its window with a lower event seq than its first reply: the first world-MCP `chat.postMessage` in the window, or the runner's post of the turn's reply. A turn with no reply is followed when any gbrain call sits in its window. Intervals: task-clustered bootstrap, 10,000 draws, seed 7.

## Per cell

| Cell | Config | Trials (excluded) | Member turns (not run) | Followed | Share [95% CI, task-clustered] | Tasks | No-reply turns (followed) | Share on replied turns | Search or query before reply |
|---|---|---|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-route-tool-mu-v03-dev | route-tool | 65 (0) | 160 (0) | 1 | 0.6% [0.0%, 2.1%] | 13 | 0 (0) | 0.6% | 0 |
| openclaw-haiku-gbrain-route-startup-mu-v03-dev | route-startup | 65 (0) | 160 (0) | 5 | 3.1% [1.2%, 5.2%] | 13 | 0 (0) | 3.1% | 4 |
| openclaw-haiku-gbrain-route-hook-mu-v03-dev | route-hook | 65 (0) | 160 (0) | 160 | 100.0% [100.0%, 100.0%] | 13 | 0 (0) | 100.0% | 160 |
| openclaw-haiku-gbrain-route-skill-mu-v03-dev | route-skill | 65 (0) | 160 (0) | 1 | 0.6% [0.0%, 2.1%] | 13 | 0 (0) | 0.6% | 0 |
| hermes-haiku-gbrain-route-tool-mu-v03-dev | route-tool | 65 (0) | 160 (0) | 0 | 0.0% [0.0%, 0.0%] | 13 | 0 (0) | 0.0% | 0 |
| hermes-haiku-gbrain-route-system-mu-v03-dev | route-system | 65 (0) | 160 (0) | 144 | 90.0% [81.3%, 97.2%] | 13 | 0 (0) | 90.0% | 143 |
| hermes-haiku-gbrain-route-startup-mu-v03-dev | route-startup | 65 (0) | 160 (0) | 138 | 86.3% [77.3%, 94.1%] | 13 | 0 (0) | 86.3% | 138 |
| hermes-haiku-gbrain-route-hook-mu-v03-dev | route-hook | 65 (0) | 160 (0) | 156 | 97.5% [94.5%, 100.0%] | 13 | 0 (0) | 97.5% | 154 |
| hermes-haiku-gbrain-route-skill-mu-v03-dev | route-skill | 65 (0) | 160 (0) | 5 | 3.1% [0.0%, 7.1%] | 13 | 0 (0) | 3.1% | 1 |

## By turn number (followed / member turns)

| Cell | Turn 1 | Turn 2 | Turn 3 | Turn 4 |
|---|---|---|---|---|
| openclaw-haiku-gbrain-route-tool-mu-v03-dev | 0 / 65 | 1 / 55 | 0 / 35 | 0 / 5 |
| openclaw-haiku-gbrain-route-startup-mu-v03-dev | 1 / 65 | 1 / 55 | 2 / 35 | 1 / 5 |
| openclaw-haiku-gbrain-route-hook-mu-v03-dev | 65 / 65 | 55 / 55 | 35 / 35 | 5 / 5 |
| openclaw-haiku-gbrain-route-skill-mu-v03-dev | 0 / 65 | 1 / 55 | 0 / 35 | 0 / 5 |
| hermes-haiku-gbrain-route-tool-mu-v03-dev | 0 / 65 | 0 / 55 | 0 / 35 | 0 / 5 |
| hermes-haiku-gbrain-route-system-mu-v03-dev | 65 / 65 | 48 / 55 | 26 / 35 | 5 / 5 |
| hermes-haiku-gbrain-route-startup-mu-v03-dev | 64 / 65 | 46 / 55 | 23 / 35 | 5 / 5 |
| hermes-haiku-gbrain-route-hook-mu-v03-dev | 65 / 65 | 54 / 55 | 32 / 35 | 5 / 5 |
| hermes-haiku-gbrain-route-skill-mu-v03-dev | 3 / 65 | 1 / 55 | 1 / 35 | 0 / 5 |

## Each route against route-tool, within its harness (Holm within the harness)

| Harness | Route | Pairs (tasks) | Control | Route | Difference, points [95% CI] | p (two-sided) | Holm p | Unpaired (control, route) |
|---|---|---|---|---|---|---|---|---|
| openclaw | route-startup | 160 (13) | 0.6% | 3.1% | +2.5 [+0.6, +4.4] | 0.1250 (exact-sign-flip) | 0.2500 | 0, 0 |
| openclaw | route-hook | 160 (13) | 0.6% | 100.0% | +99.4 [+97.9, +100.0] | 0.0002 (exact-sign-flip) | 0.0007 | 0, 0 |
| openclaw | route-skill | 160 (13) | 0.6% | 0.6% | +0.0 [+0.0, +0.0] | 1.0000 (exact-sign-flip) | 1.0000 | 0, 0 |
| hermes | route-system | 160 (13) | 0.0% | 90.0% | +90.0 [+81.3, +97.2] | 0.0002 (exact-sign-flip) | 0.0010 | 0, 0 |
| hermes | route-startup | 160 (13) | 0.0% | 86.3% | +86.3 [+77.3, +94.1] | 0.0002 (exact-sign-flip) | 0.0010 | 0, 0 |
| hermes | route-hook | 160 (13) | 0.0% | 97.5% | +97.5 [+94.5, +100.0] | 0.0002 (exact-sign-flip) | 0.0010 | 0, 0 |
| hermes | route-skill | 160 (13) | 0.0% | 3.1% | +3.1 [+0.0, +7.1] | 0.2500 (exact-sign-flip) | 0.2500 | 0, 0 |
