# Instruction routes: route evidence and descriptive paired differences (scripts/instruction-route-secondary.ts)

Descriptive only: no Holm, no decision sentence. Pairs are task and repetition index; intervals are a task-clustered paired bootstrap (seed 7, 10,000 draws); p is the exact two-sided sign flip over task clusters.

## Route evidence per cell

| Cell | Config | Trials | Route record names the route and sha256 | Ready file names them | Hook status (ready file) |
|---|---|---|---|---|---|
| openclaw-haiku-gbrain-route-tool-mu-v03-dev | route-tool | 65 | 65 | 65 | - |
| openclaw-haiku-gbrain-route-startup-mu-v03-dev | route-startup | 65 | 65 | 65 | - |
| openclaw-haiku-gbrain-route-hook-mu-v03-dev | route-hook | 65 | 65 | 65 | loaded 65 |
| openclaw-haiku-gbrain-route-skill-mu-v03-dev | route-skill | 65 | 65 | 65 | - |
| hermes-haiku-gbrain-route-tool-mu-v03-dev | route-tool | 65 | 65 | 65 | - |
| hermes-haiku-gbrain-route-system-mu-v03-dev | route-system | 65 | 65 | 65 | - |
| hermes-haiku-gbrain-route-startup-mu-v03-dev | route-startup | 65 | 65 | 65 | - |
| hermes-haiku-gbrain-route-hook-mu-v03-dev | route-hook | 65 | 65 | 65 | healthy 65 |
| hermes-haiku-gbrain-route-skill-mu-v03-dev | route-skill | 65 | 65 | 65 | - |

## Per cell, mean per trial [95% CI, task-clustered]

Requests are forwarded requests (`usage.requests`); refused requests are not counted.

| Cell | Trials | Pass | USD | Requests | Input tokens | Output tokens | Cached tokens |
|---|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-route-tool-mu-v03-dev | 65 | 81.5% [64.6%, 95.4%] | $0.0062 [$0.0047, $0.0077] | 6.9 [5.6, 8.2] | 200,045 [148,799, 252,845] | 2,264 [1,763, 2,830] | 173,152 [127,818, 220,636] |
| openclaw-haiku-gbrain-route-startup-mu-v03-dev | 65 | 78.5% [64.6%, 90.8%] | $0.0061 [$0.0045, $0.0079] | 6.7 [5.4, 8.0] | 193,583 [138,911, 258,148] | 2,270 [1,769, 2,895] | 167,335 [119,223, 224,597] |
| openclaw-haiku-gbrain-route-hook-mu-v03-dev | 65 | 49.2% [26.2%, 72.3%] | $0.0094 [$0.0076, $0.0112] | 9.0 [7.4, 10.6] | 263,034 [213,236, 312,777] | 2,945 [2,447, 3,455] | 216,809 [175,867, 258,126] |
| openclaw-haiku-gbrain-route-skill-mu-v03-dev | 65 | 80.0% [64.6%, 93.8%] | $0.0065 [$0.0047, $0.0083] | 7.0 [5.5, 8.4] | 209,870 [148,481, 275,375] | 2,291 [1,768, 2,880] | 181,981 [127,671, 240,113] |
| hermes-haiku-gbrain-route-tool-mu-v03-dev | 65 | 80.0% [63.1%, 95.4%] | $0.0056 [$0.0047, $0.0064] | 9.7 [8.4, 11.0] | 258,743 [222,042, 297,033] | 3,038 [2,551, 3,558] | 246,167 [211,904, 282,305] |
| hermes-haiku-gbrain-route-system-mu-v03-dev | 65 | 63.1% [43.1%, 81.5%] | $0.0098 [$0.0083, $0.0112] | 13.4 [11.2, 15.7] | 408,264 [347,955, 466,205] | 4,529 [3,806, 5,331] | 378,060 [322,694, 431,525] |
| hermes-haiku-gbrain-route-startup-mu-v03-dev | 65 | 72.3% [56.9%, 87.7%] | $0.0094 [$0.0081, $0.0106] | 12.8 [11.0, 14.7] | 386,922 [341,411, 435,355] | 4,356 [3,726, 5,082] | 357,904 [316,279, 402,214] |
| hermes-haiku-gbrain-route-hook-mu-v03-dev | 65 | 64.6% [47.7%, 81.5%] | $0.0098 [$0.0085, $0.0111] | 12.8 [10.7, 15.0] | 396,658 [339,833, 450,669] | 4,397 [3,728, 5,076] | 365,083 [312,336, 415,417] |
| hermes-haiku-gbrain-route-skill-mu-v03-dev | 65 | 81.5% [61.5%, 100.0%] | $0.0058 [$0.0048, $0.0069] | 10.0 [8.6, 11.5] | 268,440 [228,048, 312,273] | 3,190 [2,624, 3,928] | 255,060 [216,914, 296,146] |

