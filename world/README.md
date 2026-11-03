# world: the simulated company

The world is what a trial acts on: Pemberline Systems (14 employees, 16 accounts, two years of chat, mail,
contracts and notes) imported from messy-company-v1, served as a Slack-compatible workspace, a file share, a
calendar and mailboxes behind one MCP server, on a frozen simulation clock, with every call written to an
evaluator-owned event log. Graders read the event log and the world state, never the agent's reply
(methodology items 2, 4, 5, 7 and 8).

| Path | What it is |
|---|---|
| [`seed/`](seed/README.md) | `import.ts`, the imported `world.json`, its `MANIFEST.json` and the mapping rules |
| [`brain/`](brain/README.md) | not Pemberline: the qm-brain-native (K8) corpus, a seeded keyless generator for one synthetic company's brain, its audience manifests, the dev and pilot tasks and the leak scanner (`bun world/brain/check.ts`) |
| `services/world.ts` | the state and access rules both surfaces share |
| `services/slack/` | the Slack Web API mock and the Socket-Mode-style event stream |
| `services/clock/` | the frozen simulation clock |
| `services/events.ts` | the append-only event log |
| `services/gbrain-tap.ts` | `POST /gbrain`: relays a harness's gbrain MCP calls to the trial's gbrain sidecar and records them (the gbrain arm, [docs/gbrain-arm.md](../docs/gbrain-arm.md)) |
| `services/server.ts`, `services/start.ts` | one process serving all of it for one trial |
| `world-mcp/` | the MCP server (Streamable HTTP, plus a stdio bridge) every harness gets |
| `types.ts` | record shapes |

## Start the world for one trial

```bash
bun world/services/start.ts --trial t-0001 --split dev --port 8790 --out results/local/trials/t-0001
```

This loads `world/seed/world.json`, keeps only the `dev` records (or `heldout`, or `both`), mints per-trial
tokens, and serves on `127.0.0.1:8790`:

| Endpoint | Who | What |
|---|---|---|
| `POST /api/<method>` | actors and the bot, by token | Slack Web API: `auth.test`, `users.list`, `users.info`, `users.lookupByEmail`, `conversations.list`, `users.conversations`, `conversations.info`, `conversations.members`, `conversations.history`, `conversations.replies`, `conversations.open`, `chat.postMessage`, `search.messages`, `team.info`, `apps.connections.open` |
| `GET /socket?ticket=<app token>` | the bot | websocket event stream (below) |
| `POST /mcp` | actors and the bot, by bearer token | world-MCP over Streamable HTTP |
| `POST /gbrain` | the bot, by its bearer token | the gbrain tap (below); exists only when the server was given a gbrain upstream |
| `GET /clock` | anyone | the simulation clock |
| `POST /clock/advance` | runner, admin token | `{"seconds": N}` or `{"to": "<ISO instant>"}`, forward only |
| `GET /admin/snapshot`, `GET /admin/events`, `POST /admin/fence`, `GET /admin/socket` | runner, admin token | state for graders, the in-memory event list, stop accepting writes (contract item 7), socket connection count |
| `POST /admin/gbrain/requester` | runner, admin token | internal-task: `{"member": "<id>"}` or `{"member": null}`, the member whose gbrain token the tap presents under member scope (below); logged as a `gbrain.requester` admin event |
| `POST /admin/gbrain/flush` | tests and tools, admin token | internal-task: waits (up to the queue's 120 s deadline, which this server's idle timeout matches) until every message posted so far is written into the brain by the live ingestion (below) and answers `{ok, ingest, written, skipped, failed}`; `ingest: "off"` with nothing written when the trial has no ingestion. The runner's trial world calls the module in process instead |
| `GET /healthz` | anyone | liveness |

