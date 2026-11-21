# How big are public AGENTS.md and CLAUDE.md files?

**Most public rules files are small, but a few percent already sit past a harness's cut.** In a sample of 962 files, 58 (4.7 to 7.7%) are longer than the 20,000 characters OpenClaw keeps whole, and 10 of 395 AGENTS.md files (1.4 to 4.6%) are longer than the 32,768 bytes Codex reads.

**GitHub's index counts tell the same story:** about 38,668 of 1,306,624 indexed AGENTS.md files are over 32,768 bytes.

Collected 2026-11-19 with no paid calls. Method and limits are at the end.

## The sample: files past each cut

Sizes are exact, from each file at the commit GitHub code search returned. Ranges are 95% Wilson intervals.

| cut | AGENTS.md (n=395) | CLAUDE.md (n=567) | both (n=962) |
|---|---|---|---|
| OpenClaw cuts each file past 20,000 characters (bootstrapMaxChars) | 21 (5.3%, 3.5 to 8%) | 37 (6.5%, 4.8 to 8.9%) | 58 (6%, 4.7 to 7.7%) |
| Codex keeps only the first 32,768 bytes (project_doc_max_bytes) | 10 (2.5%, 1.4 to 4.6%) | 20 (3.5%, 2.3 to 5.4%) | 30 (3.1%, 2.2 to 4.4%) |
| Claude Code warns past 40,000 characters (and still sends the whole file) | 6 (1.5%, 0.7 to 3.3%) | 16 (2.8%, 1.7 to 4.5%) | 22 (2.3%, 1.5 to 3.4%) |
| Hermes cuts past about 48,000 characters on a 200K-token window | 4 (1%, 0.4 to 2.6%) | 13 (2.3%, 1.3 to 3.9%) | 17 (1.8%, 1.1 to 2.8%) |

The cut applies to the file its harness reads: Codex, OpenClaw and Hermes read AGENTS.md, Claude Code reads CLAUDE.md. The other column shows how common such sizes are anyway.

## Typical sizes in the sample

| file | n | median bytes | 75th percentile | 90th percentile | 99th percentile | largest |
|---|---|---|---|---|---|---|
| AGENTS.md | 395 | 3,164 | 7,952 | 13,554 | 49,578 | 105,774 |
| CLAUDE.md | 567 | 3,968 | 8,961 | 17,047 | 69,128 | 205,132 |

## GitHub's index counts per size band

These are the total_count values GitHub code search reports for each size band (in bytes). They cover every indexed file, not just the sample, but GitHub rounds and estimates them.

| bytes | AGENTS.md | CLAUDE.md |
|---|---|---|
| 0 to 1,023 | 254,208 | 189,952 |
| 1,024 to 2,047 | 193,024 | 89,344 |
| 2,048 to 4,095 | 272,896 | 199,680 |
| 4,096 to 8,191 | 266,240 | 238,592 |
| 8,192 to 16,383 | 190,464 | 182,016 |
| 16,384 to 20,000 | 32,256 | 26,176 |
| 20,001 to 32,768 | 47,488 | 43,264 |
| 32,769 to 40,000 | 10,576 | 10,544 |
| 40,001 to 48,000 | 6,576 | 6,000 |
| 48,001 to 65,535 | 8,864 | 7,024 |
| 65,536 to 131,071 | 10,272 | 7,840 |
| 131,072 and up | 2,380 | 3,044 |
| all (unfiltered query) | 1,306,624 | 1,093,632 |

- AGENTS.md: over 20,000 bytes: 86,156 (6.7% of the 1,295,244 in the bands); over 32,768 bytes: 38,668 (3% of the 1,295,244 in the bands); over 40,000 bytes: 28,092 (2.2% of the 1,295,244 in the bands); over 48,000 bytes: 21,516 (1.7% of the 1,295,244 in the bands).
- CLAUDE.md: over 20,000 bytes: 77,716 (7.7% of the 1,003,476 in the bands); over 32,768 bytes: 34,452 (3.4% of the 1,003,476 in the bands); over 40,000 bytes: 23,908 (2.4% of the 1,003,476 in the bands); over 48,000 bytes: 17,908 (1.8% of the 1,003,476 in the bands).

## Method and limits

- **Sample:** the first pages of GitHub code search for `filename:AGENTS.md` and `filename:CLAUDE.md` (100 a page, 6 pages each), kept only when the file name matches exactly, each file fetched from raw.githubusercontent.com at the commit code search names. Code search ranks by its own relevance, so this is not a random sample; it leans toward repositories GitHub ranks highly.
- **Index counts:** one code search per size band, reading total_count. GitHub estimates these totals, indexes only default branches and files under 384 KB, and counts every path, so a repository can appear more than once. The band counts do not sum exactly to the unfiltered total.
- **Near names:** `filename:` search also matches names such as agents.mdx. The sample drops them (67 of 1029 AGENTS.md and CLAUDE.md hits); the index counts cannot, so they run a little high.
- **Characters versus bytes:** OpenClaw, Hermes and Claude Code count characters; Codex counts bytes. The sample uses each file's real character count; the index bands are bytes only, so they slightly overstate character-based cuts for files with non-ASCII text.
- **Hermes:** its cut scales with the model's context window (about 48,000 characters at 200K tokens, 240,000 at 1M); 48,000 is the 200K case.
- Rebuild: `bun scripts/rules-at-scale/corpus/crawl.ts --cache <dir>` then `bun scripts/rules-at-scale/sizes/build-sizes.ts --cache <dir>`. Every row is in [sizes.json](sizes.json).
