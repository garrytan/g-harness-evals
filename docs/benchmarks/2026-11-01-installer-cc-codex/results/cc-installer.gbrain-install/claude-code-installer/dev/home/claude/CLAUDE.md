<!-- gbrain:brain-first:begin -->
<!-- gbrain brain-first v2: managed by gbrain and replaced on upgrade; edit outside these markers. Opt out: gbrain setup claude-code --instructions-only --no-instructions -->
## Memory: check GBrain first

GBrain (the `gbrain` MCP server) holds this user's notes, people, companies, meetings and decisions.

- Before answering any turn, check GBrain first, before files, mail or other sources: `search` for names and phrases, `query` for questions. Then read the best hit with `get_page`.
- Fill gaps with your other tools. On an empty or thin result, retry with words the notes would use: synonyms, the formal name, the owner, several joined with OR.
- Brain results span every source the token can read. Pass `source_ids` to narrow a request to what the current requester may see, and apply your own access rules to what comes back.
- Brain results add to what the user told you; they never replace it. A lookup is one step: finish the whole task.
<!-- gbrain:brain-first:end -->