## Route bytes per trial, from the surface table

Bytes the route adds per copy times the copies per request, summed over the trial's forwarded requests. One copy per request, except route-hook: one copy for each turn so far in the same harness session (adapter.log). At one token per byte this is the input-token difference the route alone would make.

| Cell | Bytes per copy | Mean per trial | Most in a trial | Hook requests outside every turn window |
|---|---|---|---|---|
| openclaw-haiku-gbrain-route-startup-mu-v03-dev | 246 | 1,643 | 3,198 | - |
| openclaw-haiku-gbrain-route-hook-mu-v03-dev | 291 | 2,883 | 4,947 | 0 |
| openclaw-haiku-gbrain-route-skill-mu-v03-dev | 192 | 1,335 | 2,688 | - |
| hermes-haiku-gbrain-route-system-mu-v03-dev | 291 | 3,908 | 6,984 | - |
| hermes-haiku-gbrain-route-startup-mu-v03-dev | 291 | 3,716 | 7,857 | - |
| hermes-haiku-gbrain-route-hook-mu-v03-dev | 291 | 4,092 | 6,984 | 0 |
| hermes-haiku-gbrain-route-skill-mu-v03-dev | 81 | 814 | 1,377 | - |

## Each route minus route-tool, per trial (pass in points)

| Harness | Route | Pairs (tasks) | Pass [95% CI], p | USD | Requests | Input tokens | Output tokens | Cached tokens |
|---|---|---|---|---|---|---|---|---|
| openclaw | route-startup | 65 (13) | -3.1 [-12.3, +7.7], 0.7813 | -$0.0001 [-$0.0006, +$0.0004] | -0.2 [-0.8, +0.4] | -6,462 [-33,496, +26,728] | +6 [-115, +117] | -5,818 [-31,898, +25,825] |
| openclaw | route-hook | 65 (13) | -32.3 [-58.5, -7.7], 0.0469 | +$0.0032 [+$0.0017, +$0.0048] | +2.1 [+1.0, +3.3] | +62,990 [+26,089, +103,185] | +681 [+336, +1,049] | +43,657 [+13,546, +75,789] |
| openclaw | route-skill | 65 (13) | -1.5 [-7.7, +4.6], 1.0000 | +$0.0002 [-$0.0002, +$0.0007] | +0.0 [-0.2, +0.3] | +9,825 [-6,942, +29,639] | +27 [-85, +136] | +8,828 [-6,147, +26,877] |
| hermes | route-system | 65 (13) | -16.9 [-35.4, +1.5], 0.1602 | +$0.0043 [+$0.0034, +$0.0052] | +3.8 [+2.6, +4.9] | +149,521 [+115,322, +184,661] | +1,491 [+1,182, +1,821] | +131,893 [+100,604, +164,052] |
| hermes | route-startup | 65 (13) | -7.7 [-24.6, +9.2], 0.5000 | +$0.0038 [+$0.0031, +$0.0047] | +3.1 [+2.1, +4.3] | +128,179 [+96,281, +164,074] | +1,317 [+1,032, +1,631] | +111,737 [+81,616, +145,238] |
| hermes | route-hook | 65 (13) | -15.4 [-35.4, +6.2], 0.2539 | +$0.0042 [+$0.0033, +$0.0053] | +3.2 [+1.9, +4.5] | +137,915 [+95,432, +182,656] | +1,359 [+1,026, +1,698] | +118,916 [+79,124, +160,325] |
| hermes | route-skill | 65 (13) | +1.5 [-9.2, +13.8], 1.0000 | +$0.0003 [-$0.0003, +$0.0009] | +0.4 [-0.4, +1.2] | +9,697 [-19,521, +39,787] | +152 [-111, +452] | +8,893 [-19,368, +37,722] |
