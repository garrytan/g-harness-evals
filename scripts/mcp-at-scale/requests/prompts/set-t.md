Write {{count}} short multi-step tasks for an agent connected to these servers and tools:
{{core_tools}}

Each task takes {{min_steps}} to {{max_steps}} tool calls on at least two different servers, in a chain: the result of one call names the value the next call needs (for example, a search returns an issue number that a later update uses). The text gives only the starting value; the agent must find the rest.

For each step, write the call the agent should make, the argument values that call must carry, and the result the fake server returns. A step's result must contain the exact value the next step needs.

Answer with a JSON array of {{count}} objects:
```json
[{ "text": "...", "steps": [{ "server": "...", "tool": "...", "match": { "<argument>": "<exact value>" }, "result": { "json": { } } }] }]
```
The first step's match values must appear in "text". Every later step's match value must appear in the result of the step before it.
