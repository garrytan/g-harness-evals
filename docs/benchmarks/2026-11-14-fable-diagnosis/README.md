# SWE-rebench July 2026: oracle and nop check

This page covers one keyless check of the SWE-rebench July 2026 task source on the frontier Harbor path. No model was called. It asks two questions about the 111 pinned tasks: does the reference fix pass each task's tests (the "oracle"), and does doing nothing fail them (the "nop")?

**Takeaways**

- **107 of 111 oracles pass and all 111 nops score 0, with the egress blocklist on.** The task source is usable as pinned. The 4 failures come from the dataset's own Java builds, not from the rig, and are listed below.
- **Every upstream task image carried a pointer past its base commit.** All 111 images had `.git/ORIG_HEAD` naming a later upstream commit. The commit's object was not in any image, and no image held the fix's code. The rig now scrubs history at image build time, and no built image leaks.
- **44 of 111 tasks could not grade offline as shipped.** Their test parser asks uv to download Python from github.com, which the blocklist refuses. The rig now installs a pinned Python into those images at build time and sets `UV_PYTHON_DOWNLOADS=never` for the verifier.

Machine-readable results: [oracle-check.json](oracle-check.json) (the final run) and [oracle-check-first-run.json](oracle-check-first-run.json) (the first run, before both fixes).

## Results

| | First run | Final run |
|---|---|---|
| Rig fixes | none | history scrub and Python prefetch |
| Oracle passes | 67 of 111 | 107 of 111 |
| Nop scores 0 | 111 of 111 | 111 of 111 |
| Built images leaking history | not built | 0 of 111 |
| Tasks with uv Python download attempts | 44 | 0 |

Both runs used one 16-CPU, 62 GiB Ubicloud VM, Harbor 0.24.0, 8 tasks at a time, and the source's egress blocklist (GitHub, Hugging Face, SWE-rebench hosts and model APIs refused; package registries open). The egress probe passed before the final run.

## The 4 oracle failures in the final run

All four are Java builds that fail the same way in both the oracle and the nop trial, so they can't score either way. The causes below come from the check VM's Harbor and kernel logs, which are not committed; oracle-check.json records only the rewards.

- **langchain4j__langchain4j-5315 and langchain4j__langchain4j-5367.** Maven can't find the project's own `1.16.0-SNAPSHOT` sibling modules in its local or snapshot repositories. The first run's logs show the same Maven error behind the uv failure.
- **openrewrite__rewrite-7784.** Gradle can't find `org.openrewrite:rewrite-*:8.93.11`, the project's own unreleased version. Same class as langchain4j: the build expects artifacts that were never published.
- **apache__pulsar-25953.** The Gradle daemon was killed by the container's memory limit. The task sets `memory_mb = 4096`, and the kernel log shows a java process killed at about 4 GB resident during this trial. This is the dataset's memory limit, not the blocklist.

No fix was attempted for these. A run should drop them or count them as unscorable.

## What the rig changes

**History scrub.** Each task Dockerfile gets one pinned step after the upstream image. It checks out the base commit detached, deletes every ref, tag, remote, stash and pseudo-ref (ORIG_HEAD, FETCH_HEAD and the rest), expires the reflog and runs `git gc --prune=now --aggressive`. The build fails unless HEAD is the base commit, no ref is left and no commit outside the base commit's history is reachable.

- Base images: 111 audited. All 111 had ORIG_HEAD past the base commit. None had extra refs, tags, remotes, stash, reflog, packed-refs or FETCH_HEAD, every object was reachable from HEAD, and `git log --all -S` on a line the fix adds found nothing.
- Built images: 111 audited. No history past the base commit was found in any of them; on one task (below) the check for the fix's text could not run. The scrub step and audit build took 52 s per image on average and 185 s at most, well under Harbor's 1,800 s build timeout.
- One task (Gentleman-Programming__gentle-ai-595) is marked "audit incomplete" because its fix adds no distinctive line to search for. Every structural count for its built image is 0.

**Python prefetch.** The 44 tasks whose images have no `python3` get a pinned step: uv 0.7.13 installs CPython 3.13.5 (build 20250612, the version uv picked in the first run) into `/opt/uv-python`. Their `task.toml` sets `UV_PYTHON_INSTALL_DIR=/opt/uv-python`, and every task sets `UV_PYTHON_DOWNLOADS=never`. The task list and both step hashes are in the pin, `scripts/frontier-harbor/pin-swe-rebench-07-2026.json`.

<details>
<summary>Resource numbers</summary>

- Largest image: verl-project__verl-6506, 16.3 GB on disk.
- Peak disk used at the end of a batch: 72.6 GB in the final run (69.8 GB in the first) on a 309 GB disk.
- Docker Hub pulls: 111 per run, one per image, 8 per batch. The anonymous limit is 100 per hour per IP; one VM pulled all 111 images within it.
- Pull time: 3,166 s in the final run (3,170 s in the first).
- Final run: 14 batches.
- `blocked_host_mentions` in the JSON lists tasks whose verifier output names a blocked host. Most of those tasks pass their oracle, so the mentions are log text, not failed fetches.

</details>
