#!/usr/bin/env bash
# gbrain sidecar entrypoint, one container per trial (docs/gbrain-arm.md).
#
#   HE_GBRAIN_SPLIT   dev | heldout: which split's brain under /brains to serve
#   HE_GBRAIN_BRAIN   bot-visible (default) | company | member: /brains/<split>, /brains/<split>-company (docs/gbrain-arm.md, "Company
#                     brain") or /brains/<split>-member (internal-task, "The member brain": the bot-visible slice in reader-set sources
#                     plus an empty private source per member, for the world's live ingestion)
#   HE_GBRAIN_INGEST  off (default) | live: with live (member brain only) the brain's ingest-tokens.json (one bearer token per
#                     source, each writing to that source) is copied to $HE_GBRAIN_OUT/ingest-tokens.json for the world's
#                     ingestion module, which writes each message of the scenario into the source of its conversation
#   HE_GBRAIN_CHANNEL_REMEMBER  member (default) | conversation: with conversation (internal-task; member brain only) ingest-tokens.json
#                     is copied out the same way whether or not ingestion is live, for the world's tap alone, which sends a
#                     remember made in a shared channel under that channel source's token
#   HE_GBRAIN_SCOPE   none (default) | member | sources | member-sources: with member, the company brain's tokens.json (one bearer token per member,
#                     each granted the sources that member may read, plus public-only) is copied to $HE_GBRAIN_OUT/tokens.json;
#                     with sources (internal-task, gbrain#7481), the company brain's manifest.json (its grants map members to source
#                     ids, no tokens) is copied to $HE_GBRAIN_OUT/manifest.json and the world's tap adds source_ids per request
#                     for the world's tap to present per requesting member; member needs brain company; with member-sources
#                     (internal-task-a, internal-task-b) both files are copied and the tap presents the member's token and its source_ids
#   HE_GBRAIN_ACCESS  none (default) | rules: with rules (internal-task; member brain and member scope only) serves /brains/<split>-member-acl,
#                     the member brain whose reads are gated by gbrain folder rules and member-bound tokens (gbrain/build-brain.ts
#                     --access rules); its tokens.json is copied the same way
#   HE_GBRAIN_SERVES  none (default) | several: with several (internal-task) the brain is labelled, after the trial token is minted and
#                     before serve, with gbrain access serves several --members $HE_GBRAIN_MEMBERS (gbrain's members, people/<member>/
#                     folder rules and one member-bound key per member), and access.serves_since moves 15 days back, so the trial's
#                     unbound token is past gbrain's grace and refused; the labelling receipt (key paths, never key values) goes to
#                     $HE_GBRAIN_OUT/serves.json. Two shapes: company brain with scope none (every read refused), or the bot-visible
#                     brain with scope member, where tokens.json is written from the member keys (public_only: the trial token)
#   HE_GBRAIN_MEMBERS with several: the split's token members, comma-separated (runner/trial/gbrain.ts)
#   HE_GBRAIN_LABELS  none (default) | readers: with readers (internal-task; serves several, bot-visible brain, member scope) serves
#                     /brains/<split>-labelled, the bot-visible slice with each page's readers in its frontmatter as readable_by
#                     (gbrain/build-brain.ts --labels readers; dev only)
#   HE_GBRAIN_OUT     a mounted evaluator directory: the token(s) and the sidecar's logs land here
#   HE_TRIAL_ID       names the token (trial-<id>)
#   HE_GBRAIN_SURFACE starter (default) | verbs: the MCP surface gbrain serves (internal-task, the install ladder; gbrain/pin.json
#                     "surfaces" records the tool count of each)
#   HE_GBRAIN_EMBEDDINGS  off (default) | openai:text-embedding-3-small: with a model, serves /brains/<split>-embedded (bot-visible
#                     only; built by scripts/build-gbrain-image.sh --embedded) and needs OPENAI_BASE_URL, the metering proxy's
#                     slot URL for this trial, through which gbrain's query embeddings leave; the manifest must name the model
#   OPENAI_BASE_URL   passed through to gbrain unchanged and logged as a route; it carries no key (the proxy injects the key
#                     on the host). GBRAIN_QUERY_EMBED_TIMEOUT_MS is passed through too (default from pin.json: gbrain gives up
#                     a query embedding after it and continues keyword-only, stamping the reply search_degraded)
#   HE_GBRAIN_PROXY_TOKEN  with embeddings: the proxy slot's random per-trial token (trial-token:<id>.<hex>, never a provider
#                     key), handed to gbrain as OPENAI_API_KEY so the proxy, which forwards nothing for the slot without it,
#                     accepts the query embeddings; never logged. Sets GBRAIN_MODEL_DISCOVERY=off beside it, so gbrain
#                     sends no GET /v1/models through the slot
#
# Copies the chosen brain to /brain (the path the brain was built at; gbrain records absolute paths), mints a bearer
# token for the trial into $HE_GBRAIN_OUT/token (never stdout, never a log), then serves MCP over HTTP on 0.0.0.0:3131
# with the chosen surface and the rate limits lifted, until SIGTERM. The environment carries no provider key: the image has
# none and the runner passes none; an embedded brain's calls leave through OPENAI_BASE_URL only, presenting the runner's
# per-trial proxy token. A company brain is served with GBRAIN_REMOTE_PRIVATE_PAGES=1, so
# the pages whose frontmatter says visibility: private (the five private notes) are served like every other page:
# gbrain's default hides such pages from every remote caller, and the company-brain run measures the harness and the
# source grants, not that page-level default (the default is recorded as a finding in the report).
set -euo pipefail

