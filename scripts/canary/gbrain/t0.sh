#!/usr/bin/env bash
# The gbrain suite's install check (T0) of the regression canary (docs/canary.md). No model call, no key:
#
#   scripts/canary/gbrain/t0.sh --prev <sha|tag> --new <sha|tag> --out <dir> [--fake [--fake-break prev|new]] [--remote]
#
# For each release arm it resolves the release to its peeled commit and its stable-v<version> tag, builds
# harness-eval/gbrain:canary-<version> at that commit with scripts/build-gbrain-image.sh, checks that the image records that
# commit and version, lists the sidecar's tools on both surfaces, runs scripts/gbrain-check.ts's keyless rungs on the image,
# and runs the runner's preflight on the arm's canary cell for each harness (Claude Code on Opus, Codex on Sol, Hermes on
# particle-1): the image's commit against the spec's gbrain_commit, its tools/list count, the member brain's pages and tokens,
# and the member-sources probe that no scoped call returns a row outside the requester's grant (HE-GBRAIN-002). For the plain
# arm it checks that every plain cell carries no gbrain block, preamble, commit or HE_GBRAIN_* variable, that preflight on it
# starts no sidecar, and that no Capy drive and no gstack are reachable on the machine or in the harness images
# (scripts/v04/clean-arm-audit.ts preflight). It writes <out>/t0.json as {suite, ok, checks: [{arm, harness, name, ok, detail}]}.
#
# Exit 0 when every check passed, 10 when an install or exposure check failed (BROKEN), 2 for a usage or infrastructure
# failure (no docker, a release that does not resolve, a harness image that does not build). --fake runs offline: the releases
# resolve against the recorded ref list in fixtures/ls-remote.txt, the plain-arm configuration checks run for real and the
# docker checks are recorded as not run; --fake-break <arm> fails that arm's tools/list check, for tests of the BROKEN path.
# --remote runs the same command on one Ubicloud VM (remote.sh) with no key on it, copies <out> back and destroys the VM.
# Release code is built and served only inside docker containers, which get no provider key (build-gbrain-image.sh passes
# none; the sidecar gets only its brain settings).
set -euo pipefail
cd "$(dirname "$0")/../../.."
export PATH="$HOME/.bun/bin:$PATH"
prev="" new="" out="" fake=0 remote=0 fake_break=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prev) prev="$2"; shift 2 ;;
    --new) new="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --fake) fake=1; shift ;;
    --fake-break) fake_break="$2"; shift 2 ;;
    --remote) remote=1; shift ;;
    -h|--help) sed -n '2,/^set -euo pipefail/{/^set /!p}' "$0"; exit 0 ;;
    *) echo "t0 (gbrain): unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$prev" ] && [ -n "$new" ] && [ -n "$out" ] || { echo "t0 (gbrain): --prev, --new and --out are required" >&2; exit 2; }
case "$fake_break" in ""|prev|new) ;; *) echo "t0 (gbrain): --fake-break takes prev or new" >&2; exit 2 ;; esac
if [ "$remote" -eq 1 ]; then
  [ "$fake" -eq 0 ] || { echo "t0 (gbrain): --fake runs here; drop --remote" >&2; exit 2; }
  exec bash scripts/canary/gbrain/remote.sh --entry t0 --out "$out" --hours 2 -- --prev "$prev" --new "$new"
