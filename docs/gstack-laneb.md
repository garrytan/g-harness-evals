# Lane B bridge (internal-task)

**What it is:** a way to run the pinned gstack-evals Lane B agent on harness-evals tasks, with harness-evals metering, leases and Ubicloud VMs.

- **Agent side is Lane B's, unchanged.** The agent, the three arms (none, gstack, placebo), the prompt wrapper, the Claude Code invocation and the body-load probe come from gstack-evals tag `laneb-quick-2-runner` (commit `443d582c`), byte for byte.
- **Task side and money side are ours.** The materializer that turns a task into a Harbor task, the metering proxy, the ledger lease, the trial records and the Ubicloud lane are harness-evals code.
- **Two task sources.** gstack-native repo tasks ([format](gstack-native-format.md)) and the 20 Terminal-Bench 2 tasks Lane B picked (`quick/laneb/tasks/final.json`).

Terms used below:

- **Harbor:** the task runner Lane B uses (pinned at `f3a5a923`). A Harbor "job" runs agents over tasks; each run of one agent on one task is a Harbor "trial".
- **Arm:** what is installed in the agent's `~/.claude` before it starts. `none` is empty, `gstack` is gstack at `61e201ec`, `placebo` is gstack with every skill body replaced by matched filler.
- **Cell:** one model and one arm, named `<model>.<arm>`, for example `claude-opus-5-5.gstack`.
- **Body-load gate:** Lane B's rule that at least 90% of invoked sessions must actually load the skill body, or the model's results do not count (`quick/laneb/analysis/manip.ts`).

## The files

