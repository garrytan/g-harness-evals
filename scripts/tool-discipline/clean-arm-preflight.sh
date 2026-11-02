#!/usr/bin/env bash
# Clean-arm preflight (CREW.md "Clean no-gstack and no-brain arms"), run once per arm image on the run machine before trial 1.
# Keyless: every check reads the image with its own environment and no network, and nothing here sends a model request.
#
#   bash scripts/tool-discipline/clean-arm-preflight.sh --arm none|baseline|candidate --image <tag> [--sha <full gstack sha>] [--out <jsonl>]
#
# Checks, all arms:
#   mounts        harnesses/run-trial.sh's docker run binds exactly three host directories, all under the trial's own output
#                 directory ($abs_out/workspace, $abs_out/state, $abs_out/logs at /workspace, /harness-state, /he-logs), and the
#                 file names no .capy path, so no Capy drive reaches a trial container.
#   skill_md      SKILL.md files in the image whose path, link target or content mentions gstack, outside /opt/gstack (none
#                 arm: anywhere), following symbolic links and paths with spaces. Must be 0.
#   installs      user-level gstack installs that the Capy session rules would load: ~/.local/share/gstack and ~/.claude/skills
#                 under /root and /harness-state, and any .capy directory. Must be 0.
#   gstack_capy   GSTACK_CAPY in the image's own environment, printed only as set or unset. Must be unset. (The wrapper also
#                 unsets it per trial and logs GSTACK_CAPY=unset in every gstack-register.log marker line.)
#   tirith        run as the trial's uid (this shell's id -u:id -g, as harnesses/run-trial.sh passes), TIRITH_BIN must be
#                 executable and print "tirith 0.4.2", and TIRITH_OFFLINE must be set (presence only), so Hermes uses the
#                 pinned scanner and never downloads one (#221's pin).
# none arm:       /opt/gstack must not exist, and the image label org.harness-eval.gstack.commit must be none.
# gstack arms:    /opt/gstack must exist, its HEAD must equal --sha, and the label must equal --sha.
#
# One JSON line per run is appended to --out (default results/gsta-135/preflight/clean-arms.jsonl). Exit 0 pass, 1 fail, 64 usage.
set -euo pipefail
cd "$(dirname "$0")/../.."

arm='' image='' sha='' out=results/gsta-135/preflight/clean-arms.jsonl
while [ $# -gt 0 ]; do
  case "$1" in
    --arm) arm=$2; shift 2 ;;
    --image) image=$2; shift 2 ;;
    --sha) sha=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 64 ;;
  esac
done
case "$arm" in none) ;; baseline|candidate) [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "--sha <full 40-hex gstack sha> is required for the $arm arm" >&2; exit 64; } ;; *) echo "--arm must be none, baseline or candidate" >&2; exit 64 ;; esac
[ -n "$image" ] || { echo "--image <tag> is required" >&2; exit 64; }
image_id=$(docker image inspect "$image" -f '{{.Id}}' 2>/dev/null) && [ -n "$image_id" ] || { echo "image $image is not built" >&2; exit 1; }
label=$(docker image inspect "$image" -f '{{index .Config.Labels "org.harness-eval.gstack.commit"}}' 2>/dev/null || true)

block=$(awk '/docker run -i --rm --name/{on=1} on{print} on&&/"\$image" run/{exit}' harnesses/run-trial.sh)
binds=$(grep -oE -- '-v "[^"]+"' <<< "$block" | sed -E 's/^-v "(.*)"$/\1/' | paste -sd ' ' -)
want='$abs_out/workspace:/workspace $abs_out/state:/harness-state $abs_out/logs:/he-logs'
if [ "$binds" = "$want" ] && ! grep -q '\.capy' harnesses/run-trial.sh && ! grep -qE -- '--mount|--volumes-from' <<< "$block"; then mounts=ok; else mounts="fail ($binds)"; fi

