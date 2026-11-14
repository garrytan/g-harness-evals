#!/usr/bin/env bash
# The oracle check of the SWE-rebench July 2026 task source (pin-swe-rebench-07-2026.json) on one VM, with no model
# call: Harbor's oracle agent (the reference patch, solution/solve.sh) and its nop agent (no change) on every pinned
# task, through the same rig a run uses: Harbor from the hashed lock, the tasks fetched by content hash and materialized
# with their images pinned, and every trial in egress.py SourceBlocklistDockerEnvironment, the source's blocklist.
# Run on a fresh Ubicloud VM after scripts/ubicloud/bootstrap.sh, from the repository root, with docker usable:
#
#   bash scripts/frontier-harbor/swe-rebench-oracle-check.sh <out dir> [--batch 8] [--ids a,b]
#
# Steps, all keyless (every provider key is unset first):
#   1. Harbor 0.24.0 and its hashed dependencies, the way vm-run.sh installs them; the nftables probe.
#   2. Docker Hub's pull limit for this machine: the ratelimit-limit and ratelimit-remaining headers of a manifest HEAD
#      on ratelimitpreview/test (a HEAD is not counted as a pull), at the start and before every pull.
#   3. swe_rebench_fetch.py fetches the pinned tasks into ~/swe-rebench-07-2026, materialize.ts swerebench pins them.
#   4. An egress probe in a task container behind the source's sidecar: the source's added hosts must be refused and
#      the package registries reached.
#   5. Batches of --batch tasks in the shared order: each base image pulled by digest (time, size on disk), the task's
#      materialized environment built (with the pin's image_build steps) and both images put through
#      swe-rebench-history-audit.sh, one Harbor job running oracle and nop on the batch (n_concurrent 2 x batch, retries
#      off), disk use, then every image of the batch removed so the next batch starts clean.
#   6. <out>/oracle-check.json: per task the oracle and nop rewards and exceptions, pull time and size, disk, and
#      verifier lines that name a blocklisted host; under history, per task the audit of the base and the built image and
#      whether each leaks anything past the base commit; per task whether it got the Python prefetch, and which version.
# Exit 0 when the table was written (whatever it says), 2 usage, 3 setup failure.
set -euo pipefail
umask 022
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:?usage: swe-rebench-oracle-check.sh <out dir> [--batch 8] [--ids a,b]}
shift
batch=8 only=""
while [ $# -gt 0 ]; do
  case $1 in
    --batch) batch=$2; shift 2 ;;
    --ids) only=$2; shift 2 ;;
    *) echo "swe-rebench-oracle-check: unknown argument $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$out"
