#!/usr/bin/env bash
# The gstack install check of the frontier Harbor path (internal-task). Keyless: every model call goes to fake-upstream.ts
# through the metering proxy, as in install-check.sh. Run on a fresh Ubicloud VM after scripts/ubicloud/bootstrap.sh,
# from the repository root (install-check.sh runs it as its step 6):
#
#   bash scripts/frontier-harbor/gstack-check.sh <out dir> [--tb21 <terminal-bench-2-1 checkout>] [--images all|none]
#
# It checks, and gstack-check.ts writes <out>/gstack-check.json (the committed copy is scripts/frontier-harbor/gstack-check.json):
#   1. agents: vm-run.sh on install-check-gstack-prereg.json, one task each, uncounted: Claude Code, Codex and Hermes, each
#      with the none, full and minus-retro arms. Per gstack cell the first model request lists exactly the lock's
#      skills, Harbor's skill copy left every listed SKILL.md in place, and the none arm's container had no gstack.
#      vm-run.sh exited 0 or 1 with a trial record per cell and complete accounting, and its fake-key canary is in no file.
#   2. skill start: per host, the full arm's runtime and tree copied into the pinned task image of the agent check, and
#      the preamble command of the rendered review skill run as the skill tells the agent to (eval markers set), twice,
#      with every packet of the container's network namespace captured by tcpdump in a sidecar that owns it. Any packet
#      that leaves the container is a failure: gstack's update check, telemetry and brain sync must stay off.
#   3. images: on every pinned task image (the 52; --images none skips it), the facts the install needs: HOME, the
#      default user, bash, sha256sum, git, the distribution and libc, and the built Bun running there; and the bun and
#      node the image already ships, if any (recorded, not refused: the gstack arms link their Bun at /usr/local/bin/bun).
# Exit 0 when every check passed, 1 when one failed, 2 or 3 for a usage or setup failure.
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?usage: gstack-check.sh <out dir> [--tb21 <dir>] [--images all|none]}
shift
tb21=$HOME/terminal-bench-2-1
images=all
while [ $# -gt 0 ]; do
  case "$1" in
    --tb21) tb21=$2; shift 2 ;;
    --images) images=$2; shift 2 ;;
    *) echo "usage: gstack-check.sh <out dir> [--tb21 <dir>] [--images all|none]" >&2; exit 2 ;;
  esac
done
mkdir -p "$out"
out=$(cd "$out" && pwd)
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY
say() { printf '%s gstack-check: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/gstack-check.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
prereg=$here/install-check-gstack-prereg.json
read -r tb_repo tb_commit <<< "$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["terminal_bench"]; print(t["repo"], t["commit"])' "$here/pin.json")"
if [ "$(git -C "$tb21" rev-parse HEAD 2>/dev/null)" != "$tb_commit" ]; then
  rm -rf "$tb21"
  git clone --quiet --filter=blob:none "$tb_repo" "$tb21" >> "$out/gstack-check.log" 2>&1
  git -C "$tb21" checkout --quiet "$tb_commit"
fi

# 1. the gstack cells against the fake upstream
set +e
"${safe_env[@]}" bash "$here/vm-run.sh" --prereg "$prereg" --name gstack-install-check --lease-usd 200 --out "$out/agents" \
  --tb21 "$tb21" --fake-upstream --uncounted "gstack install check (keyless, fake upstream)"
agents_rc=$?
set -e
say "agents: vm-run.sh exited $agents_rc"
cells=$out/agents/run/gstack/cells
[ -d "$cells" ] || { say "no built gstack arms under $cells (vm-run.sh failed before step 1b)"; exit 3; }

# 2. gstack-skill-start in the task image, every packet of its network namespace captured
task=$(cd "$repo" && bun -e 'import {loadPlan} from "./scripts/frontier-harbor/plan.ts"; const p = loadPlan(process.argv[1]); console.log(p.cells[0].task_ids[0])' "$prereg")
img=$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["task_selection"]["tasks"][sys.argv[2]]; print(t["image"] + "@" + t["image_digest"])' "$here/pin.json" "$task")
base=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["builder_base"])' "$here/gstack-runtime.json")
docker pull -q "$img" >> "$out/gstack-check.log" 2>&1
printf 'FROM %s\nRUN apt-get update -qq && apt-get install -y -qq --no-install-recommends tcpdump >/dev/null && rm -rf /var/lib/apt/lists/*\n' "$base" \
  | docker build -q -t frontier-gstack-check-tcpdump - >> "$out/gstack-check.log" 2>&1
