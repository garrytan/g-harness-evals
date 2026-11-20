# Reproduce and inspect: 2026-11-06-prompt-archaeology-joint

The [report](report.md) stays as published; the data behind it is linked here.

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Raw trial data (private):** [2026-11-06-prompt-archaeology-joint.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-06-prompt-archaeology-joint/2026-11-06-prompt-archaeology-joint.manifest.json), sha256 `d81a2e21a57469e5d30f5fdcb4613b66e1773ad6cfcef3c69b4f30f80597273c`. 47,963 files, 110.4 MB compressed in 1 part, covering probe/ and main/ in full (shards with VM logs and smoke, staged, merged), ship-322 ship artifacts, PR diffs, rehearsal logs and thread helper scripts. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- **Raw trial data (private):** [2026-11-06-prompt-archaeology-joint--sqlite-wal.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-06-prompt-archaeology-joint--sqlite-wal/2026-11-06-prompt-archaeology-joint--sqlite-wal.manifest.json), sha256 `0c7e4daf2cb9c21fd207dea27300f6f498633977ab36854b186bfb6c1017df70`. 494 files, 5.0 MB compressed in 1 part, covering SQLite write-ahead logs left out of 2026-11-06-prompt-archaeology-joint. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- **Trial bundle (public):** [2026-11-06-prompt-archaeology-joint.bundle.tar.gz](https://github.com/garrytan/g-harness-evals/releases/download/data-2026-11-06-prompt-archaeology-joint/2026-11-06-prompt-archaeology-joint.bundle.tar.gz), sha256 `bc4bf16dc21f5094f4fa8b5a177f641ac4958e64e9ffb97ba83e7c7985b371ef`. Check it with `bun scripts/bundle.ts verify <file> --sha256 <digest>` ([trial-bundle.md](../../trial-bundle.md)).
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->