fi
mkdir -p "$out"
out=$(cd "$out" && pwd)
canary=(bun scripts/canary/gbrain/canary.ts)
checks="$out/checks.jsonl"
: > "$checks"
log() { printf '%s t0 (gbrain): %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/t0.log" >&2; }
check() { # arm harness name ok(0|1) detail
  jq -nc --arg arm "$1" --arg harness "$2" --arg name "$3" --argjson ok "$([ "$4" = 1 ] && echo true || echo false)" --arg detail "$5" \
    '{arm: $arm, harness: $harness, name: $name, ok: $ok, detail: $detail}' >> "$checks"
  log "$1/$2 $3: $([ "$4" = 1 ] && echo ok || echo FAIL) $5"
}
finish() { # exit code [infra message]
  jq -s --arg infra "${2:-}" --argjson fake "$([ "$fake" -eq 1 ] && echo true || echo false)" \
    --slurpfile prev "$out/prev/release.json" --slurpfile new "$out/new/release.json" \
    '{suite: "gbrain", ok: ($infra == "" and all(.[]; .ok)), checks: ., releases: {prev: $prev[0], new: $new[0]}, fake: $fake} + (if $infra == "" then {} else {infra: $infra} end)' \
    "$checks" > "$out/t0.json"
  log "wrote $out/t0.json, exit $1"
  exit "$1"
}
infra() { log "infrastructure: $*"; finish 2 "$*"; }
mkdir -p "$out/prev" "$out/new" "$out/plain"
echo null > "$out/prev/release.json"; echo null > "$out/new/release.json"

# 1. Release identity: each arm's peeled commit and stable tag, and its own image tag.
ls_args=()
[ "$fake" -eq 0 ] || ls_args=(--ls-remote scripts/canary/gbrain/fixtures/ls-remote.txt)
for arm in prev new; do
  ref=${!arm}
  "${canary[@]}" resolve --ref "$ref" ${ls_args[@]+"${ls_args[@]}"} > "$out/$arm/release.json" 2> "$out/$arm/resolve.log" || { echo null > "$out/$arm/release.json"; infra "$arm $ref does not resolve: $(tail -1 "$out/$arm/resolve.log")"; }
  check "$arm" gbrain-sidecar resolve 1 "$(jq -r '"\(.ref) -> \(.sha) (\(.tag // "no stable tag"), version \(.version // "unknown")), image \(.image)"' "$out/$arm/release.json")"
done
[ "$(jq -r .sha "$out/prev/release.json")" != "$(jq -r .sha "$out/new/release.json")" ] || infra "prev and new are the same commit; nothing to compare"
[ "$(jq -r .image "$out/prev/release.json")" != "$(jq -r .image "$out/new/release.json")" ] || infra "prev and new would share an image tag"

# 2. A probe spec per arm: one dev-draw-2 task for each model, so plan and preflight see the canary's own cells.
task=$(ls tasks/multiuser/v0.3/dev-draw-2/dev | head -1)
jq -n --arg t "$task" '{suite: "gbrain", models: ({opus: null, sol: null, particle: null} | map_values({tasks: [$t], t1: [$t], digest: []})), source: {note: "t0 probe: one task per model, plan and preflight only"}}' > "$out/t0-tasks.json"
render() { "${canary[@]}" render --tasks "$out/t0-tasks.json" --tier T1 --attempts 1 --arms plain,prev,new --models opus,sol,particle --run-id "canary-gbrain-t0" --lease-usd 1 --out "$out/specs" --prev "$out/prev/release.json" --new "$out/new/release.json" "$@" > "$out/render.log" 2>&1 || infra "rendering the probe specs failed: $(tail -1 "$out/render.log")"; }
render
while IFS= read -r row; do check plain "$(jq -r .harness <<<"$row")" "$(jq -r .name <<<"$row")" "$([ "$(jq -r .ok <<<"$row")" = true ] && echo 1 || echo 0)" "$(jq -r .detail <<<"$row")"; done < <("${canary[@]}" plain-checks --spec "$out/specs/plain.prereg.json" | jq -c '.[]')
harnesses="claude-code codex hermes"

if [ "$fake" -eq 1 ]; then
  for h in $harnesses; do check plain "$h" harness-image 1 "fake: not built"; done
  check plain all clean-arm 1 "fake: not probed"
  for arm in prev new; do
    image=$(jq -r .image "$out/$arm/release.json")
    check "$arm" gbrain-sidecar image-build 1 "fake: $image not built"
    check "$arm" gbrain-sidecar image-identity 1 "fake: not inspected"
    if [ "$fake_break" = "$arm" ]; then check "$arm" gbrain-sidecar tools-list 0 "fake: tools/list listed no gbrain tools (--fake-break)"; else check "$arm" gbrain-sidecar tools-list 1 "fake: not listed"; fi
    check "$arm" gbrain-sidecar gbrain-check-keyless 1 "fake: not run"
    for h in $harnesses; do check "$arm" "$h" preflight 1 "fake: not run"; done
  done
  for h in $harnesses; do check plain "$h" preflight 1 "fake: not run"; done
  [ "$(jq -s 'all(.[]; .ok)' "$checks")" = true ] && finish 0 || finish 10
fi

command -v docker >/dev/null && docker info >/dev/null 2>&1 || infra "docker is not usable here"
# 3. The harness images every arm runs, from this checkout (keyless; the plain arm is these images alone).
for h in $harnesses; do
  docker build -q -t "harness-eval/$h:dev" "harnesses/$h" > "$out/plain/build-$h.log" 2>&1 || infra "harness image $h did not build: $(tail -1 "$out/plain/build-$h.log")"
  check plain "$h" harness-image 1 "harness-eval/$h:dev $(docker image inspect -f '{{.Id}}' "harness-eval/$h:dev" | cut -c1-19)"
done
images=(); for h in $harnesses; do images+=(--image "harness-eval/$h:dev"); done
if bun scripts/v04/clean-arm-audit.ts preflight --out "$out/plain/clean-arm.json" "${images[@]}" > "$out/plain/clean-arm.log" 2>&1; then
  check plain all clean-arm 1 "no Capy drive and no gstack on this machine or in $harnesses"
else
  rc=$?; [ "$rc" -eq 1 ] || infra "the clean-arm probe could not run (exit $rc; $out/plain/clean-arm.log)"
  check plain all clean-arm 0 "gstack or a Capy drive is reachable; see $out/plain/clean-arm.json"
fi

# 4. Each release: its image at its commit, its tools, gbrain-check's keyless rungs.
built=()
for arm in prev new; do
  sha=$(jq -r .sha "$out/$arm/release.json"); version=$(jq -r '.version // empty' "$out/$arm/release.json"); image=$(jq -r .image "$out/$arm/release.json")
  if ! scripts/build-gbrain-image.sh --gbrain "$sha" --tag "$image" --out "$out/$arm/gbrain-image" > "$out/$arm/build-gbrain.log" 2>&1; then
    check "$arm" gbrain-sidecar image-build 0 "build-gbrain-image.sh --gbrain $sha --tag $image failed: $(grep -m1 HE-GBRAIN-007 "$out/$arm/build-gbrain.log" || tail -1 "$out/$arm/build-gbrain.log")"
    for n in image-identity tools-list gbrain-check-keyless; do check "$arm" gbrain-sidecar "$n" 0 "not run: the image did not build"; done
    for h in $harnesses; do check "$arm" "$h" preflight 0 "not run: the image did not build"; done
    continue
  fi
  check "$arm" gbrain-sidecar image-build 1 "$image $(docker image inspect -f '{{.Id}}' "$image" | cut -c1-19)"
  got_sha=$(jq -r .gbrain_commit "$out/$arm/gbrain-image/image.json"); got_version=$(jq -r .gbrain_version "$out/$arm/gbrain-image/image.json")
  if [ "$got_sha" = "$sha" ] && { [ -z "$version" ] || [ "$got_version" = "$version" ]; }; then check "$arm" gbrain-sidecar image-identity 1 "image.json records gbrain $got_sha, version $got_version"
  else check "$arm" gbrain-sidecar image-identity 0 "image.json records gbrain $got_sha version $got_version; the release is $sha version ${version:-unknown}"; fi
  if "${canary[@]}" probe-tools --image "$image" --out "$out/$arm/tools.json" > "$out/$arm/tools.log" 2>&1 && [ "$(jq '.starter > 0 and .verbs > 0' "$out/$arm/tools.json")" = true ]; then
    check "$arm" gbrain-sidecar tools-list 1 "$(jq -r --slurpfile pin gbrain/pin.json '"starter \(.starter) tools (pin \($pin[0].surfaces.starter.tools)), verbs \(.verbs) (pin \($pin[0].surfaces.verbs.tools))"' "$out/$arm/tools.json")"
    built+=("$arm")
  else
    check "$arm" gbrain-sidecar tools-list 0 "tools/list failed or listed nothing: $(tail -1 "$out/$arm/tools.log")"
  fi
  if GBRAIN_CHECK_DIR="$out/$arm/gbrain-check" bun scripts/gbrain-check.ts --gbrain "$sha" --image "$image" --no-build > "$out/$arm/gbrain-check.log" 2>&1; then gc=1; else gc=0; fi
  f=$(find "$out/$arm/gbrain-check" -name check.json 2>/dev/null | head -1)
  if [ -n "$f" ]; then summary=$(jq -r '"\(.passed | length) passed, \(.failures | length) failed\(if (.failures | length) > 0 then ": " + (.failures[0:2] | join("; ")) else "" end); pin diffs: \(if (.pin_diffs | length) > 0 then (.pin_diffs | join("; ")) else "none" end)"' "$f"); else summary=$(tail -1 "$out/$arm/gbrain-check.log"); fi
  check "$arm" gbrain-sidecar gbrain-check-keyless "$gc" "$summary"
done

# 5. Preflight on every arm's cells, one harness at a time, each release's spec carrying its measured tool counts.
tool_args=()
for arm in ${built[@]+"${built[@]}"}; do tool_args+=(--"$arm"-tools "$out/$arm/tools.json"); done
rm -rf "$out/specs"; render ${tool_args[@]+"${tool_args[@]}"}
for arm in plain prev new; do
  [ "$arm" = plain ] || [[ " ${built[*]+${built[*]}} " == *" $arm "* ]] || continue
  bun runner/run.ts plan --prereg "$out/specs/$arm.prereg.json" --out "$out/$arm/plan" > "$out/$arm/plan.log" 2>&1 || infra "plan of the $arm probe spec failed: $(tail -1 "$out/$arm/plan.log")"
  gimg=(); [ "$arm" = plain ] || gimg=(--gbrain-image "$(jq -r .image "$out/$arm/release.json")")
  for h in $harnesses; do
    id=$(jq -r --arg h "$h" '.cells[] | select(.harness == $h) | .id' "$out/specs/$arm.prereg.json")
    log_file="$out/$arm/preflight-$h.log"
    # Preflight checks only that PARTICLE_API_KEY is present for a Particle cell (it calls no model); T0 holds no key, so the
    # Hermes cell gets a placeholder that no request ever carries.
    if env PARTICLE_API_KEY=none bun runner/run.ts preflight --manifest "$out/$arm/plan/manifest.json" --cells "$id" ${gimg[@]+"${gimg[@]}"} > "$log_file" 2>&1 && grep -q '^PREFLIGHT: ok' "$log_file"; then
      if [ "$arm" = plain ]; then
        if grep -q '^GBRAIN:' "$log_file"; then check plain "$h" preflight 0 "preflight of $id probed a gbrain sidecar"; else check plain "$h" preflight 1 "$id: preflight ok, no gbrain sidecar"; fi
      else
        check "$arm" "$h" preflight 1 "$id: $(grep -E '^GBRAIN: (image .* tools on|scope=member-sources)' "$log_file" | sed -E 's/^GBRAIN: //' | cut -c1-260 | paste -sd'|' -)"
      fi
    else
      check "$arm" "$h" preflight 0 "$id: $(grep -m1 -oE 'HE-[A-Z]+-[0-9]+.*' "$log_file" | cut -c1-400 || tail -1 "$log_file")"
    fi
  done
done
[ "$(jq -s 'all(.[]; .ok)' "$checks")" = true ] && finish 0 || finish 10
