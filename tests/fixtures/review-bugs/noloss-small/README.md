# noloss-small: a fixture for score-mc against noloss

Synthetic. 14 bug PRs (18 blocking bugs) and 2 decoy PRs in one invented repository, with a plain arm and a review
arm at 2 passes each. Nothing here is a real PR, finding or review. `tests/review-bugs/score-mc.test.ts` checks that
`scripts/review-bugs/score-mc.ts` agrees with gstack-evals' noloss scorer on it: the Monte Carlo sign-flip p within 3
Monte Carlo standard errors of noloss's exact p, and the bootstrap and false-alarm intervals equal to noloss's.

- `suite.json`: the suite, in noloss's suite format.
- `arms/review-bugs-mc-fixture/{plain,review}/`: the two arms, as `noloss ingest` published them (arm contract v1,
  with `ingest.json`).
- `noloss-expected.json`: the exact values noloss computed, each with the command that produced it.

## How the expected values were produced

From a gstack-evals checkout at `91d76421a9f127167b3694306aa77f2971f7a712`, after `bun install`, with
`F` set to this directory. No command calls a model.

1. Ingest each arm from its source directory (the source directories are not kept; the ingested copies are byte for
   byte the same files plus `ingest.json`):

   ```
   bin/gstack-evals noloss ingest <src>/plain --suite $F/suite.json --root $F/arms
   bin/gstack-evals noloss ingest <src>/review --suite $F/suite.json --root $F/arms
   ```

2. Blocking recall, its interval and the exact one-sided sign-flip p values (`p_no_loss` at margin 0 is p_greater,
   `p_loss` is p_less):

   ```
   bin/gstack-evals noloss score --suite $F/suite.json --root $F/arms --variant review --reference plain \
     --margin 0 --margin-reason m --seed 7 --draws 10000 --json
   ```

3. The false-alarm gate with the arms swapped, so noloss's excess (reference minus variant) is review minus plain:

   ```
   bin/gstack-evals noloss score --suite $F/suite.json --root $F/arms --variant plain --reference review \
     --margin 0 --margin-reason m --seed 7 --draws 10000 --false-alarm-gate 0.5 --json
   ```

4. Any-severity recall: noloss score has no paired test for it, so this script, copied into the gstack-evals checkout
   root and run with `bun noloss-any-severity.ts $F`, uses noloss's own reader and `stats.ts`. It is below.

It printed `{"pairs":18,"p_greater":0.05078125,"p_less":0.9814453125}`.

## noloss-any-severity.ts

```ts
// Run from a gstack-evals checkout at 91d76421a9f127167b3694306aa77f2971f7a712: bun <this file> <fixture dir>
// Any-severity exact sign-flip p from noloss's own reader and stats.ts. The pairs are built the way score.ts builds its
// detection metric (blockers that are not over-blocking, outcome F or D), paired by blocker and clustered by PR.
import { join, resolve } from "node:path";
import { loadSuite } from "./lanes/review-noloss/suite.ts";
import { readIngested } from "./lanes/review-noloss/ingest.ts";
import { pairedTests, twoSidedSignFlip } from "./lanes/review-noloss/stats.ts";
const dir = resolve(process.argv[2]!);
const { suite, sha256 } = loadSuite(join(dir, "suite.json"));
const arm = (id: string) => readIngested(join(dir, "arms", suite.id, id), suite, sha256).arm;
const share = (a: ReturnType<typeof arm>, unit: string, blocker: string) => {
  const rows = a.judgments!.filter((j) => j.unit.id === unit && j.blocker.id === blocker && j.outcome !== "M");
  return rows.length / a.arm.passes;
};
const v = arm("review"), r = arm("plain");
const pairs = suite.units.flatMap((u) => u.blockers.filter((b) => b.counts !== "over-blocking").map((b) => ({ id: u.id + " " + b.id, cluster: u.cluster, a: share(r, u.id, b.id), b: share(v, u.id, b.id) })));
const t = pairedTests(pairs, 0, [v.arm.passes, r.arm.passes]);
console.log(JSON.stringify({ pairs: pairs.length, p_greater: t.no_loss.p, p_less: t.loss.p }));
```
