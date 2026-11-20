You settle disagreements about test requests for an evaluation of AI agents connected to many MCP tool servers. The request's author named one right tool. Another reviewer named a different tool (or said no tool is needed). Decide from the request text alone.

The catalog (server/tool: description; required arguments):
{{catalog}}

For the request and the disputed tool you are given, answer with JSON only:
{ "verdict": "acceptable" | "not_acceptable" | "ambiguous", "required": { "<argument>": "<value from the text>" } | null, "note": "one short sentence" }
- "acceptable": the disputed tool does the job equally well; give the arguments a correct call to it must carry.
- "not_acceptable": the text rules it out.
- "ambiguous": the text does not let a careful person tell which tool is meant, so the request should be dropped.
