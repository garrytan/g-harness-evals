"""Harbor 0.24.0 docker environment with the frontier blocklist (internal-task plan, Contamination, keys and fairness).

Harbor's docker egress control knows public, no-network and allowlist modes and starts its sidecar only for a
non-public policy. TB2.1 tasks run public. This environment always starts the sidecar, built from egress-sidecar/
beside this file (Harbor's sidecar plus a blocklist service), so public mode sends every TCP connection from the task
containers through gost, which refuses the hosts in egress-sidecar/blocklist.txt (pin.json egress.blocklist). A host
whose kernel lacks nftables fib inet support gets no sidecar from Harbor; this environment then refuses to start the
trial (HE-FRONTIER-004) instead of running it unblocked.

Job config: {"environment": {"import_path": "egress:BlocklistDockerEnvironment"}}, with this directory on PYTHONPATH.

A Cursor cell (harness cursor) runs under CursorBlocklistDockerEnvironment instead (plan.ts names it for those cells
only): the same sidecar built from egress-sidecar/Dockerfile.cursor, whose blocklist (blocklist-cursor.txt, pin.json
egress.cursor_cells.blocklist) leaves Cursor's API hosts and its package host reachable. Every other cell's blocklist
refuses cursor.sh, *.cursor.sh and downloads.cursor.com.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Sequence

from harbor.environments.docker.docker import DockerEnvironment
from harbor.models.task.config import NetworkPolicy

HERE = Path(__file__).resolve().parent
SIDECAR = HERE / "egress-sidecar"


def pinned_blocklist() -> list[str]:
    return list(json.loads((HERE / "pin.json").read_text())["egress"]["blocklist"])


def sidecar_blocklist(name: str = "blocklist.txt") -> list[str]:
    return [line.strip() for line in (SIDECAR / name).read_text().splitlines() if line.strip()]


def pinned_cursor_blocklist() -> list[str]:
    return list(json.loads((HERE / "pin.json").read_text())["egress"]["cursor_cells"]["blocklist"])


class BlocklistDockerEnvironment(DockerEnvironment):
    _EGRESS_CONTROL_SIDECAR_CONTEXT_PATH = SIDECAR
    _EGRESS_CONTROL_SIDECAR_DOCKER_NAME = "frontier-harbor:egress-blocklist-sidecar"

    @staticmethod
    def _requires_egress_control(*, startup_network_policy: NetworkPolicy, phase_network_policies: Sequence[NetworkPolicy]) -> bool:
        return True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        if sidecar_blocklist() != pinned_blocklist():
            raise RuntimeError("HE-FRONTIER-004 egress-sidecar/blocklist.txt differs from pin.json egress.blocklist")
        super().__init__(*args, **kwargs)
        if not self._enable_egress_control:
            raise RuntimeError(
                "HE-FRONTIER-004 the egress blocklist sidecar cannot run here (Windows container, or a kernel without "
                "nftables fib inet support), so the trial would run unblocked; run on the pinned Ubicloud image"
            )


class CursorBlocklistDockerEnvironment(BlocklistDockerEnvironment):
    _EGRESS_CONTROL_SIDECAR_DOCKER_NAME = "frontier-harbor:egress-blocklist-sidecar-cursor"

    @classmethod
    def _egress_control_sidecar_dockerfile_path(cls) -> Path:
        return SIDECAR / "Dockerfile.cursor"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        if sidecar_blocklist("blocklist-cursor.txt") != pinned_cursor_blocklist():
            raise RuntimeError("HE-FRONTIER-004 egress-sidecar/blocklist-cursor.txt differs from pin.json egress.cursor_cells.blocklist")
        super().__init__(*args, **kwargs)
