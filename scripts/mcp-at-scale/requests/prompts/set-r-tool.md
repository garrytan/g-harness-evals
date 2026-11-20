Write {{count}} requests whose one right tool is `{{tool}}` on the {{service}} server.

What the tool does (its own description):
{{description}}

Its input schema:
```json
{{schema}}
```

The same agent is also connected to other servers, including these near-twins of {{service}} that do a similar job:
{{twins}}

Write them in these strata:
- {{capability_only}} requests that are **capability-only**: the job and its object make `{{tool}}` the right tool, but the text names no product or service at all. Do not use any of these words: {{banned_words}}.
- {{names_service}} requests that **name the service**, using one of these words: {{service_words}}.
- Of all {{count}}, make {{bait}} of them **near-twin bait**: the wording should tempt an agent towards {{bait_twin}} (a similar job, similar nouns), while the text still makes `{{tool}}` the only right choice. Spread the bait across both strata. Leave bait out if no near-twin is listed.

Answer with a JSON array of {{count}} objects:
```json
[{ "text": "...", "stratum": "capability_only" | "names_service", "bait": true | false, "bait_twin": "<server name or null>",
   "required": { "<argument>": "<exact value that appears in text>" } }]
```
"required" names only the arguments a correct call must carry, with values copied exactly from your text.
