# Control-arm audit: gn-follow-2026-11 and gn-follow-preset-2026-11 (internal-task, 2026-11-02, $0)

Under the crew rule "Clean no-gstack and no-brain arms" (2026-11-02). Every number below comes from the runs' own receipts on this machine (~/.capy/work/harness-evals/runs/<run>/shards/<shard>/). Script: audit.py, in this folder.

**Verdict: both none arms are clean.** In 32 none sessions (16 per run), not one tool call touched gstack, the Capy drive or a gstack skill. Every none init message listed only Claude Code's two built-in skills (doctor, plugin-authoring).

## Where each run ran
| Run | Where | VM | Commit | Lane B root uploaded |
|---|---|---|---|---|
| gn-follow-2026-11 | Ubicloud standard-16, eu-central-h1, UBI_OWNER=internal-task, Harbor containers (Harbor f3a5a923), 2026-11-01 17:27 to 19:33 UTC, destroyed (cleanup done) | <vm name> | fec132d37 | ~/.capy/work/gstack-laneb: gstack-evals, arms gstack/none/placebo, terminal-bench-2 |
| gn-follow-preset-2026-11 | Ubicloud standard-16, eu-central-h1, UBI_OWNER=internal-task, Harbor containers (Harbor f3a5a923), 2026-11-01 18:45 to 20:16 UTC, destroyed (cleanup done) | <vm name> | e1016ca4d | ~/.capy/work/gstack-laneb-preset: same parts |

- No Capy drive goes to the VM. run-shard.sh streams only the commit's checkout and the named Lane B parts.
- The none arm's tar (8bab4833, the pinned one in both runs' arms.json) holds only two empty directories, .claude/ and .claude/skills/. That tar is extracted into /root at trial start.
- The runtime layer (runtime-copy.Dockerfile, the same in every arm) adds only claude, node and bun.

## Per-arm reads
A counted call is a tool call (any tool: Read, Bash, Glob, Grep, Skill, ...) whose input contains `gstack`, `.capy`, `.capy/drive` or `.claude/skills`, or names `/skills/<s>` for one of the 64 gstack skill names, or any Skill tool call.

| Run | Arm | Sessions | Tool calls | Calls touching gstack/drive/skill | Sessions with one | SKILL.md reads | Skill tool | Init lists "gstack" |
|---|---|---|---|---|---|---|---|---|
| gn-follow-2026-11 | none | 16 | 89 | **0** | 0 | 0 | 0 | 0 |
| gn-follow-2026-11 | gstack | 16 | 111 | 5 (Bash) | 4 | 0 | 0 | 16 |
| gn-follow-2026-11 | placebo | 16 | 94 | 0 | 0 | 0 | 0 | 16 |
| gn-follow-preset-2026-11 | none | 16 | 92 | **0** | 0 | 0 | 0 | 0 |
| gn-follow-preset-2026-11 | gstack | 16 | 112 | 10 (Bash) | 5 | 0 | 0 | 16 |
| gn-follow-preset-2026-11 | placebo | 16 | 95 | 0 | 0 | 0 | 0 | 16 |

- **Placebo is not a no-gstack control, by design.** Its tar (ff6b909d) installs the same 64 skill names under ~/.claude/skills, each with gstack's frontmatter and a neutral body. So its init lists them, but it read none of them.
- **The none arm is the only clean control in these runs, and it is clean.**
- gstack's touching calls were gstack-skill-start / gstack-skill-end runs and a few direct reads under ~/.claude/skills/gstack. The probe found 0 of 16 followed in each run.

## Preflight in the current run (gn-hard-follow-2026-11), for comparison
Checked on the gstack shard's live VM (<vm name>, built the same way as the none shard's VM).
- **VM:**
  - no /home/user/.capy, ~/.capy or /root/.capy;
  - 0 .capy/drive paths;
  - no ~/.local/share/gstack or ~/.claude/skills;
  - 0 gstack-* binaries on PATH.
- **Container:** a none-arm container, built from the task's own materialized agent Dockerfile (django__django-15732) with the none tar extracted into /root:
  - 0 drive paths and 0 gstack paths under /root, /home and /opt;
  - /root/.claude/skills is empty;
  - /opt holds only laneb and miniconda3;
  - 0 gstack-* binaries on PATH.
- Env was never printed.