out=$(cd "$out" && pwd)
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
unset ANTHROPIC_API_KEY OPENAI_API_KEY UBICLOUD_API_KEY VOYAGE_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY
venv=${FRONTIER_HARBOR_VENV:-$HOME/.frontier-harbor/venv}
pin=$here/pin-swe-rebench-07-2026.json
src=$HOME/swe-rebench-07-2026
run=$out/run
say() { printf '%s oracle-check: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$out/check.log"; }
safe_env=(env -i "PATH=$PATH" "HOME=$HOME" "TZ=UTC")
now() { date +%s.%N; }

# 1. Harbor from the hashed lock, as vm-run.sh step 2 does
read -r wheel_sha lock_file lock_sha uv_version <<< "$(python3 -c 'import json,sys; h=json.load(open(sys.argv[1]))["harbor"]; d=h["dependencies"]; print(h["wheel_sha256"], d["file"], d["sha256"], d["uv"])' "$here/pin.json")"
lock=$repo/$lock_file
[ "$(sha256sum "$lock" | cut -d' ' -f1)" = "$lock_sha" ] || { say "$lock_file is not the pinned sha256"; exit 3; }
if [ ! -x "$venv/bin/harbor" ] || [ "$(cat "$venv/.lock-sha256" 2>/dev/null)" != "$lock_sha" ]; then
  uv=$HOME/.local/bin/uv
  [ "$("$uv" --version 2>/dev/null | cut -d' ' -f2)" = "$uv_version" ] || curl -LsSf "https://astral.sh/uv/$uv_version/install.sh" | "${safe_env[@]}" UV_NO_MODIFY_PATH=1 sh >> "$out/check.log" 2>&1
  rm -rf "$venv"; mkdir -p "$(dirname "$venv")"
  ("${safe_env[@]}" "$uv" venv --python 3.12 "$venv" && "${safe_env[@]}" "$uv" pip install --python "$venv/bin/python" --require-hashes --only-binary :all: -r "$lock") >> "$out/check.log" 2>&1 || { say "installing Harbor failed"; exit 3; }
  printf '%s' "$wheel_sha" > "$venv/.wheel-sha256"; printf '%s' "$lock_sha" > "$venv/.lock-sha256"
fi
if sudo -n nft add table inet frontier_probe 2>/dev/null; then sudo -n nft delete table inet frontier_probe; else say "nftables inet is missing; the blocklist cannot run"; exit 3; fi
say "harbor $("$venv/bin/python" -c 'import importlib.metadata as m; print(m.version("harbor"))'); kernel $(uname -r); $(docker --version); $(nproc) cpus; $(free -g | awk '/Mem:/{print $2}') GiB; disk $(df -BG --output=size,avail / | tail -1)"

# 2. Docker Hub's limit for this machine (a HEAD is not a pull)
ratelimit() {
  python3 - <<'PY'
import json, urllib.request
tok = json.load(urllib.request.urlopen("https://auth.docker.io/token?service=registry.docker.io&scope=repository:ratelimitpreview/test:pull", timeout=30))["token"]
req = urllib.request.Request("https://registry-1.docker.io/v2/ratelimitpreview/test/manifests/latest", method="HEAD", headers={"Authorization": "Bearer " + tok})
h = {k.lower(): v for k, v in urllib.request.urlopen(req, timeout=30).headers.items()}
print(json.dumps({"limit": h.get("ratelimit-limit"), "remaining": h.get("ratelimit-remaining"), "source": "ip" if h.get("docker-ratelimit-source") else None}))
PY
}
ratelimit > "$out/ratelimit-start.json" 2>>"$out/check.log" || echo '{"error": "HEAD failed"}' > "$out/ratelimit-start.json"
say "docker hub limit at start: $(cat "$out/ratelimit-start.json")"
docker info --format '{{json .RegistryConfig.Mirrors}}' > "$out/registry-mirrors.json" 2>/dev/null || true

# 3. tasks
ids=$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); w=set(filter(None, sys.argv[2].split(","))); print(",".join(t for t in p["shared_order"]["order"] if not w or t in w))' "$pin" "$only")
"${safe_env[@]}" "$venv/bin/python" "$here/swe_rebench_fetch.py" fetch --pin "$pin" --out "$src" --ids "$ids" >> "$out/check.log" 2>&1 || { say "fetch failed ($src/fetch.json)"; exit 3; }
cp "$src/fetch.json" "$out/fetch.json"
(cd "$repo" && "${safe_env[@]}" bun scripts/frontier-harbor/materialize.ts swerebench --src "$src" --out "$run" --ids "$ids") >> "$out/check.log" 2>&1 || { say "materialize refused (check.log)"; exit 3; }
say "materialized $(printf '%s' "$ids" | tr ',' '\n' | grep -c .) task(s)"
harbor_env=("${safe_env[@]}" "PYTHONPATH=$here")
job() {
  python3 - "$@" <<'PY'
import json, sys
path, name, jobs, conc, agents, tasks = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5].split(","), sys.argv[6:]
json.dump({"job_name": name, "jobs_dir": jobs, "n_attempts": 1, "n_concurrent_trials": conc, "quiet": True, "retry": {"max_retries": 0},
           "environment": {"import_path": "egress:SourceBlocklistDockerEnvironment", "delete": True, "kwargs": {"task_source": "swe-rebench-07-2026"}},
           "agents": [{"name": a} for a in agents], "tasks": [{"path": t} for t in tasks]}, open(path, "w"), indent=2)
PY
}

# 4. the egress probe behind the source's sidecar
probe=$out/probe/tasks/egress-probe
rm -rf "$out/probe"; mkdir -p "$out/probe/tasks"
cp -r "$here/egress-probe" "$probe"
sed -i '/^\[verifier.env\]/,/^\[/{/PROBE_PROXY_STATUS_URL/d}' "$probe/task.toml"
python3 - "$pin" "$probe/tests/probe.py" <<'PY'
import json, sys
pin = json.load(open(sys.argv[1]))
blocked = ["github.com", "api.github.com", "codeload.github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "patch-diff.githubusercontent.com",
           "huggingface.co", "datasets-server.huggingface.co", "hf.co", "swe-rebench.com", "ofhuhcpkvzjlejydnvyd.supabase.co", "api.anthropic.com", "tbench.ai"]
