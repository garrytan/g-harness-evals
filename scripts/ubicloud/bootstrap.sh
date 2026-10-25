#!/usr/bin/env bash
# Mirror ci.yml's runner on a fresh Ubuntu 24.04 Ubicloud VM: Bun at the workflow's bun-version, python3 for
# scripts/check-links.py, jq for scripts/build-gbrain-image.sh, Node (tests/qm-directory.test.ts spawns `node`, which
# ubuntu-latest carries), and Docker, which ubuntu-latest has for every job (the container-level cases in
# tests/adapter-conformance.test.ts skip without it, so the checks job needs it too). Run by ubi-runner.sh --setup as
# user ubi (passwordless sudo) with the synced checkout as the working directory. Idempotent.
set -euo pipefail
[ -f .github/workflows/ci.yml ] || { echo "bootstrap: run from the repository root (no .github/workflows/ci.yml here)" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
t0=$(date +%s)
log() { echo "[bootstrap] $*"; }

bun_version=$(sed -n 's/^ *bun-version: *//p' .github/workflows/ci.yml | head -1)
[ -n "$bun_version" ] || { echo "bootstrap: no bun-version in .github/workflows/ci.yml" >&2; exit 2; }

sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends ca-certificates curl git jq python3 unzip >/dev/null
log "apt done ($(( $(date +%s) - t0 ))s)"

if ! [ -x "$HOME/.bun/bin/bun" ] || [ "$("$HOME/.bun/bin/bun" --version)" != "$bun_version" ]; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL="$HOME/.bun" bash -s "bun-v$bun_version" >/dev/null
fi
# The runner starts every remote command in a login shell, which reads ~/.profile and not the lines the installer adds to ~/.bashrc.
grep -q '/.bun/bin' ~/.profile 2>/dev/null || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.profile
export PATH="$HOME/.bun/bin:$PATH"
[ "$(bun --version)" = "$bun_version" ] || { echo "bootstrap: bun $(bun --version) installed, ci.yml pins $bun_version" >&2; exit 2; }
log "bun $bun_version, python3 $(python3 --version | cut -d' ' -f2), jq $(jq --version) ($(( $(date +%s) - t0 ))s)"

if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y -qq --no-install-recommends nodejs >/dev/null
fi
log "node $(node --version) ($(( $(date +%s) - t0 ))s)"

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo systemctl enable --now docker >/dev/null 2>&1
sudo usermod -aG docker "$USER"
log "$(sudo docker --version) ($(( $(date +%s) - t0 ))s)"
log "done in $(( $(date +%s) - t0 ))s"
