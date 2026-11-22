# Post-run audit scripts, gbrain-install-2026-11

These scripts produced audit1.json, audit2.json, audit3.json and AUDITS.md one folder up. They read the raw run data, which is not in git. Fetch and unpack the private raw archive raw-2026-11-17-gbrain-install--run first (see docs/raw-archive.md). Its run/ folder is the `<run dir>` below. `<audits dir>` is any empty folder for the outputs.

Run them from this checkout, in this order:

1. `bun recall-events.ts <run dir> <audits dir>/scratch` lists the recall turn's gbrain calls for every recalled trial.
2. `bun save-events.ts <audits dir>/scratch` lists the save turn's gbrain calls for the same trials.
3. `PGLITE_TOOLS=<dir> bash run-brains.sh <run dir> <audits dir> <shard>...` copies each recalled trial's brain and records where it holds the nonce (brain-dump.ts). `<dir>` must hold node_modules/@electric-sql/pglite 0.4.3, the version gbrain v0.60.734.0 ships.
4. `python3 audit1.py <run dir> <audits dir>` runs Audit 1.
5. `bun audit2.ts <run dir> <audits dir>` runs Audit 2.
6. `bun audit3.ts <run dir> <audits dir>`, then `bun audit3-noversion.ts <run dir> <audits dir>`, runs Audit 3. It calls this checkout's scripts/gbrain-install/verdict.ts, which pins.sha256 holds at the run's version.
7. `python3 make-md.py <audits dir>` writes AUDITS.md.

## Rerunning these scripts

- Pass run-brains.sh every shard that holds a recalled trial. Audit 1 reports a trial whose shard was left out as "unknown: brain not in the copy", the same label it gives a brain that really is missing.
- Run one run-brains.sh batch at a time. Batches share one scratch database and one brains.json, so two at once can overwrite each other's results.
- The scripts write their outputs with your default file permissions, which usually lets other users on the machine read them. The scratch files hold tool replies from the raw archive, so keep `<audits dir>` in a private folder (for example, create it with `mkdir -m 700`).

The TypeScript scripts import the scorer from this checkout's scripts/gbrain-install/. tests/gbrain-install-audits.test.ts runs steps 1, 2, 5 and 6 on two committed trials, and step 7 on the committed audit files.
