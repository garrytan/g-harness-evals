# Reproduce and inspect: 2026-11-01-prompt-archaeology

The [report](report.md) stays as published; the data behind it is linked here.

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Raw trial data (private):** [2026-11-01-prompt-archaeology.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-01-prompt-archaeology/2026-11-01-prompt-archaeology.manifest.json), sha256 `e0feb9bf7100c4b9275dbb224f6861fab7ee5d87f407f8e3baaff9a0a852502d`. 107,360 files, 102.8 MB compressed in 1 part, covering all 15 shard dests (results, smoke, VM and fanout logs, ledgers, proxy logs), attempts/ (cx-a pre-resume, he-c launch3 try1), merged summaries and shard-named copies. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- **Raw trial data (private):** [2026-11-01-prompt-archaeology--sqlite-wal.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-01-prompt-archaeology--sqlite-wal/2026-11-01-prompt-archaeology--sqlite-wal.manifest.json), sha256 `3ced2c04ba66e67b6b2388af3f79327b1fa42f2d809839968f76eecf01361088`. 2,799 files, 20.9 MB compressed in 1 part, covering SQLite write-ahead logs left out of 2026-11-01-prompt-archaeology. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- **Trial bundle (public):** [2026-11-01-prompt-archaeology.bundle.tar.gz](https://github.com/garrytan/g-harness-evals/releases/download/data-2026-11-01-prompt-archaeology/2026-11-01-prompt-archaeology.bundle.tar.gz), sha256 `0082f193d7d651d425830f7eade45669b320b36b50ab06fb69500b8d7f53d711`. Check it with `bun scripts/bundle.ts verify <file> --sha256 <digest>` ([trial-bundle.md](../../trial-bundle.md)).
- **Not archived in full:** One copy of the raw data was archived in full. A second machine from the same run belongs to another account and could not be reached, so anything it holds beyond that copy is not archived.
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->
