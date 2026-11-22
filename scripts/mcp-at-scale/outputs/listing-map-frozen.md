# Keyless MCP listing map at the frozen versions (2026-11-19)

**What this shows.** For each harness and catalog size (rung), where each MCP tool sits in the first request the harness sends to the model: with its full schema, as a name plus description, as a name only, only as its server's name, or absent. This is a keyless run against a fake model, so it costs nothing and scores nothing.

- Every one of the 52 trials installed the frozen version (Claude Code by binary sha256, the others by their --version output, Hermes by its pinned commit): agents.py checks it inside the container and stops the trial on a mismatch (HE-MCP-050), and no trial had INFRA. The 32 catalog rows also carry that check's output as `install_check`; the 20 gbrain rows re-measured on 2026-11-22 do not, because listing-map.ts does not write it. No trial had INFRA, and every expected server connected except in Pi codemode and Pi deferred. Those two connect MCP servers on first use, so a one-word listing turn connects none.
- Versions: claude-code 2.1.328, codex 0.170.0, hermes v2026.9.24, openclaw 2026.11.5, pi 1.5.2, gbrain v0.60.763.0 (scripts/mcp-at-scale/versions.json).
- QM is skipped (no Harbor class yet). Gemini CLI is not part of this eval and was not run.

## Catalog servers, rungs 30 to 300

| Harness cell | Rung | Tools | First request (est. tokens) | full_schema | description | name_only | server_only | absent | Connected |
|---|---|---|---|---|---|---|---|---|---|
| claude-code 2.1.328 | 30 | 30 | 14,579 | 0 | 0 | 30 | 0 | 0 | 6/6 |
| claude-code 2.1.328 | 75 | 74 | 15,080 | 0 | 0 | 74 | 0 | 0 | 8/8 |
| claude-code 2.1.328 | 150 | 145 | 16,274 | 0 | 0 | 145 | 0 | 0 | 14/14 |
| claude-code 2.1.328 | 300 | 303 | 18,813 | 0 | 0 | 295 | 8 | 0 | 24/24 |
| claude-code-no-tool-search 2.1.328 | 30 | 30 | 34,217 | 30 | 0 | 0 | 0 | 0 | 6/6 |
| claude-code-no-tool-search 2.1.328 | 75 | 74 | 40,123 | 74 | 0 | 0 | 0 | 0 | 8/8 |
| claude-code-no-tool-search 2.1.328 | 150 | 145 | 68,871 | 145 | 0 | 0 | 0 | 0 | 14/14 |
| claude-code-no-tool-search 2.1.328 | 300 | 303 | 127,272 | 303 | 0 | 0 | 0 | 0 | 24/24 |
| codex 0.170.0 | 30 | 30 | 13,857 | 0 | 0 | 0 | 30 | 0 | 6/6 |
| codex 0.170.0 | 75 | 74 | 13,887 | 0 | 0 | 0 | 74 | 0 | 8/8 |
| codex 0.170.0 | 150 | 145 | 13,982 | 0 | 0 | 0 | 145 | 0 | 14/14 |
| codex 0.170.0 | 300 | 303 | 14,167 | 0 | 0 | 0 | 303 | 0 | 24/24 |
| hermes v2026.9.24 | 30 | 30 | 11,755 | 0 | 30 | 0 | 0 | 0 | 6/6 |
| hermes v2026.9.24 | 75 | 74 | 12,989 | 0 | 71 | 3 | 0 | 0 | 8/8 |
| hermes v2026.9.24 | 150 | 145 | 12,315 | 0 | 0 | 145 | 0 | 0 | 14/14 |
| hermes v2026.9.24 | 300 | 303 | 13,847 | 0 | 0 | 295 | 8 | 0 | 24/24 |
| openclaw 2026.11.5 | 30 | 30 | 18,784 | 0 | 0 | 30 | 0 | 0 | 6/6 |
| openclaw 2026.11.5 | 75 | 74 | 18,839 | 0 | 0 | 31 | 43 | 0 | 8/8 |
| openclaw 2026.11.5 | 150 | 145 | 19,139 | 0 | 0 | 54 | 91 | 0 | 14/14 |
| openclaw 2026.11.5 | 300 | 303 | 19,244 | 0 | 0 | 42 | 261 | 0 | 24/24 |
| pi-codemode 1.5.2 | 30 | 30 | 2,011 | 0 | 0 | 0 | 30 | 0 | 0/6 |
| pi-codemode 1.5.2 | 75 | 74 | 2,026 | 0 | 0 | 0 | 74 | 0 | 0/8 |
| pi-codemode 1.5.2 | 150 | 145 | 2,069 | 0 | 0 | 0 | 145 | 0 | 0/14 |
| pi-codemode 1.5.2 | 300 | 303 | 2,138 | 0 | 0 | 0 | 303 | 0 | 0/24 |
| pi-deferred 1.5.2 | 30 | 30 | 1,661 | 0 | 0 | 0 | 30 | 0 | 0/6 |
| pi-deferred 1.5.2 | 75 | 74 | 1,678 | 0 | 0 | 0 | 74 | 0 | 0/8 |
| pi-deferred 1.5.2 | 150 | 145 | 1,726 | 0 | 0 | 0 | 145 | 0 | 0/14 |
| pi-deferred 1.5.2 | 300 | 303 | 1,802 | 0 | 0 | 0 | 303 | 0 | 0/24 |
| pi-direct 1.5.2 | 30 | 30 | 14,694 | 30 | 0 | 0 | 0 | 0 | 6/6 |
| pi-direct 1.5.2 | 75 | 74 | 20,480 | 74 | 0 | 0 | 0 | 0 | 8/8 |
| pi-direct 1.5.2 | 150 | 145 | 49,681 | 145 | 0 | 0 | 0 | 0 | 14/14 |
| pi-direct 1.5.2 | 300 | 303 | 107,864 | 303 | 0 | 0 | 0 | 0 | 24/24 |

