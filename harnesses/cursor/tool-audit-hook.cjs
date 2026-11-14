// A Cursor command hook for postToolUse and postToolUseFailure (https://cursor.com/docs/hooks), the documented record
// of every tool call the CLI runs. It reads the hook's JSON input on stdin and appends one line to the log file named on
// its command line: the hook event, tool_name and failure_type, and a time. Nothing else from the input is kept (no tool
// input or output, so no file contents, commands or keys), and it answers with an empty object, which changes no call.
// scripts/cursor/web-tool-audit.ts reads the lines (harnesses/cursor/README.md, "Web tools").
'use strict';
const fs = require('fs');
const out = process.argv[2];
let s = '';
process.stdin.on('data', (d) => (s += d));
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(s); } catch { ev = { unparsed: true }; }
  const line = { at: new Date().toISOString(), event: ev.hook_event_name ?? null, tool_name: ev.tool_name ?? null };
  if (ev.failure_type) line.failure_type = ev.failure_type;
  if (ev.unparsed) line.unparsed = true;
  if (out) fs.appendFileSync(out, JSON.stringify(line) + '\n');
  process.stdout.write('{}\n');
});
