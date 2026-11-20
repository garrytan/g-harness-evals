# Raw data archive

**Every run whose results/ folder holds a trials.jsonl has an entry in [the archive index](archive/index.json), and its reproduce page names its archives with their sha256, or says why it has none.** The committed receipts under each run's results/ folder rebuild the published numbers (`bun run verify`). The raw data behind them (agent transcripts, metering-proxy captures, trial workspaces, grader inputs and outputs, shard logs) is too large and too sensitive for git, so it goes into an archive instead.

- **Private raw archive:** one per run (or per machine that held part of a run), as GitHub release assets on the private working repository, release tag `raw-<archive id>`.
- **Public trial bundle:** the run's committed receipts as a [trial bundle](trial-bundle.md), as GitHub release assets on the public repository [garrytan/g-harness-evals](https://github.com/garrytan/g-harness-evals), release tag `data-<run folder>`. This is what [replicate.md](replicate.md) reruns from.
- **The link:** each run folder has a `reproduce.md` page beside its report with a "Data archive" section, written from [archive/index.json](archive/index.json) by `bun scripts/archive/raw.ts link`, naming each archive with its sha256. The [reports index](reports-index.md) links it as "(reproduce)". It sits beside the report, not in it, because most reports are hash-pinned by their preregistration.

## Why this store

- **GitHub release assets cost nothing per month.** GitHub does not bill storage or download bandwidth for release assets. The limit is 2 GiB per file, so archives are split into parts of 1,900 MiB.
- **No new account or key.** The same GitHub access that pushes the repository uploads and downloads the assets, and a public asset downloads with no login.
- **Raw data stays private by default,** because it carries things we can't or shouldn't publish: the harness vendors' own system prompts inside every captured request (their text, not ours), held-out task text, and simulated-world credentials. Stripping removes keys and tokens, but a public raw transcript would still need a line-by-line read for vendor text, so we open a raw archive only with a stated reason, run by run.
- **The public tier holds only what is already public:** a trial bundle is built from the public repository's own committed files, so publishing it adds no new data.

## What is stripped before anything leaves a machine

`scripts/archive/raw.ts pack` runs on the machine that holds the data. Nothing is uploaded until it has run and `verify` has passed.

1. **Dropped whole, by path:** any folder or file whose name contains sealed, custody, heldout or held-out (so a held-out cell such as `openclaw-sonnet-mu-heldout/` goes too); age identities and ciphertext; SSH keys and runner VM access state (`ubi-state/`, `ubi-runner-state/`, `ubirun-*/`); credentials files (`.env`, `.netrc`, `hosts.yml`, secrets files); private real-user turns (Set R); SQLite shared-memory files (`*.sqlite-shm`, rebuilt on open; write-ahead logs are kept because they can hold committed rows). A file whose path itself matches a key pattern is dropped too, logged as `secret-in-path` with the path withheld. Symbolic links are never followed.
2. **Redacted, by pattern:** every token shape [scripts/publish-audit.ts](../scripts/publish-audit.ts) scans for, plus private keys, age identities, other GitHub and Hugging Face tokens, Basic auth headers, `*_API_KEY=`, `*_TOKEN=` and similar assignments, auth headers in captured requests, the runner's per-trial run tokens, and named personal data. A text file gets `[REDACTED:<pattern>]` in place of each hit; a binary file gets the same number of `X` characters, so its structure survives. A plain file over 1 GiB is scanned in 64 MiB chunks and is never redacted: on any hit it is dropped whole, as `secret-in-large-file`.
3. **Expanded or dropped:** a tarball inside the data (`.tar`, `.tar.gz`, `.tgz`, `.tar.zst`) is expanded and stripped like everything else with `--expand-archives`; without that flag it is dropped as `unexpanded-archive`, and one that tar can't read is dropped as `unreadable-archive`. A `.gz` or `.zst` file of up to 1 GiB is decompressed, stripped and stored under its name without the suffix, and if it turns out to hold a tar, that tar is expanded the same way. It is dropped as `compressed-unscannable` when it is over 1 GiB, decompresses to more than 1 GiB or fails to decompress (a failed zstd counts here), and as `compressed-nested` when it decompresses to another compressed stream. Any other compressed file (`.bz2`, `.xz`, `.zip`, `.7z`) can't be scanned, so it is dropped as `compressed-unscannable`.
4. **Excluded by choice, with a reason:** `--exclude <glob>=<reason>` for data that is easy to rebuild elsewhere, such as clones of public repositories.

