// The Agent SDK driver of the Claude Code adapter (H10 PR 4, HARN-18; harnesses/routes/README.md, "Routes on four harnesses").
// adapter.sh runs it in place of `claude -p` for the sdk-preset and sdk-default drivers, one process per turn, as
//
//   node sdk-driver.ts --driver sdk-preset|sdk-default --claude <path> --model <model> --mcp-config <file> --session-id|--resume <id>
//
// with the prompt on stdin. It drives the same pinned CLI binary through @anthropic-ai/claude-agent-sdk (package.json, the
// release whose claudeCodeVersion is the CLI's pin), with what the cli driver passes: bypassPermissions, WebSearch and WebFetch
// disallowed, the adapter's --mcp-config file with --strict-mcp-config, and the adapter's UUIDv5 session id (sessionId on a
// session's first turn, resume after). settingSources is ["user"], so $CLAUDE_CONFIG_DIR's settings.json, CLAUDE.md and skills
// load as the CLI loads them. sdk-preset sets systemPrompt to the claude_code preset; sdk-default leaves it unset, which the SDK
// sends to the CLI as an empty custom prompt. Every SDK message goes to stdout as one JSON line: the CLI's own stream-json
// records (system init, assistant, user, result), which adapter.sh reads exactly as it reads `claude -p` output.
//
// Exit: 0 when the SDK's stream ended without an error; 1 when the SDK threw (the CLI exited non-zero or could not start), after
// every record it yielded was printed; 2 for bad arguments; 143 after SIGTERM or SIGINT, which abort the query (the SDK stops the
// CLI child) before the driver exits.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const usage = (why: string): never => {
  process.stderr.write('sdk-driver: ' + why + '\n');
  process.exit(2);
};

let values: Record<string, string | undefined> = {};
try {
  ({ values } = parseArgs({
    options: { driver: { type: 'string' }, claude: { type: 'string' }, model: { type: 'string' }, 'mcp-config': { type: 'string' }, 'session-id': { type: 'string' }, resume: { type: 'string' } },
    strict: true,
  }));
} catch (e) {
  usage((e as Error).message);
}
const driver = values.driver;
if (driver !== 'sdk-preset' && driver !== 'sdk-default') usage('--driver must be sdk-preset or sdk-default, not ' + JSON.stringify(driver));
for (const k of ['claude', 'model', 'mcp-config']) if (!values[k]) usage('--' + k + ' is required');
const sessionId = values['session-id'], resume = values.resume;
if (!sessionId === !resume) usage('give exactly one of --session-id and --resume');

const abortController = new AbortController();
let signalled = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    signalled = true;
    process.stderr.write('sdk-driver: ' + sig + ', aborting the query\n');
    abortController.abort();
  });
}

const options: Options = {
  pathToClaudeCodeExecutable: values.claude,
  cwd: process.cwd(),
  model: values.model,
  settingSources: ['user'],
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  disallowedTools: ['WebSearch', 'WebFetch'],
  strictMcpConfig: true,
  extraArgs: { 'mcp-config': values['mcp-config']! },
  abortController,
  stderr: (data) => process.stderr.write(data),
  ...(driver === 'sdk-preset' ? { systemPrompt: { type: 'preset', preset: 'claude_code' } as const } : {}),
  ...(sessionId ? { sessionId } : { resume }),
};

let code = 0;
try {
  for await (const message of query({ prompt: readFileSync(0, 'utf8'), options })) process.stdout.write(JSON.stringify(message) + '\n');
} catch (e) {
  process.stderr.write('sdk-driver: ' + (e as Error).message + '\n');
  code = 1;
}
process.exitCode = signalled ? 143 : code;
