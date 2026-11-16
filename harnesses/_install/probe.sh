#!/usr/bin/env bash
# The gbrain install probe (internal-task, docs/adapters.md "Install mode"). Bash, grep, find and coreutils only, so the same file runs
# in all four harness images (the Hermes image has python3 and no node; the Claude Code and Codex images have node and no python3).
#
#   probe.sh state <harness>                       one JSON line on stdout: is gbrain installed, is there a brain, is the harness
#                                                  wired to it
#   probe.sh watch <harness> <out.ndjson> <pid>    every second: compute the state, append it to <out.ndjson> when anything but
#                                                  "at" changed, touch <out dir>/install-watch.alive; exit once <pid> is gone
#
# <harness> is claude-code, codex, openclaw or hermes. HOME is HE_SESSION_STATE_DIR (the adapters export both), the workspace is
# HE_WORKSPACE_DIR (default /workspace), and each harness's own state dir is the one its adapter exports: CLAUDE_CONFIG_DIR,
# CODEX_HOME, OPENCLAW_STATE_DIR, HERMES_HOME (default HOME/claude, HOME/codex, HOME/openclaw, HOME/hermes). The harness's stock
# location under HOME (~/.claude, ~/.codex, ~/.openclaw, ~/.hermes) is read too, for an agent that wrote there.
#
# The state line:
#   binary        gbrain on PATH, else in ~/.bun/bin, ~/.local/bin or ~/.npm-global/bin; null when none
#   version       the first dotted number "gbrain --version" prints within 5 s; null when none
#   brain         ~/.gbrain/brain.pglite or ~/.gbrain/config.json exists; brain_path names the one found (brain.pglite first)
#   mcp           a harness config registers a server named gbrain, or a gbrain plugin that brings its tools
#   instructions  a file the harness loads as instructions or a skill mentions gbrain
#   hook          a harness hook or turn plugin runs gbrain
#   wired         every candidate file or plugin directory that mentions gbrain: relative to HOME, or absolute when outside it
#   ok            binary and brain and (mcp or instructions or hook)
set -uo pipefail
shopt -s nullglob

usage() { echo "usage: probe.sh state <claude-code|codex|openclaw|hermes> | probe.sh watch <harness> <out.ndjson> <pid>" >&2; exit 2; }
[ $# -ge 2 ] || usage
cmd=$1 harness=$2
case "$harness" in claude-code|codex|openclaw|hermes) ;; *) usage ;; esac

home=${HE_SESSION_STATE_DIR:-${HOME:-/harness-state}}
home=${home%/}
ws=${HE_WORKSPACE_DIR:-/workspace}
ws=${ws%/}

js() {
  local s=$1
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\r'/\\r}; s=${s//$'\t'/\\t}
  printf '"%s"' "$s"
}
mentions() { [ -f "$1" ] && grep -qi gbrain "$1" 2>/dev/null; }

