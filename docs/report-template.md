<!-- Copy into docs/benchmarks/<date>-<name>/report.md. Replace every <...>. Delete these comments. -->
# <Run title> (<run id>): report

<!-- Two or three takeaways, what works first, what didn't right after. Each: "We learned X. You should do X." -->
- **We learned <what works>. You should <do this>.**
- **We learned <what didn't work, stated plainly, with its number>. You should <do this instead>.**

**The lesson this run is after:** <the public question, in one line>.

**Answer: <one plain line: the question and what we found>.**

- **Pass rate:** <cell>: <x>% [<lo>%, <hi>%] (<passes> / <scored>, <n> tasks); <cell>: ...
- **Cost per solved task:** <cell>: $<x> [$<lo>, $<hi>]; ... (list price through our metering proxy; <what is in and out>; drop this line when cost is not part of the lesson)
- **Median time per trial:** <cell>: <s> s; ... (<trials one at a time or concurrent>)
- **Calls:** <pair>: <can't tell apart | behind | ahead> (Holm family of <k>). MDD <a> to <b> points.
- **Verdict:** <KEEP | FIX-METHOD | CUT-CANDIDATE>: <plain meaning, and the named fix for FIX-METHOD>.
- **Caveats:** <one line each: dev or held-out, incomplete cells, saturation, pins, deviations>
- **Status:** <merged | draft>, results PR <#n>, claim check <reader and PR | none on record>, grader audit <passed, k of n sampled failures flagged ([grader-audit.md](../../grader-audit.md)) | not applicable: reason>. Words: [glossary](../../glossary.md).

## What ran

## Results

<!-- Include the Headroom section from summarize-run.ts: "k of n tasks can tell the arms apart" and the per-task table. -->

## Why null?

## Deviations

<!-- No run spend in this file: it goes in spend-internal.md beside it, which the public export leaves out. Cost in the body only where it is the lesson. -->

## Disclosures
