#!/usr/bin/env bash
# The fence matrix's gbrain sidecar (docs/attack/fence-matrix.md). scripts/attack/fence-matrix.ts mounts this file read-only into a
# container of a harness-eval/gbrain image and runs it in place of gbrain/entrypoint.sh, because the matrix needs two things the
# trial sidecar does not give: page writes on the copied brain and every operation gbrain has.
#
#   HE_GBRAIN_SPLIT  dev: the member brain to copy (/brains/dev-member); heldout is refused, since the matrix keeps reply excerpts
#   HE_GBRAIN_OUT    a mounted directory: token, ingest-tokens.json, manifest.json, rebind.log, serve.log
#
# Like gbrain/entrypoint.sh it copies the brain to /brain (gbrain records absolute paths), mints a bearer token into
# $HE_GBRAIN_OUT/token and serves MCP over HTTP on port 3131 with the rate limits lifted, bound to the container's own address
# (the port is published on the host loopback only). Unlike it, it first re-stamps the
# default source's checkout with gbrain's documented self-transfer for a checkout restored at its recorded path (sources writer
# transfer prepare and accept with --self-transfer --confirm-relocated-root, after setting gbrain's ownership records back to
# 0600), so put_page from a remote caller lands on the copy, and it serves --surface full. The environment carries no key.
set -euo pipefail
: "${HE_GBRAIN_SPLIT:?HE_GBRAIN_SPLIT must be dev}"
: "${HE_GBRAIN_OUT:?HE_GBRAIN_OUT must be a writable mounted directory}"
case "$HE_GBRAIN_SPLIT" in dev) ;; *) echo "HE_GBRAIN_SPLIT must be dev (got $HE_GBRAIN_SPLIT)" >&2; exit 2 ;; esac
for k in ANTHROPIC_API_KEY OPENAI_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY VOYAGE_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "refusing to start: $k is set in the sidecar environment; gbrain must never see a model key" >&2; exit 2; fi
done
[ -f /opt/sidecar/image.json ] || { echo "refusing to start: not inside a harness-eval/gbrain container (no /opt/sidecar/image.json)" >&2; exit 2; }
src=/brains/$HE_GBRAIN_SPLIT-member
export HOME="$HE_GBRAIN_OUT" GBRAIN_HOME=/brain GBRAIN_SKIP_STARTUP_HOOKS=1 NO_COLOR=1
g() { bun /opt/gbrain/src/cli.ts "$@"; }

rm -rf /brain/.gbrain /brain/manifest.json
cp -a "$src/.gbrain" /brain/.gbrain
cp "$src/manifest.json" /brain/manifest.json
rm -f /brain/.gbrain/*.lock /brain/.gbrain/persistence/locks/* 2>/dev/null || true
find /brain/.gbrain/content -maxdepth 3 -name '.gbrain-owner*.json' -exec chmod 600 {} + 2>/dev/null || true

t0=$(date +%s%N)
status=$(g sources writer status default --json 2>>"$HE_GBRAIN_OUT/rebind.log")
root=$(jq -r '.bindings[] | select(.source_id == "default") | .local_path' <<<"$status")
prepared=$(g sources writer transfer prepare default --self-transfer --confirm-relocated-root --admin-intent writer_transfer_prepare \
  --expected-state "$(jq -r .admin_state <<<"$status")" --json 2>>"$HE_GBRAIN_OUT/rebind.log")
fresh=$(g sources writer status default --json 2>>"$HE_GBRAIN_OUT/rebind.log")
g sources writer transfer accept default --path "$root" --expected-epoch "$(jq -r .owner_epoch <<<"$prepared")" \
  --manifest "$(jq -r .manifest.digest <<<"$prepared")" --self-transfer --confirm-relocated-root --admin-intent writer_transfer_accept \
  --expected-state "$(jq -r .admin_state <<<"$fresh")" --json > "$HE_GBRAIN_OUT/rebind.json" 2>>"$HE_GBRAIN_OUT/rebind.log"
[ "$(jq -r '.transferred' "$HE_GBRAIN_OUT/rebind.json")" = true ] || { echo "self-transfer of the default source failed; see $HE_GBRAIN_OUT/rebind.log" >&2; exit 2; }
echo "default source re-stamped at $root in $(( ($(date +%s%N) - t0) / 1000000 )) ms" >> "$HE_GBRAIN_OUT/rebind.log"

umask 077
tok=$(g auth create fence-matrix 2>>"$HE_GBRAIN_OUT/auth.stderr.log" | grep -oE 'gbrain_[0-9a-f]+' | head -1 || true)
[ -n "$tok" ] || { echo "gbrain auth create printed no token (see auth.stderr.log)" >&2; exit 2; }
printf '%s' "$tok" > "$HE_GBRAIN_OUT/token.tmp" && mv "$HE_GBRAIN_OUT/token.tmp" "$HE_GBRAIN_OUT/token"
unset tok
cp "$src/ingest-tokens.json" "$HE_GBRAIN_OUT/ingest-tokens.json"
umask 022
cp "$src/manifest.json" "$HE_GBRAIN_OUT/manifest.json"

GBRAIN_ADMIN_BOOTSTRAP_TOKEN=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN GBRAIN_HTTP_RATE_LIMIT_IP=1000000 GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000 GBRAIN_OAUTH_TOKEN_RATE_LIMIT_MAX=1000000
addr=$(hostname -i | tr ' ' '\n' | grep -m1 -E '^[0-9]+(\.[0-9]+){3}$' || true)
[ -n "$addr" ] || { echo "the container has no IPv4 address to bind" >&2; exit 2; }
exec bun /opt/gbrain/src/cli.ts serve --http --port 3131 --bind "$addr" --surface full --suppress-bootstrap-token >> "$HE_GBRAIN_OUT/serve.log" 2>&1