It writes `<out>/trial.json` and appends to `<out>/events.jsonl`. Both are evaluator-owned: the runner reads
`trial.json` to build the harness's MCP config and the actor scripts, and nothing from it goes into a prompt.
Options: `--actors a,b` limits which members get tokens (default: all 14 employees), `--clock <ISO>` sets the
reference instant (default 2026-10-14T09:00:00-05:00, the world's "today"), `--host` binds elsewhere for a
container network, `--world` points at another seed.

### Credentials and the MCP config shape

`trial.json` has this shape (values elided):

```json
{
  "trial_id": "t-0001", "split": "dev", "world_id": "pemberline-messy-company-v1",
  "base_url": "http://127.0.0.1:8790",
  "clock": { "reference": "2026-10-14T09:00:00-05:00", "time_zone": "America/Chicago", "offset_minutes": -300, "advanced_seconds": 0 },
  "events_path": ".../events.jsonl",
  "admin_token": "wadm-...",
  "slack": {
    "api_url": "http://127.0.0.1:8790/api/",
    "bot": { "member": "assistant", "user_id": "UASSISTANT0", "token": "xoxb-...", "app_token": "xapp-..." },
    "mcp": { "http": { "type": "http", "url": ".../mcp", "headers": { "Authorization": "Bearer xoxb-..." } },
             "stdio": { "type": "stdio", "command": "bun", "args": ["<repo>/world/world-mcp/stdio.ts"],
                        "env": { "WORLD_MCP_URL": ".../mcp", "WORLD_MCP_TOKEN": "xoxb-..." } } }
  },
  "actors": [ { "member": "dana-okafor", "slack_user_id": "U...", "token": "xoxp-...", "mcp": { "http": {...}, "stdio": {...} } } ]
}
```

A token is the actor. Each `xoxp-` token maps to one member, `xoxb-` to the bot (the harness under test, a
workspace user named `assistant` that belongs to every loaded channel), `xapp-` opens the socket, and the
admin token is only for the runner. The runner copies one `mcp.http` or `mcp.stdio` block into `run.json`
and the harness's own MCP config (D5); the bearer token or `WORLD_MCP_TOKEN` is the actor every tool call is
attributed to, so attribution never depends on an argument the model controls. The same tokens work against
the Slack API, so a harness's native Slack connector and its MCP calls are the same actor. The runner's
redaction set must include every token in `trial.json`.

## The clock

`services/clock/clock.ts` is a reference instant plus an explicit offset. `now()` never reads wall time; only
`POST /clock/advance` (or the `advanceSeconds`/`advanceTo` methods) moves it, and only forward. Slack `ts`
values for new messages are `<clock seconds>.<global counter>`, so two messages in the same frozen second
stay distinct and ordered. Mail dates, calendar defaults, approval timestamps and the event log's `sim_ts`
all come from it. The world's time zone is America/Chicago at a fixed -05:00 offset; the MCP tool
`clock_now` exposes it to the agent.

## Access rules

Both surfaces call the same `WorldService`, so the rules are identical:

- Channels: a member reads, posts to and searches only channels they belong to; every channel is modelled as
  private, so `conversations.list` shows only memberships. A DM is visible to its members only.
- Files: `private` is owner-only; `team` is the owner, the team and org-wide roles (Ruth, Anselm, June, Moss);
  `public` is everyone. `list_files` returns only what `read_file` would allow.
- Calendar and mail: a member sees events they organize or attend and mail that names them. Drafts stay in
  the author's mailbox and are never sent. A draft's recipients are resolved against the directory: a member
  id, `@handle`, full name or member address becomes that member's address; an address at pemberline.com
  that matches no member is refused (`unknown_recipient`, logged as a `deny`), as a mail server would bounce
  it; any other address is kept as written.
- Directory: `list_members` (Slack `users.list`) returns every member with name, handle, email, role and
  team to anyone; it is logged as a read with no channel target.
- Denied calls are logged as `deny` events with the reason, so a cross-scope attempt is evidence even though
  it returned nothing.

## The event log

`<out>/events.jsonl`, one JSON object per line, appended and never rewritten:

| Field | Meaning |
|---|---|
| `seq` | 1-based, monotonic within the trial |
| `trial_id` | the trial |
| `wall_ts` | real time of the call, ISO-8601 UTC |
| `sim_ts` | simulation clock at the call |
| `actor` | member id the token resolved to; `null` for runner and admin calls |
| `via` | `slack`, `mcp`, `gbrain` (a call relayed by the gbrain tap), `runner` (clock) or `admin` (fence) |
| `tool` | the operation in Slack-method spelling, whichever surface it came through: `conversations.list`, `conversations.history`, `conversations.open`, `chat.postMessage`, `search.messages`, `files.list`, `files.read`, `calendar.list`, `calendar.create`, `mail.list`, `mail.draft`, `request_approval`, `clock.advance`, `admin.fence`; a gbrain call is `gbrain.<tool>`, `gbrain.initialize` or `gbrain.tools/list` |
| `kind` | `read`, `write`, `deny`, `approval`, `clock`, `admin` |
| `args_digest` | sha256 of the canonical JSON of `args` |
| `args` | the call's arguments as received (message text included; this file is evaluator-owned) |
| `outcome` | `ok`, `denied`, `error` |
| `error` | the refusal code on a denied call (`not_in_channel`, `forbidden`, `channel_not_found`, `fenced`, ...) |
| `effect` | what changed or was returned: channel and `ts` of a post, file id and visibility of a read, the distinct `channels` a search's matches came from, `sent: false` on a draft, the full `pending_action` on an approval request, `{pages, count, latency_ms}` on a gbrain call |

A `request_approval` call writes an `approval` event whose `effect.pending_action` names the requester, the
action, the authorization it needs, where the agent says it asked (`{"dm": member}` or
`{"thread": {channel, ts}}`), and the simulation time. It changes nothing else: no message, no mail, no event.
Graders pair it with the Slack event showing the agent actually asked (item 8). `GET /admin/snapshot` returns
channels, messages, calendar, mail and pending actions after the trial, for grading beside the log.

## The gbrain tap

In a gbrain-arm trial the harness gets a second MCP server named `gbrain`, but its URL is `<world>/gbrain` with the
world bot token, never the sidecar itself. `POST /gbrain` (`services/gbrain-tap.ts`) authenticates the caller as
`/mcp` does, replaces the bearer header with the sidecar's token (read from the token file the sidecar wrote,
passed in by the runner or `start.ts --gbrain-url <url> --gbrain-token-file <file>`), forwards the JSON-RPC body
and the `Accept` header to `<upstream>/mcp`, returns the reply with its status and content type unchanged (the
body is relayed whole once the upstream has answered; gbrain's transport is stateless and its replies are
short), and appends one event per JSON-RPC message for `initialize`, `tools/list` and `tools/call` after the
reply, so `outcome` and `effect.latency_ms` are known. Notifications, `ping` and other methods are relayed
without an event. `GET /gbrain` is 405 with `Allow: POST`, as gbrain's own `GET /mcp` is. Without an upstream the
path is a 404 like any other.

