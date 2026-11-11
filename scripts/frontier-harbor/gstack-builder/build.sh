#!/usr/bin/env bash
# Inside the gstack arm builder (Dockerfile beside this file). One host per run:
#
#   gstack-arm-build --host claude|codex|hermes --model <m> --plan-mode on|off --out /out [--runtime] [--arm <id>=<spec> ...]
#       [--lock-arm <id>=<spec> ...]
#
# --model and --plan-mode come from gstack-runtime.json's render block (gstack-arm.ts buildHost passes them).
#
# 1. ./setup --host <h> --no-browser in the pinned checkout ($HOME/.local/share/gstack), as a user installs gstack; its
#    last line must be "gstack ready (<h>)". Then the eval settings a user sets with gstack-config: telemetry off (and
#    the telemetry question answered), update_check false, artifacts_sync_mode off (brain sync does nothing).
# 2. The host's own skill entries setup made are removed (~/.claude/skills, ~/.codex/skills, the Hermes registration):
#    each arm publishes exactly its render instead.
# 3. Each --arm renders `gstack-modules render --host <h> --modules <spec> --out-dir <in-container path>
#    --install-root $HOME/.local/share/gstack --model <m> --plan-mode <on|off>` and moves the tree to
#    /out/arms/<id>/tree<path> with its lock at /out/arms/<id>/loadout.lock.json. A --lock-arm keeps only the lock.
#    A refusal (gstack's MODULE_* and RENDER_* codes, exit 2) goes to /out/arms/<id>/refusal.txt with its exit code;
#    the other arms still render. Spec none renders nothing.
#    Claude: the tree is the skills root itself ($HOME/.claude/skills), with the router copied to gstack/SKILL.md as
#    gstack-modules install publishes it, and gstack/ otherwise linking every top-level entry of the checkout, so it
#    holds what a user's ~/.claude/skills/gstack (the checkout itself) holds. Codex: $HOME/.gstack/arms/codex (skills
#    under .agents/skills), its gstack/ router folder carrying the runtime links setup's create_agents_sidecar makes
#    (bin, lib, browse, review, qa, ETHOS.md, the design and make-pdf dists, supabase/config.sh), except that browse/,
#    review/ and qa/ are real folders linking every entry but SKILL.md: Codex lists every SKILL.md under its skills
#    folder at any depth, so the checkout's Claude-format browse, review and qa skills would be listed a second time
#    (seen in the internal-task install check; setup's create_codex_runtime_root leaves them out the same way). Hermes:
#    $HOME/.gstack/arms/hermes (skills under .hermes/skills) plus a copy under $HOME/.gstack/arms/hermes-skills/gstack,
#    the one gstack category Hermes's registration uses.
# 4. --runtime copies Bun ($HOME/.bun/bin; its download cache stays behind), the checkout and the state root ($HOME/.gstack, arms left out) to /out/runtime<path>.
# Files under /out are handed to OUT_UID:OUT_GID at the end.
set -euo pipefail
host="" model="" plan_mode="" out="" runtime=0
arms=() lock_arms=()
while [ $# -gt 0 ]; do
  case "$1" in
    --host) host=$2; shift 2 ;;
    --model) model=$2; shift 2 ;;
    --plan-mode) plan_mode=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --runtime) runtime=1; shift ;;
    --arm) arms+=("$2"); shift 2 ;;
    --lock-arm) lock_arms+=("$2"); shift 2 ;;
    *) echo "gstack-arm-build: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$host" in claude|codex|hermes) ;; *) echo "gstack-arm-build: --host must be claude, codex or hermes" >&2; exit 2 ;; esac
[ -n "$model" ] || { echo "gstack-arm-build: --model is required" >&2; exit 2; }
case "$plan_mode" in on|off) ;; *) echo "gstack-arm-build: --plan-mode must be on or off" >&2; exit 2 ;; esac
[ -n "$out" ] || { echo "gstack-arm-build: --out is required" >&2; exit 2; }
G=$HOME/.local/share/gstack
mkdir -p "$out/arms"
cd "$G"
setup_log=$out/setup-$host.log
if [ "$host" = hermes ]; then
  HERMES_HOME=/tmp/hermes-setup ./setup --host hermes --no-browser > "$setup_log" 2>&1
else
  ./setup --host "$host" --no-browser > "$setup_log" 2>&1
