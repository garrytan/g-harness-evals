# Prototype 001: stream the order export with readline

## Verdict: VALIDATED

Question: Can Node's built-in readline stream the nightly order export and total amount_cents per region while memory stays flat as the file grows?

Evidence:
- node prototypes/001-readline-stream/stream-totals.mjs data/sample-orders.csv
  prints {"rows":20,"totals":{"north":6390,"south":11038,"east":14990,"west":10033},"peak_rss_mb":45}, the same totals importer/current.js prints.
- node prototypes/001-readline-stream/make-big.mjs /tmp/big.csv 5000000 writes a 196 MB file with 5,000,000 rows.
- /usr/bin/time -v on the streaming script over that file: maximum resident set 87,000 KB, 2.9 s wall clock.
- /usr/bin/time -v on importer/current.js over the same file: maximum resident set 705,080 KB, 2.8 s wall clock.

What worked: readline with crlfDelay: Infinity over a read stream keeps resident memory around 85 MB for a 196 MB file, against 705 MB for the read-everything importer, at the same speed. CRLF line endings total correctly.

What failed or surprised us: the naive split(',') breaks on quoted fields. A row with "south" in quotes was totalled under its own key with the quotes in it. The sample has no quoted fields, but if the real export ever quotes a column, the parser needs a real CSV tokenizer. Not measured: a full 2 GB file (extrapolated only).

Recommendation: ship. Next production step: rewrite the importer around readline (or a streaming CSV parser if quoted fields can appear), with a test that feeds a quoted and a CRLF row, then run it once against a real 2 GB export and record peak RSS.

## Files

- stream-totals.mjs: the streaming totaller, with a peak RSS reading.
- make-big.mjs: writes a synthetic export of N rows for the memory test.