probe='
skip=""; [ "$1" = none ] || skip=/opt/gstack
n=0; while IFS= read -r -d "" f; do
  case "$f" in "$skip"/*) [ -n "$skip" ] && continue ;; esac
  t=$(readlink -f "$f" 2>/dev/null || echo "$f")
  case "$f$t" in *[Gg][Ss][Tt][Aa][Cc][Kk]*) n=$((n+1)); echo "skill_md_path=$f" >&2; continue ;; esac
  grep -qi gstack "$f" 2>/dev/null && { n=$((n+1)); echo "skill_md_path=$f" >&2; }
done < <(find -L / -xdev -name SKILL.md -type f -print0 2>/dev/null)
echo "skill_md=$n"
i=0; for d in /root/.local/share/gstack /harness-state/.local/share/gstack /root/.claude/skills /harness-state/.claude/skills; do [ -e "$d" ] && { i=$((i+1)); echo "install_path=$d" >&2; }; done
for d in $(find / -xdev -type d -name .capy 2>/dev/null); do i=$((i+1)); echo "install_path=$d" >&2; done
echo "installs=$i"
if [ -n "${GSTACK_CAPY+x}" ]; then echo gstack_capy=set; else echo gstack_capy=unset; fi
if [ -e /opt/gstack ]; then echo opt_gstack=present; echo "gstack_head=$(git -C /opt/gstack rev-parse HEAD 2>/dev/null || echo unreadable)"; else echo opt_gstack=absent; echo gstack_head=none; fi
'
log=$(mktemp)
result=$(docker run --rm --network none --user 0 --entrypoint /bin/bash "$image" -c "$probe" bash "$arm" 2>"$log") || { echo "the probe container failed for $image" >&2; cat "$log" >&2; rm -f "$log"; exit 1; }
paths=$(grep -E '^(skill_md_path|install_path)=' "$log" | cut -d= -f2- | paste -sd ',' - || true); rm -f "$log"
tirith=$(docker run --rm --network none --user "$(id -u):$(id -g)" --entrypoint /bin/sh "$image" -c 'if [ -x "${TIRITH_BIN:-}" ]; then v=$(HOME=/tmp "$TIRITH_BIN" --version 2>/dev/null); else v=missing; fi; [ -n "${TIRITH_OFFLINE:+x}" ] && echo "$v offline" || echo "$v online"' 2>/dev/null || echo "probe failed")
get() { grep -m1 "^$1=" <<< "$result" | cut -d= -f2-; }
skill_md=$(get skill_md) installs=$(get installs) gstack_capy=$(get gstack_capy) opt_gstack=$(get opt_gstack) head=$(get gstack_head)

fails=()
[ "$mounts" = ok ] || fails+=("mounts: $mounts")
[ "$skill_md" = 0 ] || fails+=("skill_md: $skill_md gstack SKILL.md files where none may be")
[ "$installs" = 0 ] || fails+=("installs: $installs user-level gstack installs or .capy directories")
[ "$gstack_capy" = unset ] || fails+=("gstack_capy: set in the image environment")
[ "$tirith" = "tirith 0.4.2 offline" ] || fails+=("tirith: '$tirith' as the trial uid, not 'tirith 0.4.2 offline'")
if [ "$arm" = none ]; then
  [ "$opt_gstack" = absent ] || fails+=("opt_gstack: present in the none arm")
  [ "$label" = none ] || fails+=("label: org.harness-eval.gstack.commit=$label, not none")
else
  [ "$opt_gstack" = present ] || fails+=("opt_gstack: absent in the $arm arm")
  [ "$head" = "$sha" ] || fails+=("gstack_head: $head, not $sha")
  [ "$label" = "$sha" ] || fails+=("label: org.harness-eval.gstack.commit=$label, not $sha")
fi
verdict=pass; [ ${#fails[@]} = 0 ] || verdict=fail

mkdir -p "$(dirname "$out")"
jq -nc --arg arm "$arm" --arg image "$image" --arg id "$image_id" --arg label "$label" --arg mounts "$mounts" --arg skill_md "$skill_md" --arg installs "$installs" \
  --arg gstack_capy "$gstack_capy" --arg tirith "$tirith" --arg opt_gstack "$opt_gstack" --arg head "$head" --arg paths "$paths" --arg verdict "$verdict" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson fails "$(printf '%s\n' "${fails[@]+"${fails[@]}"}" | jq -R . | jq -sc 'map(select(length > 0))')" \
  '{at:$at, arm:$arm, image:$image, image_id:$id, label_commit:$label, checks:{mounts:$mounts, skill_md:($skill_md|tonumber), installs:($installs|tonumber), gstack_capy:$gstack_capy, tirith:$tirith, opt_gstack:$opt_gstack, gstack_head:$head}, flagged_paths:($paths|split(",")|map(select(length > 0))), result:$verdict, failures:$fails}' | tee -a "$out"
echo "CLEAN-ARM: $arm $image $verdict" >&2
[ "$verdict" = pass ]
