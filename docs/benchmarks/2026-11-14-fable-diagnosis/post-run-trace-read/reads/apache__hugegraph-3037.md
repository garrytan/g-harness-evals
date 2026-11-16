# apache__hugegraph-3037
Passes: X 2 of 2, Y 1 of 2
Fault named in the instruction: yes (the issue names HugeCountStrategy and the upstream TINKERPOP-2911 ConnectiveStep fix to port)
- Y-a2 FAIL: other. It pulled the upstream 3.5.8 sources and ported the ConnectiveStep branch and transformToNotStep like the passing tries, but also ported FilterStep branches and changed the always-true and() child so only that child becomes identity(), going beyond upstream; Y-a1 made a similar beyond-upstream identity change and passed, so the trace does not show which difference the hidden test caught.
Passing tries did differently: both X tries ported the upstream code line for line from the published TinkerPop sources and deliberately left the non-upstream identity() and repeat() quirks alone, saying so in the final message; Y-a1 passed with a hand-written rewrite plus the extra identity fix.
Rating: WEAK, favours X. X stayed strictly on the upstream port on both tries while both Y tries changed behaviour beyond upstream, but one Y try passed anyway, so the extra changes are not clearly the cause.