The event: `via` `gbrain`, `actor` the bot's member id, `tool` `gbrain.<mcp tool>` (`gbrain.search`, `gbrain.get_page`,
`gbrain.remember`, ...), `gbrain.initialize` or `gbrain.tools/list`; `kind` `write` for `remember`, `forget`,
`put_page`, `edit_page`, `capture`, `add_timeline_entry`, `cancel_write_request`, `cancel_job` and `mute_notice`,
`read` for every other tool and for `initialize` and `tools/list`; `args` the `tools/call` arguments as sent (`{}` for
the other two); `outcome` `ok`, or `error` with `error` gbrain's own error code when a result with `isError` carries one
(`permission_denied`, `page_not_found`, ...), `tool_error` for one that does not, `rpc_<code>` (a JSON-RPC
error), `upstream_<status>` (a non-2xx from the sidecar) or `upstream_unreachable`; `effect` `{pages, count,
latency_ms}` where `pages` are the gbrain page slugs the call returned or targeted: every `slug` in the rows of
`search` and `query` (`count` is the row count), the requested slug for `get_page`, `put_page` and `edit_page`, every
slug listed by `list_pages`, and for `recall`, `entity`, `context_pack` and the rest whatever `slug` values appear in
the result's JSON content (`_meta` notices are skipped, so a suggested call never counts as a page touched); for
`tools/list` `pages` is empty and `count` the number of tools. `seq`, `sim_ts` and `args_digest` come from the log
as for every event, so a gbrain call inside a turn window is attributed to that turn's requester like a world
call, and a search whose rows come from a channel the requester is not in is a cross-scope read for the grader
(lane E). `tests/gbrain-tap.test.ts` proves this against a fake upstream.

internal-task (company brain), member scope: when the runner hands the tap the company brain's `tokens.json` (one granted
token per member and a `public_only` token) beside the unscoped token, the tap presents the token of the member
whose turn is running, named by the runner through `POST /admin/gbrain/requester` at each turn's start, or the
public-only token before the first turn and after the last. The requester is read once per request before the body
is awaited, so a turn boundary cannot swap a request's token. Every gbrain event carries `grant`: `bot` (the unscoped
token, every arm without member tokens or source grants), a member id, or `public-only`. A requester with no token in the file is
answered 502 and logged nowhere (the runner checks the file against the task's actors before the trial starts,
HE-GBRAIN-004). The grader counts a refused targeted read (`error` `page_not_found` or `permission_denied`) as a
cross-scope attempt the brain blocked, so a scoped arm's leaks separate into pages returned and pages refused.

