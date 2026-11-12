#!/bin/bash
# internal-task Step 0 entry: put the catalog where the harness reads skills, apply STEP0_CONFIG, then run the counted adapter.
#   native      catalog installed, every harness setting at its shipped default
#   names-only  the image carries the names-only catalog copy; OpenClaw's skills.limits raised (Hermes has no listing limit key)
#   no-bundled  OpenClaw skills.allowBundled set to a name no skill has; Hermes HERMES_HOME/.no-bundled-skills marker
# A first argument "list" runs the harness's own skill list commands after the same setup instead of the adapter.
set -e
case "$STEP0_HARNESS" in
  openclaw)
    mkdir -p /workspace/skills && cp -r /opt/step0-skills/. /workspace/skills/
    state="$HE_SESSION_STATE_DIR/openclaw"
    template=/opt/harness/config/openclaw.json
    case "${HE_MODEL_BASE_URL%/}" in */openai) template=/opt/harness/config/openclaw.openai.json ;; esac
    extra=""
    case "$STEP0_CONFIG" in
      names-only) extra='  skills: { limits: { maxCandidatesPerRoot: 1000, maxSkillsLoadedPerSource: 1000, maxSkillsInPrompt: 1000, maxSkillsPromptChars: 1000000 } },' ;;
      no-bundled) extra='  skills: { allowBundled: ["step0-no-bundled-skill"] },' ;;
    esac
    if [ -n "$extra" ]; then
      mkdir -p "$state"
      python3 - "$template" "$state/openclaw.json" "$extra" <<'PY'
import sys
src, dest, extra = sys.argv[1:4]
text = open(src).read().rstrip()
assert text.endswith("}"), "template does not end with }"
open(dest, "w").write(text[:-1].rstrip() + "\n" + extra + "\n}\n")
PY
    fi
    if [ "${1:-}" = list ]; then
      export HOME="$HE_SESSION_STATE_DIR" OPENCLAW_STATE_DIR="$state" OPENCLAW_CONFIG_PATH="$state/openclaw.json"
      mkdir -p "$state"; [ -e "$OPENCLAW_CONFIG_PATH" ] || cp "$template" "$OPENCLAW_CONFIG_PATH"
      cd /workspace
      openclaw skills list --json > "$HE_LOG_DIR/skills-list.json" 2> "$HE_LOG_DIR/skills-list.err" || true
      openclaw skills list --json --verbose > "$HE_LOG_DIR/skills-list-verbose.json" 2>> "$HE_LOG_DIR/skills-list.err" || true
      openclaw skills check --json > "$HE_LOG_DIR/skills-check.json" 2> "$HE_LOG_DIR/skills-check.err" || true
      cp "$OPENCLAW_CONFIG_PATH" "$HE_LOG_DIR/openclaw.json"
      exit 0
    fi
    ;;
  hermes)
    home="$HE_SESSION_STATE_DIR/hermes"
    mkdir -p "$home/skills" && cp -r /opt/step0-skills/. "$home/skills/"
    [ "$STEP0_CONFIG" = no-bundled ] && touch "$home/.no-bundled-skills"
    if [ "${1:-}" = list ]; then
      export HERMES_HOME="$home" HOME="$HE_SESSION_STATE_DIR"
      [ -e "$home/config.yaml" ] || cp /opt/harness/config/config.yaml "$home/config.yaml"
      cd /workspace
      hermes --version > "$HE_LOG_DIR/hermes-version.txt" 2>&1 || true
      COLUMNS=400 hermes skills list > "$HE_LOG_DIR/skills-list.txt" 2> "$HE_LOG_DIR/skills-list.err" || true
      find "$home/skills" -name SKILL.md | sed "s|^$home/skills/||" | sort > "$HE_LOG_DIR/skills-on-disk.txt"
      exit 0
    fi
    ;;
  *) echo "step0 entry: unknown STEP0_HARNESS=$STEP0_HARNESS" >&2; exit 2 ;;
esac
exec /opt/harness/adapter.sh "$@"
