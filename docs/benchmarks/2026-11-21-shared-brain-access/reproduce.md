# Reproduce and inspect: 2026-11-21-shared-brain-access

The [report](report.md) stays as published; the data behind it is linked here.

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Raw trial data (private):** [2026-11-21-shared-brain-access.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-21-shared-brain-access/2026-11-21-shared-brain-access.manifest.json), sha256 `9b5d53990a647ece223f93314278978c991176e758428f830d4c86f94a8b0e40`. 157,261 files, 342.3 MB compressed in 1 part, covering folder: run/ 28 arm shards (claude-code, codex, hermes, openclaw x opus/sol x gbrain arms) plus two set-aside attempts, with trials, gbrain installs, smoke, proxy logs, ledgers; the 205 MB gbrain release binary left out. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->

## Rerun the merge and the analysis

1. Fetch and extract the raw archive above into `<raw>`. It holds each shard's folder under `run/<shard>/`.
2. From commit `4d1ee96638fb587c8cc951fcf980d50869737822` (the merge tool with `--amendment`), or from main after this run's results merged, merge the 28 shards, first shard first:

   ```
   args="--shard claude-code-opus-none=<raw>/run/claude-code-opus-none/results"
   for s in $(ls <raw>/run | grep -v -e smokefail -e vmidle -e '^claude-code-opus-none$'); do args="$args --shard $s=<raw>/run/$s/results"; done
   bun scripts/merge-shards.ts --out <merged> $args --partial --amendment 8f599947825f9f9d24c3794e8faa563f1a72b75b
   ```

   Expect "Merged 28 shard(s) ... 28 cells, 1572 trials", the four OpenClaw Sol shards listed under the amendment, and 0 trials unstarted.
3. From main (it holds harness-evals#568, which the analysis needs), run `bun scripts/shared-brain-access.ts --results <merged>`. Expect exit 0, 52 excluded trials and output identical to [analysis.txt](analysis.txt).

The two set-aside folders in the archive (`codex-sol-gbrain-installer-open.smokefail-1` and `codex-sol-gbrain-told-open.vmidle-1`) ran no counted trial and are not merged.
