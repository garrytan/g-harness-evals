#!/usr/bin/env python3
"""The offline install check of the gstack bundle (internal-task), keyless, on a VM with Docker:

  python3 scripts/frontier-harbor/gstack-bundle-images.py --bundle <gstack-bundle tgz> --out <report.json>
      [--tasks <id,id,...>] [--hosts hermes,openclaw] [--jobs 4]

For each pinned Terminal-Bench 2.1 task image (pin.json task_selection, by digest; every task unless --tasks) and each
host, it starts the image with --network none, copies the bundle to the path agents.py uploads it to, runs the root
commands and then the agent script of delivery.py bundle_install (as root, HOME=/root, no harness installed), and records
gstack's own install line (setup exit, seconds, files written, visible, hook), the SKILL.md files setup wrote and the
wall time. A row passes when setup exited 0 and the host's build-check entry is on disk: Hermes gets
gstack-build-check/SKILL.md, OpenClaw the gstack router skill gstack/SKILL.md. The hook state is recorded, not checked:
with no harness CLI in the container, gstack cannot turn its start hook on (the pilot and the agent install check do,
with the harness installed). The bundle is checked first against delivery-pin.json bundle (verify-bundle); a mismatch
stops before any container (exit 3). Exit 0 when every row passed, 1 when one failed, 2 on a usage error.
"""
from __future__ import annotations

import argparse
import json
import platform
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import delivery as dl  # noqa: E402

WANT = {"hermes": "/gstack-build-check/SKILL.md", "openclaw": "/gstack/SKILL.md"}


def sh(args: list[str], stdin: str | None = None, timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=timeout)


def check(task: str, image: str, host: str, bundle: str) -> dict:
    name = "gbi-" + uuid.uuid4().hex[:12]
    row: dict = {"task": task, "image": image, "host": host, "failed_step": None, "exit": None, "wall_seconds": None,
                 "install_line": None, "setup_seconds": None, "files_written": None, "visible": None, "hook": None, "skills": [], "entry": False}
    started = time.monotonic()
    root, scripts = dl.bundle_install(host)
    steps = [
        ("create", ["docker", "create", "--network", "none", "--name", name, "--entrypoint", "sleep", image, "infinity"], None),
        ("start", ["docker", "start", name], None),
        ("mkdir", ["docker", "exec", name, "sh", "-c", "mkdir -p " + str(Path(dl.BUNDLE_TARBALL).parent) + " && chmod 1777 " + str(Path(dl.BUNDLE_TARBALL).parent)], None),
        ("upload", ["docker", "cp", bundle, name + ":" + dl.BUNDLE_TARBALL], None),
        *[("root", ["docker", "exec", "-e", "HE_AGENT_USER=root", name, "bash", "-c", c.replace('"$HE_AGENT_USER"', "root")], None) for c in root],
    ]
    try:
        for step, args, stdin in steps:
            r = sh(args, stdin)
            if r.returncode != 0:
                row.update(failed_step=step, exit=r.returncode, error=(r.stderr or r.stdout)[-400:])
                return row
        r = sh(["docker", "exec", "-i", "-e", "HOME=/root", "-w", "/root", name, "bash", "-s"], scripts[0])
        row["exit"] = r.returncode
        line = next((l for l in reversed(r.stdout.splitlines()) if l.startswith("gstack-install: ")), None)
        row["install_line"] = line
        if line:
            f = dict(w.split("=", 1) for w in line[len("gstack-install: "):].split() if "=" in w)
            row.update(setup_seconds=float(f.get("setup_seconds", "0") or 0), files_written=int(f.get("files_written", "0") or 0), visible=f.get("visible"), hook=f.get("hook"))
        listed = sh(["docker", "exec", name, "sh", "-c", "cat " + dl.bundle_logs(host) + "/setup-files.txt 2>/dev/null"])
        row["skills"] = sorted(p for p in listed.stdout.split() if p.endswith("/SKILL.md"))
        row["entry"] = any(p.endswith(WANT[host]) for p in row["skills"])
        if r.returncode != 0:
            row.update(failed_step="setup", error=(r.stderr or "")[-400:])
        elif not row["entry"]:
            row["failed_step"] = "skills"
        return row
    except subprocess.TimeoutExpired as e:
        row.update(failed_step=row["failed_step"] or "timeout", error=str(e)[-400:])
        return row
    finally:
        row["wall_seconds"] = round(time.monotonic() - started, 3)
        sh(["docker", "rm", "-f", name], timeout=300)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tasks")
    ap.add_argument("--hosts", default="hermes,openclaw")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    hosts = a.hosts.split(",")
    if any(h not in WANT for h in hosts) or a.jobs < 1:
        print("gstack-bundle-images: --hosts is hermes and/or openclaw, --jobs at least 1", file=sys.stderr)
        return 2
    pin = json.loads((HERE / "pin.json").read_text())["task_selection"]["tasks"]
    tasks = a.tasks.split(",") if a.tasks else sorted(pin)
    if any(t not in pin for t in tasks):
        print("gstack-bundle-images: --tasks names a task that is not pinned", file=sys.stderr)
        return 2
    receipt = dl.verify_bundle(a.bundle)
    if not receipt["matches"]:
        print(f"gstack-bundle-images: the bundle's content {receipt['content_sha256']} at {receipt['commit']} is not delivery-pin.json's bundle", file=sys.stderr)
        return 3
    images = {t: pin[t]["image"].split(":")[0] + "@" + pin[t]["image_digest"] for t in tasks}
    with ThreadPoolExecutor(a.jobs) as pool:
        rows = list(pool.map(lambda th: check(th[0], images[th[0]], th[1], a.bundle), [(t, h) for t in tasks for h in hosts]))
    docker = sh(["docker", "--version"]).stdout.strip()
    report = {
        "schema": "frontier-harbor-gstack-bundle-images/1",
        "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "repo_commit": sh(["git", "-C", str(HERE), "rev-parse", "HEAD"]).stdout.strip(),
        "machine": {"kernel": platform.release(), "docker": docker},
        "gstack": {"version": dl.BUNDLE["version"], "commit": dl.BUNDLE["commit"], "tarball_sha256": receipt["tarball_sha256"], "content_sha256": receipt["content_sha256"], "setup_flags": dl.BUNDLE["setup_flags"]},
        "network": "none (docker create --network none)", "harness_installed": False,
        "pass": all(r["failed_step"] is None for r in rows),
        "failed": [{"task": r["task"], "host": r["host"], "step": r["failed_step"]} for r in rows if r["failed_step"]],
        "rows": rows,
    }
    Path(a.out).write_text(json.dumps(report, indent=2) + "\n")
    print(f"gstack-bundle-images: {len(rows) - len(report['failed'])} of {len(rows)} task image and host rows passed; {'pass' if report['pass'] else 'FAIL'}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