| File | What it does |
|---|---|
| `scripts/gstack-laneb/pin.json` | Every pin: the gstack-evals commit and tag, Harbor, the arm tar digests, the TB2 commit and tree digest (`tb2.final_tree_sha256`), and the sha256 of every Lane B file we use. |
| `scripts/gstack-laneb/pinned/` | Byte copies of the Lane B files the bridge imports (with Lane B's LICENSE). A test checks them against pin.json. |
| `scripts/gstack-laneb/fetch.ts` | Fetches gstack-evals at the pinned commit, checks every pinned file, builds the arms with Lane B's `arms/build.sh`, and accepts each arm only as the pinned tar or, for gstack, a pack-equivalent rebuild that pin.json lists as a dated deviation (below). `--tb2` also fetches Terminal-Bench 2 and checks its tree digest (below, Fetching Terminal-Bench 2). |
| `scripts/gstack-laneb/plan.ts` | Reads a preregistration (schema `gstack-laneb/1`), lists cells and trial ids, and prints each shard's lease. |
| `scripts/gstack-laneb/materialize.ts` | `native` and `tb2` write Harbor task directories; `job` writes the shard's Harbor job (retries off, one trial at a time). |
| `scripts/gstack-laneb/vm-run.sh` | Runs one shard: proxies, ledgers, the Harbor job, then the trial records. |
| `scripts/gstack-laneb/to-trials.ts` | `attest` records the preregistration attestation before the first session, `convert` turns Harbor results into `trials.jsonl`, `gates` computes the body-load gate. |
| `scripts/gstack-laneb/smoke.sh` | Keyless end-to-end smoke on the toy fixture with a fake upstream. |
| `tests/gstack-laneb.test.ts` | Keyless tests for all of the above. |
| `tests/gstack-laneb-fetch.test.ts` | Keyless, offline tests of the Terminal-Bench 2 fetch against local `file://` fixture repositories of synthetic files; one case against the real upstream runs only with `HE_LANEB_TB2_NETWORK=1`. |
| `tests/fixtures/gstack-native/repo/toy/dev/toy-fix-calc/` | A hand-written toy task for the smoke and the tests. |

## Native tasks grade in a separate container

**Nothing grades inside the agent's container.** A reviewer reached reward 1 without the work by shimming `env` on PATH, swapping the python3 symlink, calling `os._exit(0)` under pytest, and sniffing paths.

- `materialize.ts native` writes `[verifier] environment_mode = "separate"` with its own `[verifier.environment]` (no network), `tests/Dockerfile` from the task's `verifier/Dockerfile`, and top-level `artifacts` from task.toml (`["/work"]`).
- Harbor copies `/work` out of the agent's container and restores it at `/work` in a fresh verifier container built from that image (`src/harbor/trial/artifact_handler.py` at the pinned Harbor). Interpreters, PATH and anything else the agent changed outside `/work` never reach the verifier.
- A native task without `verifier/Dockerfile`, whose verifier image copies into `/work`, or whose `artifacts` is anything but `["/work"]` is refused (HE-LANEB-003), as gstack-evals refuses shared verification.
- A symbolic link in a native task's `environment/`, `verifier/` or `oracle/` is copied as the file or directory it names, because a copied link would point back into this checkout and Harbor refuses that as outside the task. A link that leaves its own directory (so `environment/` never receives oracle or verifier files), names nothing, cannot be resolved, loops or is a second link to one directory is refused (HE-LANEB-003), as is a directory whose links would copy more than 10000 entries or 1 GiB (file links and the first walk of a directory link included), and so is one of those three directories when it is itself a link.
- `oracle/` becomes `solution/oracle/`. The bridge's `solution/solve.sh` restores it at `/oracle` and runs `/oracle/solve.sh`, so files beside the script (`oracle/fix.patch`) are where it expects them.
- If a graded native trial's `artifacts/manifest.json` has no `/work` entry that is `ok` or `empty` (a failed copy, or no manifest), nothing shows the verifier graded the agent's tree, so the record is `infra_error` with grade `n/a` (HE-LANEB-008), not a fail.
- The toy fixture's verifier runs the agent's code as uid 65534 in a child process and grades the values it prints on random inputs, so an agent that exits 0 early scores 0. Harbor mounts `/logs/verifier` and restores `/work` world-writable, so verify.sh makes both root-owned first and kills every uid 65534 process after each run; a detached process that rewrites `reward.txt` scores 0. `checks/exit-early.sh` and `checks/lingering-writer.sh` cover both.
- `reward` stays fractional in every record (`laneb.reward`); qa and review score found over planted.

## How a call is metered

```
Claude Code (trial container)
  -> Lane B proxy (pinned runner/proxy.ts, on the docker bridge gateway, port 8787)
  -> our metering proxy (runner/proxy/metering-proxy.ts, 127.0.0.1:8790, lease mode, one bound slot with a random token)
  -> Anthropic
```

- **Only our proxy holds the key.** Lane B's proxy is configured with our slot token as its "key" and our proxy as its upstream.
- **Our ledger is the record.** `ledger.sqlite` holds the cap and the spend. Lane B's own ledger is approved at the same lease, so it also stops at the lease, and `to-trials.ts` reports Lane B's meter beside ours with the delta.
- **count_tokens is free, on this lane only.** Lane B's proxy calls `POST /v1/messages/count_tokens` before each request. `vm-run.sh` starts our proxy with `--free-count-tokens`, so it forwards that route for the bound slot, its token and a model on both `--allow-models` and the slot's model list (when the slot was bound with one), never prices or reserves it, and logs it at $0. Without the flag (every harness lane) the route is refused with 403 as before.
- **Retries are off.** A Harbor trial that fails after its first metered call is one terminal record with its spend kept, never a silent rerun.
- **Every charge lands before the records.** At the end, `vm-run.sh` closes Lane B's sessions, unbinds our slot and drains our meter (up to eight 120 s waits for requests still streaming), then writes the records. `<out>/accounting.json` says whether every request settled; if one did not, its reservation stays charged in `ledger.sqlite`, `run-summary.json` says the accounting is incomplete, and the shard exits 6.
- **A stop still writes records.** The proxies and ledgers run in their own sessions, so the controller's SIGTERM to the shard's process group reaches Harbor and `vm-run.sh` but not them. `vm-run.sh` then drains (one 30 s wait) and writes the records; `vm-shard.sh` waits for it, and `run-shard.sh` waits up to 240 s for the shard's exit file before it copies results back.
- **Budget stops are cap stops.** A trial refused by our lease (402), the Lane B ledger, or a Lane B session or global cap is `model_error` with `cap_stop`. A trial whose every request was refused before any response is `infra_error` (HE-LANEB-007), not a model result.
- **The cap holds.** `plan.ts lease` refuses leases that sum above `spend_cap_usd`. A counted shard must be a preregistered shard (same name and cells) with a lease no more than planned, or `vm-run.sh` refuses it before any proxy starts.

## Running it

1. **Fetch** (any machine with Docker; no key):
   ```
   bun scripts/gstack-laneb/fetch.ts --out ~/.capy/work/gstack-laneb --tb2
   ```
   It prints digests and counts only. Exit 2 with `HE-LANEB-002` means an arm is neither its pinned tar nor a listed deviation, and nothing was copied; `HE-LANEB-009` means the Terminal-Bench 2 fetch failed (below). `--pinned-arms <dir>` offers pinned `<arm>.tar.gz` files to use by digest before any rebuild. `<out>/fetch.json` exists only after a run that finished: it is deleted first and written last.
2. **Smoke** (no key, no spend):
   ```
   HE_LANEB_HARBOR_READY=1 bash scripts/gstack-laneb/smoke.sh --laneb-root ~/.capy/work/gstack-laneb --network public
   ```
   It passes when there are two trial records, both pass, Lane B logged zero `count_failed` events, and the invoked placebo session loaded a skill body. `--network public` is for Capy machines, whose kernel cannot run Harbor's egress sidecar; a Ubicloud VM uses `allowlist`.
3. **Preregister** in its own pull request, merged before the first counted trial (crew rule). Then print the leases:
   ```
   bun scripts/gstack-laneb/plan.ts lease --prereg docs/benchmarks/<run>/prereg.json
   ```
   A shard's lease is its projected spend x 1.4 plus the Lane B session cap of its most expensive model ($5 for Opus 5.5, $1 for Haiku 5.5), because a Lane B session reserves its whole cap before its first call.
4. **Fan out** on Ubicloud, one VM per shard:
   ```
   UBI_OWNER=<thread code> bash scripts/ubicloud/fanout.sh --manifest <fanout.json> --workload gstack-laneb
   ```
   The manifest is the usual one ([ubicloud.md](ubicloud.md)) with cells named `<model>.<arm>`; put `--laneb-root <dir>` in its options when the fetched root is not at `~/.capy/work/gstack-laneb`. Each VM runs the keyless smoke, then `vm-run.sh` under the shard's lease. `--resume` and `--embedded` are refused for this workload.
5. **Merge** with `scripts/merge-shards.ts` as for any run. Each record carries a `laneb` block (arm, Harbor trial, session, body-load probe, Lane B's meter and the delta). Then run `to-trials.ts gates --results <merged dir>`.

## Fetching Terminal-Bench 2

**The TB2 copy is used only after its digest matches the pin.** `fetch.ts --tb2` fetches `laude-institute/terminal-bench-2` at `tb2.commit` and computes `tb2.final_tree_sha256` on the copy: Lane B's `treeDigest` of each of the 20 task directories in `final.json`, combined by the rule in pin.json (`treeOf`). These are the same per-task digests `materialize.ts tb2` checks later.

- **A new directory per attempt.** Each attempt fetches into `<out>/.terminal-bench-2.gen-<random>`, never a directory an earlier run left (leftovers are deleted first). Only a copy whose digest matches replaces `<out>/terminal-bench-2`, so a failed fetch leaves an earlier checked copy as it was.
- **fetch.json last.** An earlier `<out>/fetch.json` is deleted before anything is fetched. The new one, with the arm digests and the `tb2` record (url, commit, digest, task count, the route and the attempts), is written to a temporary file in `<out>` and renamed into place after everything else passed. A rerun that fails leaves no fetch.json at all, so nothing shows an earlier success beside a current failure.
- **Bounded and unattended.** Every network git step runs without prompts (`GIT_TERMINAL_PROMPT=0`, no askpass, ssh in batch mode, no pager) and with only PATH, HOME, git and proxy settings in its environment, so no model key reaches git. Each attempt has a deadline (10 minutes) and the whole fetch another (30 minutes). A network error or an attempt deadline is retried at most twice. A digest or commit mismatch is never retried.
- **Errors carry no credentials.** A failure names the url, the commit and, for a mismatch, the first 12 hex characters of the pinned and the computed digest. Credentials are removed from the url and from git's output first: `user:token@` in a url, `x-access-token:`, `ghp_`, `gho_` and `github_pat_` shaped tokens, and Authorization headers.
- **Never inside this repository.** With `--tb2`, an `--out` inside this checkout is refused before anything is fetched (HE-LANEB-003), so no TB2 task file can be committed. The default root, `~/.capy/work/gstack-laneb`, is outside it.

**The credential is the lane's existing gh login, not a new secret.** The first attempt uses the machine's own git configuration. On a Capy machine (the lane's machines), the system git config already sends github.com through Capy's git proxy with a stored credential, and that is how the private `garrytan/gstack-evals` fetch has always authenticated. If git reports an authentication failure, the fetch moves once to the gh CLI login on that machine: git's credential helper is set to `gh auth git-credential` for the remaining attempts. This is the same gh login `scripts/ubicloud/pr-check.sh` posts `ubicloud/checks` under and `merge-pass.sh` merges with. A retry after a network error also goes through it when `gh auth status` succeeds. No token is read, passed on a command line, printed or logged. Ubicloud shard VMs never fetch: `run-shard.sh` streams the fetched root to the VM without its `.git`. The gstack-evals fetch follows the same policy.

## What a shard writes

Everything under `--out` is 0600 (directories 0700). Harbor, proxy and agent logs stay in files; stdout gets counts and digests, never a task id or task text.

- `attestation.json`: the preregistration attestation, dated before the first session.
- `trials.jsonl`, `trials/`, `manifest.json`: the usual results tree.
- `gates.json`: the body-load gate per model.
- `run-summary.json`: counts and spend (our ledger, our proxy log, Lane B's meter, the delta).
- `laneb/`: the Lane B run root (Harbor jobs, `proxy-sessions.jsonl`, `proxy-requests.jsonl`, ledger logs).

## The gstack arm deviation (2026-10-29)

**The pinned gstack tar (`737411ef...`) no longer exists, and a rebuild does not reproduce it byte for byte.** Lane B's build fetches gstack from GitHub and keeps the checkout's `.git`, and GitHub delta-compressed the same objects into a different pack. Lane B's arms/README.md lists that pack as a reproducibility dependency.

So the counted gstack arm is a **pack-equivalent rebuild**, recorded in `pin.json` under `arms.gstack.deviations`. fetch.ts accepts it only when all of these hold, and recomputes every one on each fetch:

- every entry outside `.claude/skills/gstack/.git/objects/pack/` matches the commit's `gstack.files.tsv` (type, mode, size, sha256 or link target; nothing missing or extra): 15,391 entries;
- the pack directory holds one `pack-<sha>.{pack,idx,rev}` set and nothing else; the record lists the three changed paths with old and new sizes and sha256;
- HEAD is `61e201ec`, the checkout holds 4,582 objects, none unreachable from HEAD, and `git fsck --full` is clean; the record also holds a sha256 of the sorted object names, so the exact set is pinned;
- git runs on the unpacked `.git` only after every file outside the pack (its config included) matched, with executable settings such as `core.fsmonitor` overridden;
- the none and placebo arms match their pins exactly;
- the rebuilt tar and tar.gz sha256 are the ones in the record.

**The tree digest differs, by design of the digest.** The manifest's tree digest (`b98699cb...`) covers the pack files, so the rebuild's tree digest (`065d915b...`) differs. The record holds both.

- A pack-equivalent rebuild that pin.json does not list is refused, and fetch.ts writes the full record to `<out>/gstack-deviation.proposed.json` for a reviewed pin change.
- `vm-run.sh` accepts an arm tar only if it is the pinned one or a listed deviation, and writes `<out>/arms.json`. Every trial record of that arm carries `laneb.arm_deviation` (dates, both tar digests, the reason). With the pinned tar the field is absent.

## Known limits

- **Held-out sets are refused.** `vm-run.sh`, `vm-shard.sh` and `run-shard.sh` refuse a sealed root, an opening receipt or a `heldout` split for this workload. The opening receipt and the sealed results contract (`merge-shards.ts` custody checks) are not wired for Lane B yet.
- **Requirement for the later held-out bridge (from #117).** At seal time a held-out task's `environment/Dockerfile` ends with exactly `LABEL harness-eval.sealed=true`. The held-out bridge must build sealed images with `--label harness-eval.sealed=true` and must ignore or refuse a task's docker-compose file. PR B has no code for this, because held-out runs are refused.
- **`--network public` is for uncounted smokes.** It opens every phase to the internet; a counted run uses `allowlist`.
- **TB2 verifiers keep Lane B's network setting.** The pinned TB2 materializer runs the shared verifier with network, as Lane B does, so TB2 results stay comparable with Lane B's. Native tasks never use a shared verifier (below).
- **Provider reconciliation.** `scripts/reconcile-provider.ts` filters on per-trial tokens (`trial-token:<run>/`); a Lane B shard meters under one lease key (`<run_id>:<shard>`), so reconcile Lane B spend from the shard's `ledger.sqlite` and `proxy-usage.ndjson`.
- **Session ids in results need the pregate allowlist.** Each Harbor `result.json` carries the Lane B proxy session id (`"session": "s-<12 hex>"`) in its laneb block, a correlation id for the proxy's session log and not a credential, which gstack-pregate's secrets check reports as `env.kv`. `.gstack/pregate.json` allowlists exactly that value at the end of its line, only on `docs/benchmarks/*/results/*/laneb/jobs/*/*/result.json` and `docs/benchmarks/*/results/*/trials/*/*/*/harbor/result.json` (`tests/pregate-allowlist.test.ts`), so a Lane B results pull request passes the check only once that entry is on main.
- **No resume.** A shard that stops part way has explicit records for what Harbor finished or started; the merge refuses a run with trials Harbor never started.

## Error codes

`HE-LANEB-001` to `HE-LANEB-009`, listed in [errors.md](errors.md#lane-b-bridge-harn-14).

## Disclosures

gstack is Garry Tan's own project.

## Changelog

### 2026-11-08: the Terminal-Bench 2 fetch checks its digest before use and records fetch.json last (internal-task)

New section "Fetching Terminal-Bench 2". `fetch.ts --tb2` now fetches into a new generation directory per attempt and moves it into place only after `tb2.final_tree_sha256` matches. fetch.json is deleted before a run and written last by rename. Every network git step runs without prompts, under per-attempt and overall deadlines, with at most two retries of a transient failure and none of a mismatch. Errors name the url, commit and digest prefixes with credentials removed, an `--out` inside the repository is refused with `--tb2`, and an authentication failure falls back to the lane's gh login. New error code HE-LANEB-009 and new tests in `tests/gstack-laneb-fetch.test.ts`. Why: the old fetch reused whatever directory an earlier run left, never checked the pinned digest, could wait on a credential prompt, and wrote fetch.json in place, so a failed rerun could sit beside an earlier success record.