: "${HE_GBRAIN_SPLIT:?HE_GBRAIN_SPLIT must be dev or heldout}"
: "${HE_GBRAIN_OUT:?HE_GBRAIN_OUT must be a writable mounted directory}"
: "${HE_TRIAL_ID:=unknown}"
: "${HE_GBRAIN_BRAIN:=bot-visible}"
: "${HE_GBRAIN_SCOPE:=none}"
: "${HE_GBRAIN_SURFACE:=starter}"
: "${HE_GBRAIN_EMBEDDINGS:=off}"
: "${HE_GBRAIN_INGEST:=off}"
: "${HE_GBRAIN_ACCESS:=none}"
: "${HE_GBRAIN_CHANNEL_REMEMBER:=member}"
: "${HE_GBRAIN_SERVES:=none}"
: "${HE_GBRAIN_LABELS:=none}"
refuse() { echo "$1" >&2; exit 2; }
pin=/opt/sidecar/gbrain/pin.json
case "$HE_GBRAIN_SPLIT" in dev|heldout) ;; *) refuse "HE_GBRAIN_SPLIT must be dev or heldout (got $HE_GBRAIN_SPLIT)" ;; esac
case "$HE_GBRAIN_BRAIN" in bot-visible|company|member) ;; *) refuse "HE_GBRAIN_BRAIN must be bot-visible, company or member (got $HE_GBRAIN_BRAIN); fix: set gbrain.brain on the cell to one of them" ;; esac
case "$HE_GBRAIN_INGEST" in off|live) ;; *) refuse "HE_GBRAIN_INGEST must be off or live (got $HE_GBRAIN_INGEST); fix: set gbrain.ingest on the cell to one of them" ;; esac
[ "$HE_GBRAIN_INGEST" = off ] || [ "$HE_GBRAIN_BRAIN" = member ] || refuse "HE_GBRAIN_INGEST=live needs HE_GBRAIN_BRAIN=member (got $HE_GBRAIN_BRAIN); only the member brain carries ingest tokens; fix: set gbrain: {surface: starter, brain: member, scope: member, ingest: live}"
case "$HE_GBRAIN_CHANNEL_REMEMBER" in member|conversation) ;; *) refuse "HE_GBRAIN_CHANNEL_REMEMBER must be member or conversation (got $HE_GBRAIN_CHANNEL_REMEMBER); fix: set gbrain.channel_remember on the cell to one of them" ;; esac
[ "$HE_GBRAIN_CHANNEL_REMEMBER" = member ] || [ "$HE_GBRAIN_BRAIN" = member ] || refuse "HE_GBRAIN_CHANNEL_REMEMBER=conversation needs HE_GBRAIN_BRAIN=member (got $HE_GBRAIN_BRAIN); only the member brain carries ingest tokens"
case "$HE_GBRAIN_SCOPE" in none|member|sources|member-sources) ;; *) refuse "HE_GBRAIN_SCOPE must be none, member, sources or member-sources (got $HE_GBRAIN_SCOPE); fix: set gbrain.scope on the cell to one of them" ;; esac
[ "$HE_GBRAIN_SCOPE" = none ] || [ "$HE_GBRAIN_BRAIN" = company ] || [ "$HE_GBRAIN_BRAIN" = member ] || [ "$HE_GBRAIN_SERVES/$HE_GBRAIN_BRAIN/$HE_GBRAIN_SCOPE" = several/bot-visible/member ] || refuse "HE_GBRAIN_SCOPE=$HE_GBRAIN_SCOPE needs HE_GBRAIN_BRAIN=company or member (got $HE_GBRAIN_BRAIN); only those brains carry member tokens and source grants; fix: set gbrain: {surface: starter, brain: company, scope: $HE_GBRAIN_SCOPE}"
case "$HE_GBRAIN_ACCESS" in none|rules) ;; *) refuse "HE_GBRAIN_ACCESS must be none or rules (got $HE_GBRAIN_ACCESS); fix: set gbrain.access on the cell to rules or leave it out" ;; esac
[ "$HE_GBRAIN_ACCESS" = none ] || { [ "$HE_GBRAIN_BRAIN" = member ] && [ "$HE_GBRAIN_SCOPE" = member ] && [ "$HE_GBRAIN_INGEST" = off ]; } || refuse "HE_GBRAIN_ACCESS=rules needs HE_GBRAIN_BRAIN=member, HE_GBRAIN_SCOPE=member and HE_GBRAIN_INGEST=off (got $HE_GBRAIN_BRAIN, $HE_GBRAIN_SCOPE, $HE_GBRAIN_INGEST); fix: set gbrain: {surface: starter, brain: member, scope: member, access: rules}"
case "$HE_GBRAIN_SURFACE" in starter|verbs) ;; *) refuse "HE_GBRAIN_SURFACE must be starter or verbs (got $HE_GBRAIN_SURFACE); fix: set gbrain.surface on the cell to one of them" ;; esac
case "$HE_GBRAIN_EMBEDDINGS" in off) ;; openai:text-embedding-3-small) ;; *) refuse "HE_GBRAIN_EMBEDDINGS must be off or openai:text-embedding-3-small (got $HE_GBRAIN_EMBEDDINGS); fix: set gbrain.embeddings on the cell to one of them" ;; esac
case "$HE_GBRAIN_SERVES" in none|several) ;; *) refuse "HE_GBRAIN_SERVES must be none or several (got $HE_GBRAIN_SERVES); fix: set gbrain.serves on the cell to several or leave it out" ;; esac
case "$HE_GBRAIN_LABELS" in none|readers) ;; *) refuse "HE_GBRAIN_LABELS must be none or readers (got $HE_GBRAIN_LABELS); fix: set gbrain.labels on the cell to readers or leave it out" ;; esac
[ "$HE_GBRAIN_LABELS" = none ] || [ "$HE_GBRAIN_SERVES" = several ] || refuse "HE_GBRAIN_LABELS=$HE_GBRAIN_LABELS needs HE_GBRAIN_SERVES=several; the labels are read only by member-bound keys"
if [ "$HE_GBRAIN_SERVES" = several ]; then
  case "$HE_GBRAIN_BRAIN/$HE_GBRAIN_SCOPE" in company/none|bot-visible/member) ;; *) refuse "HE_GBRAIN_SERVES=several needs HE_GBRAIN_BRAIN=company with HE_GBRAIN_SCOPE=none, or HE_GBRAIN_BRAIN=bot-visible with HE_GBRAIN_SCOPE=member (got $HE_GBRAIN_BRAIN, $HE_GBRAIN_SCOPE)" ;; esac
  [ "$HE_GBRAIN_INGEST/$HE_GBRAIN_ACCESS/$HE_GBRAIN_CHANNEL_REMEMBER/$HE_GBRAIN_EMBEDDINGS" = off/none/member/off ] || refuse "HE_GBRAIN_SERVES=several runs without live ingestion, access rules, channel_remember conversation or embeddings (got $HE_GBRAIN_INGEST, $HE_GBRAIN_ACCESS, $HE_GBRAIN_CHANNEL_REMEMBER, $HE_GBRAIN_EMBEDDINGS)"
  [ "$HE_GBRAIN_LABELS" = none ] || [ "$HE_GBRAIN_BRAIN/$HE_GBRAIN_SCOPE" = bot-visible/member ] || refuse "HE_GBRAIN_LABELS=$HE_GBRAIN_LABELS needs HE_GBRAIN_BRAIN=bot-visible and HE_GBRAIN_SCOPE=member (got $HE_GBRAIN_BRAIN, $HE_GBRAIN_SCOPE)"
  [[ "${HE_GBRAIN_MEMBERS:-}" =~ ^[a-z0-9][a-z0-9-]*(,[a-z0-9][a-z0-9-]*)*$ ]] || refuse "HE_GBRAIN_SERVES=several needs HE_GBRAIN_MEMBERS, the split's token members as comma-separated member ids (got '${HE_GBRAIN_MEMBERS:-}')"
