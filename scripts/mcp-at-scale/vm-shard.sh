#!/usr/bin/env bash
# The VM side of scripts/mcp-at-scale/run-shard-vm.sh (internal-task): run from the staged checkout's root on a Ubicloud VM
# after scripts/ubicloud/bootstrap.sh. Installs Harbor from the hashed lock file and the repository's bun packages, both
# with a scrubbed environment, then runs run.ts shard on .mcp-input/spec.json under the docker group, writing to
# ~/mcp-out/<shard>, and hands the results to the VM user so the final pull can read every file.
#
#   bash scripts/mcp-at-scale/vm-shard.sh <shard> <deadline-epoch> [--fake-upstream] [--phase 1|2 [--prior-phase <dir>]]
set -euo pipefail
shard=${1:?usage: vm-shard.sh <shard> <deadline-epoch>}
[ -f scripts/mcp-at-scale/run.ts ] && [ -f .mcp-input/spec.json ] || { echo "vm-shard: run from the staged checkout's root" >&2; exit 2; }
deadline=${2:-}
[[ "$deadline" =~ ^[1-9][0-9]*$ ]] || exit 2
shift 2
clean=(env -i "PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin" "HOME=$HOME" TZ=UTC DEBIAN_FRONTEND=noninteractive)
"${clean[@]}" sudo -n apt-get install -y -q python3-venv >/dev/null
venv=$HOME/he-harbor-venv
[ -x "$venv/bin/harbor" ] || "${clean[@]}" bash -c 'python3 -m venv "$1" && "$1/bin/pip" install -q --require-hashes --only-binary :all: -r scripts/frontier-harbor/harbor-requirements.txt' _ "$venv"
"${clean[@]}" bun install --frozen-lockfile >/dev/null
out=$HOME/mcp-out/$shard
mkdir -p "$out"
export PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin TZ=UTC
rc=0
# run.ts removes every provider key from its own environment at start and passes them to the metering proxy alone.
args=(shard --spec .mcp-input/spec.json --name "$shard" --out "$out" --venv "$venv" "$@")
printf -v command ' %q' "${args[@]}"
sg docker -c "if [ ! -e \"\$HOME/.he-mcp-deadline\" ] && [ \"\$(date +%s)\" -lt $deadline ]; then exec bun scripts/mcp-at-scale/run.ts$command; else exit 124; fi" || rc=$?
sudo -n chown -R "$(id -un):" "$out" || true
echo "vm-shard: run.ts exited $rc"
exit "$rc"
