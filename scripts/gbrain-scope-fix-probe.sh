#!/bin/bash
# Keyless probe of gbrain's shared-bot scoping fixes (v0.60.708.0 and v0.60.667.0) on this repository's dev brains, run inside the gbrain sidecar
# image: docker run --rm -v <this file>:/probe.sh:ro --entrypoint bash <image> /probe.sh <brain> <config>
#   brain   dev-company (every record of the dev split), dev (the bot-visible slice) or dev-labelled (the bot-visible slice built
#           with each page's readers as readable_by, gbrain/build-brain.ts --labels readers; the run's labelled arm)
#   config  open        today's default: one unbound token, brain unlabelled
#           refused     the unbound token minted first, then gbrain access serves several --members <the 15 token members>,
#                       then access.serves_since moved 15 days back, so the token is past its 14-day grace
#           members     the same labelled brain, each member reading with the key gbrain access serves several minted for them
#           members-labelled  as members, after gbrain repair visibility writes each page's readers (members only) as readable_by
#           owner       the labelled brain with gbrain access owner set <OWNER>, the owner reading with its own bound key
#           owner-restricted  as owner, plus gbrain access owner reads-restricted on, the owner opt-in (v0.60.682.0) Wintermute runs with
#           one-pinned  config access.serves = one set explicitly, two members enabled, the unbound token (Wintermute's setup, R94)
# For each member it lists every page through the remote list_pages (offset paging, 100 a page) and one search, and counts the
# returned pages whose readers (the company manifest's per-page readers, the world's rule) exclude that member.
set -u
export GBRAIN_HOME=/brain HOME=/tmp/h NO_COLOR=1 GBRAIN_SKIP_STARTUP_HOOKS=1 GBRAIN_HTTP_RATE_LIMIT_IP=1000000 GBRAIN_HTTP_RATE_LIMIT_TOKEN=1000000
mkdir -p /tmp/h
BRAIN=$1; MODE=$2; OWNER=${OWNER:-dana-okafor}
G="bun /opt/gbrain/src/cli.ts"
src=/brains/$BRAIN
cp -a $src/.gbrain /brain/.gbrain && { [ -d $src/sources ] && cp -a $src/sources /brain/sources || true; } && cp $src/manifest.json /brain/
find /brain/.gbrain/content /brain/sources -maxdepth 3 -name '.gbrain-owner*.json' -exec chmod 600 {} + 2>/dev/null
bun /opt/sidecar/gbrain/rebind-sources.ts default $(jq -r '(.sources // [])[].id' /brain/manifest.json | tr '\n' ' ') >/tmp/rebind.log 2>&1 || { echo "REBIND FAILED"; exit 2; }
READERS=/brains/dev-company/manifest.json
MEMBERS=$(jq -r '.members|keys|join(" ")' /brains/dev-company/tokens.json)
U=$($G auth create probe-unbound 2>/tmp/auth.err | grep -oE 'gbrain_[0-9a-f]+' | head -1)
[ -n "$U" ] || { echo "unbound token not minted: $(tail -1 /tmp/auth.err)"; exit 2; }
if [ "$MODE" != open ] && [ "$MODE" != one-pinned ]; then  # refused, members, members-labelled, owner
  $G access serves several --members $(echo $MEMBERS | tr ' ' ',') --yes --json > /tmp/serves.json 2>/tmp/serves.err
  [ "$(jq -r .applied /tmp/serves.json)" = true ] || { echo "access serves several did not apply: $(jq -c '[.members[],.rules[],.keys[]]|map(select(.action=="blocked"))|.[0]' /tmp/serves.json)"; exit 2; }
  $G config set access.serves_since "$(date -u -d '15 days ago' +%Y-%m-%dT%H:%M:%SZ)" --force >/dev/null 2>&1
  case $MODE in owner|owner-restricted) $G access owner set $OWNER >/dev/null 2>&1 ;; esac
  [ "$MODE" = owner-restricted ] && $G access owner reads-restricted on >/dev/null 2>&1
