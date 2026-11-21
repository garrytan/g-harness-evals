# Filler drop list

**The filler is real rules files from public repositories. Every unit that touches a planted rule's topic is dropped before any text is planted.**

- A unit is a section under a matching heading, a code block, a list item with its indented lines, a table row or a paragraph. One matching line drops the whole unit.
- R1 to R6 are the planted rules' topics: changes files and file naming (R1); precheck, lint, format, check scripts and finishing steps (R2); tests (R3); commits, sign-off, git and push (R4); notes and looking things up before an edit (R5); diffs (R6). "network" is installs and the network. "blocks_one_turn" is a line that tells the agent to ask, confirm with or wait for a person, which a one-turn run with no one to answer cannot do. "missing_tool" is a line that needs a tool, tracker, service or project command the task image does not have (an issue tracker, an MCP server, docker compose, make targets).
- The other reasons drop text that is unsafe to plant: an at sign (Claude Code and Gemini CLI expand @path text), a link, an email address, a key-shaped string, a mention of a rules file by name, an HTML comment (Claude Code strips them from CLAUDE.md), a line that is mostly not English (under 80% of its letters A to Z, or at least 6 words with 2 or more Spanish, Portuguese, French, German or Italian function words and no English ones), or a heading that repeats a planted section's heading.
- Text before a file's first heading is dropped too, because it has no heading to sit under. It is listed as "preamble".
- A rung counts the drops from every section it reaches in the seeded order, including the section it cuts. The full list, with each unit's text, is in [drop-list.json](drop-list.json). Rebuild with `bun scripts/rules-at-scale/corpus/build-corpus.ts build`.

## Counts per rung

A unit dropped for several reasons counts once under each reason, so a row can sum to more than its "units dropped" column.

| rung | sections reached | units dropped | lines dropped | R1 | R2 | R3 | R4 | R5 | R6 | network | blocks_one_turn | missing_tool | at_sign | link | email | key | rules_file | html_comment | not_english | heading_clash |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| b8k (8192 bytes) | 26 | 110 | 259 | 28 | 17 | 7 | 28 | 7 | 3 | 14 | 0 | 12 | 1 | 18 | 0 | 0 | 5 | 0 | 2 | 0 |
| b28k (28672 bytes) | 103 | 338 | 957 | 36 | 95 | 62 | 80 | 24 | 5 | 46 | 4 | 67 | 3 | 31 | 0 | 0 | 9 | 0 | 4 | 0 |
| b80k (81920 bytes) | 288 | 868 | 3241 | 49 | 235 | 175 | 171 | 142 | 15 | 111 | 22 | 180 | 24 | 57 | 2 | 1 | 23 | 20 | 9 | 0 |
| b160k (163840 bytes) | 571 | 1686 | 6205 | 69 | 463 | 297 | 309 | 249 | 25 | 228 | 64 | 401 | 37 | 114 | 3 | 1 | 60 | 41 | 48 | 0 |
| qm-top (98000 characters) | 367 | 1060 | 4053 | 53 | 270 | 201 | 198 | 174 | 17 | 132 | 34 | 231 | 25 | 87 | 2 | 1 | 31 | 20 | 26 | 0 |
| whole corpus | 805 | 2634 | 8770 | 81 | 655 | 469 | 439 | 349 | 32 | 363 | 91 | 639 | 55 | 158 | 3 | 1 | 99 | 81 | 240 | 0 |

The whole-corpus row includes 8 preambles (51 lines), which no rung counts.

## Kept and dropped per source

