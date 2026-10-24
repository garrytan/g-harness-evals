# gbrain sidecar

The gbrain arm of the multi-user evaluation asks whether a harness does better or worse on the held-out tasks when [gbrain](https://github.com/garrytan/gbrain), a knowledge brain with an MCP server, is installed beside the world tools. This directory is the sidecar that provides it: one container per trial, a fresh brain per trial, keyless, serving gbrain's MCP over HTTP to the world's tap. The design, the rationale and the smoke evidence are in [docs/gbrain-arm.md](../docs/gbrain-arm.md); the pins are in [pin.json](pin.json).

| File | What it is |
|---|---|
| `Dockerfile` | builds `harness-eval/gbrain:dev`: gbrain at commit `f241216c` (0.60.413.0) run from source with bun 1.4.4, and two prebuilt PGLite brains, `/brains/dev` and `/brains/heldout` |
| `build-brain.ts` | builds one brain from the corpus and `world/seed/world.json`: stages the bot-visible pages, runs `gbrain init` and `gbrain import` with no key in the environment, writes `manifest.json` |
| `entrypoint.sh` | per trial: copies the split's brain to `/brain`, mints a bearer token into `$HE_GBRAIN_OUT/token`, serves until SIGTERM |
| `pin.json` | commit, version, surface, engine, the exact init, import and serve commands and environment, and that embeddings and every model call are off |

## Build

From the repository root (the Dockerfile copies `gbrain/`, `world/types.ts` and `world/seed/world.json`; the root `.dockerignore` keeps the context to those):

```sh
docker build -f gbrain/Dockerfile -t harness-eval/gbrain:dev .
```

The build clones gbrain at the pinned commit, runs `bun install --frozen-lockfile`, fetches the messy-company-v1 corpus from gbrain-evals at `6999ebc9` with a sparse checkout, and builds each brain in its own stage at `/brain` (gbrain records absolute paths inside a brain, so it is served from the path it was built at). The build fails when a page world.json lists is missing from the corpus or when the import count differs from the page count. It takes about 90 s warm; the image is 1.4 GB, almost all of it the bun image and gbrain's dependencies.

`bun gbrain/build-brain.ts --split heldout --corpus <gbrain-evals>/eval/data/messy-company-v1/corpus --out /tmp/brain --staging /tmp/staging --gbrain "bun <gbrain>/src/cli.ts"` builds a brain outside Docker, for inspection.

## What the brain holds, and why

Exactly the slice of the Pemberline corpus the bot can already read in the world, for one split: the chat pages that became channels (the `source_slugs` of every non-DM channel loaded for the split; the two DM pages are left out) and the files with visibility `public` (Moss's digests and the public notes). Held-out: 7 channel pages and 18 public files, 25 pages. Dev: 7 and 11, 18 pages. Each page keeps its corpus path under the split, so its gbrain slug is `<split>/<corpus slug>`, for example `heldout/chats/coastal-team-banter` or `heldout/agent-notes/2026-02-01-coastal-digest`. `manifest.json` in each brain lists every page with the world record it came from and the sha256 of its source file, plus gbrain's import summary.

The brain changes retrieval, not information access: a harness with gbrain can search, read and remember, but it cannot reach anything the world would not show it, so the organisation rules in the preamble stay identical between arms and the preamble is not changed. A full-corpus "company brain" variant (contracts, tickets, mail, team notes) would change information access as well and is a listed follow-up in docs/gbrain-arm.md, not built here.

Embeddings are off (`gbrain init --no-embedding`, `gbrain import --no-embed`): the brain makes no model or embedding call, search is keyword-only, and every search result carries gbrain's `degraded_recall` notice saying so. The sidecar's environment has no API key, and the entrypoint refuses to start if it finds one.

## Run one by hand

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

In a trial the runner does all of this (runner/trial/gbrain.ts) and the harness never reaches the sidecar: it reaches `POST /gbrain` on the world server, which authenticates it as the bot, swaps in the sidecar token and records the call ([world/README.md](../world/README.md)).

## Changelog

### 2026-10-24: Sidecar built for the gbrain arm (lane D)

harness-evals v0.0.5. First version: Dockerfile, brain builder, entrypoint, pin and this page.