fi
if [ "$HE_GBRAIN_EMBEDDINGS" != off ]; then
  [ "$HE_GBRAIN_BRAIN" = bot-visible ] || refuse "HE_GBRAIN_EMBEDDINGS=$HE_GBRAIN_EMBEDDINGS needs HE_GBRAIN_BRAIN=bot-visible (got $HE_GBRAIN_BRAIN); only the bot-visible brains are built with embeddings"
  [ -n "${OPENAI_BASE_URL:-}" ] || refuse "HE_GBRAIN_EMBEDDINGS=$HE_GBRAIN_EMBEDDINGS needs OPENAI_BASE_URL (the metering proxy's slot URL); the sidecar never holds a key, so without the route gbrain cannot embed a query"
  src="/brains/$HE_GBRAIN_SPLIT-embedded"
  [ -d "$src/.gbrain" ] || refuse "no embedded brain at $src; this is the keyword image; fix: scripts/build-gbrain-image.sh --embedded (gbrain/README.md) and pass its tag as --gbrain-image"
  built_model=$(jq -r '.embeddings.model // empty' "$src/manifest.json")
  [ "$built_model" = "$HE_GBRAIN_EMBEDDINGS" ] || refuse "the brain at $src was built with embeddings '$built_model', the cell asks for $HE_GBRAIN_EMBEDDINGS; fix: rebuild with scripts/build-gbrain-image.sh --embedded"
  : "${GBRAIN_QUERY_EMBED_TIMEOUT_MS:=$(jq -r '.embeddings.query_embed_timeout_ms' "$pin")}"
  export GBRAIN_QUERY_EMBED_TIMEOUT_MS
