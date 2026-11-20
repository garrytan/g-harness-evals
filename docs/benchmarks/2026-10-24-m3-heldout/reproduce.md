# Reproduce and inspect: m3-heldout-2026-10

The [report](report.md) is hash-pinned by its preregistration, so the commands to recheck it live here.

- **Trial bundle:** [2026-10-24-m3-heldout.bundle.tar.gz](https://github.com/garrytan/g-harness-evals/releases/download/data-2026-10-24-m3-heldout/2026-10-24-m3-heldout.bundle.tar.gz) ([release](https://github.com/garrytan/g-harness-evals/releases/tag/data-2026-10-24-m3-heldout)), sha256 `1d39a3e5b97fcf85f6c47a1865ca0235b9dbaf1c06724f5d91c123ccf186c78b`. It holds `prereg.json` and the committed `results/` of this run, byte for byte, plus the analyzers' expected output ([trial-bundle.md](../../trial-bundle.md)).
- **Commit to rerun from:** `f4dc3dff41f1edc39beedfbe71b50cb0245209d7` on the public copy (the bundle's `rerun_commit`).

```sh
git clone https://github.com/garrytan/g-harness-evals && cd g-harness-evals
git checkout f4dc3dff41f1edc39beedfbe71b50cb0245209d7
bun install --frozen-lockfile
curl -sSLf -o ../bundle.tar.gz https://github.com/garrytan/g-harness-evals/releases/download/data-2026-10-24-m3-heldout/2026-10-24-m3-heldout.bundle.tar.gz
D=1d39a3e5b97fcf85f6c47a1865ca0235b9dbaf1c06724f5d91c123ccf186c78b

bun scripts/bundle.ts verify ../bundle.tar.gz --sha256 $D --rebuild                  # free: the bundle is what the repository holds
bun scripts/replicate.ts --bundle ../bundle.tar.gz --sha256 $D --reanalyze            # free: recompute the tables
bun scripts/replicate.ts --bundle ../bundle.tar.gz --sha256 $D --estimate-only        # free: price a rerun
read -rs ANTHROPIC_API_KEY && export ANTHROPIC_API_KEY
bun scripts/replicate.ts --bundle ../bundle.tar.gz --sha256 $D --cell openclaw-sonnet-mu-heldout --max-usd 6 --yes   # paid, about $3.50
```

- **Last rerun (2026-11-19):** 15 of 20 passed against 77 of 100 published, band 12 to 17, `WITHIN BAND`, $3.00 spent. Details: [replicate/m3-heldout-2026-10/](../../replicate/m3-heldout-2026-10/README.md).
- **What the rerun covers:** one cell's pass rate. The harness comparison in the report is rechecked by `--reanalyze`. QM cells are not rerun by this tool. How it works: [replicate.md](../../replicate.md).

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Trial bundle (public):** [2026-10-24-m3-heldout.bundle.tar.gz](https://github.com/garrytan/g-harness-evals/releases/download/data-2026-10-24-m3-heldout/2026-10-24-m3-heldout.bundle.tar.gz), sha256 `1d39a3e5b97fcf85f6c47a1865ca0235b9dbaf1c06724f5d91c123ccf186c78b`. Check it with `bun scripts/bundle.ts verify <file> --sha256 <digest>` ([trial-bundle.md](../../trial-bundle.md)).
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->
