# Next time: 2026-11-12-fable-5-2-coding-cc322

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Run the loop that makes Claude Code's session folders readable every 20 seconds from the first trial, because at 150 seconds new unreadable files appeared between passes and 8 mid-run copies failed on 6 shards.
- Write the scripts for every preregistered line before the data, because prereg-lines.py, drift.ts and the safety-filter scan were written after it, even though their rules were fixed in advance.
- Add a recognition check that takes Fable 5.2 past 200K tokens of context, because no Fable 5.2 attempt passed 200K, so the preregistered check for no compaction before about 900K tokens was never exercised.

### Ideas to improve the eval

- Make the refusal counter catch safety-filter stops that show only in the transcripts, because it missed 8 such stops in this run (3 Fable 5.2, 3 Fable 5.1 and 2 Opus 5.5) that a transcript scan found.
- Compare Fable 5.2 with Opus 5.5 on a harder test-scored task set, because the two were close on this set and the preregistered verdict for this null is a set with more headroom for Opus.
