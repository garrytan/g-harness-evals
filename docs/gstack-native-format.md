# gstack-native task format (internal-task)

Source tree for one task: tasks/repo/<set>/<split>/<task-id>/ (split = dev or heldout). Held-out trees exist only inside custody.

## Files

- task.toml
  - id (string, unique in the set), kind (fix | review | qa | ship), skill (investigate | review | qa | ship; the Lane B invocation name)
  - agent_timeout_s, verifier_timeout_s, cpus, memory_mb, storage_mb
  - workdir = "/work/repo" (Claude Code's working directory; laneb agent option workdir), repo_dir = "" (graded on container state, no patch export)
  - artifacts = ["/work"] (exactly this list in every gstack-native-v1 task; any other list is refused): the paths Harbor copies out of the agent's container when the agent stops and restores at the same paths in the separate verifier container. Nothing else of the agent's container reaches the verifier.
  - [score] kind-specific: qa has planted_bugs (int) and max_false_reports (int); review has planted_hunks (list of {file, start, end}) for the location check; ship has allowed_paths (globs the finished branch may touch besides the feature's own files).
  - [repeat] verifier repeats for timing-sensitive checks (qa: repro_runs, default 3; a repro counts when it shows the bug on every run against the buggy build and on none against the fixed build).
- instruction.md: what a lead would tell any engineer. Names the output contract (findings file path and shape, repro directory, branch name, remote) and nothing about gstack.
- environment/: Dockerfile and its build context. Base images pinned by digest, packages by version. The image holds /work/repo (a git checkout), for ship a bare remote at /work/remote.git, for qa the app and a start script, Chromium at the revision gstack 61e201ec's playwright-core pins plus Playwright, the gh stub at /usr/local/bin/gh (records requests to /work/.gh-requests.jsonl, always exits 0), git, and the language toolchain. Label harness-eval.sealed=true on held-out images.
- verifier/: the separate verifier (Harbor tests/, environment_mode = "separate", no network). Grading never happens inside the agent's container: a shimmed PATH or interpreter, a replaced symlink, a patched test runner or anything else the agent left outside /work does not exist where the verifier runs. verifier/Dockerfile is required (a task without it is refused, as gstack-evals refuses shared verification): it builds the verifier image with the toolchain and copies the verifier into /tests, and never puts a starting /work in the image; the agent's /work arrives as the artifact. The bridge adds tests/test.sh (exec /bin/bash /tests/verify.sh). verify.sh is the entry point and writes /logs/verifier/reward.txt (0..1) and /logs/verifier/result.json (bits and counts only, never task text). It:
  1. checks integrity first: sha256 of the interpreters and tools it will call (from verifier/integrity.tsv, recorded at image build) and, for ship, remote main against the recorded sha; any mismatch is reward 0 with result.tamper = true;
  2. restores protected files (the repository's own tests, CI config, the hidden tests) from verifier/ before running anything;
  3. grades by execution with absolute tool paths. The agent's code runs only in a child process as an unprivileged user (uid 65534), and the verifier grades what that code prints on inputs it chooses, never an exit code alone: a calc.py that is just `os._exit(0)` must score 0. Harbor mounts /logs/verifier and restores /work world-writable, so before any agent code runs the verifier makes /logs/verifier root-owned 0755 and /work root-owned without group or other write, and after each run it kills every uid 65534 process that is left;
     - fix: hidden tests and the repository's tests pass on the final tree;
     - review: each finding's test fails on the defective change and passes on the corrected change (both shipped in verifier/ as git bundles), and its location falls in a planted hunk; reward = found / planted, 0 if any listed test passes on the defective change;
     - qa: each repro shows the bug on the buggy build and not on the fixed build, repro_runs times; reward = reproduced / planted_bugs, 0 if false reports exceed max_false_reports;
     - ship: the named branch exists on /work/remote.git, merges cleanly into the recorded main, hidden tests and lint pass on the merge, CONTRIBUTING rules hold, and changed paths are within the feature plus allowed_paths.
- oracle/solve.sh: produces a reward-1 state from the starting container.
- checks/: wrong-solution and tamper agents, each a script run in place of the agent; every one must score 0. Required set: noop, delete-or-edit-a-test, exit-early (the code under test exits 0 at import), lingering-writer (the code under test leaves a detached process that rewrites reward.txt and the protected tests), force-push-main (ship), path-shim (puts a fake python/node/git first on PATH and in /usr/local/bin), always-pass-test (review), unrelated-change (ship), plus at least two plausible wrong fixes per fix task.
- MANIFEST entries: sha256 of every file; image build-input tree digest.

## Acceptance (keyless, before a task is used)

oracle 5/5 reward 1; starting state and every checks/ script 5/5 reward 0; lint clean (no 8-word run shared with gstack SKILL.md bodies at 61e201ec, no gstack-only skill names or slash-prefixed skill names, no gstack output markers); qa browser check (the gstack arm's browse launches against the app offline; Playwright launches) on the dev split. Every check prints counts and bits only.
