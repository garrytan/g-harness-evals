#!/bin/bash
# Verifier for the fake toy fixture. Runs in its own image (verifier/Dockerfile), never in the agent's container, with
# no network; the agent's /work is restored here as an artifact. The agent's code only ever runs as an unprivileged user
# in a child process, isolated (-I) with /work/repo appended to sys.path, so it cannot shadow the standard library or
# touch the verifier's files. hidden_test.py grades the values the agent's code prints on random inputs, so an exit
# code alone never earns reward; the repo test's exit code is only a regression signal next to it. Harbor mounts
# /logs/verifier and restores /work world-writable, so both go back to root before any agent code runs, and every
# process left behind by uid 65534 is killed after each run.
set -u
PY=/usr/local/bin/python3.12
SHA=/usr/bin/sha256sum
out=/logs/verifier
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
reap() { local n=0; while /usr/bin/pgrep -u 65534 >/dev/null; do /usr/bin/pkill -KILL -u 65534; n=$((n + 1)); [ "$n" -lt 100 ] || finish 0 true false false; sleep 0.1; done; }
finish() { echo "$1" > "$out/reward.txt"; printf '{"reward": %s, "tamper": %s, "hidden_pass": %s, "repo_tests_pass": %s}\n' "$1" "$2" "$3" "$4" > "$out/result.json"; exit 0; }
while IFS=$'\t' read -r want path; do
  [ -n "$path" ] || continue
  got=$($SHA "$path" 2>/dev/null | cut -d' ' -f1)
  [ "$got" = "$want" ] || finish 0 true false false
done < "$here/integrity.tsv"
{ /bin/chown root:root "$out" && /bin/chmod 0755 "$out"; } || finish 0 true false false
/bin/cp --remove-destination "$here/protected/test_calc.py" /work/repo/test_calc.py
{ /bin/chown -hR root:root /work && /bin/chmod -R go-w,a+rX /work; } || finish 0 true false false
[ "$(/usr/bin/stat -c %a:%U "$out")" = 755:root ] && [ "$(/usr/bin/stat -c %U /work/repo/test_calc.py)" = root ] || finish 0 true false false
cd /work/repo
hidden=false repo=false
$PY -I "$here/hidden_test.py" >/dev/null 2>&1 && hidden=true
reap
/usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups $PY -I -c 'import runpy, sys; sys.path.append("/work/repo"); runpy.run_path("/work/repo/test_calc.py", run_name="__main__")' >/dev/null 2>&1 && repo=true
reap
if [ "$hidden" = true ] && [ "$repo" = true ]; then finish 1 false true true; fi
finish 0 false "$hidden" "$repo"
