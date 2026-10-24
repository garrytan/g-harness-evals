#!/usr/bin/env bash
# gbrain sidecar entrypoint, one container per trial (docs/gbrain-arm.md).
#
#   HE_GBRAIN_SPLIT   dev | heldout: which split's brain under /brains to serve
#   HE_GBRAIN_BRAIN   bot-visible (default) | company: /brains/<split> or /brains/<split>-company (docs/gbrain-arm.md, "Company brain")
#   HE_GBRAIN_SCOPE   none (default) | member: with member, the company brain's tokens.json (one bearer token per member,
#                     each granted the sources that member may read, plus public-only) is copied to $HE_GBRAIN_OUT/tokens.json
#                     for the world's tap to present per requesting member; member needs brain company
#   HE_GBRAIN_OUT     a mounted evaluator directory: the token(s) and the sidecar's logs land here
#   HE_TRIAL_ID       names the token (trial-<id>)
#
# Copies the chosen brain to /brain (the path the brain was built at; gbrain records absolute paths), mints a bearer
# token for the trial into $HE_GBRAIN_OUT/token (never stdout, never a log), then serves MCP over HTTP on 0.0.0.0:3131
# with the starter surface, embeddings off and the rate limits lifted, until SIGTERM. The environment carries no API
# key: the image has none and the runner passes none. A company brain is served with GBRAIN_REMOTE_PRIVATE_PAGES=1, so
# the pages whose frontmatter says visibility: private (the five private notes) are served like every other page:
# gbrain's default hides such pages from every remote caller, and the company-brain run measures the harness and the
# source grants, not that page-level default (the default is recorded as a finding in the report).
set -euo pipefail

: "${HE_GBRAIN_SPLIT:?HE_GBRAIN_SPLIT must be dev or heldout}"
: "${HE_GBRAIN_OUT:?HE_GBRAIN_OUT must be a writable mounted directory}"
: "${HE_TRIAL_ID:=unknown}"
: "${HE_GBRAIN_BRAIN:=bot-visible}"
: "${HE_GBRAIN_SCOPE:=none}"
refuse() { echo "$1" >&2; exit 2; }
case "$HE_GBRAIN_SPLIT" in dev|heldout) ;; *) refuse "HE_GBRAIN_SPLIT must be dev or heldout (got $HE_GBRAIN_SPLIT)" ;; esac
case "$HE_GBRAIN_BRAIN" in bot-visible|company) ;; *) refuse "HE_GBRAIN_BRAIN must be bot-visible or company (got $HE_GBRAIN_BRAIN); fix: set gbrain.brain on the cell to one of them" ;; esac
case "$HE_GBRAIN_SCOPE" in none|member) ;; *) refuse "HE_GBRAIN_SCOPE must be none or member (got $HE_GBRAIN_SCOPE); fix: set gbrain.scope on the cell to one of them" ;; esac
[ "$HE_GBRAIN_SCOPE" = none ] || [ "$HE_GBRAIN_BRAIN" = company ] || refuse "HE_GBRAIN_SCOPE=member needs HE_GBRAIN_BRAIN=company (got $HE_GBRAIN_BRAIN); only the company brain carries member tokens; fix: set gbrain: {surface: starter, brain: company, scope: member}"
case "$HE_GBRAIN_BRAIN" in company) src="/brains/$HE_GBRAIN_SPLIT-company" ;; *) src="/brains/$HE_GBRAIN_SPLIT" ;; esac
[ -d "$src/.gbrain" ] || refuse "no brain at $src; rebuild the image (gbrain/README.md)"
[ "$HE_GBRAIN_SCOPE" = none ] || [ -s "$src/tokens.json" ] || refuse "no tokens.json in $src; the company brain was built without member tokens; rebuild the image (gbrain/README.md)"

for k in ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY VOYAGE_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "refusing to start: $k is set in the sidecar environment; gbrain must never see a model key" >&2; exit 2; fi
done