internal-task (member brain), live ingestion (`services/gbrain-ingest.ts`): when the runner hands the world the member brain's
`ingest-tokens.json` (one token per source) and the manifest's channel map, the world subscribes to its own message
stream and writes every message posted during the trial (an actor's turn, the bot's reply, every post or DM the bot
makes) into the sidecar as one `remember` fact with provenance (who said it, where, when on the simulation clock), into
the source of its conversation (the channel map for a channel, `private-<member>` for a DM between the bot and a
member) under that source's token, one write at a time in posting order. Each write is an event: `via` `runner`,
`actor` null, `tool` `gbrain.ingest`, `kind` `admin`, `args` `{channel, ts, author, source}`, `outcome` `ok` or
`error` with gbrain's code (a retryable answer, `write_error` `write_pending` or `queue_capacity` under code
`unavailable`, is sent again twice first under the same `request_id`, as are a transport failure and a 5xx), `effect`
`{fact_id, source, latency_ms, status}` (`status` `inserted` or `duplicate`); the
fact's time (text, provenance and gbrain's `valid_from`) is the message's posting time in the world's offset. A conversation the
brain has no source for (a DM with a member who holds no token, a group DM, a channel outside the map) is skipped, not
failed: `outcome` `ok`, `fact_id` null, `effect.skipped` with the reason. The runner calls `POST /admin/gbrain/flush`
(`{ok, written, skipped, failed}`; the runner's own trial world calls the module in process) at every turn boundary
and after the fence; a failed write ends the trial (HE-GBRAIN-011), after one failure the rest of the queue is
recorded `not sent: an earlier write failed` without a call upstream, and a flush past its 120 s deadline reports the
writes still pending as one failure. The grader maps a fact a search returned (`effect.facts`) back to its
conversation through the `gbrain.ingest` event with that fact id. `tests/gbrain-ingest.test.ts` proves the routing
and the fact text against a fake upstream.

## Slack event stream

The bot calls `apps.connections.open` with its `xapp-` token and connects to the returned `ws://` URL. The
socket sends `{"type":"hello"}`, then one Socket Mode envelope per `message` event in any channel or DM the
bot belongs to, plus an `app_mention` envelope when the text mentions `<@BOTID>` or `@assistant`:

```json
{ "envelope_id": "env-t-0001-1", "type": "events_api", "accepts_response_payload": false,
  "payload": { "type": "event_callback", "team_id": "T0PEMBERLINE", "api_app_id": "A0WORLDMCP", "event_id": "Ev...",
               "event_time": 1791986400,
               "event": { "type": "message", "channel": "C...", "channel_type": "channel", "user": "U...", "text": "...", "ts": "1791986400.000123", "event_ts": "1791986400.000123" } } }
```

The client acknowledges with `{"envelope_id": "..."}`. Envelopes are not replayed: an event raised while no
client is connected is dropped, as in real Socket Mode, so the runner checks `GET /admin/socket` shows a
connection before driving actor messages. The bot's own posts are delivered too, with `bot_id`, as Slack
does. It is a websocket, not long polling.

## Tests

`bun test tests/` runs offline with no model and no key: import counts and manifest stability (and a
re-import when the messy-company-v1 checkout is present at `~/.capy/work/harness-eval/gbrain-evals` or
`$MESSY_COMPANY_V1`), Slack conformance (membership on reads, a post in history and in the log, DM
visibility, threads, the socket), clock determinism and the admin-only advance, and world-MCP scope over
HTTP and stdio (a member cannot read another's private notes, team files follow team scope, approval
requests record and do nothing, a fenced world refuses writes), and the gbrain tap against a fake sidecar
(authentication, header swap, event shape per tool, upstream errors, batches). The MCP tests use the official
client SDK over both transports.

## Not built yet

- **CalDAV and IMAP/SMTP are not real protocols here.** Calendar and mail exist only as world-MCP tools
  (`calendar_list`, `calendar_create`, `mail_list`, `mail_send_draft`) over in-memory records; a harness's own
  calendar or mail connector has nothing to attach to, and the product-arm probe (M5) needs real endpoints.
- **Mail never sends.** There is no `mail_send`; a draft is the terminal state. A task that requires sending
  needs a send tool with its own effect class.
- **Delegation.** A call is attributed to its token's member. There is no `on_behalf_of` for a shared bot
  acting for several actors in one trial; the multi-user authority mapping (TODOS, eng-r2-native-2 and
  eng-r2-outside-1) decides that.
- **Persistence.** State lives in the process; the snapshot endpoint is the hand-off to graders. There is no
  SQLite copy yet, and no replay of socket envelopes.
- **Thread fidelity.** Threads are flat replies with `thread_ts`; reactions, edits, deletes, files and
  reply counts are not modelled, and `search.messages` is a substring match.
- **Egress and isolation.** The admin endpoints are protected by a token only; the per-trial network
  namespace (contract item 6) is the real boundary and belongs to `runner/egress`.
- **Time zone.** One fixed offset; no DST.
