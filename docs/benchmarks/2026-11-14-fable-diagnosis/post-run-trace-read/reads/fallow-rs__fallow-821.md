# fallow-rs__fallow-821
Passes: X 1 of 2, Y 0 of 2
Fault named in the instruction: partly (it names the file pattern and the Vercel packages, not where in the code; no Vercel plugin existed, and all tries added `crates/core/src/plugins/vercel.rs`)
- X-a2 FAIL: over-reach beyond the issue. Same plugin as the passing try, but it also turns the plugin on when a `vercel.*` config file merely sits at the project or workspace root, with no Vercel dependency or script, and it said this went beyond the issue's wording.
- Y-a1 FAIL: over-reach beyond the issue. It activates on the dependency, a `vercel` script, or the presence of `vercel.json` or `vercel.{ts,...}` at a root, and also treats a `default` export as used.
- Y-a2 FAIL: over-reach beyond the issue. It activates on the dependency or on a `vercel.json` or `vercel.*` file at a root, and its fixture asserts that a `vercel.mjs` with no Vercel dependency is protected.
Passing tries did differently: X-a1 activated only on the `vercel` or `@vercel/config` dependency or a `vercel` script, following the existing OpenNext plugin's precedent, and left a `vercel.ts` in a project with no Vercel signal reported. That is the one visible difference from the three failures; why it matters to the hidden tests is not shown.
Rating: WEAK, favours X. Activation on file presence alone appears in all three failures and not in the pass, but X itself made that choice in one try, so it is not a consistent difference between the agents.
