# gbrain sidecar

The gbrain arm of the multi-user evaluation asks whether a harness does better or worse on the held-out tasks when [gbrain](https://github.com/garrytan/gbrain), a knowledge brain with an MCP server, is installed beside the world tools. This directory is the sidecar that provides it: one container per trial, a fresh brain per trial, keyless, serving gbrain's MCP over HTTP to the world's tap. The design, the rationale and the smoke evidence are in [docs/gbrain-arm.md](../docs/gbrain-arm.md); the pins are in [pin.json](pin.json).

| File | What it is |
|---|---|
| `Dockerfile` | builds the sidecar image: gbrain at `GBRAIN_COMMIT` (default the pin, `089bf0d8`, 0.60.431.0; a shallow fetch of exactly that commit) run from source with bun 1.4.4, four prebuilt keyword PGLite brains: `/brains/dev` and `/brains/heldout` (bot-visible) and `/brains/dev-company` and `/brains/heldout-company` (the company brain, below), and `/install`, the install bundle (internal-task, below); the `embedded` target adds `/brains/dev-embedded` and `/brains/heldout-embedded` |
| `build-brain.ts` | builds one brain from the corpus and `world/seed/world.json` with no key in the environment: `--brain bot-visible` stages the bot-visible pages into one source; `--brain company` stages every record of the split into one federated source per reader set, mints one token per member and writes `tokens.json`; `--embeddings openai:text-embedding-3-small` (bot-visible only) embeds the pages through `OPENAI_BASE_URL`; all write `manifest.json` |
| `build-install.ts` | internal-task: runs gbrain's documented install commands for OpenClaw and Hermes at image build (`skillpack scaffold`, `compile-context`) into `/install` with a manifest of every file's sha256 and the kept context slugs |
| `export-install.sh` | internal-task: exports one harness and split view of `/install` to a mounted directory with its own manifest and digest (HE-GBRAIN-006 on a bad request) |
| `entrypoint.sh` | per trial: copies the brain named by `HE_GBRAIN_SPLIT`, `HE_GBRAIN_BRAIN` and `HE_GBRAIN_EMBEDDINGS` to `/brain`, mints a bearer token into `$HE_GBRAIN_OUT/token`, under `HE_GBRAIN_SCOPE=member` copies the member tokens to `$HE_GBRAIN_OUT/tokens.json`, serves `--surface $HE_GBRAIN_SURFACE` until SIGTERM; an embedded brain needs `OPENAI_BASE_URL` (the proxy route, logged, never a key) |
| `pin.json` | commit, version, engine, the two surfaces with their tool counts, the exact init, import and serve commands and environment for every brain, the embedding model and route, the install commands with the doc lines they come from and the excluded shapes |

## Build

From the repository root (the Dockerfile copies `gbrain/`, `world/types.ts` and `world/seed/world.json`; the root `.dockerignore` keeps the context to those):

```sh
docker build -f gbrain/Dockerfile -t harness-eval/gbrain:dev .      # or: scripts/build-gbrain-image.sh [--gbrain <sha>] [--tag <tag>] [--embedded]
```

The build fetches gbrain at the pinned commit (`--build-arg GBRAIN_COMMIT=<sha or branch>` for another; `GBRAIN_VERSION` is checked only when set, so a candidate commit builds without editing this file), runs `bun install --frozen-lockfile`, fetches the messy-company-v1 corpus from gbrain-evals at `6999ebc9` with a sparse checkout, and builds each of the four brains in its own stage at `/brain` (gbrain records absolute paths inside a brain, so it is served from the path it was built at). The build fails when a page world.json lists is missing from the corpus or when an import count differs from the page count (per source for a company brain). A company brain takes about 95 s on a 4-core machine (39 `sources add` and up to 28 `import` calls, then 16 `auth create` and `auth rescope` pairs); the install stage (`build-install.ts`, below) about 3 s; the image takes about 6 minutes warm and is about 1.7 GB. `/opt/sidecar/image.json` inside the image records the resolved gbrain commit and the checkout's VERSION.

**Embedded brains (internal-task).** `scripts/build-gbrain-image.sh --embedded [--tag <tag>]` builds the keyword target, then starts the metering proxy with a scratch ledger and a $1 lease beside `gbrain/.build/`, runs the Dockerfile's `builder` stage as a container with `gbrain/.build/brains/<split>-embedded` bind-mounted at `/brain` and `OPENAI_BASE_URL=http://host.docker.internal:<port>/gbrain-image/openai`, builds each bot-visible brain with `build-brain.ts --embeddings openai:text-embedding-3-small` (`init --embedding-model`, `import`, `embed --stale --catch-up --json --yes`, then a dry run proving the backlog empty), writes the proxy's usage summary into each brain's `manifest.json`, and builds the `embedded` target, which copies the two directories to `/brains/<split>-embedded`. The container sees the route and never a key (gbrain sends `Bearer unauthenticated`; the proxy injects the key on the host and meters every call); `OPENAI_API_KEY` must be in the shell that runs the script, for the proxy only. `--dry-run` prints the commands and the missing prerequisites. A failed docker build prints HE-GBRAIN-007 with the failing stage and the last 20 lines of `gbrain/.build/build.log`.

While the gbrain arm (`gbrain-arm-2026-10`, image `harness-eval/gbrain:dev`) is between its preregistration and its report, build this image under its own tag, `docker build -f gbrain/Dockerfile -t harness-eval/gbrain:company .`, and run with `--gbrain-image harness-eval/gbrain:company`; the `:dev` tag that arm's trials record stays what it was.

`bun gbrain/build-brain.ts --split heldout [--brain company] --corpus <gbrain-evals>/eval/data/messy-company-v1/corpus --out /tmp/brain --staging /tmp/staging --gbrain "bun <gbrain>/src/cli.ts"` builds a brain outside Docker, for inspection; `HE_GBRAIN_BUILD_TEST=1 bun test tests/gbrain-brain.test.ts` builds and serves the held-out company brain against a local gbrain checkout and proves the grants.

## What the brain holds, and why

Exactly the slice of the Pemberline corpus the bot can already read in the world, for one split: the chat pages that became channels (the `source_slugs` of every non-DM channel loaded for the split; the two DM pages are left out) and the files with visibility `public` (Moss's digests and the public notes). Held-out: 7 channel pages and 18 public files, 25 pages. Dev: 7 and 11, 18 pages. Each page keeps its corpus path under the split, so its gbrain slug is `<split>/<corpus slug>`, for example `heldout/chats/coastal-team-banter` or `heldout/agent-notes/2026-02-01-coastal-digest`. `manifest.json` in each brain lists every page with the world record it came from and the sha256 of its source file, plus gbrain's import summary.

The bot-visible brain changes retrieval, not information access: a harness with gbrain can search, read and remember, but it cannot reach anything the world would not show it, so the organisation rules in the preamble stay identical between arms and the preamble is not changed.

## The company brain

`/brains/<split>-company` holds every record loaded for the split, the way a company brain is deployed: one brain, every page, many people asking through one bot. Held-out: 108 pages (7 channel pages, 20 contracts, 4 tickets, 8 CRM notes, 8 account profiles, 10 weekly updates, 14 digests, 6 notes of which 2 private, 21 emails, 10 meetings); dev: 118 (including the two DM pages and 3 private notes). Page slugs are the same `<split>/<corpus slug>` as in the bot-visible brain, so the grader's slug mapping (docs/tasks.md, "gbrain reads") applies to every page.

The pages are grouped into gbrain **sources**, one per distinct set of members who may read the record in the world: the channel's members for a chat or DM page, everyone for a public file, the owner plus the team plus the org-wide roles for a team file (the world's `canReadFile` rule), the owner for a private note, the mailbox members for an email, the organizer and attendees for a meeting. Source ids are `public`, `private-<member>`, `team-<short>` (team plus org-wide), `team-<short>-members` (the team alone), `channel-<name>`, else `readers-<8 hex of sha256 over the sorted member ids>`; the held-out split has 28 reader sets, plus an empty `private-<member>` source for each of the 11 employees without a private note, 39 sources. Every source is created `--federated`, so a token with no source grant (the per-trial bot token the entrypoint mints) reads all of them: at the pinned commit a new source is non-federated by default and an ungranted remote token reads only federated sources, which would have left the unscoped brain empty.

`tokens.json` beside the brain holds one bearer token per employee and for Moss (15), each created with `gbrain auth create member-<id>` and narrowed with `gbrain auth rescope --token member-<id> --sources private-<id>,<every source whose readers include the member>` (the first entry is the write source, so a `remember` lands where only that member's turns read), plus `public-only`, granted `public` alone. gbrain enforces the grant on `search`, `query`, `recall`, `entity`, `list_pages` and `get_page`: a page outside the grant answers `page_not_found` (or `permission_denied` when the call names the source). The manifest lists the sources with their readers and the grants without secrets; `tests/gbrain-brain.test.ts` checks the grants against the world rule page by page and, with `HE_GBRAIN_BUILD_TEST=1`, builds and serves the brain to prove them. The tokens are plaintext in the image layer: the image is built and used on one machine and never pushed to a registry, the tokens unlock only a per-trial copy of the brain reachable on the host loopback, the harness never sees the sidecar's address, the per-trial copy under `<trial dir>/gbrain/` is excluded from committed results, and the receipts scan for `gbrain_[0-9a-f]{20}` covers it.

A company brain is served with `GBRAIN_REMOTE_PRIVATE_PAGES=1`. gbrain's default hides every page whose frontmatter says `visibility: private` from every remote caller, owner included; the five private notes in the corpus carry that line. The company-brain run measures the harness and the source grants, not that page-level default, so the entrypoint switches it off for company brains only; the default itself is a finding the report carries (a deployer whose private documents carry gbrain's frontmatter gets page-level protection without any grant).

How the brain is picked and scoped per trial is in [docs/gbrain-arm.md](../docs/gbrain-arm.md), "Company brain": the cell's `gbrain.brain` and `gbrain.scope`, the entrypoint's `HE_GBRAIN_BRAIN` and `HE_GBRAIN_SCOPE`, and the world tap presenting the requesting member's token under member scope.

Embeddings are off in the keyword brains (`gbrain init --no-embedding`, `gbrain import --no-embed`): the brain makes no model or embedding call, search is keyword-only, and every search result carries gbrain's `degraded_recall` notice saying so. The sidecar's environment has no API key, and the entrypoint refuses to start if it finds one. The embedded brains (above) make one metered embedding call per distinct query through `OPENAI_BASE_URL`; the entrypoint sets `GBRAIN_QUERY_EMBED_TIMEOUT_MS` from pin.json for them, and past it gbrain continues keyword-only and stamps the reply `search_degraded`.

## The install bundle (internal-task)

`/install` holds what gbrain's own documentation tells a user to run for OpenClaw and Hermes at the pinned commit, run once at image build by `build-install.ts` with no key: `openclaw/workspace/skills` from `gbrain skillpack scaffold --harness openclaw --workspace <workspace>` (64 skills, 127 files, including `brain-ops`), `hermes/workspace/skills` from `gbrain skillpack scaffold --all --workspace <workspace>` (the same files), and `hermes/<split>/.hermes.md` from `gbrain compile-context --target hermes --include-core` against each split's bot-visible brain (dev 18 pages and about 700 tokens, held-out 25 pages and about 940 tokens: every page as slug, title and excerpt). `manifest.json` lists the commands as run, every file's sha256 and size, the kept slugs of each context file, and one digest over the whole bundle. `export-install.sh <harness> <split> <dest>` copies one view (`workspace/` and, for Hermes, `.hermes.md`) into a mounted directory with a manifest of those files and a `view_digest` (sha256 over `<path> <sha256>` lines in path order), checking the copy with `sha256sum -c`:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v /tmp/view:/out --entrypoint /opt/sidecar/gbrain/export-install.sh harness-eval/gbrain:dev hermes heldout /out
```

The runner's preflight exports each gbrain-docs cell's view into the run's results and verifies it, and the trial mounts it read-only into the harness container, where the adapter copies it to `/workspace`; those pieces and the cells that select them are described in [docs/gbrain-arm.md](../docs/gbrain-arm.md), "The install ladder".

## Run one by hand

Add `-e HE_GBRAIN_SURFACE=verbs` to serve the seven memory verbs instead of the 33 starter tools; `tools/list` then returns 7 and the page search is `recall`. An embedded brain needs the embedded image, `-e HE_GBRAIN_EMBEDDINGS=openai:text-embedding-3-small`, `--add-host host.docker.internal:host-gateway` and `-e OPENAI_BASE_URL=<proxy slot URL>`; `sidecar.log` then names the route and the timeout.

```sh
mkdir -p /tmp/gb && docker run -d --name gb --user "$(id -u):$(id -g)" -p 127.0.0.1:0:3131 \
  -v /tmp/gb:/he-gbrain -e HE_GBRAIN_SPLIT=heldout -e HE_GBRAIN_OUT=/he-gbrain -e HE_TRIAL_ID=hand harness-eval/gbrain:dev
PORT=$(docker port gb 3131/tcp | head -1 | sed 's/.*://')
until curl -sf "localhost:$PORT/health" >/dev/null && [ -s /tmp/gb/token ]; do sleep 0.25; done
curl -s -X POST "localhost:$PORT/mcp" -H "Authorization: Bearer $(cat /tmp/gb/token)" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"saltmarsh discount","limit":3}}}'
docker stop gb && docker rm gb
```

Replies are SSE-framed JSON-RPC (`event: message` then `data: {...}`); a tool result is `result.content[]`, whose first text entry is JSON (rows with `slug` for `search` and `query`, the page for `get_page`). `GET /mcp` is 405, `/health` needs no token, `tools/list` returns the 33 starter tools in about 27 KB. The container is ready about 5 s after `docker run` (copying the brain takes 0.4 s, minting the token 2 s, starting the server 3 s); the files under `$HE_GBRAIN_OUT` are `token` (mode 0600), `sidecar.log`, `serve.log` and `auth.stderr.log`, none of which carries the token.

The company brain by hand, with member scope: add `-e HE_GBRAIN_BRAIN=company -e HE_GBRAIN_SCOPE=member` to the `docker run` above; `/tmp/gb/tokens.json` (mode 0600) then holds `members` (member id to token) and `public_only`. `jq -r '.members["kwame-adjei"]' /tmp/gb/tokens.json` is Kwame's token: the same `search` for `saltmarsh` under it returns Coastal pages and no Strategic page, `get_page` of `heldout/notes/2025-08-08-ruth-private-orlavine` under it answers `page_not_found` while the same call under `$(cat /tmp/gb/token)` (the unscoped bot token) returns the note, and `search` under `.public_only` returns public pages only. `sidecar.log` names the brain, the scope, the source and grant counts and the gbrain commit. The container is ready about 6 s after `docker run` with a company brain (the brain is 95 MB).

In a trial the runner does all of this (runner/trial/gbrain.ts) and the harness never reaches the sidecar: it reaches `POST /gbrain` on the world server, which authenticates it as the bot, swaps in the sidecar token (or, under member scope, the requesting member's token) and records the call ([world/README.md](../world/README.md)).

## Changelog

### 2026-10-25: Install ladder, sidecar image (internal-task)

harness-evals v0.0.5. `HE_GBRAIN_SURFACE` (starter or verbs) and `HE_GBRAIN_EMBEDDINGS` in the entrypoint, `OPENAI_BASE_URL` passed through and logged as a route; `build-brain.ts --embeddings`; `GBRAIN_COMMIT` as a shallow fetch of any commit with `GBRAIN_VERSION` optional and `image.json` in the image; the install bundle (`build-install.ts`, `/install`, `export-install.sh`); the `builder`, `keyword` and `embedded` targets; `scripts/build-gbrain-image.sh`; pin.json's `surfaces`, `embeddings`, `install` and `gbrain_check` entries.

### 2026-10-25: The company brain (internal-task)

harness-evals v0.0.5. `build-brain.ts --brain company`: every record of the split in one federated source per reader set, one token per member in `tokens.json`; the Dockerfile builds the two company brains beside the two bot-visible ones; the entrypoint reads `HE_GBRAIN_BRAIN` and `HE_GBRAIN_SCOPE` and serves a company brain with `GBRAIN_REMOTE_PRIVATE_PAGES=1`; gbrain pinned at `089bf0d8` (0.60.431.0) for this and later runs, the gbrain arm's `f241216c` recorded in its own manifests; the tag rule while that arm runs.

### 2026-10-24: Sidecar built for the gbrain arm (lane D)

harness-evals v0.0.5. First version: Dockerfile, brain builder, entrypoint, pin and this page.
