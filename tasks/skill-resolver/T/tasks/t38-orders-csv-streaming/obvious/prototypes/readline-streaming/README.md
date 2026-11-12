# Can readline stream the order export?

**Short answer: yes.** Streaming the file line by line with readline keeps memory roughly flat, while the current importer grows with the file.

## What I built

totals.mjs reads the CSV through fs.createReadStream and readline.createInterface, skips the header, and adds amount_cents per region. It prints the totals and the peak resident memory it saw.

## How I tested

1. Ran it on data/sample-orders.csv. Totals match importer/current.js (north 6390, south 11038, east 14990, west 10033).
2. Generated a 196 MB file with 5 million rows and ran both scripts under /usr/bin/time -v.

## Results

| Script | Peak RSS | Wall time |
|---|---|---|
| importer/current.js | about 705 MB | 2.8 s |
| totals.mjs (readline) | about 87 MB | 2.9 s |

## Caveats

- The parsing is a plain split on commas, so quoted fields with commas would break it.
- I did not test a full 2 GB file.

## Next steps

Rewrite importer/current.js around readline, add a CSV parser if the export can contain quoted fields, and test against a real nightly file.
