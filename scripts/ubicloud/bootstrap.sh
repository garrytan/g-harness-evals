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

# Network steps retry with backoff (internal-task, 2026-11-08: GitHub release downloads answered 504 for hours and six shard
# launches failed in this script or the image build). HE_RETRY_TRIES tries, waits doubling from HE_RETRY_BASE_S up to
# HE_RETRY_MAX_S. HE_BUN_INSTALL_URL and HE_BUN_NPM_REGISTRY point the Bun step at stubs in tests/ubicloud-lane-retry.test.ts,
# and HE_BOOTSTRAP_ONLY=bun runs the Bun step alone there.
tries=${HE_RETRY_TRIES:-6} base_s=${HE_RETRY_BASE_S:-5} max_s=${HE_RETRY_MAX_S:-120}
bun_ok() { [ -x "$HOME/.bun/bin/bun" ] && [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null)" = "$bun_version" ]; }

# The same Bun version from the npm registry (@oven/bun-linux-<arch>, the package the bun npm wrapper installs), accepted
# only when the tarball's sha512 matches the registry's integrity field and the metadata names that package and version.
bun_from_npm() {
  local arch pkg reg=${HE_BUN_NPM_REGISTRY:-https://registry.npmjs.org} tmp i wait=$base_s url
  case $(uname -m) in x86_64) arch=x64 ;; aarch64 | arm64) arch=aarch64 ;; *) echo "bootstrap: no Bun npm package for $(uname -m)" >&2; return 1 ;; esac
  pkg="@oven/bun-linux-$arch"
  log "bun install script failed $tries times; trying the npm registry package $pkg@$bun_version"
  tmp=$(mktemp -d)
  for ((i = 1; i <= tries; i++)); do
    rm -f "$tmp/meta.json" "$tmp/bun.tgz"
    if curl -fsSL --connect-timeout 20 --max-time 60 "$reg/$pkg/$bun_version" -o "$tmp/meta.json" 2>/dev/null \
      && url=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["dist"]["tarball"])' "$tmp/meta.json") \
      && curl -fsSL --connect-timeout 20 --max-time 180 "$url" -o "$tmp/bun.tgz" 2>/dev/null; then break; fi
    rm -f "$tmp/bun.tgz"
    [ "$i" -lt "$tries" ] || break
    log "npm registry try $i of $tries failed; next try in ${wait}s"
    sleep "$wait"; wait=$(( wait * 2 > max_s ? max_s : wait * 2 ))
  done
  [ -s "$tmp/bun.tgz" ] || { echo "bootstrap: the npm registry did not serve $pkg@$bun_version after $tries tries" >&2; rm -rf "$tmp"; return 1; }
  python3 - "$tmp/meta.json" "$tmp/bun.tgz" "$pkg" "$bun_version" <<'PY' || { rm -rf "$tmp"; return 1; }
import base64, hashlib, json, sys
meta, tgz, pkg, version = sys.argv[1:5]
m = json.load(open(meta))
want = m.get('dist', {}).get('integrity', '')
got = 'sha512-' + base64.b64encode(hashlib.sha512(open(tgz, 'rb').read()).digest()).decode()
if m.get('name') != pkg or m.get('version') != version: sys.exit('bootstrap: registry metadata names %s@%s, not %s@%s' % (m.get('name'), m.get('version'), pkg, version))
if got != want: sys.exit('bootstrap: %s@%s tarball sha512 does not match the registry integrity' % (pkg, version))
PY
  tar -xzf "$tmp/bun.tgz" -C "$tmp" package/bin/bun && mkdir -p "$HOME/.bun/bin" && install -m 0755 "$tmp/package/bin/bun" "$HOME/.bun/bin/bun"
  local rc=$?
  rm -rf "$tmp"
  return $rc
}

install_bun() {
  local i wait=$base_s
  for ((i = 1; i <= tries; i++)); do
    if curl -fsSL --connect-timeout 20 --max-time 60 "${HE_BUN_INSTALL_URL:-https://bun.sh/install}" 2>/dev/null | BUN_INSTALL="$HOME/.bun" bash -s "bun-v$bun_version" >/dev/null 2>&1 && [ -x "$HOME/.bun/bin/bun" ]; then return 0; fi
    [ "$i" -lt "$tries" ] || break
    log "bun install try $i of $tries failed; next try in ${wait}s"
    sleep "$wait"; wait=$(( wait * 2 > max_s ? max_s : wait * 2 ))
  done
  bun_from_npm
}

if [ "${HE_BOOTSTRAP_ONLY:-}" != bun ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq --no-install-recommends ca-certificates curl git jq python3 unzip >/dev/null
  log "apt done ($(( $(date +%s) - t0 ))s)"
fi

if ! bun_ok; then
  rm -f "$HOME/.bun/bin/bun"
  install_bun || { echo "bootstrap: Bun $bun_version could not be installed from GitHub or the npm registry" >&2; exit 2; }
fi
ln -sf bun "$HOME/.bun/bin/bunx"
# The runner starts every remote command in a login shell, which reads ~/.profile and not the lines the installer adds to ~/.bashrc.
grep -q '/.bun/bin' ~/.profile 2>/dev/null || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.profile
export PATH="$HOME/.bun/bin:$PATH"
[ "$(bun --version)" = "$bun_version" ] || { echo "bootstrap: bun $(bun --version) installed, ci.yml pins $bun_version" >&2; exit 2; }
[ "$(bunx --version 2>/dev/null)" = "$bun_version" ] || { echo "bootstrap: bunx is missing or is not Bun $bun_version" >&2; exit 2; }
[ "${HE_BOOTSTRAP_ONLY:-}" != bun ] || { log "bun $bun_version"; exit 0; }
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

# Inbound firewall (2026-10-28): the VM has a public address and the metering proxy on a shard VM holds the provider keys,
# so only SSH is reachable from outside. Containers still reach the host over the docker bridges (the proxy and the world
# bind the bridge gateway), replies to the VM's own connections come back, and ICMP stays for path discovery and IPv6
# neighbour discovery. Its own nftables table, so Docker's iptables rules (FORWARD and NAT) are untouched. Idempotent.
# HE_LANE_FIREWALL=off skips it, for a debugging VM nobody runs a proxy on.
if [ "${HE_LANE_FIREWALL:-on}" != off ]; then
  command -v nft >/dev/null || sudo apt-get install -y -qq --no-install-recommends nftables >/dev/null
  sudo nft -f - <<'EOF'
table inet he_lane
delete table inet he_lane
table inet he_lane {
  chain input {
    type filter hook input priority 0; policy drop;
    iif lo accept
    ct state established,related accept
    ct state invalid drop
    meta l4proto { icmp, ipv6-icmp } accept
    iifname "docker0" accept
    iifname "br-*" accept
    udp sport 67 udp dport 68 accept
    udp sport 547 udp dport 546 accept
    tcp dport 22 accept
  }
}
EOF
  log "firewall: inbound drop except ssh, loopback, docker bridges, replies, icmp ($(sudo nft list chain inet he_lane input | grep -c accept) accept rules)"
fi
log "done in $(( $(date +%s) - t0 ))s"
