#!/usr/bin/env bash
# Tirith fence check (tool-discipline-start-hermes-r2-2026-11): does the image's pinned Tirith allow the gstack-review start
# fence that gstack renders for Hermes? Keyless, no network, no model request.
#
#   bash scripts/tool-discipline/tirith-fence-check.sh --arm baseline|candidate --image <tag> [--out <jsonl>]
#
# In a throwaway container of the image (as root, --network none), it renders gstack's Hermes skills the way the build does
# (./setup --host hermes --no-browser into a scratch HERMES_HOME, start hook off), takes the first bash or sh fence in
# gstack-review/SKILL.md that calls gstack-skill-start, and runs the image's Tirith on it:
# $TIRITH_BIN check --format json --non-interactive --shell posix (TIRITH_BIN and TIRITH_OFFLINE=1 from the image, #221's pin).
# One JSON line goes to --out (default results/gsta-135/preflight/tirith-fence.jsonl): arm, image, image id, the Tirith version,
# the fence's sha256 and text, Tirith's action and its finding patterns. Exit 0 when the action is allow, 1 otherwise, 64 usage.
set -euo pipefail
cd "$(dirname "$0")/../.."
arm='' image='' out=results/gsta-135/preflight/tirith-fence.jsonl
while [ $# -gt 0 ]; do
  case "$1" in
    --arm) arm=$2; shift 2 ;;
    --image) image=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
case "$arm" in baseline|candidate) ;; *) echo "--arm must be baseline or candidate (the none arm has no gstack fence)" >&2; exit 64 ;; esac
[ -n "$image" ] || { echo "--image <tag> is required" >&2; exit 64; }
image_id=$(docker image inspect "$image" -f '{{.Id}}' 2>/dev/null) && [ -n "$image_id" ] || { echo "image $image is not built" >&2; exit 1; }
probe='set -e
[ -x "${TIRITH_BIN:-}" ] || { echo "no TIRITH_BIN in the image (the Tirith pin is missing)" >&2; exit 3; }
mkdir -p /tmp/s && cd /opt/gstack
HOME=/tmp/s HERMES_HOME=/tmp/s/hermes GSTACK_HARNESS_START_HOOK=0 ./setup --host hermes --no-browser >/tmp/setup.log 2>&1 || { tail -5 /tmp/setup.log >&2; exit 3; }
f=$(find /tmp/s/hermes -path "*/gstack-review/SKILL.md" | sort | head -1)
[ -n "$f" ] || { echo "no gstack-review SKILL.md after setup" >&2; exit 3; }
python3 - "$f" > /tmp/fence.sh <<PY
import re, sys
t = open(sys.argv[1]).read()
for m in re.finditer(r"\x60\x60\x60(?:bash|sh)\n(.*?)\x60\x60\x60", t, re.S):
    if "gstack-skill-start" in m.group(1):
        sys.stdout.write(m.group(1)); break
PY
[ -s /tmp/fence.sh ] || { echo "no start fence in $f" >&2; exit 3; }
version=$(HOME=/tmp/s "$TIRITH_BIN" --version)
set +e; HOME=/tmp/s "$TIRITH_BIN" check --format json --non-interactive --shell posix -- "$(cat /tmp/fence.sh)" > /tmp/t.json; set -e
python3 - "$version" <<PY
import hashlib, json, sys
fence = open("/tmp/fence.sh").read()
t = json.load(open("/tmp/t.json"))
print(json.dumps({"tirith_version": sys.argv[1], "fence_sha256": hashlib.sha256(fence.encode()).hexdigest(), "fence": fence,
  "action": t.get("action"), "patterns": [e.get("pattern") for f in t.get("findings", []) for e in f.get("evidence", [])]}))
PY
'
result=$(docker run --rm --network none --user 0 --entrypoint /bin/bash "$image" -c "$probe") || { echo "the fence probe failed for $image" >&2; exit 1; }
mkdir -p "$(dirname "$out")"
jq -c --arg arm "$arm" --arg image "$image" --arg id "$image_id" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{at:$at, arm:$arm, image:$image, image_id:$id} + .' <<< "$result" | tee -a "$out"
action=$(jq -r .action <<< "$result")
echo "TIRITH-FENCE: $arm $image $action" >&2
[ "$action" = allow ]
