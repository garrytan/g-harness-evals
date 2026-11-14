"""Fetch the pinned SWE-rebench July 2026 tasks from the Harbor hub, the way Harbor 0.24.0 downloads them.

Run it with the Python of a Harbor 0.24.0 install (vm-run.sh's venv, or uv tool install harbor==0.24.0):

    python swe_rebench_fetch.py resolve [--dataset <org>/<name>] [--ref <tag or sha256:digest>]
    python swe_rebench_fetch.py fetch --pin <pin-swe-rebench-07-2026.json> --out <dir> [--ids a,b] [--concurrency 4]

The dataset is a Harbor hub package (org/name), not a git registry: harbor datasets download <org>/<name>@<tag>
resolves the tag to a dataset version (a row with its own content hash), lists the version's task versions (each a
package with a content hash) and downloads each task's archive from the hub's storage bucket. resolve prints that
resolution as JSON, for a reviewed pin change. fetch downloads every pinned task (or --ids) by its content hash, so a
moved tag cannot change what it fetches (the pin's source_digest, which for these tasks equals the hub's content hash), into <out>/<task>/, at most --concurrency at a time with retries (Harbor's own
download opens 100 at once and the hub answers 429), and refuses a task whose files do not hash to the pinned content
hash (Harbor's Packager.compute_content_hash). It writes <out>/fetch.json with the dataset digest and each task's hash.
Exit 0 when every task matched, 1 otherwise.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path


async def resolve(org: str, name: str, ref: str) -> dict:
    from harbor.db.client import RegistryDB

    db = RegistryDB()
    _pkg, version = await db.resolve_dataset_version(org, name, ref)
    rows = await db.get_dataset_version_tasks(version["id"])
    files = await db.get_dataset_version_files(version["id"])
    tasks = sorted(
        ({"org": r.task_version.package.org.name, "name": r.task_version.package.name, "content_hash": r.task_version.content_hash} for r in rows if r.task_version is not None),
        key=lambda t: t["name"],
    )
    return {
        "dataset": f"{org}/{name}",
        "ref": ref,
        "revision": version.get("revision"),
        "content_hash": version.get("content_hash"),
        "created_at": version.get("created_at"),
        "redacted_tasks": sum(1 for r in rows if r.task_version is None),
        "files": [{"path": f["path"], "content_hash": f["content_hash"], "size_bytes": f.get("size_bytes")} for f in files],
        "tasks": tasks,
    }


async def fetch(pin: dict, out: Path, ids: list[str] | None, concurrency: int) -> dict:
    from harbor.db.client import RegistryDB
    from harbor.publisher.packager import Packager
    from harbor.storage.supabase import SupabaseStorage

    src = pin["source"]
    tasks = pin["task_selection"]["tasks"]
    wanted = ids or sorted(tasks)
    unknown = [t for t in wanted if t not in tasks]
    if unknown:
        raise SystemExit(f"{len(unknown)} --ids task(s) are not pinned tasks")
    org = src["hub_org"]
    db, storage = RegistryDB(), SupabaseStorage()
    sem = asyncio.Semaphore(concurrency)
    out.mkdir(parents=True, exist_ok=True)
    result: dict[str, dict] = {}

    async def one(task: str) -> None:
        want = tasks[task]["source_digest"]
        dest = out / task
        async with sem:
            if dest.is_dir() and Packager.compute_content_hash(dest)[0] == want:
                result[task] = {"content_hash": want, "cached": True, "ok": True}
                return
            err = None
            for attempt in range(6):
                try:
                    resolved = await db.resolve_task_version(org, task, "sha256:" + want)
                    with tempfile.TemporaryDirectory() as tmp:
                        archive = Path(tmp) / "archive.tar.gz"
                        await storage.download_file(resolved.archive_path, archive)
                        if dest.exists():
                            shutil.rmtree(dest)
                        dest.mkdir(parents=True)
                        with tarfile.open(archive, "r:gz") as tar:
                            tar.extractall(path=dest, filter="data")
                    got = Packager.compute_content_hash(dest)[0]
                    result[task] = {"content_hash": got, "cached": False, "ok": got == want, "attempts": attempt + 1}
                    return
                except Exception as e:  # the hub's 429 and timeouts
                    err = type(e).__name__
                    await asyncio.sleep(2 * 2**attempt)
            result[task] = {"content_hash": None, "ok": False, "error": err}

    await asyncio.gather(*(one(t) for t in wanted))
    report = {
        "schema": "frontier-harbor-swe-rebench-fetch/1",
        "dataset": src["dataset"],
        "dataset_content_hash": src["dataset_version"]["content_hash"],
        "tasks": {t: result[t] for t in wanted},
        "ok": all(result[t]["ok"] for t in wanted),
    }
    (out / "fetch.json").write_text(json.dumps(report, indent=1) + "\n")
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("resolve")
    r.add_argument("--dataset", default="ibragim-badertdinov/swe-rebench-07-2026")
    r.add_argument("--ref", default="2026-07")
    f = sub.add_parser("fetch")
    f.add_argument("--pin", required=True)
    f.add_argument("--out", required=True)
    f.add_argument("--ids", default="")
    f.add_argument("--concurrency", type=int, default=4)
    a = ap.parse_args()
    if a.cmd == "resolve":
        org, name = a.dataset.split("/", 1)
        print(json.dumps(asyncio.run(resolve(org, name, a.ref)), indent=1))
        return 0
    pin = json.loads(Path(a.pin).read_text())
    report = asyncio.run(fetch(pin, Path(a.out), [t for t in a.ids.split(",") if t] or None, a.concurrency))
    bad = [t for t, v in report["tasks"].items() if not v["ok"]]
    print(f"fetched {len(report['tasks']) - len(bad)} of {len(report['tasks'])} pinned task(s); {len(bad)} failed or differ")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