else
  case "$HE_GBRAIN_BRAIN" in bot-visible) src="/brains/$HE_GBRAIN_SPLIT" ;; *) src="/brains/$HE_GBRAIN_SPLIT-$HE_GBRAIN_BRAIN" ;; esac
  [ "$HE_GBRAIN_ACCESS" = none ] || src="$src-acl"
  [ "$HE_GBRAIN_LABELS" = none ] || src="$src-labelled"
fi
[ -d "$src/.gbrain" ] || refuse "no brain at $src; rebuild the image (gbrain/README.md)"
[ "$HE_GBRAIN_LABELS" = none ] || [ "$(jq -r '.labels // empty' "$src/manifest.json")" = "$HE_GBRAIN_LABELS" ] || refuse "the brain at $src was not built with --labels $HE_GBRAIN_LABELS; rebuild the image (gbrain/Dockerfile stage brain-dev-labelled)"
[ "$HE_GBRAIN_ACCESS" = none ] || [ "$(jq -r '.access // empty' "$src/manifest.json")" = rules ] || refuse "the brain at $src was not built with --access rules; rebuild the image (gbrain/Dockerfile stage brain-dev-member-acl)"
case "$HE_GBRAIN_SERVES/$HE_GBRAIN_SCOPE" in none/member|none/member-sources) want_tokens=1 ;; *) want_tokens=0 ;; esac
case "$HE_GBRAIN_SCOPE" in sources|member-sources) want_grants=1 ;; *) want_grants=0 ;; esac
[ "$want_tokens" = 0 ] || [ -s "$src/tokens.json" ] || refuse "no tokens.json in $src; the $HE_GBRAIN_BRAIN brain was built without member tokens; rebuild the image (gbrain/README.md)"
case "$HE_GBRAIN_INGEST/$HE_GBRAIN_CHANNEL_REMEMBER" in live/*|*/conversation) want_ingest_tokens=1 ;; *) want_ingest_tokens=0 ;; esac
[ "$want_ingest_tokens" = 0 ] || [ -s "$src/ingest-tokens.json" ] || refuse "no ingest-tokens.json in $src; the member brain was built without ingest tokens; rebuild the image (gbrain/README.md)"
[ "$want_grants" = 0 ] || [ "$(jq -r '.grants | length' "$src/manifest.json" 2>/dev/null || echo 0)" -gt 0 ] || refuse "no grants in $src/manifest.json; the company brain was built without source grants; rebuild the image (gbrain/README.md)"