mkdir -p "$HE_GBRAIN_OUT"
log() { printf '%s gbrain-sidecar[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HE_TRIAL_ID" "$*" >> "$HE_GBRAIN_OUT/sidecar.log"; }

export HOME="$HE_GBRAIN_OUT"
export GBRAIN_HOME=/brain
export GBRAIN_SKIP_STARTUP_HOOKS=1
export NO_COLOR=1

t0=$(date +%s%N)
rm -rf /brain/.gbrain /brain/manifest.json /brain/tokens.json
cp -a "$src/.gbrain" /brain/.gbrain
cp "$src/manifest.json" /brain/manifest.json
rm -f /brain/.gbrain/*.lock /brain/.gbrain/persistence/locks/* 2>/dev/null || true
log "brain $HE_GBRAIN_BRAIN scope $HE_GBRAIN_SCOPE copied from $src ($(jq -r '.counts.total' /brain/manifest.json) pages$(jq -r 'if .sources then ", \(.sources | length) sources, \(.grants | length) grants" else "" end' /brain/manifest.json), gbrain $(jq -r '.gbrain_commit' /brain/manifest.json | cut -c1-12)) in $(( ($(date +%s%N) - t0) / 1000000 )) ms"

# The token is printed once by gbrain; it goes to the token file and nowhere else.
umask 077
tok=$(bun /opt/gbrain/src/cli.ts auth create "trial-$HE_TRIAL_ID" 2>>"$HE_GBRAIN_OUT/auth.stderr.log" | grep -oE 'gbrain_[0-9a-f]+' | head -1 || true)
[ -n "$tok" ] || { log "gbrain auth create printed no token (see auth.stderr.log)"; echo "gbrain auth create failed; see $HE_GBRAIN_OUT/sidecar.log" >&2; exit 2; }
printf '%s' "$tok" > "$HE_GBRAIN_OUT/token.tmp"
mv "$HE_GBRAIN_OUT/token.tmp" "$HE_GBRAIN_OUT/token"
unset tok
if [ "$HE_GBRAIN_SCOPE" = member ]; then
  # The member tokens were minted at image build (gbrain/build-brain.ts); they are copied, mode 0600, for the tap only.
  cp "$src/tokens.json" "$HE_GBRAIN_OUT/tokens.json.tmp"
  mv "$HE_GBRAIN_OUT/tokens.json.tmp" "$HE_GBRAIN_OUT/tokens.json"
  log "member tokens copied ($(jq -r '.members | length' "$HE_GBRAIN_OUT/tokens.json") members and public-only) into $HE_GBRAIN_OUT/tokens.json"
fi
umask 022
log "token minted (trial-$HE_TRIAL_ID) into $HE_GBRAIN_OUT/token at $(( ($(date +%s%N) - t0) / 1000000 )) ms"

GBRAIN_ADMIN_BOOTSTRAP_TOKEN=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN
export GBRAIN_HTTP_RATE_LIMIT_IP=1000000 GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000 GBRAIN_OAUTH_TOKEN_RATE_LIMIT_MAX=1000000
if [ "$HE_GBRAIN_BRAIN" = company ]; then export GBRAIN_REMOTE_PRIVATE_PAGES=1; fi

log "serve: gbrain serve --http --port 3131 --bind 0.0.0.0 --surface starter --suppress-bootstrap-token${GBRAIN_REMOTE_PRIVATE_PAGES:+ (GBRAIN_REMOTE_PRIVATE_PAGES=1)}"
# exec so SIGTERM from docker stop reaches gbrain itself. Its banner and request log go to serve.log,
# which never carries a token (the bootstrap token is suppressed, bearer tokens are hashed).
exec bun /opt/gbrain/src/cli.ts serve --http --port 3131 --bind 0.0.0.0 --surface starter --suppress-bootstrap-token >> "$HE_GBRAIN_OUT/serve.log" 2>&1
