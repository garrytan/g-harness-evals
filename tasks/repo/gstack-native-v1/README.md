# gstack-native-v1

Repository tasks for testing gstack's skills in Claude Code against a length-matched placebo and against no skills (internal-task). Format and grading: [docs/repo-tasks.md](../../../docs/repo-tasks.md).

- **dev/**: 8 public tasks for calibration, listed below.
- **heldout/**: 32 sealed tasks, eight per kind. Only `MANIFEST.json` is ever on main ([docs/sealed-custody.md](../../../docs/sealed-custody.md)).

| Task | Kind | Skill named to the gstack arm | Source |
|---|---|---|---|
| gn-dev-fix-01 | fix | investigate | tabulate (MIT) |
| gn-dev-fix-02 | fix | investigate | inflection (MIT) |
| gn-dev-review-01 | review | review | inflection (MIT) |
| gn-dev-review-02 | review | review | schedule (MIT) |
| gn-dev-qa-01 | qa | qa | generated web app |
| gn-dev-qa-02 | qa | qa | generated web app |
| gn-dev-ship-01 | ship | ship | inflection (MIT) |
| gn-dev-ship-02 | ship | ship | tabulate (MIT) |

**Licenses.** Each task copies files from its source repository: the whole working tree inside `environment/work.tar` (with the repository's own LICENSE), and single files under `verifier/protected/`, `verifier/trees/` and `oracle/final/`. Every copy stays under its upstream license; the texts are in [LICENSES/](LICENSES/) (inflection, schedule and tabulate are MIT).

**Acceptance.** [dev/ACCEPTANCE.json](dev/ACCEPTANCE.json) holds each task's matrix from `scripts/repo-tasks/matrix.ts`: the image ids it ran on and the reward of every run of the oracle, the starting state and each check.
