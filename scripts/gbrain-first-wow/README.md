# gbrain time-to-first-wow eval: fixtures, scoring and the dry run

These scripts build the made-up user histories for the eval in [docs/benchmarks/2026-11-24-gbrain-first-wow/](../../docs/benchmarks/2026-11-24-gbrain-first-wow/PREREGISTRATION.md), score each trial by rule, and run the whole analysis keyless.

- **Nothing here calls a model or reads a key.** Every score is a rule over the reply, the session's tool events and the trial's end state.
- **The fixtures are synthetic.** Names, values and dates come from a seed; nothing comes from a real person.

| File | What it does |
|---|---|
| `fixtures.ts` | Builds one HOME per seed: project folders plus Claude Code and Codex session files with three planted facts, and the manifest (questions, answers, decoys, which file holds what). `bun scripts/gbrain-first-wow/fixtures.ts <seed> <claude-code\|codex> <out dir>` writes one. |
| `score.ts` | `scoreTrial` (history-rich and messy) and `scoreNoHistory`: the value, the decoys, the reference and whether a tool call read it; abstention and the import fallback. |
| `verdict.ts` | Paired contrasts per harness with 95% intervals and exact McNemar tests, the interim look, the decision rules and the smallest detectable difference. |
| `dry-run.ts` | Every cell and seed with scripted stand-in agents, through the real transcript parsers. Writes `receipt.json` and `README.md` to the plan's `dry-run/` folder. |
| `projection.ts` | The planning cost projection, before any pilot. The pilot replaces it with `scripts/plan-cost.ts`. |
| `coding.ts` | The coding check: 15 small bug-fix tasks in the fixture's project, mapped to seeds by seed mod 15, each graded by a hidden test file run with `bun test`. |
| `pilot-summary.ts` | Re-scores every trial of a pilot run from the files it left and prints the pilot's checks per arm. `bun scripts/gbrain-first-wow/pilot-summary.ts <run dir> [--json <out>] [--md <out>]`. |
| `prereg.ts` | Writes the counted run's `prereg.json` on one gbrain build. `bun scripts/gbrain-first-wow/prereg.ts --gbrain-commit <40 hex> --gbrain-version <v> [--out <file>]`. |
| `analyze.ts` | The counted-run analysis: re-scores each trial, applies the plan's drop and miss rules, and runs `verdict.ts`. It lists the gbrain dependency trees the trials ran on (`gbrain_deps_sha256` in the JSON) and warns when there is more than one. `--interim` takes the one interim look. `bun scripts/gbrain-first-wow/analyze.ts <results dir>... [--interim] [--prereg <prereg.json>] [--json <out>] [--md <out>]`. |

Tests: `bun test tests/gbrain-first-wow.test.ts tests/gbrain-first-wow-analyze.test.ts tests/gbrain-first-wow-coding.test.ts`.

## Known limits

- The session files are modelled on Claude Code 2.1.312 and Codex 0.165.0. Whether gbrain's importer reads them is checked at the pilot.
- Abstention on the no-history persona is a regular expression (`ABSTAIN_RE`), and a made-up provider name has no fixed shape, so only flags and ports are checked for invented values.
- QM's transcripts are parsed from its items table dump by `scripts/gbrain-install/transcript.ts`.