for k in ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY VOYAGE_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "refusing to start: $k is set in the sidecar environment; gbrain must never see a model key" >&2; exit 2; fi
done
# An embedded brain presents the proxy slot's per-trial token as its OpenAI credential (2026-10-28: the proxy forwards nothing
# for the slot without it). The token is the runner's, shaped trial-token:<id>.<hex>, never a provider key; the proxy strips
# it and injects the real key on the host. It reaches gbrain through the only variable gbrain reads a credential from.
# With a key set, gbrain would also run its OpenAI model discovery (GET /v1/models) before the first embedding; that request
# would be metered under the trial key and counted among the harness's requests, so discovery is switched off (the embedding
# model is pinned by the cell).
if [ "$HE_GBRAIN_EMBEDDINGS" != off ]; then
  case "${HE_GBRAIN_PROXY_TOKEN:-}" in
    trial-token:*) export OPENAI_API_KEY="$HE_GBRAIN_PROXY_TOKEN" GBRAIN_MODEL_DISCOVERY=off; unset HE_GBRAIN_PROXY_TOKEN ;;
    *) refuse "HE_GBRAIN_EMBEDDINGS=$HE_GBRAIN_EMBEDDINGS needs HE_GBRAIN_PROXY_TOKEN (the proxy slot's per-trial token, trial-token:<id>.<hex>); the proxy forwards nothing for the slot without it" ;;
  esac
fi

