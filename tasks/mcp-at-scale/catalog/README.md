# MCP tool catalog for the tools-at-scale test

**What this is:** the tool lists of 30 public, open-source MCP servers, captured once at pinned commits, and a nested ladder of 30, 75, 150 and 300 tools built from them. Our fake MCP servers replay these exact tool definitions so every harness sees real-world tool names, descriptions and schemas, while every call lands in a log we grade.

- **Nothing here is a credential or private data.** Placeholders such as `placeholder-not-a-credential` and `example.com` hosts were the only settings any server got. The leak scan result is in `leak-scan.json`.
- **Licences:** every server keeps its own licence. The texts, Apache-2.0 NOTICE files and our modification notices are in `LICENSES/`.
- **Integrity:** `SHA256SUMS` has the sha256 of every file here.

## Where each server came from

| Server name here | Source | Commit | Licence (SPDX) | Capture | Tools |
|---|---|---|---|---|---|
| `atlassian` | [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian/tree/a423ea579955bd4e00bf97ef64effea21f6ad1a3) | `a423ea579955` | MIT | runtime | 96 |
| `cloudwatch` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/cloudwatch-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 19 |
| `cloudtrail` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/cloudtrail-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 5 |
| `aws-pricing` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/aws-pricing-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 9 |
| `s3-tables` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/s3-tables-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 16 |
| `dynamodb` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/dynamodb-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 8 |
| `iam` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/iam-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 29 |
| `amazon-sns-sqs` | [awslabs/mcp](https://github.com/awslabs/mcp/tree/07dd13a50f191297b4ad875e016de20d2266d521/src/amazon-sns-sqs-mcp-server) | `07dd13a50f19` | Apache-2.0 | runtime | 43 |
| `aws-kb-retrieval` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/aws-kb-retrieval-server) | `9be4674d1ddf` | MIT | runtime | 1 |
| `everart` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/everart) | `9be4674d1ddf` | MIT | runtime | 1 |
| `github` | [github/github-mcp-server](https://github.com/github/github-mcp-server/tree/df32d7ec5786e0e71932767fce9982409cbaec40) | `df32d7ec5786` | MIT | runtime | 46 |
| `gitlab` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/gitlab) | `9be4674d1ddf` | MIT | runtime | 9 |
| `google-maps` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/google-maps) | `9be4674d1ddf` | MIT | runtime | 7 |
| `grafana` | [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana/tree/70b04944ed598cfa811d168d7b96a797fd3ee291) | `70b04944ed59` | Apache-2.0 | runtime | 80 |
| `heroku` | [heroku/heroku-mcp-server](https://github.com/heroku/heroku-mcp-server/tree/57c094c2a2e1b7b01f9ae8998bea3edc9fc214da) | `57c094c2a2e1` | Apache-2.0 | runtime | 33 |
| `kubernetes` | [containers/kubernetes-mcp-server](https://github.com/containers/kubernetes-mcp-server/tree/6e0b675bedb4c75e562ab100e408527c1bb10e0c) | `6e0b675bedb4` | Apache-2.0 | runtime | 21 |
| `linear` | [jerhadf/linear-mcp-server](https://github.com/jerhadf/linear-mcp-server/tree/5e2cb621c52762618eb015b4a8d6bf884021b29e) | `5e2cb621c527` | MIT | runtime | 5 |
| `mattermost` | [cloud-ru-tech/mcp-server-mattermost](https://github.com/cloud-ru-tech/mcp-server-mattermost/tree/8976ae4a77180bdeffdc3ffe20362bd253dc7cf8) | `8976ae4a7718` | MIT | runtime | 39 |
| `memory` | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/tree/c799c8552b0f27b7a33a7b9233773da144dddcf5/src/memory) | `c799c8552b0f` | Apache-2.0 AND MIT | runtime | 9 |
| `mongodb` | [mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server/tree/2727403a2776d3dfc7f7d82866624633f5a4e1b4/packages/mongodb-mcp-server) | `2727403a2776` | Apache-2.0 | runtime | 27 |
| `notion` | [makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server/tree/cf16e5c20bfbfb98ecec1227f210ef0ae3abebe5) | `cf16e5c20bfb` | MIT | runtime | 24 |
| `playwright` | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp/tree/2337aff0213d28db41d3e3daf48cee19b3d0bd82) | `2337aff0213d` | Apache-2.0 | runtime | 25 |
| `postgres` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/postgres) | `9be4674d1ddf` | MIT | runtime | 1 |
| `sentry` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/sentry) | `9be4674d1ddf` | MIT | runtime | 1 |
| `slack-bot` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/slack) | `9be4674d1ddf` | MIT | runtime | 8 |
| `slack` | [korotovsky/slack-mcp-server](https://github.com/korotovsky/slack-mcp-server/tree/b88c0de3f706f4f07337c9eda7133c736d1c9524) | `b88c0de3f706` | MIT | static | 22 |
| `sqlite` | [modelcontextprotocol/servers-archived](https://github.com/modelcontextprotocol/servers-archived/tree/9be4674d1ddf8c469e6461a27a337eeb65f76c2e/src/sqlite) | `9be4674d1ddf` | MIT | runtime | 6 |
| `teams` | [floriscornel/teams-mcp](https://github.com/floriscornel/teams-mcp/tree/b01182db9e450a2e3079bfa9a56d3e7f4e029693) | `b01182db9e45` | MIT | runtime | 31 |
| `terraform` | [hashicorp/terraform-mcp-server](https://github.com/hashicorp/terraform-mcp-server/tree/ffe13b794213caef56407b7f16809003882cccce) | `ffe13b794213` | MPL-2.0 | runtime | 10 |
| `time` | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/tree/c799c8552b0f27b7a33a7b9233773da144dddcf5/src/time) | `c799c8552b0f` | Apache-2.0 AND MIT | runtime | 3 |

"runtime" means the server was built from source and asked for `initialize` and `tools/list` over stdio. "static" means the stock server would not list tools without a real credential, so the definitions were read from the pinned source another way; `capture.static_via` in that server's file says exactly how.

## The ladder (`ladder.json`)

**Core (rung 30):** six servers spread through the alphabet of the list above, each trimmed with the switch a user would set, so that no two core tools do the same job. Every test request targets a core tool, so every request runs at every rung.

| Core server | Job | Tools | Switch a user sets |
|---|---|---|---|
| `atlassian` | wiki pages (Confluence) | 5 | ENABLED_TOOLS=confluence_search,confluence_get_page,confluence_get_page_children,confluence_create_page,confluence_update_page |
| `github` | code hosting: issues, pull requests, commits | 5 | --tools list_issues,issue_write,create_pull_request,merge_pull_request,list_commits |
| `grafana` | incident management | 6 | --enabled-tools=incident |
| `mongodb` | document database queries and writes | 5 | MDB_MCP_DISABLED_TOOLS set to every other tool name (22 names, listed in servers/mongodb.json core_filter) |
| `slack` | team chat | 4 | SLACK_MCP_ENABLED_TOOLS=channels_list,conversations_history,conversations_add_message,conversations_search_messages |
| `terraform` | infrastructure registry lookups | 5 | --tools=search_provider_docs,get_provider_details,search_modules,get_module_details,search_policies |

**Bigger rungs** add whole servers (default settings) in a fixed seeded order (seed 20261121), mixing near-twins of core servers (a second code host or issue tracker, other chat apps, other databases, a second wiki, other observability tools) with unrelated servers. Each rung contains the one below it. Sizes may land within 5 tools of the target.

| Target | Tools | Servers | Servers added at this rung |
|---|---|---|---|
| 30 | 30 | 6 | `atlassian`, `github`, `grafana`, `mongodb`, `slack`, `terraform` |
| 75 | 74 | 8 | `postgres`, `amazon-sns-sqs` |
| 150 | 145 | 14 | `google-maps`, `cloudwatch`, `iam`, `gitlab`, `aws-kb-retrieval`, `sqlite` |
| 300 | 303 | 24 | `kubernetes`, `notion`, `cloudtrail`, `dynamodb`, `time`, `memory`, `slack-bot`, `s3-tables`, `teams`, `heroku` |

Server names follow one rule: each server is named after its upstream package or folder with the mcp and server words dropped (github-mcp-server is github, mcp-grafana is grafana, cloudwatch-mcp-server is cloudwatch); the one clash, two Slack servers, keeps slack for korotovsky/slack-mcp-server and names the archived reference server, which runs on a bot token, slack-bot.

Tool names are unique on every rung once the server name is put in front (`<server>__<tool>`). Some bare names repeat across servers (`bare_name_collisions` in ladder.json); that is realistic and is part of the test.

## How the capture was sandboxed

1. The source at the pinned commit was exported with `git archive` and copied into a throwaway Docker container with `docker cp` (no volume mounts).
2. Install ran on an internal Docker network whose only way out was a logging proxy that allows the package registries alone (npm, PyPI, the Go module proxy). npm and pnpm ran with lifecycle scripts off.
3. The server then ran from that container with `--network none`, all capabilities dropped, and only the placeholder settings listed in its file. Our capture client spoke MCP to it over stdin and stdout.

## What was left out, and why

- **getsentry/sentry-mcp** (FSL-1.1-Apache-2.0): Functional Source License, not OSI-approved; the MIT reference Sentry server from modelcontextprotocol/servers-archived is used instead.
- **stripe/agent-toolkit (now stripe/ai)** (MIT): no tool definitions in source: tools live on the hosted server at mcp.stripe.com, and the final local proxy (tag ai-packages-final, a3196df9) only forwards tools/list to it, which needs a Stripe key.
- **cloudflare/mcp-server-cloudflare** (Apache-2.0): every app is a hosted Cloudflare Worker that lists tools only after OAuth; a static reader for its zod tool definitions was not built because the catalog reached 300 tools without it.
- **neondatabase/mcp-server-neon** (MIT): now a hosted Next.js app behind OAuth with no local stdio server; not captured for the same reason as Cloudflare.
- **v-3/discordmcp**: no licence file.
- **SaseQ/discord-mcp** (MIT): logs in to Discord before it serves tools/list (needs a bot token and the network), and its tools are Java annotations with no static reader; Mattermost and Teams stand in as second chat apps.
- **modelcontextprotocol/servers src/filesystem** (Apache-2.0 AND MIT): duplicates the harness built-in file tools.
- **modelcontextprotocol/servers src/fetch** (Apache-2.0 AND MIT): duplicates the harness built-in web fetch.
- **modelcontextprotocol/servers src/git** (Apache-2.0 AND MIT): duplicates git on the local disk through the harness shell.
- **modelcontextprotocol/servers src/everything** (Apache-2.0 AND MIT): a protocol test server, not a service anyone connects for work.
- **modelcontextprotocol/servers src/sequentialthinking** (Apache-2.0 AND MIT): a reasoning aid rather than a service; a model may call it on any request, which would muddy the tool-when-none-needed outcome.
- **modelcontextprotocol/servers-archived src/brave-search** (MIT): duplicates the harness built-in web search.
- **modelcontextprotocol/servers-archived src/puppeteer** (MIT): archived browser server superseded by microsoft/playwright-mcp, which is in the catalog.
- **modelcontextprotocol/servers-archived src/github** (MIT): archived and superseded by github/github-mcp-server, which is in the catalog.
- **modelcontextprotocol/servers-archived src/git** (MIT): duplicates git on the local disk through the harness shell.
- **elastic/mcp-server-elasticsearch** (Apache-2.0): its build fetches a git dependency (elastic/elasticsearch-rs at a pinned revision) from github.com, outside the registry-only egress the capture allows.
- **modelcontextprotocol/servers-archived src/gdrive** (MIT): refuses to start without a Google OAuth credentials file; one tool, so no static reader was built.
- **modelcontextprotocol/servers-archived src/redis** (MIT): connects to a Redis server before it serves tools/list and exits when it cannot.
- **supabase-community/supabase-mcp** (Apache-2.0): answers tools/list only after a call to the Supabase management API with a real access token (fetch failed with the network off); its tool definitions are spread over feature modules with no static reader built.
- **awslabs/mcp (56 other servers)** (Apache-2.0): seven servers for distinct AWS services were enough; aws-api-mcp-server in particular runs AWS CLI commands, close to a shell.
- No single tool was dropped from a kept server: none duplicates the harness built-ins (local files, a shell, web fetch, git on the local disk). Remote file tools such as GitHub's `get_file_contents` act on a hosted service, not the local disk.

## Rebuild and check

```sh
bun scripts/mcp-at-scale/catalog/capture.ts        # needs Docker; spends nothing, uses no keys
bun scripts/mcp-at-scale/catalog/build-ladder.ts   # ladder.json, LICENSES/, this README
bun scripts/mcp-at-scale/catalog/scan.ts           # leak-scan.json, SHA256SUMS
bun test tests/mcp-at-scale-catalog.test.ts
```

Installs use each repository's own lockfile (npm ci, pnpm --frozen-lockfile, uv sync --frozen, go.sum), and each file records the base image digest, so a re-capture should list the same tools. build-ladder.ts reads licence texts from the source caches that capture.ts leaves in its work folder.
