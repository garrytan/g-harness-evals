#!/usr/bin/env bash
# The questions a fresh gstack install asks at the start of its first skill, gated as gstack's bin/gstack-skill-start
# gates them at garrytan/gstack 55aaa6c4a (gstack 1.102 with #4510; 1.101.0.0 gates them the same way): the upgrade offer
# when the update check finds one (none when update_check is false), the Boil the Ocean intro (.completeness-intro-seen),
# telemetry (.telemetry-prompted, after the intro), proactive suggestions (.proactive-prompted, after telemetry, none when
# proactive is off) and the routing offer (no "## Skill routing" in CLAUDE.md or AGENTS.md here, routing_declined false,
# proactive asked and not off). spawned and unattended sessions get none of them.
#
#   GSTACK_HOME=<state dir> SESSION_KIND=<kind> [UPGRADE_AVAILABLE=1] first-run-gates.sh <gstack bin dir>
#
# Prints "QUESTION <block>" per question the skill start would emit, "SESSION_KIND <kind>", and "BLOCKED" when the kind
# is headless and a question was emitted: a headless skill stops BLOCKED at a question nobody answers.
set -euo pipefail
bin=$1 gh=${GSTACK_HOME:?} kind=${SESSION_KIND:?}
q=0
ask() { echo "QUESTION $1"; q=1; }
case "$kind" in spawned|unattended) echo "SESSION_KIND $kind"; exit 0 ;; esac
[ "$("$bin/gstack-config" get update_check)" = false ] || [ "${UPGRADE_AVAILABLE:-}" != 1 ] || ask upgrade-flow
lake=$([ -f "$gh/.completeness-intro-seen" ] && echo yes || echo no)
tel=$([ -f "$gh/.telemetry-prompted" ] && echo yes || echo no)
pro=$([ -f "$gh/.proactive-prompted" ] && echo yes || echo no)
pro_off=$([ "$("$bin/gstack-config" get proactive)" = off ] && echo yes || echo no)
has_routing=no
for f in CLAUDE.md AGENTS.md; do [ -f "$f" ] && grep -q "## Skill routing" "$f" && has_routing=yes; done
[ "$lake" = yes ] || ask lake-intro
[ "$tel" = yes ] || [ "$lake" = no ] || ask telemetry-prompt
[ "$pro" = yes ] || [ "$tel" = no ] || [ "$pro_off" = yes ] || ask proactive-prompt
[ "$has_routing" = yes ] || [ "$("$bin/gstack-config" get routing_declined)" != false ] || [ "$pro" = no ] || [ "$pro_off" = yes ] || ask routing-injection
echo "SESSION_KIND $kind"
[ "$kind" != headless ] || [ "$q" -eq 0 ] || echo BLOCKED