## gbrain at rung 150 (v0.60.763.0 image, he-mcp-gbrain:0.60.763.0-e2f532b25bc5)

Counts are for gbrain's own tools; the catalog servers at rung 150 sit as in the table above. Measured 2026-11-22.

| Harness cell | gbrain surface | gbrain tools | First request (est. tokens) | full_schema | description | name_only | server_only | absent | Connected |
|---|---|---|---|---|---|---|---|---|---|
| claude-code 2.1.328 | full | 173 | 18,522 | 0 | 0 | 173 | 0 | 0 | 15/15 |
| claude-code 2.1.328 | starter | 36 | 17,552 | 0 | 0 | 36 | 0 | 0 | 15/15 |
| claude-code 2.1.328 | verbs | 173 | 16,985 | 0 | 0 | 10 | 163 | 0 | 15/15 |
| claude-code 2.1.328 | registered | 36 | 16,984 | 0 | 0 | 9 | 27 | 0 | 15/15 |
| codex 0.170.0 | full | 173 | 15,343 | 0 | 0 | 0 | 0 | 173 | 15/15 |
| codex 0.170.0 | starter | 36 | 15,343 | 0 | 0 | 0 | 0 | 36 | 15/15 |
| codex 0.170.0 | verbs | 173 | 15,343 | 0 | 0 | 0 | 0 | 173 | 15/15 |
| codex 0.170.0 | registered | 36 | 15,343 | 0 | 0 | 0 | 0 | 36 | 15/15 |
| hermes v2026.9.24 | full | 173 | 13,547 | 0 | 0 | 173 | 0 | 0 | 15/15 |
| hermes v2026.9.24 | starter | 36 | 12,576 | 0 | 0 | 36 | 0 | 0 | 15/15 |
| hermes v2026.9.24 | verbs | 173 | 12,380 | 0 | 0 | 8 | 165 | 0 | 15/15 |
| hermes v2026.9.24 | registered | 36 | 12,380 | 0 | 0 | 8 | 28 | 0 | 15/15 |
| openclaw 2026.11.5 | full | 173 | 19,150 | 0 | 0 | 0 | 173 | 0 | 15/15 |
| openclaw 2026.11.5 | starter | 36 | 19,150 | 0 | 0 | 0 | 36 | 0 | 15/15 |
| openclaw 2026.11.5 | verbs | 173 | 19,220 | 0 | 0 | 8 | 165 | 0 | 15/15 |
| openclaw 2026.11.5 | registered | 36 | 19,220 | 0 | 0 | 8 | 28 | 0 | 15/15 |
| pi-codemode 1.5.2 | full | 173 | 2,076 | 0 | 0 | 0 | 173 | 0 | 15/15 |
| pi-codemode 1.5.2 | starter | 36 | 2,076 | 0 | 0 | 0 | 36 | 0 | 15/15 |
| pi-codemode 1.5.2 | verbs | 173 | 2,076 | 0 | 0 | 0 | 173 | 0 | 15/15 |
| pi-codemode 1.5.2 | registered | 36 | 2,076 | 0 | 0 | 0 | 36 | 0 | 15/15 |

gbrain v0.60.763.0 lists the same tool names, counts and server instructions as v0.60.747.0 on every surface (full 173, starter 36, verbs 8, as registered 8), and its setup dry-runs are unchanged; two descriptions on the full surface changed (query's autocut parameter, and whois now also matching phone numbers). Every place count matches the v0.60.747.0 map. In the first run at 3 cells at once on a 2-core machine, all four Claude Code cells ended their turn before gbrain answered initialize (gbrain not connected); a rerun of those four at one cell at a time connected 15/15 with the counts above, the same counts as v0.60.747.0. This is the same timing effect as an earlier v0.60.745.0 map, not a gbrain change. Codex's first request is about 1,400 estimated tokens larger than in the v0.60.747.0 run (15,343 against 13,982) with gbrain absent in both; the Codex cells moved from GPT-6.1 Sol to GPT-6.2 Sol between the two runs.

Earlier: gbrain v0.60.747.0 listed the same tools, schemas and instructions as v0.60.745.0 and v0.60.743.0 on every surface.

Data: listing-map-frozen.json beside this file. Trial directories stay on the run machine.