mkdir -p "$HE_GBRAIN_OUT"
log() { printf '%s gbrain-sidecar[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" >> "$HE_GBRAIN_OUT/sidecar.log"; }

export HOME="$HE_GBRAIN_OUT"
export GBRAIN_HOME=/brain
export GBRAIN_SKIP_STARTUP_HOOKS=1
export NO_COLOR=1

t0=$(date +%s%N)
rm -rf /brain/.gbrain /brain/sources /brain/manifest.json /brain/tokens.json /brain/ingest-tokens.json
cp -a "$src/.gbrain" /brain/.gbrain
if [ -d "$src/sources" ]; then cp -a "$src/sources" /brain/sources; fi
cp "$src/manifest.json" /brain/manifest.json
rm -f /brain/.gbrain/*.lock /brain/.gbrain/persistence/locks/* 2>/dev/null || true
# internal-task: every source's checkout (default under .gbrain/content, a scoped brain's federated sources under sources/) is now a
# new directory at its recorded path, and the image's chmod a+rX left gbrain's private ownership records readable by all.
# gbrain refuses writes to such a checkout, so the records go back to 0600 and each source takes gbrain's self-transfer for a
# checkout restored at its recorded path (gbrain/rebind-sources.ts), before serve starts.
find /brain/.gbrain/content /brain/sources -maxdepth 3 -name '.gbrain-owner*.json' -exec chmod 600 {} + 2>/dev/null || true
rebind_ids="default $(jq -r '(.sources // [])[].id' /brain/manifest.json | tr '\n' ' ')"
t1=$(date +%s%N)
bun /opt/sidecar/gbrain/rebind-sources.ts $rebind_ids > "$HE_GBRAIN_OUT/rebind.log" 2>&1 \
  || { log "source re-stamp failed (see rebind.log): $(tail -1 "$HE_GBRAIN_OUT/rebind.log")"; echo "gbrain source re-stamp failed; see $HE_GBRAIN_OUT/rebind.log" >&2; exit 2; }
log "re-stamped $(grep -c ' re-stamped at ' "$HE_GBRAIN_OUT/rebind.log") source checkouts in $(( ($(date +%s%N) - t1) / 1000000 )) ms"
log "brain $HE_GBRAIN_BRAIN scope $HE_GBRAIN_SCOPE access $HE_GBRAIN_ACCESS serves $HE_GBRAIN_SERVES labels $HE_GBRAIN_LABELS ingest $HE_GBRAIN_INGEST embeddings $HE_GBRAIN_EMBEDDINGS copied from $src ($(jq -r '.counts.total' /brain/manifest.json) pages$(jq -r 'if .sources then ", \(.sources | length) sources, \(.grants | length) grants" else "" end' /brain/manifest.json), gbrain $(jq -r '.gbrain_commit' /brain/manifest.json | cut -c1-12)) in $(( ($(date +%s%N) - t0) / 1000000 )) ms"

# The token is printed once by gbrain; it goes to the token file and nowhere else.
umask 077
tok=$(bun /opt/gbrain/src/cli.ts auth create "trial-$HE_TRIAL_ID" 2>>"$HE_GBRAIN_OUT/auth.stderr.log" | grep -oE 'gbrain_[0-9a-f]+' | head -1 || true)
[ -n "$tok" ] || { log "gbrain auth create printed no token (see auth.stderr.log)"; echo "gbrain auth create failed; see $HE_GBRAIN_OUT/sidecar.log" >&2; exit 2; }
printf '%s' "$tok" > "$HE_GBRAIN_OUT/token.tmp"
mv "$HE_GBRAIN_OUT/token.tmp" "$HE_GBRAIN_OUT/token"
unset tok
if [ "$HE_GBRAIN_SERVES" = several ]; then
  # internal-task: gbrain's own shared-bot setup, after the trial token exists so that token is one gbrain finds unbound. The receipt
  # names key paths; the keys stay under /brain and, under member scope, in tokens.json (mode 0600) for the tap only.
  serr="$HE_GBRAIN_OUT/serves.stderr.log"
  bun /opt/gbrain/src/cli.ts access serves several --members "$HE_GBRAIN_MEMBERS" --yes --json > "$HE_GBRAIN_OUT/serves.json.tmp" 2>>"$serr" || true
  if grep -qE 'gbrain_[0-9a-f]{20}' "$HE_GBRAIN_OUT/serves.json.tmp"; then rm -f "$HE_GBRAIN_OUT/serves.json.tmp"; log "gbrain access serves several printed a key value; receipt discarded"; echo "serves several: receipt carried a key value" >&2; exit 2; fi
  [ "$(jq -r '.applied' "$HE_GBRAIN_OUT/serves.json.tmp" 2>/dev/null)" = true ] || { log "gbrain access serves several did not apply: $(jq -c '[(.members // [])[], (.rules // [])[], (.keys // [])[]] | map(select(.action == "blocked")) | .[0]' "$HE_GBRAIN_OUT/serves.json.tmp" 2>/dev/null || tail -1 "$serr")"; echo "gbrain access serves several did not apply; see $HE_GBRAIN_OUT/sidecar.log" >&2; exit 2; }
  mv "$HE_GBRAIN_OUT/serves.json.tmp" "$HE_GBRAIN_OUT/serves.json"
  since=$(date -u -d '15 days ago' +%Y-%m-%dT%H:%M:%SZ)
  bun /opt/gbrain/src/cli.ts config set access.serves_since "$since" --force >>"$serr" 2>&1 || { log "gbrain config set access.serves_since failed (see serves.stderr.log)"; echo "gbrain config set access.serves_since failed" >&2; exit 2; }
  state=$(bun /opt/gbrain/src/cli.ts access serves --json 2>>"$serr" || true)
  jq -e --arg members "$HE_GBRAIN_MEMBERS" '.serves == "several" and .from == "config" and (.since | fromdateiso8601) < now and ((.enabled_members | sort) == ($members | split(",") | sort))' <<<"$state" >/dev/null 2>&1 \
    || { log "gbrain access serves reports $(jq -c '{serves, from, since, enabled_members: (.enabled_members | length)}' <<<"$state" 2>/dev/null || echo 'no JSON'), not serves several from config with a past since and the $(tr ',' '\n' <<<"$HE_GBRAIN_MEMBERS" | grep -c .) members"; echo "the brain is not labelled serves several; see $HE_GBRAIN_OUT/sidecar.log" >&2; exit 2; }
  if [ "$HE_GBRAIN_SCOPE" = member ]; then
    echo '{}' > "$HE_GBRAIN_OUT/members.json.tmp"
    for m in ${HE_GBRAIN_MEMBERS//,/ }; do
      key=$(jq -r --arg m "$m" '.keys[] | select(.member == $m) | .path' "$HE_GBRAIN_OUT/serves.json")
      [ -s "$key" ] || { log "no member key for $m at '$key'"; echo "serves several: no member key for $m" >&2; exit 2; }
      jq --arg m "$m" --rawfile k "$key" '. + {($m): ($k | rtrimstr("\n"))}' "$HE_GBRAIN_OUT/members.json.tmp" > "$HE_GBRAIN_OUT/members.json.tmp2"
      mv "$HE_GBRAIN_OUT/members.json.tmp2" "$HE_GBRAIN_OUT/members.json.tmp"
    done
    jq -n --arg split "$HE_GBRAIN_SPLIT" --rawfile pub "$HE_GBRAIN_OUT/token" --slurpfile members "$HE_GBRAIN_OUT/members.json.tmp" '{schema_version: 1, brain: "bot-visible", split: $split, members: $members[0], public_only: $pub}' > "$HE_GBRAIN_OUT/tokens.json.tmp"
    rm -f "$HE_GBRAIN_OUT/members.json.tmp"
    mv "$HE_GBRAIN_OUT/tokens.json.tmp" "$HE_GBRAIN_OUT/tokens.json"
  fi
  log "serves several: $(jq -r '"\(.members | length) members, \(.rules | length) people/<member>/ rules, \(.keys | length) member keys under \(.key_dir)"' "$HE_GBRAIN_OUT/serves.json"), access.serves_since $since (the unbound trial-$HE_TRIAL_ID token past the grace); receipt $HE_GBRAIN_OUT/serves.json$([ "$HE_GBRAIN_SCOPE" = member ] && echo ", member keys in $HE_GBRAIN_OUT/tokens.json")"
fi
if [ "$want_tokens" = 1 ]; then
  # The member tokens were minted at image build (gbrain/build-brain.ts); they are copied, mode 0600, for the tap only.
  cp "$src/tokens.json" "$HE_GBRAIN_OUT/tokens.json.tmp"
  mv "$HE_GBRAIN_OUT/tokens.json.tmp" "$HE_GBRAIN_OUT/tokens.json"
  log "member tokens copied ($(jq -r '.members | length' "$HE_GBRAIN_OUT/tokens.json") members and public-only) into $HE_GBRAIN_OUT/tokens.json"
fi
if [ "$want_ingest_tokens" = 1 ]; then
  # internal-task: the per-source ingest tokens (minted at image build) for the world's live ingestion and, under
  # HE_GBRAIN_CHANNEL_REMEMBER=conversation (internal-task), the tap's shared-channel remembers; mode 0600, never logged.
  cp "$src/ingest-tokens.json" "$HE_GBRAIN_OUT/ingest-tokens.json.tmp"
  cp "$src/manifest.json" "$HE_GBRAIN_OUT/manifest.json"
  mv "$HE_GBRAIN_OUT/ingest-tokens.json.tmp" "$HE_GBRAIN_OUT/ingest-tokens.json"
  log "ingest tokens copied ($(jq -r '.sources | length' "$HE_GBRAIN_OUT/ingest-tokens.json") sources) into $HE_GBRAIN_OUT/ingest-tokens.json (ingest $HE_GBRAIN_INGEST, channel remember $HE_GBRAIN_CHANNEL_REMEMBER)"
fi
if [ "$want_grants" = 1 ]; then
  # internal-task (gbrain#7481): the grants (member -> source ids) for the tap's per-request source_ids; the manifest holds no token.
  cp "$src/manifest.json" "$HE_GBRAIN_OUT/manifest.json.tmp"
  mv "$HE_GBRAIN_OUT/manifest.json.tmp" "$HE_GBRAIN_OUT/manifest.json"
  log "source grants copied ($(jq -r '.grants | length' "$HE_GBRAIN_OUT/manifest.json") grants over $(jq -r '.sources | length' "$HE_GBRAIN_OUT/manifest.json") sources) into $HE_GBRAIN_OUT/manifest.json; the tap adds source_ids per request"
fi
umask 022
log "token minted (trial-$HE_TRIAL_ID) into $HE_GBRAIN_OUT/token at $(( ($(date +%s%N) - t0) / 1000000 )) ms"

GBRAIN_ADMIN_BOOTSTRAP_TOKEN=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN
export GBRAIN_HTTP_RATE_LIMIT_IP=1000000 GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000 GBRAIN_OAUTH_TOKEN_RATE_LIMIT_MAX=1000000
if [ "$HE_GBRAIN_BRAIN" = company ]; then export GBRAIN_REMOTE_PRIVATE_PAGES=1; fi

if [ "$HE_GBRAIN_EMBEDDINGS" != off ]; then
  # The route, never a key: the URL names the proxy host, port and slot. The proxy injects the provider key on the host.
  log "embeddings $HE_GBRAIN_EMBEDDINGS: query embeddings leave through OPENAI_BASE_URL=$OPENAI_BASE_URL (GBRAIN_QUERY_EMBED_TIMEOUT_MS=$GBRAIN_QUERY_EMBED_TIMEOUT_MS)"
elif [ -n "${OPENAI_BASE_URL:-}" ]; then
  log "note: OPENAI_BASE_URL=$OPENAI_BASE_URL is set but the brain is keyword-only (embedding_disabled); gbrain makes no call through it"
fi

log "serve: gbrain serve --http --port 3131 --bind 0.0.0.0 --surface $HE_GBRAIN_SURFACE --suppress-bootstrap-token${GBRAIN_REMOTE_PRIVATE_PAGES:+ (GBRAIN_REMOTE_PRIVATE_PAGES=1)}"
# exec so SIGTERM from docker stop reaches gbrain itself. Its banner and request log go to serve.log,
# which never carries a token (the bootstrap token is suppressed, bearer tokens are hashed).
exec bun /opt/gbrain/src/cli.ts serve --http --port 3131 --bind 0.0.0.0 --surface "$HE_GBRAIN_SURFACE" --suppress-bootstrap-token >> "$HE_GBRAIN_OUT/serve.log" 2>&1
