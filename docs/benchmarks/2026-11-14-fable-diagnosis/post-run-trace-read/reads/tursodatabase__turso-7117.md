# tursodatabase__turso-7117
Passes: X 0 of 2, Y 2 of 2
Fault named in the instruction: no (the issue shows the repro and the expected result, a gone sqlite_sequence row, but names no file or function)
- X-a1 FAIL: right place but incomplete or wrong fix. It worked in `core/translate/alter.rs` but made ALTER COLUMN reject any primary-key column with an error, so the issue's own repro now errors instead of succeeding with the stale sequence row removed.
- X-a2 FAIL: right place but incomplete or wrong fix. Same choice, widened to UNIQUE columns too: the repro's ALTER is refused rather than carried out, which changes behaviour the issue expected to keep working.
Passing tries did differently: Both Y tries let the ALTER go through and deleted the table's `sqlite_sequence` row (reusing the DROP TABLE delete path) and cleared the in-memory AUTOINCREMENT flag in `core/vdbe/execute.rs`, so the next insert does not recreate the row.
Rating: STRONG, favours Y. Both X tries chose to forbid the operation and both Y tries made it work as the reporter expected, and that choice lines up exactly with the grades.
