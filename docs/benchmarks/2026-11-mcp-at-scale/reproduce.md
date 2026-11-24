# Reproduce and inspect: 2026-11-mcp-at-scale

The [report](report.md) stays as published; the data behind it is linked here.

## Rebuild the analysis

From the repository root, with Bun:

```sh
R=docs/benchmarks/2026-11-mcp-at-scale
bun scripts/mcp-at-scale/analysis/analyze.ts --trials $R/results/trials.jsonl \
  --sets $R/results/sets/set-r.jsonl $R/results/sets/set-t.jsonl $R/results/sets/set-g.jsonl \
  --interim-state $R/results/look/interim-state.json --margins $R/margins.json --out /tmp/mcp-analysis
```

`bun run verify --run 2026-11-mcp-at-scale` does the same and compares every number with the committed [analysis.md](results/analysis/analysis.md) and analysis.json.

The exploratory gbrain reading on the 65 passable requests:

```sh
python3 $R/results/exploratory/gbrain-extra.py --inputs /tmp/mcp-g65
bun scripts/mcp-at-scale/analysis/analyze.ts --trials /tmp/mcp-g65/trials.jsonl \
  --sets $R/results/sets/set-r.jsonl $R/results/sets/set-t.jsonl /tmp/mcp-g65/set-g-confirmable.jsonl \
  --exploratory --margins $R/margins.json --out /tmp/mcp-g65/analysis
```

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Raw trial data (private):** [2026-11-mcp-at-scale--run.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-mcp-at-scale--run/2026-11-mcp-at-scale--run.manifest.json), sha256 `ab9f1d2d4ee9ad0cfc9809c58e6f9d16cfbae345a21e0e4ef89cb75cffc2ed0f`. 634,850 files, 332.1 MB compressed in 1 part, covering counted run: all 12 shards in both phases (trial jobs with transcripts, fake-server and gbrain relay logs, proxy usage, ledgers, accounting, key scans and reviews, VM records, run logs), the phase 1 index and interim look, the merged trials and final analysis, the spec build records and the launch claims. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->