assert all(any(b == h or (h.startswith("*.") and b.endswith(h[1:])) for h in pin["egress"]["blocklist"]) for b in blocked)
open_ = ["pypi.org", "files.pythonhosted.org", "registry.npmjs.org", "crates.io", "static.crates.io", "index.crates.io", "proxy.golang.org", "sum.golang.org", "repo.maven.apache.org", "repo1.maven.org"]
open(sys.argv[2], "w").write(f'''import json, os, socket, ssl
BLOCKED = {blocked!r}
OPEN = {open_!r}
def https(host):
    try:
        socket.getaddrinfo(host, 443)
    except Exception as e:
        return {{"ok": False, "error": "dns:" + type(e).__name__}}
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=10) as s, ctx.wrap_socket(s, server_hostname=host) as t:
            t.sendall(f"HEAD / HTTP/1.1\\r\\nHost: {{host}}\\r\\nConnection: close\\r\\n\\r\\n".encode())
            return {{"ok": bool(t.recv(64)), "error": None}}
    except Exception as e:
        return {{"ok": False, "error": type(e).__name__}}
out = {{"https": {{h: https(h) for h in BLOCKED + OPEN}}}}
out["blocked_refused"] = all(not out["https"][h]["ok"] for h in BLOCKED)
out["open_reachable"] = all(out["https"][h]["ok"] for h in OPEN)
out["pass"] = out["blocked_refused"] and out["open_reachable"]
os.makedirs("/logs/verifier", exist_ok=True)
json.dump(out, open("/logs/verifier/probe.json", "w"), indent=2)
open("/logs/verifier/reward.txt", "w").write("1" if out["pass"] else "0")
''')
PY
job "$out/probe/probe.json" egress-probe "$out/probe/jobs" 1 nop "$probe"
(cd "$out/probe" && "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$out/probe/probe.json") >> "$out/probe/harbor.log" 2>&1 || say "harbor egress-probe exited non-zero (probe/harbor.log)"
say "egress probe: $(cat "$out"/probe/jobs/egress-probe/*/verifier/probe.json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k: d[k] for k in ("blocked_refused", "open_reachable", "pass")})' 2>/dev/null || echo 'no probe.json')"

