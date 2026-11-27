# Reproduce and inspect: 2026-11-24-gbrain-first-wow

The [report](report.md) stays as published; the data behind it is linked here.

## Pins

- **Run commit:** `6384ca3e9be9a838a75d818eca0896e3084844f2`, on this run's results branch, which lands on main as a merge commit so the commit stays reachable. Every shard ran from it (`results/shards/<shard>/shard.json`).
- **gbrain:** `c341d40de3e5f7cacecb064825655ce926d877f8`, package 0.60.774.0, installed with `bun install --frozen-lockfile`; every gbrain image records `deps_sha256 041772cb259411986e0a0115534dd413c361a42bc05407f446d596d7cb440101` (`results/shards/<shard>/first-wow-images.ndjson`).
- **Images:** each shard's image ids are in its `shard.json` and in `results/merged/shards.json`.
- **Keys:** the counted run used `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `PARTICLE_API_KEY` through the metering proxy; every command below is keyless.

## Commands, from the repository root

```sh
# Why-null breakdown, from the committed trial list only (keyless, under a second)
python3 scripts/gbrain-first-wow/why-null.py docs/benchmarks/2026-11-24-gbrain-first-wow/results/merged/trials.jsonl --out why-null.json

# Frozen analysis: needs the seven shard folders from the raw archive below (keyless, about 10 seconds)
git worktree add ../he-6384ca3e 6384ca3e9be9a838a75d818eca0896e3084844f2
cd ../he-6384ca3e
bun scripts/gbrain-first-wow/analyze.ts <raw>/s1-qm/results <raw>/s2-qm-sol-plain/results <raw>/s2b-qm-particle/results \
  <raw>/s3-cc/results <raw>/s4-cc/results <raw>/s5-codex/results <raw>/s6-codex/results --json final.json --md final.md

# Half-way looks: the same command with --interim; the 13:48 UTC look also passed
# --prereg docs/benchmarks/2026-11-24-gbrain-first-wow/interim-prereg-without-particle.json (deviations.md)
```

Run over the seven shard folders, the analysis gives the committed `final.json` with the same values; its `results_dirs` and the order of its `no_history` and `coding` lists differ, because the committed copy was run over one merged folder.

`results/merged/` was written by `scripts/merge-shards.ts` from copies of each shard's top-level files, without the trial folders (the controller lacked the disk to copy them a second time), so `shards.json` names those copies as each shard's source. The trial folders are in the raw archive.

- **Observed time:** about 10 hours from the first shard's start to the last shard's end, on seven standard-4 Ubicloud VMs, one trial at a time per VM.
- **Observed cost:** per-trial metered cost by arm is in the report; trials cost $0.015 to $0.214 each at list price.

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Raw trial data (private):** [gbrain-first-wow-2026-12.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-gbrain-first-wow-2026-12/gbrain-first-wow-2026-12.manifest.json), sha256 `2ee01ea2203ac09bb05e0e86a47e506ec9ab1653e46910e5f0bed66b769e825a`. 2,619,352 files, 6.4 GB compressed in 4 parts, covering the counted run: the seven shards (s1-qm, s2-qm-sol-plain, s2b-qm-particle, s3-cc, s4-cc, s5-codex, s6-codex), each with its controller logs, one-trial smoke, results, trial folders, harness state and gbrain databases. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->
