#!/bin/bash
# internal-task anatomy probe image: put probe skills where the harness reads skills, then run the counted adapter unchanged.
set -e
case "${ANATOMY_HARNESS:-openclaw}" in
  openclaw) mkdir -p /workspace/skills && cp -r /opt/anatomy-skills/. /workspace/skills/ ;;
  hermes) mkdir -p "$HE_SESSION_STATE_DIR/hermes/skills" && cp -r /opt/anatomy-skills/. "$HE_SESSION_STATE_DIR/hermes/skills/" ;;
esac
exec /opt/harness/adapter.sh "$@"