**The strip log records what was removed, never the value:** one line per changed file with the pattern names and counts. The manifest totals every redaction and exclusion, and lists the email domains it saw so a person can check them against the simulated world's own domains.

**Then the archive itself is scanned.** `verify` checks each part's sha256, decompresses the whole archive, checks every file against the file list, scans every file again with every pattern, and fails if any key shape or dropped path is still inside.

## Format

| File | What |
|---|---|
| `<id>.manifest.json` | Schema `harness-evals/raw-archive/1`: the archive id, a note on what it holds, the source names, the tool's patterns and drop rules, totals, every part's name, size and sha256, the redaction and exclusion counts, and the review list. Its sha256 is the digest a report links. |
| `<id>.raw.tar.zst.part-000`, `-001`, ... | One zstd-compressed tar, split into parts. Concatenate them in order to read it. |
| `<id>.files.jsonl.gz` | Every file in the archive with its size and sha256 (also inside the archive as `_archive/files.jsonl`). |
| `<id>.strip-log.jsonl.gz` | One line per redacted or masked file (also inside as `_archive/strip-log.jsonl`). |

Paths inside the archive start with the source name given to `--src <dir>=<name>`. Long or non-ASCII paths use PAX records, which GNU tar and bsdtar read.

## Commands

```sh
# On the machine that holds the data (needs Bun and zstd)
bun scripts/archive/raw.ts pack --run-id <archive id> --src <dir>=<name> [--src ...] --out <dir> --expand-archives \
  [--exclude '<glob>=<reason>'] [--note "<what this holds>"]
bun scripts/archive/raw.ts verify --dir <dir>                       # scan over the finished archive; exit 0 only when clean
bun scripts/archive/raw.ts publish --dir <dir> --repo garrytan/harness-evals   # release raw-<archive id>; checks GitHub's digest of every asset

# Anyone with access: download, check and unpack
bun scripts/archive/raw.ts fetch --url <manifest url> --sha256 <digest> --out <dir> [--extract <dir>]
# Or by hand: check each part's sha256 against the manifest, then
cat <id>.raw.tar.zst.part-* | zstd -dc | tar -x
```

After publishing, add the archive to [archive/index.json](archive/index.json) under the run folder and run `bun scripts/archive/raw.ts link`, which writes the "Data archive" section of each run's reproduce.md and sets the run's `reproduce` field in docs/scoreboard/reports.json; then run `bun scripts/scoreboard/build.ts` to regenerate the index. Errors are `HE-ARCHIVE-00x` lines ([errors.md](errors.md#raw-data-archives)).

## The index

`docs/archive/index.json` has one entry per run folder:

- `status`: `archived`, `partial` (some raw data is gone or unreachable) or `not-archived`, with a `reason` for the last two.
- `raw`: a list of private archives, each with its manifest URL and sha256, size, file and part counts, what it covers and why it is private.
- `bundle`: the public trial bundle's URL, sha256 and size, or nothing until the run reaches the public repository.

## The rule for new runs

**A results pull request archives its run's raw data before it is ready.** [tests/raw-archive.test.ts](../tests/raw-archive.test.ts) fails when a run folder holds results but has no index entry, or when its reproduce.md "Data archive" section doesn't match the index. A run whose raw data can't be archived gets a `not-archived` entry saying why.

- Pack and verify on the machine where the data lives, before that machine or any VM is let go. Delete the local copy only after `fetch` from the release verifies.
- The public trial bundle comes after the run reaches the public repository, because it has to name public commits; until then the entry has no `bundle`.