| source | licence | file bytes | kept bytes | units dropped |
|---|---|---|---|---|
| s01-shenseanchen--waku-agent | MIT | 6518 | 852 | 23 |
| s02-agentlas-ai--agentlas-os | Apache-2.0 | 2730 | 427 | 10 |
| s03-enuno--unifi-mcp-server | Apache-2.0 | 19926 | 4068 | 86 |
| s04-haddocking--haddock3 | Apache-2.0 | 8961 | 3686 | 25 |
| s05-leonmuscoden--letterfeed | MIT | 22194 | 9199 | 38 |
| s06-stefanbschneider--mobile-env | MIT | 6379 | 1664 | 18 |
| s07-curiosity-ai-bv--localocr | MIT | 3045 | 2007 | 9 |
| s08-1password--scam | MIT | 12841 | 5446 | 53 |
| s09-peteromallet--arnold | Apache-2.0 | 32928 | 7287 | 76 |
| s10-jasonanewcoder--abaqus_skills | MIT | 11293 | 2687 | 29 |
| s11-leadmagic--gtm-skills | MIT | 2065 | 82 | 32 |
| s12-azure-samples--art-voice-agent-accelerator | MIT | 5406 | 2791 | 20 |
| s13-vichannnnn--holy-grail | MIT | 5268 | 329 | 27 |
| s14-kequach--uniqlo-sales-alerter | MIT | 4850 | 1805 | 9 |
| s15-omoinoki--sekaisync | MIT | 12677 | 1423 | 40 |
| s16-urml-mars--urml | Apache-2.0 | 23111 | 5350 | 68 |
| s17-zambav--comfyui-agent-toolkit | MIT | 7393 | 2466 | 27 |
| s18-gabrielmoreira--agent-skills-mirror | MIT | 1693 | 959 | 7 |
| s19-emersonfelipesp--netbox-sdk | Apache-2.0 | 9654 | 1207 | 14 |
| s20-abhichandra21--promptheus | MIT | 5659 | 2901 | 19 |
| s21-jamesbrink--mcp-coroot | MIT | 7695 | 3150 | 15 |
| s22-sidprasad--spytial | MIT | 7979 | 1719 | 26 |
| s23-adrianoamalfi--hassos-addons | Apache-2.0 | 3774 | 1256 | 6 |
| s24-excatt--superclaude-plusplus | MIT | 3416 | 1449 | 13 |
| s25-mcp-builder-ai--mcpbuilder-ai | Apache-2.0 | 3544 | 1172 | 10 |
| s26-fry69--altq.net | MIT | 2908 | 1454 | 12 |
| s27-python-discord--king-arthur | MIT | 3607 | 3068 | 4 |
| s28-bernierllc--agents-environment-config | MIT | 4831 | 2014 | 15 |
| s29-tabato--viral-ops | MIT | 1691 | 1327 | 4 |
| s30-dancing-bear-show--dancing-bear | MIT | 1593 | 990 | 4 |
| s31-gkmngrgn--rayt | MIT | 2430 | 1674 | 8 |
| s32-lesleslie--jinja2-async-environment | BSD-3-Clause | 2387 | 1008 | 9 |
| s33-dcurlewis--ai-context-system | MIT | 6308 | 3619 | 15 |
| s34-pedrogiudice--lex-vector | MIT | 5673 | 1824 | 32 |
| s35-aelaguiz--doctrine | MIT | 3190 | 2724 | 13 |
| s36-trundleyrg--financialagent | MIT | 12076 | 823 | 50 |
| s37-adamkrysztopa--dependence-forecastability | MIT | 2631 | 1401 | 9 |
| s38-bytechminds--meritrankeragent | MIT | 12440 | 3627 | 42 |
| s39-lucasmind--nodeava-workshop-public | Apache-2.0 | 9623 | 4233 | 36 |
| s40-matt82198--aesop | MIT | 3676 | 1046 | 17 |
| s41-bitzone910--trace-opsd | Apache-2.0 | 3930 | 1987 | 22 |
| s42-sergeiwallace--ai-cli-utils | MIT | 4556 | 1392 | 15 |
| s43-luluthehungrycat--edgmes-agent | MIT | 10381 | 2350 | 12 |
| s44-joshspeagle--frasian_tilting | MIT | 39473 | 5058 | 77 |
| s45-lyskawson--acs2-rust | MIT | 8241 | 1399 | 21 |
| s46-marrinexyq-droid--jchatmind | MIT | 1827 | 1291 | 5 |
| s47-nicobako--when-exactly | MIT | 2957 | 1972 | 6 |
| s48-oliffur--gamenightrankings | MIT | 4447 | 1586 | 12 |
| s49-modem7--claude-config-sync | MIT | 5262 | 413 | 18 |
| s50-brujack--math | MIT | 5512 | 1834 | 14 |
| s51-cerebrocybersolutions--libro | Apache-2.0 | 2519 | 1342 | 8 |
| s52-brunov21--codetide | Apache-2.0 | 2773 | 1276 | 12 |
| s53-arjunsahlot--artbutsports | MIT | 23199 | 8751 | 30 |
| s54-authrain-cloud-abdullahformuli--arnold | Apache-2.0 | 32928 | 7287 | 76 |
| s55-eric-hahha--trafficlab-project | MIT | 31514 | 3207 | 170 |
| s56-nmpacheco--llm-agent-tutor | MIT | 5232 | 636 | 16 |
| s57-radiann-kswg--7400seriescollection | MIT | 32391 | 854 | 25 |
| s58-roost-infra--dsalpha | Apache-2.0 | 22977 | 2637 | 34 |
| s59-tyler-keith-thompson--projecttemplate | Apache-2.0 | 51819 | 3796 | 173 |
| s60-benedikt-haug--hermes-agent | MIT | 10381 | 2350 | 12 |
| s61-bobbyzhong10--empirical-workflow-kit | MIT | 5145 | 485 | 18 |
| s62-bossjones--boss-ai-monitoring | MIT | 8705 | 1574 | 26 |
| s63-castilloglenn--rl-agent-for-fun | MIT | 9293 | 663 | 12 |
| s64-chinthana-w--s-imply | MIT | 7044 | 4519 | 23 |
| s65-classiccottrell--agentic_light | Apache-2.0 | 17558 | 3425 | 37 |
| s66-davidsheffield--workshopcode | MIT | 1759 | 1648 | 1 |
| s67-jpoutrin--portman-cli | MIT | 4884 | 1619 | 28 |
| s68-mriffle--parquet-to-tsv | Apache-2.0 | 11333 | 2969 | 30 |
| s69-msjoshlopez--systems-skills | MIT | 4631 | 1573 | 19 |
| s70-pkuppens--production-agentic-rag-course-mine | MIT | 9720 | 2013 | 21 |
| s71-pmackowka--shift-left-data-quality-pydantic | MIT | 13371 | 3493 | 40 |
| s72-pojung-lu--read_excels | MIT | 8094 | 4688 | 28 |
| s73-review-bench--jacobpevans_ansible-splunk | MIT | 3107 | 1037 | 13 |
| s74-shigechika--zapi-mcp | MIT | 5776 | 837 | 12 |
| s75-tzehern0703--floodlens | MIT | 16452 | 8694 | 23 |
| s76-andomo3--flecto-shade | MIT | 6332 | 3526 | 16 |
| s77-ladiossopp--art-voice-agent-accelerator | MIT | 5406 | 2791 | 20 |
| s78-messiahheedia--quickcommand | MIT | 1597 | 1318 | 2 |
| s79-peaceful-weapon--art-voice-agent-accelerator-s | MIT | 5406 | 2791 | 20 |
| s80-pir2square--art-voice-agent-accelerator | MIT | 5406 | 2791 | 20 |
| s81-premthakkar8--daily-briefing-bot | MIT | 1624 | 1066 | 3 |
| s82-iofficeai--aionui | Apache-2.0 | 7768 | 1135 | 46 |
| s83-securego--gosec | Apache-2.0 | 1593 | 860 | 7 |
| s84-orneryd--ui-grid | MIT | 2589 | 870 | 6 |
| s85-walkccc--clrs | MIT | 3149 | 851 | 6 |
| s86-labex-labs--python-cheatsheet | MIT | 3911 | 3069 | 14 |
| s87-marcobambini--gravity | MIT | 3764 | 1625 | 8 |
| s88-pulumi--kubespy | Apache-2.0 | 6545 | 530 | 25 |
| s89-x-wei--flutter_catalog | MIT | 3093 | 1906 | 14 |
| s90-tddworks--claudebar | Apache-2.0 | 11481 | 1417 | 36 |
| s91-apache--impala | Apache-2.0 | 4217 | 3024 | 4 |
| s92-icflorescu--mantine-datatable | MIT | 5329 | 2443 | 30 |
| s93-johnpapa--vscode-peacock | MIT | 3723 | 949 | 17 |
| s94-paloaltonetworks--docusaurus-openapi-docs | MIT | 7952 | 1783 | 56 |
| s95-danielpan12--jobhuntbot | MIT | 1535 | 233 | 6 |
| s96-egraphs-good--egglog | MIT | 1632 | 579 | 7 |
| s97-sverweij--state-machine-cat | MIT | 3563 | 1338 | 11 |
| s98-roznoshchik--lurnby | BSD-3-Clause | 10102 | 5390 | 42 |
| s99-uxlfoundation--onedal | Apache-2.0 | 4781 | 3515 | 12 |
| s100-sixhq--overture | MIT | 3671 | 1885 | 19 |
| s101-macterm--macterm | MIT | 6043 | 1288 | 9 |
| s102-browseroperator--browser-operator-core | BSD-3-Clause | 8247 | 2436 | 22 |
| s103-kubernetes-sigs--cluster-api-provider-openstack | Apache-2.0 | 8440 | 860 | 66 |
| s104-thomaskioko--tv-maniac | Apache-2.0 | 5416 | 1754 | 31 |

Kept filler in total: 475 sections, 240892 bytes.
