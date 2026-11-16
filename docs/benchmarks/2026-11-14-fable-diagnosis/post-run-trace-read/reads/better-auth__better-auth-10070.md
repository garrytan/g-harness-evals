# better-auth__better-auth-10070
Passes: X 2 of 2, Y 1 of 2
Fault named in the instruction: yes (the issue names runWithTransaction in core context/transaction and says it should reuse the active transaction like getCurrentAdapter)
- Y-a1 FAIL: right place but incomplete or wrong fix. It made runWithTransaction reentrant and fixed the factory consumeOne/incrementOne fallback, like every passing try, but it joined any active transaction through a plain inTransaction flag with no check of which adapter opened it, while the three passing tries tied reuse to the adapter that opened the transaction; whether that is what the hidden test caught is not visible in the trace.
Passing tries did differently: they recorded the source adapter of the active transaction (transactionOf, transactionOwner, transaction.source) and joined only when the same adapter or its transaction adapter asked, and Y-a2 also refused to join a settled transaction.
Rating: NONE, favours neither. All four tries found the same two places and made near-identical fixes, and the one failure differs only in a reuse-condition detail that its sibling Y try got right.