fi
if [ "$MODE" = members-labelled ]; then
  # gbrain maintainers' fair test: each page's world readers (the company manifest) written as readable_by on the page, members only.
  mkdir -p /tmp/sets
  SRCMAP=/brain/manifest.json
  jq -r --arg ms "$MEMBERS" --slurpfile src $SRCMAP '($ms|split(" ")) as $m | ($src[0].pages | map({key: .page_slug, value: (.source // "default")}) | from_entries) as $s | .pages[] | select($s[.page_slug] != null) | [.page_slug, $s[.page_slug], ([.readers[] | select(. as $r | $m | index($r))] | join(","))] | @tsv' $READERS > /tmp/pages.tsv
  while IFS=$'\t' read -r slug source readers; do [ -n "$readers" ] || readers=nobody-listed; f=/tmp/sets/$(echo "$source $readers" | md5sum | cut -c1-12); echo "$readers" > $f.readers; echo "$source" > $f.source; echo "$slug" >> $f.slugs; done < /tmp/pages.tsv
  n=0; pages=0
  for r in /tmp/sets/*.readers; do b=${r%.readers}; s=$(cat $b.source)
    $G repair visibility --source $s --slugs-file $b.slugs --readers "$(cat $r)" --json > $b.preview 2>&1
    h=$(grep -oE '\-\-expect [0-9a-f]+' $b.preview | head -1 | cut -d' ' -f2); [ -n "$h" ] || h=$(jq -r '.. | objects | (.plan_hash? // .preview_hash? // .hash? // empty)' $b.preview 2>/dev/null | head -1)
    if [ -n "$h" ] && $G repair visibility --source $s --slugs-file $b.slugs --readers "$(cat $r)" --apply --expect $h --json > $b.out 2>&1; then n=$((n+1)); pages=$((pages+$(wc -l < $b.slugs))); else echo "repair visibility failed (source $s, readers $(cat $r)): $(tail -c 400 $b.preview) / $(tail -c 300 $b.out 2>/dev/null)"; fi
  done
  echo "readable_by written for $n reader sets, $pages of $(wc -l < /tmp/pages.tsv) pages"
fi
if [ "$MODE" = one-pinned ]; then
  $G config set access.serves one >/dev/null 2>&1
  for m in dana-okafor hollis-mbeki; do $G access member add $m --json >/dev/null 2>&1; done
fi
echo "config $MODE on $BRAIN: $($G access serves --json 2>/dev/null | jq -c '{serves,from,enabled_members:(.enabled_members|length),since,owner}') owner_reads_restricted=$($G config get access.owner_reads_restricted 2>/dev/null || echo unset)"
$G serve --http --port 3131 --bind 127.0.0.1 --surface starter --suppress-bootstrap-token >/tmp/serve.log 2>&1 &
for i in $(seq 1 90); do curl -s -o /dev/null 127.0.0.1:3131/health && break; sleep 1; done
call() {
  curl -s -X POST 127.0.0.1:3131/mcp -H "Authorization: Bearer $1" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}" | sed -n 's/^data: //p;/^{/p' | head -1
}
slugs() { jq -r '[.result.content[]?.text | (try fromjson catch null) | .. | objects | .slug? // empty] | unique | .[]' 2>/dev/null; }
errof() { jq -r 'if .error then (.error.message|tostring) elif .result.isError then (.result.content[0].text | tostring | (capture("(?<c>requester_scope_required)").c // .[0:120])) else empty end' 2>/dev/null | head -1; }
tot_ret=0; tot_out=0; tot_err=0
for m in $MEMBERS; do
  case $MODE in
    members|members-labelled) K=$(cat /brain/.gbrain/member-keys/$m.key) ;;
    owner|owner-restricted) [ "$m" = "$OWNER" ] || continue; K=$(cat /brain/.gbrain/member-keys/$m.key) ;;
    *) K=$U ;;
  esac
  : > /tmp/got
  err=""
  for off in 0 100 200; do r=$(call "$K" list_pages "{\"limit\":100,\"offset\":$off}"); e=$(echo "$r" | errof); [ -n "$e" ] && err=$e; echo "$r" | slugs >> /tmp/got; done
  for q in rate ticket site deadline seat; do r=$(call "$K" search "{\"query\":\"$q\",\"limit\":50}"); e=$(echo "$r" | errof); [ -n "$e" ] && err=$e; echo "$r" | slugs >> /tmp/got; done
  sort -u /tmp/got -o /tmp/got
  n=$(grep -c . /tmp/got)
  out=$(jq -r --arg m "$m" --rawfile got /tmp/got '($got|split("\n")|map(select(length>0))) as $g | [.pages[] | select((.page_slug as $s | $g | index($s)) and ((.readers|index($m))|not))] | length' $READERS)
  echo "  $m: returned $n distinct pages, $out outside $m's readers${err:+, error: $err}"
  tot_ret=$((tot_ret+n)); tot_out=$((tot_out+out)); [ -n "$err" ] && tot_err=$((tot_err+1))
done
[ -n "${SHOW:-}" ] && cp /tmp/got /tmp/got.$SHOW 2>/dev/null; echo "TOTAL $MODE $BRAIN: returned $tot_ret, outside the asker's readers $tot_out, members with an error $tot_err"
