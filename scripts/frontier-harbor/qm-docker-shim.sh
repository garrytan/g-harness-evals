#!/bin/sh
# Stand-in for the docker CLI inside QM core on the frontier Harbor path (scripts/frontier-harbor/qm_harbor.py).
# QM's local sandbox backend (src/sandbox/local-sandbox.ts at the pin) runs every sandbox through the docker CLI named by
# LOCAL_SANDBOX_DOCKER_BIN. Here every sandbox it asks for is the Harbor task container: `run` and `start` only mark the
# name running, `port` answers the port of QM's own exec daemon (cli/templates/aws/microvm-agent/agent.mjs at the pin),
# which FrontierQm starts inside the task container, and networks, volumes and images are answered as present. Every call
# is appended to $HE_QM_SHIM_STATE/calls.log. Any other command fails, so a new docker use in QM shows up as an error.
set -u
state=${HE_QM_SHIM_STATE:-/tmp/he-qm-shim}
port=${HE_QM_SANDBOX_PORT:?HE_QM_SANDBOX_PORT must name the port of the exec daemon}
image_id=sha256:harbor-task-container
mkdir -p "$state/known" "$state/running" "$state/volumes"
printf '%s\n' "$*" >> "$state/calls.log"
cmd=${1:-}
[ $# -gt 0 ] && shift
last() { for a; do :; done; printf '%s' "${a:-}"; }
case $cmd in
  version) echo "he-qm docker shim (sandbox = the Harbor task container)" ;;
  image)
    [ "${1:-}" = inspect ] || exit 1
    case "$*" in *'{{.Id}}'*) echo "$image_id" ;; *) echo "" ;; esac ;;
  inspect)
    name=$(last "$@")
    [ -e "$state/known/$name" ] || { echo "Error: No such object: $name" >&2; exit 1; }
    if [ -e "$state/running/$name" ]; then echo "true $image_id"; else echo "false $image_id"; fi ;;
  run)
    name=
    while [ $# -gt 0 ]; do if [ "$1" = --name ]; then name=${2:-}; break; fi; shift; done
    [ -n "$name" ] || { echo "he-qm docker shim: run without --name" >&2; exit 1; }
    touch "$state/known/$name" "$state/running/$name"
    echo "$name" ;;
  start) name=$(last "$@"); touch "$state/known/$name" "$state/running/$name" ;;
  stop) rm -f "$state/running/$(last "$@")" ;;
  rm) for a; do case $a in -*) ;; *) rm -f "$state/running/$a" "$state/known/$a" ;; esac; done ;;
  port) echo "127.0.0.1:$port" ;;
  volume)
    sub=${1:-}
    [ $# -gt 0 ] && shift
    case $sub in
      inspect) [ -e "$state/volumes/$(last "$@")" ] ;;
      create) touch "$state/volumes/$(last "$@")"; last "$@"; echo ;;
      rm) for a; do case $a in -*) ;; *) rm -f "$state/volumes/$a" ;; esac; done ;;
      *) echo "he-qm docker shim: unsupported volume $sub" >&2; exit 1 ;;
    esac ;;
  network) : ;;
  ps) : ;;
  *) echo "he-qm docker shim: unsupported command $cmd" >&2; exit 1 ;;
esac