# 5. batches: pull, run oracle and nop, measure, clean
: > "$out/pulls.jsonl"; : > "$out/batches.jsonl"; : > "$out/history.jsonl"
IFS=',' read -r -a all <<< "$ids"
for ((i = 0; i < ${#all[@]}; i += batch)); do
  part=("${all[@]:i:batch}")
  b=$(( i / batch + 1 ))
  for t in "${part[@]}"; do
    ref=$(python3 -c 'import json,sys; t=json.load(open(sys.argv[1]))["task_selection"]["tasks"][sys.argv[2]]; print(t["image"].rsplit(":",1)[0] + "@" + t["image_digest"])' "$pin" "$t")
    before=$(ratelimit 2>/dev/null || echo null)
    t0=$(now); ok=true
    docker pull -q "$ref" >> "$out/check.log" 2>&1 || ok=false
    t1=$(now)
    size=$(docker image inspect --format '{{.Size}}' "$ref" 2>/dev/null || echo null)
    python3 -c 'import json,sys; print(json.dumps({"task": sys.argv[1], "ref": sys.argv[2], "ok": sys.argv[3] == "true", "seconds": round(float(sys.argv[5]) - float(sys.argv[4]), 1), "disk_bytes": None if sys.argv[6] == "null" else int(sys.argv[6]), "ratelimit_before": json.loads(sys.argv[7])}))' "$t" "$ref" "$ok" "$t0" "$t1" "$size" "$before" >> "$out/pulls.jsonl"
    built=frontier-history-audit/$(printf '%s' "$t" | tr '[:upper:]' '[:lower:]')
    t0=$(now)
    docker build -q -t "$built" "$run/tasks/$t/environment" >> "$out/check.log" 2>&1 || built=""
    t1=$(now)
    for which in base built; do
      img=$ref; [ "$which" = built ] && img=$built
      a=$([ -n "$img" ] && bash "$here/swe-rebench-history-audit.sh" "$img" "$run/tasks/$t" 2>> "$out/check.log" || true)
      python3 -c 'import json,sys
try: a = json.loads(sys.argv[4])
except Exception: a = {"error": "no audit output" if sys.argv[3] else "build failed"}
r = {"task": sys.argv[1], "image": sys.argv[2], **a}
if sys.argv[2] == "built": r["build_seconds"] = round(float(sys.argv[6]) - float(sys.argv[5]), 1)
print(json.dumps(r))' "$t" "$which" "$img" "$a" "$t0" "$t1" >> "$out/history.jsonl"
    done
  done
  df0=$(df -B1 --output=used / | tail -1)
  job "$run/batch-$b.json" "batch-$b" "$run/jobs" $(( 2 * ${#part[@]} )) oracle,nop $(for t in "${part[@]}"; do printf '%s ' "$run/tasks/$t"; done)
  t0=$(now)
  (cd "$run" && "${harbor_env[@]}" "$venv/bin/harbor" run -y -c "$run/batch-$b.json") >> "$run/harbor.log" 2>&1 || say "harbor batch $b exited non-zero (run/harbor.log)"
  t1=$(now)
  df1=$(df -B1 --output=used / | tail -1)
  python3 -c 'import json,sys; print(json.dumps({"batch": int(sys.argv[1]), "tasks": sys.argv[2].split(","), "seconds": round(float(sys.argv[4]) - float(sys.argv[3]), 1), "disk_used_before": int(sys.argv[5]), "disk_used_after": int(sys.argv[6])}))' "$b" "$(IFS=,; echo "${part[*]}")" "$t0" "$t1" "$df0" "$df1" >> "$out/batches.jsonl"
  docker system df >> "$out/check.log" 2>&1 || true
  docker ps -aq | xargs -r docker rm -f >> "$out/check.log" 2>&1 || true
  docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -v -E '^(frontier-harbor|harbor-prebuilt|gogost|alpine)' | awk '{print $2}' | sort -u | xargs -r docker image rm -f >> "$out/check.log" 2>&1 || true
  docker builder prune -af >> "$out/check.log" 2>&1 || true
  say "batch $b of $(( (${#all[@]} + batch - 1) / batch )) done ($(find "$run/jobs/batch-$b" -mindepth 2 -maxdepth 2 -name result.json | wc -l) results), disk used $(( df1 / 1073741824 )) GiB at its end"
done
ratelimit > "$out/ratelimit-end.json" 2>>"$out/check.log" || echo '{"error": "HEAD failed"}' > "$out/ratelimit-end.json"

# 6. the table
python3 - "$out" "$pin" <<'PY'
import glob, json, os, re, sys
out, pin_path = sys.argv[1], sys.argv[2]
pin = json.load(open(pin_path))
pp = pin["image_build"]["python_prefetch"]
tasks = pin["task_selection"]["tasks"]
base = json.load(open(os.path.join(os.path.dirname(pin_path), "pin.json")))["egress"]["blocklist"]
added = [h for h in pin["egress"]["blocklist"] if h not in base]
host_re = re.compile("|".join(re.escape(h.removeprefix("*.")) for h in added))
def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []
pulls = {p["task"]: p for p in jl(f"{out}/pulls.jsonl")}
batches = {t: b for b in jl(f"{out}/batches.jsonl") for t in b["tasks"]}
trials = {}
for res in glob.glob(f"{out}/run/jobs/*/*/result.json"):
    d = os.path.dirname(res)
    r = json.load(open(res))
    cfg = r.get("config") or json.load(open(f"{d}/config.json"))
    task = cfg["task"]["path"].rstrip("/").split("/")[-1]
    agent = cfg["agent"]["name"]
    rw = (r.get("verifier_result") or {}).get("rewards") or {}
    stdout = ""
    for f in ("verifier/test-stdout.txt", "verifier/test-stderr.txt", "exception.txt"):
        if os.path.exists(f"{d}/{f}"):
            stdout += open(f"{d}/{f}", errors="replace").read()
    lines = [l.strip()[:240] for l in stdout.splitlines() if host_re.search(l)][:5]
    downloads = [l.strip()[:240] for l in stdout.splitlines() if "python-build-standalone" in l or re.search(r"(?i)python downloads? (are|is) (disabled|not allowed)|No interpreter found", l)][:5]
    ex = r.get("exception_info") or {}
    trials[(task, agent)] = {"reward": rw.get("reward", next(iter(rw.values()), None)), "exception": ex.get("exception_type"),
                             "exception_message": (ex.get("exception_message") or "")[:300] or None, "blocked_host_lines": lines, "python_download_lines": downloads,
                             "started_at": r.get("started_at"), "finished_at": r.get("finished_at")}
rows = {}
for t in pin["shared_order"]["order"]:
    if t not in pulls and not any(k[0] == t for k in trials):
        continue
    o, n, p, b = trials.get((t, "oracle"), {}), trials.get((t, "nop"), {}), pulls.get(t, {}), batches.get(t, {})
    rows[t] = {"language": tasks[t]["language"], "repo": tasks[t]["repo"], "image_compressed_bytes": tasks[t]["image_compressed_bytes"],
               "pull_seconds": p.get("seconds"), "pull_ok": p.get("ok"), "image_disk_bytes": p.get("disk_bytes"),
               "batch": b.get("batch"), "batch_disk_used_after_bytes": b.get("disk_used_after"),
               "oracle_reward": o.get("reward"), "oracle_exception": o.get("exception"), "oracle_exception_message": o.get("exception_message"),
               "nop_reward": n.get("reward"), "nop_exception": n.get("exception"), "nop_exception_message": n.get("exception_message"),
               "blocked_host_lines": sorted(set(o.get("blocked_host_lines", []) + n.get("blocked_host_lines", []))),
               "python_prefetch": pp["python"] if t in pp["tasks"] else None,
               "python_download_lines": sorted(set(o.get("python_download_lines", []) + n.get("python_download_lines", [])))}
def leaks(a):
    if "error" in a or a.get("fix_line_candidate") is None or a.get("log_S_hits_past_head") is None or a.get("objects_with_fix_line_past_head") is None:
        return ["audit incomplete"]
    w = [k for k in ("commits_not_ancestors_incl_reflog", "refs", "remotes", "stash", "reflog_entries", "packed_refs", "log_S_hits_past_head", "objects_with_fix_line_past_head") if a[k]]
    w += [k for k in ("orig_head", "fetch_head") if a[k]["present"]]
    if not a["head_is_base"]: w.append("head_is_not_base")
    if a["objects_total"] > a["objects_reachable_from_head"]: w.append("objects_outside_head_history")
    return w
history = {}
for h in jl(f"{out}/history.jsonl"):
    t, w = h.pop("task"), h.pop("image")
    history.setdefault(t, {})[w] = {**h, "leaks": leaks(h)}
hsum = {w: {"audited": sum(w in v for v in history.values()), "leaking": sorted(t for t, v in history.items() if w in v and v[w]["leaks"]),
            "leak_kinds": {k: sum(k in v[w]["leaks"] for v in history.values() if w in v) for k in sorted({k for v in history.values() if w in v for k in v[w]["leaks"]})}}
        for w in ("base", "built")}
probe = glob.glob(f"{out}/probe/jobs/egress-probe/*/verifier/probe.json")
rl = [json.load(open(f"{out}/ratelimit-{w}.json")) for w in ("start", "end")]
summary = {"tasks": len(rows), "oracle_pass": sum(r["oracle_reward"] == 1 for r in rows.values()), "nop_zero": sum(r["nop_reward"] == 0 for r in rows.values()),
           "oracle_fail": sorted(t for t, r in rows.items() if r["oracle_reward"] != 1), "nop_nonzero": sorted(t for t, r in rows.items() if r["nop_reward"] != 0),
           "blocked_host_mentions": sorted(t for t, r in rows.items() if r["blocked_host_lines"]),
           "largest_image": max(rows.items(), key=lambda kv: kv[1]["image_compressed_bytes"])[0] if rows else None,
           "largest_image_disk_bytes": max((r["image_disk_bytes"] or 0) for r in rows.values()) if rows else None,
           "peak_batch_disk_used_bytes": max((b["disk_used_after"] for b in jl(f"{out}/batches.jsonl")), default=None),
           "pull_seconds_total": round(sum(r["pull_seconds"] or 0 for r in rows.values()), 1)}
json.dump({"schema": "frontier-harbor-swe-rebench-oracle-check/1", "pin": os.path.relpath(pin_path, os.path.dirname(os.path.dirname(os.path.dirname(pin_path)))),
           "dataset_content_hash": pin["source"]["dataset_version"]["content_hash"], "tree_sha256": pin["task_selection"]["tree_sha256"],
           "environment": "egress:SourceBlocklistDockerEnvironment (task_source swe-rebench-07-2026)", "ratelimit_start": rl[0], "ratelimit_end": rl[1],
           "egress_probe": json.load(open(probe[0])) if probe else None, "batches": jl(f"{out}/batches.jsonl"), "summary": summary, "tasks": rows,
           "history": {"rule": pin["image_build"]["history_scrub"]["rule"], "step_sha256": pin["image_build"]["history_scrub"]["step_sha256"], "summary": hsum, "tasks": history},
           "python_prefetch": {"python": pp["python"], "python_build": pp["python_build"], "uv": pp["uv"], "step_sha256": pp["step_sha256"], "tasks": {t: pp["python"] for t in pp["tasks"] if t in rows},
                               "verifier_env": pin["image_build"]["verifier_env"], "download_attempts": sorted(t for t, r in rows.items() if r["python_download_lines"])}},
          open(f"{out}/oracle-check.json", "w"), indent=1)
print(json.dumps({**summary, "history": hsum}))
PY
say "table written: $out/oracle-check.json"
