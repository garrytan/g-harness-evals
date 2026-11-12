# Ticket router: is prompt v2 better than v1?

Owner: Lena. Written 2026-11-05.

- The router reads an incoming support ticket and picks one of 9 queues (billing, refunds, login, outage, api, data-export, abuse, sales, other).
- Prompt v1 is what runs in production today (prompts/router-v1.txt). Prompt v2 (prompts/router-v2.txt) adds the queue descriptions and four worked examples.
- We want to run both prompts on claude-opus-5-5 and gpt-6.1-sol.
- Labelled data: data/dev.jsonl (240 tickets, labels from the support leads) and data/holdout.jsonl (120 tickets).
- The holdout was already used once: in September, Raj scored router v1 on it with gpt-5.5 for the Q3 review. Nobody has looked at it since.
- Budget for the whole thing: $150, Lena approves anything over that.
- What matters: queue accuracy, and above all fewer outage tickets routed to "other" (those page nobody). Last quarter 7 of 41 outage tickets went to "other".
- Worry from Raj: the scorer just string-matches the queue name, so an answer like "billing or refunds" might get credit.
