#!/bin/bash
# internal-task step 0: put the catalog where the harness reads user skills, apply the variant's setting, run the counted adapter.
#   native      the catalog, every harness setting at its shipped default
#   names-only  the names-only catalog copy; Claude Code: SLASH_COMMAND_TOOL_CHAR_BUDGET=${STEP0_CC_BUDGET:-100000};
#               Codex: /etc/codex/config.toml (written at image build) from codex-names-only.toml ([skills] max_context_tokens = 10000, the cap)
#   no-bundled  the catalog; Claude Code: CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1; Codex: /etc/codex/config.toml from
#               codex-no-bundled.toml ([skills.bundled] enabled = false)
set -e
: "${HE_SESSION_STATE_DIR:=/harness-state}"
catalog=native
[ "$STEP0_VARIANT" = names-only ] && catalog=names-only
case "$STEP0_HARNESS" in
  claude-code)
    dest="$HE_SESSION_STATE_DIR/claude/skills"
    case "$STEP0_VARIANT" in
      names-only) export SLASH_COMMAND_TOOL_CHAR_BUDGET="${STEP0_CC_BUDGET:-100000}" ;;
      no-bundled) export CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 ;;
    esac ;;
  codex)
    dest="$HE_SESSION_STATE_DIR/codex/skills"
    [ "$STEP0_VARIANT" = native ] || [ -f /etc/codex/config.toml ] || { echo "catalog-entry.sh: no /etc/codex/config.toml for $STEP0_VARIANT" >&2; exit 2; } ;;
  *) echo "catalog-entry.sh: STEP0_HARNESS=$STEP0_HARNESS is not claude-code or codex" >&2; exit 2 ;;
esac
mkdir -p "$dest"
cp -r "/opt/step0-catalog/$catalog/." "$dest/"
echo "step0: harness=$STEP0_HARNESS variant=$STEP0_VARIANT catalog=$catalog skills=$(ls "$dest" | wc -l) dest=$dest" >&2
exec /opt/harness/adapter.sh "$@"