declare -A seen
wired=()
mcp=false instructions=false hook=false
add_wired() {
  local p=$1 rel
  case "$p" in "$home"/*) rel=${p#"$home"/} ;; *) rel=$p ;; esac
  [ -n "${seen[$rel]:-}" ] && return 0
  seen[$rel]=1
  wired+=("$rel")
}
# consider <kind> <file>: a file that mentions gbrain is wired; its kind decides which flag it sets.
#   instructions  any mention
#   mcp-json      a JSON or JSON5 key named gbrain holding an object (mcpServers.gbrain, mcp.servers.gbrain)
#   mcp-toml      a [mcp_servers.<name>] table whose name holds gbrain
#   mcp-yaml      an mcp_servers: section with an entry named gbrain
#   hook-json     a "command" that runs gbrain (Claude Code settings hooks, Codex hooks.json)
#   hook-yaml     a hooks: section with a command that runs gbrain (Hermes)
#   openclaw-json mcp-json, and a hook for a gbrain turn plugin entry or a hook command that runs gbrain
consider() {
  local kind=$1 f=$2
  mentions "$f" || return 0
  add_wired "$f"
  case "$kind" in
    instructions) instructions=true ;;
    mcp-json) grep -Eq '(^|[[:space:],{])"?gbrain"?[[:space:]]*:[[:space:]]*\{' "$f" && mcp=true ;;
    mcp-toml) grep -Eq '^[[:space:]]*\[mcp_servers\.[^]]*gbrain' "$f" && mcp=true ;;
    mcp-yaml) grep -q '^mcp_servers:' "$f" && grep -Eq '^[[:space:]]+"?gbrain[A-Za-z0-9_-]*"?:[[:space:]]*$' "$f" && mcp=true ;;
    hook-json) grep -Eqi '"command"[[:space:]]*:[[:space:]]*"[^"]*gbrain' "$f" && hook=true ;;
    hook-yaml) grep -q '^hooks:' "$f" && grep -Eqi '^[[:space:]]*(-[[:space:]]*)?command:.*gbrain' "$f" && hook=true ;;
    openclaw-json)
      grep -Eq '(^|[[:space:],{])"?gbrain"?[[:space:]]*:[[:space:]]*\{' "$f" && mcp=true
      grep -Eqi 'gbrain[a-z0-9_-]*(turn|hook)|command"?[[:space:]]*:[[:space:]]*"[^"]*gbrain' "$f" && hook=true ;;
  esac
  return 0
}
# consider_plugin <mcp|hook> <dir>: a plugin directory whose name holds gbrain is wired and sets mcp or hook.
consider_plugin() {
  [ -d "$2" ] || return 0
  add_wired "$2"
  if [ "$1" = hook ]; then hook=true; else mcp=true; fi
}
# Skill and instruction files under a directory, a few levels down (skills/<name>/SKILL.md, skills/<category>/<name>/SKILL.md).
consider_tree() {
  local dir=$1 f
  [ -d "$dir" ] || return 0
  while IFS= read -r -d '' f; do consider instructions "$f"; done < <(find "$dir" -maxdepth 4 -type f -name '*.md' -print0 2>/dev/null)
}

scan() {
  local cc cx oc hh d p f
  case "$harness" in
    claude-code)
      cc=${CLAUDE_CONFIG_DIR:-$home/claude}
      for d in "$cc" "$home/.claude"; do
        consider mcp-json "$d/.claude.json"
        consider instructions "$d/CLAUDE.md"
        consider hook-json "$d/settings.json"
        consider hook-json "$d/settings.local.json"
        consider mcp-json "$d/plugins/installed_plugins.json"
        consider_tree "$d/skills"
        consider_tree "$d/commands"
        consider_tree "$d/agents"
      done
      consider mcp-json "$home/.claude.json"
      consider mcp-json "$ws/.mcp.json"
      consider instructions "$ws/CLAUDE.md"
      consider instructions "$ws/CLAUDE.local.md"
      consider instructions "$ws/.claude/CLAUDE.md"
      consider hook-json "$ws/.claude/settings.json"
      consider hook-json "$ws/.claude/settings.local.json"
      consider_tree "$ws/.claude/skills"
      ;;
    codex)
      cx=${CODEX_HOME:-$home/codex}
      for d in "$cx" "$home/.codex"; do
        consider mcp-toml "$d/config.toml"
        consider instructions "$d/AGENTS.md"
        consider instructions "$d/AGENTS.override.md"
        consider hook-json "$d/hooks.json"
        consider_tree "$d/skills"
        consider_tree "$d/prompts"
        for p in "$d"/plugins/*gbrain*; do consider_plugin mcp "$p"; done
      done
      consider instructions "$ws/AGENTS.md"
      consider instructions "$ws/AGENTS.override.md"
      consider_tree "$home/.agents/skills"
      consider_tree "$ws/.agents/skills"
      ;;
    openclaw)
      oc=${OPENCLAW_STATE_DIR:-$home/openclaw}
      for d in "$oc" "$home/.openclaw"; do
        consider openclaw-json "$d/openclaw.json"
        consider_tree "$d/skills"
        consider_tree "$d/workspace"
        for p in "$d"/extensions/*gbrain* "$d"/gbrain/*gbrain*; do
          case "${p##*/}" in *turn*|*hook*) consider_plugin hook "$p" ;; *) consider_plugin mcp "$p" ;; esac
        done
        for p in "$d"/hooks/*gbrain*; do consider_plugin hook "$p"; done
      done
      for f in AGENTS.md SOUL.md TOOLS.md BOOTSTRAP.md; do consider instructions "$ws/$f"; done
      consider_tree "$ws/skills"
      ;;
    hermes)
      hh=${HERMES_HOME:-$home/hermes}
      for d in "$hh" "$home/.hermes"; do
        consider mcp-yaml "$d/config.yaml"
        consider hook-yaml "$d/config.yaml"
        consider instructions "$d/SOUL.md"
        consider_tree "$d/skills"
        for p in "$d"/plugins/*gbrain*; do consider_plugin mcp "$p"; done
        for p in "$d"/hooks/*gbrain*; do consider_plugin hook "$p"; done
      done
      for f in .hermes.md HERMES.md AGENTS.md; do consider instructions "$ws/$f"; done
      ;;
  esac
}

# "gbrain --version" runs again only when the binary's path, mtime or size changed (the watcher asks every second).
version_key='' version_val=''
# Sets body: the state line without its harness and at fields.
state_body() {
  local bin='' d brain=false brain_path='' w ok=false key out
  seen=(); wired=(); mcp=false instructions=false hook=false
  bin=$(command -v gbrain 2>/dev/null || true)
  if [ -z "$bin" ]; then
    for d in "$home/.bun/bin" "$home/.local/bin" "$home/.npm-global/bin"; do
      if [ -f "$d/gbrain" ] && [ -x "$d/gbrain" ]; then bin=$d/gbrain; break; fi
    done
  fi
  if [ -n "$bin" ]; then
    key="$bin:$(stat -L -c '%Y:%s' "$bin" 2>/dev/null)"
    if [ "$key" != "$version_key" ]; then
      out=$(timeout -k 1 5 "$bin" --version < /dev/null 2>/dev/null | head -c 4096 || true)
      version_val=$(printf '%s\n' "$out" | grep -Eo '[0-9]+(\.[0-9]+)+' | head -1 || true)
      version_key=$key
    fi
  else
    version_key='' version_val=''
  fi
  if [ -e "$home/.gbrain/brain.pglite" ]; then brain=true brain_path=$home/.gbrain/brain.pglite
  elif [ -e "$home/.gbrain/config.json" ]; then brain=true brain_path=$home/.gbrain/config.json
  fi
  scan
  if [ -n "$bin" ] && [ "$brain" = true ] && { [ "$mcp" = true ] || [ "$instructions" = true ] || [ "$hook" = true ]; }; then ok=true; fi
  w=''
  for d in "${wired[@]}"; do w+="${w:+,}$(js "$d")"; done
  body="\"binary\":$([ -n "$bin" ] && js "$bin" || printf null),\"version\":$([ -n "$version_val" ] && js "$version_val" || printf null)"
  body+=",\"brain\":$brain,\"brain_path\":$([ -n "$brain_path" ] && js "$brain_path" || printf null),\"mcp\":$mcp,\"instructions\":$instructions,\"hook\":$hook"
  body+=",\"wired\":[$w],\"ok\":$ok"
}
line() { printf '{"harness":"%s","at":"%s",%s}\n' "$harness" "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$body"; }

case "$cmd" in
  state)
    [ $# -eq 2 ] || usage
    state_body
    line
    ;;
  watch)
    [ $# -eq 4 ] || usage
    out=$3 pid=$4
    alive="$(dirname "$out")/install-watch.alive"
    trap 'exit 0' TERM INT
    last=''
    while kill -0 "$pid" 2>/dev/null; do
      state_body
      if [ "$body" != "$last" ]; then line >> "$out"; last=$body; fi
      touch "$alive"
      sleep 1
    done
    ;;
  *) usage ;;
esac