fi
last=$(grep -v '^[[:space:]]*$' "$setup_log" | tail -n 1)
case "$last" in "gstack ready ($host"*) ;; *) echo "gstack-arm-build: setup's last line is not 'gstack ready ($host)': $last" >&2; exit 3 ;; esac
bin/gstack-config set telemetry off >/dev/null
bin/gstack-config set update_check false >/dev/null
bin/gstack-config set artifacts_sync_mode off >/dev/null
mkdir -p "$HOME/.gstack" && touch "$HOME/.gstack/.telemetry-prompted"
rm -rf "$HOME/.claude/skills" "$HOME/.codex/skills" /tmp/hermes-setup
case "$host" in
  claude) dest=$HOME/.claude/skills ;;
  codex) dest=$HOME/.gstack/arms/codex ;;
  hermes) dest=$HOME/.gstack/arms/hermes ;;
esac
render() {
  local entry=$1 keep=$2 id spec dir rc
  id=${entry%%=*} spec=${entry#*=}
  dir=$out/arms/$id
  rm -rf "$dir" && mkdir -p "$dir"
  [ "$spec" != none ] || return 0
  rm -rf "$dest" "$HOME/.gstack/arms/hermes-skills"
  rc=0
  bin/gstack-modules render --host "$host" --modules "$spec" --out-dir "$dest" --install-root "$G" --model "$model" --plan-mode "$plan_mode" > "$dir/render.log" 2> "$dir/refusal.txt" || rc=$?
  if [ "$rc" -ne 0 ]; then echo "$rc" > "$dir/exit"; rm -rf "$dest"; return 0; fi
  rm -f "$dir/refusal.txt"
  cp "$dest/loadout.lock.json" "$dir/loadout.lock.json"
  if [ "$keep" -eq 0 ]; then rm -rf "$dest"; return 0; fi
  if [ "$host" = claude ]; then
    mkdir -p "$dest/gstack" && cp "$dest/SKILL.md" "$dest/gstack/SKILL.md"
    for e in "$G"/* "$G"/.[!.]*; do [ -e "$e" ] && [ ! -e "$dest/gstack/${e##*/}" ] && ln -s "$e" "$dest/gstack/${e##*/}"; done
  fi
  if [ "$host" = codex ]; then
    side=$dest/.agents/skills/gstack
    for e in bin lib ETHOS.md; do [ -e "$G/$e" ] && [ ! -e "$side/$e" ] && ln -s "$G/$e" "$side/$e"; done
    for d in browse review qa; do
      [ -d "$G/$d" ] || continue
      mkdir -p "$side/$d"
      for e in "$G/$d"/* "$G/$d"/.[!.]*; do [ -e "$e" ] && [ "${e##*/}" != SKILL.md ] && [ ! -e "$side/$d/${e##*/}" ] && ln -s "$e" "$side/$d/${e##*/}"; done
    done
    for d in design make-pdf; do [ -d "$G/$d/dist" ] && mkdir -p "$side/$d" && ln -sfn "$G/$d/dist" "$side/$d/dist"; done
    [ ! -f "$G/supabase/config.sh" ] || { mkdir -p "$side/supabase" && ln -sf "$G/supabase/config.sh" "$side/supabase/config.sh"; }
  fi
  if [ "$host" = hermes ]; then mkdir -p "$HOME/.gstack/arms/hermes-skills/gstack" && cp -a "$dest/.hermes/skills/." "$HOME/.gstack/arms/hermes-skills/gstack/"; fi
  mkdir -p "$dir/tree$(dirname "$dest")"
  mv "$dest" "$dir/tree$dest"
  if [ "$host" = hermes ]; then mkdir -p "$dir/tree$HOME/.gstack/arms" && mv "$HOME/.gstack/arms/hermes-skills" "$dir/tree$HOME/.gstack/arms/hermes-skills"; fi
}
for a in ${arms[@]+"${arms[@]}"}; do render "$a" 1; done
for a in ${lock_arms[@]+"${lock_arms[@]}"}; do render "$a" 0; done
if [ "$runtime" -eq 1 ]; then
  rm -rf "$HOME/.gstack/arms"
  mkdir -p "$out/runtime$HOME/.local/share" "$out/runtime$HOME/.bun"
  cp -a "$HOME/.bun/bin" "$out/runtime$HOME/.bun/bin"
  cp -a "$G" "$out/runtime$G"
  cp -a "$HOME/.gstack" "$out/runtime$HOME/.gstack"
  printf '%s\n' "$(git -C "$G" rev-parse HEAD)" > "$out/runtime.commit"
  bun --version > "$out/runtime.bun"
fi
printf '%s\n' "$HOME" > "$out/home"
[ -z "${OUT_UID:-}" ] || chown -R "$OUT_UID:${OUT_GID:-$OUT_UID}" "$out"
