Write {{count}} requests for an agent connected to a personal knowledge base ("the brain") that holds these synthetic pages:
{{pages}}

The right tool for each request is `{{tool}}`:
{{description}}

Input schema:
```json
{{schema}}
```

This tool is {{surface_note}}. Make each request clearly need this tool and no other brain tool. Put every needed value in the text.

Answer with a JSON array of {{count}} objects: `[{ "text": "...", "required": { "<argument>": "<exact value from text>" } }]`.