mkdir -p "$out/skill-start"
for cell in cc-opus-full codex-sol-full hermes-opus-full; do
  m=$cells/$cell.json
  host=$(jq -r .host "$m")
  cap=cap-$host-$$
  ctr=run-$host-$$
  docker rm -f "$cap" "$ctr" >/dev/null 2>&1 || true
  docker run -d --name "$cap" --cap-add NET_ADMIN --cap-add NET_RAW frontier-gstack-check-tcpdump tcpdump -i any -n -l -U -tttt 'not arp' >/dev/null
  sleep 2
  docker create --name "$ctr" --network "container:$cap" -e HOME=/root -e GSTACK_EVAL_DIR=/tmp/gstack-eval -e EVALS_RUN_ID=frontier-gstack-install-check \
    --entrypoint sleep "$img" infinity >/dev/null
  for up in $(jq -r '.uploads[].src' "$m"); do docker cp -a "$up/." "$ctr:/" >/dev/null; done
  docker start "$ctr" >/dev/null
  docker exec -u root "$ctr" sh -c "mkdir -p /usr/local/bin && ln -sf $(jq -r .layout.bun "$m") /usr/local/bin/bun"
  md=$(find "$out/agents/run/gstack/$host/arms/full/tree" -path '*review/SKILL.md' -not -path '*/sections/*' | head -n 1)
  awk '/^```bash$/{f=1; b=""; next} /^```$/{if (f && b ~ /gstack-skill-start/) {printf "%s", b; exit} f=0; next} f{b=b $0 "\n"}' "$md" > "$out/skill-start/$host.preamble.sh"
  set +e
  for n in 1 2; do
    docker exec -i "$ctr" bash -s < "$out/skill-start/$host.preamble.sh" > "$out/skill-start/$host.run$n.txt" 2>&1
    echo "$?" > "$out/skill-start/$host.run$n.exit"
  done
  docker exec "$ctr" sh -c 'ls -la /tmp/gstack-eval; ls -la /root/.gstack; cat /root/.gstack/config.yaml' > "$out/skill-start/$host.state.txt" 2>&1
  set -e
  sleep 3
  docker logs "$cap" > "$out/skill-start/$host.packets.txt" 2>&1 || true
  docker rm -f "$cap" "$ctr" >/dev/null 2>&1 || true
  say "skill start ($host): exit $(cat "$out/skill-start/$host.run1.exit") then $(cat "$out/skill-start/$host.run2.exit"); $(grep -c ' IP6\? ' "$out/skill-start/$host.packets.txt" || true) packet line(s) captured"
done

# 3. the pinned task images
if [ "$images" = all ]; then
  bunbin=$(jq -r '.uploads[0].src' "$cells/cc-opus-full.json")/root/.bun/bin
  mkdir -p "$out/images"
  python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["task_selection"]["tasks"]; [print(k, v["image"] + "@" + v["image_digest"]) for k, v in sorted(t.items())]' "$here/pin.json" > "$out/images/list.txt"
  probe='printf "home=%s\nuid=%s\nuser=%s\n" "$HOME" "$(id -u)" "$(id -un 2>/dev/null)"; for c in bash sha256sum git curl; do printf "%s=%s\n" "$c" "$(command -v $c)"; done; for c in bun node; do p=$(command -v $c); printf "image_%s=%s\n" "$c" "${p:+$p $($c --version 2>&1 | head -n 1)}"; done; . /etc/os-release 2>/dev/null; printf "os=%s %s\n" "$ID" "$VERSION_ID"; printf "libc=%s\n" "$( (ldd --version 2>&1 || true) | head -n 1)"; printf "bun=%s\n" "$(/gsbun/bun --version 2>&1 | head -n 1)"'
  check_image() {
    docker pull -q "$2" > /dev/null 2>"$out/images/$1.pull.err" || { echo "pull=failed" > "$out/images/$1.txt"; return 0; }
    docker run --rm --network none -v "$bunbin:/gsbun:ro" --entrypoint sh "$2" -c "$probe" > "$out/images/$1.txt" 2>&1 || echo "probe=failed" >> "$out/images/$1.txt"
    docker image rm -f "$2" >/dev/null 2>&1 || true
  }
  export -f check_image
  export out bunbin probe
  xargs -P 6 -L 1 bash -c 'check_image "$0" "$1"' < "$out/images/list.txt"
  say "images: probed $(find "$out/images" -name '*.txt' ! -name list.txt | wc -l) image(s)"
fi

cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/gstack-check.ts --out "$out" --agents-rc "$agents_rc"
