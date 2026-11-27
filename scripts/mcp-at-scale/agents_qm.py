"""QM cells for MCP at scale (internal-task-a plan, "Arms" 1 and 3), on internal-task-b's FrontierQm (scripts/frontier-harbor/agents.py,
handoffs/internal-task-a/qm-harness.md, "internal-task-b: MCP servers"). QM runs exactly as FrontierQm runs it; this class only adds the
cell's MCP servers and the one core setting that lets core reach them.

- Each server Harbor hands the class (task.toml [environment] mcp_servers, written by materialize.ts) is registered with
  PUT /v1/admin/mcp-servers/<id> through qm-call.mjs admin, after qm_harbor.admin_calls and before QM's sandbox is
  created, with QM's shipped defaults: body {name, url, auth: "none"}, so approval stays "annotations", catalog off,
  credentialScope shared, readOnly false, enabled true, and validate unset (core probes tools/list before it saves the
  server, as it ships). The catalog host needs no token, so no bearer placeholder is needed.
- QM registers only http(s) servers, and its core runs in its own container. A stdio server (the gbrain arm's logging
  relay, materialize.ts relayCommand) is served to it by stdio-http-bridge.ts, started in the task container at agent
  setup, one port per server from BRIDGE_PORT, on the task container's own address (core shares its network namespace,
  and QM never allows loopback). So the relay, gbrain and the relay's log stay where every other harness has them.
- QM's id rule (2 to 40 characters, lowercase letters, digits and hyphens, starting with a letter) is applied by
  qm_server_id; the name -> id mapping is recorded under mcp_cell.server_ids, and the server's own name is its display name.
- Core reaches only public addresses unless an origin is listed in PRIVATE_NETWORK_ALLOWED_ORIGINS (QM's
  docs/mcp-connectors.md). The class lists exactly the servers' origins (the catalog host, http://catalog:8080, plus the
  bridge's for a stdio server) by extending core's environment dict (qm_harbor.core_env) on its way into the 0600 env
  file core is started with.
- Every registration's HTTP status goes into install_checks.qm_admin as "mcp_server:<id>" (with the tool names for
  gbrain); a non-2xx stops the trial at setup (HE-QM-002, as FrontierQm's own admin calls do), so it is an infra_error.
- After the turn, before FrontierQm removes core, the session transcript (GET /v1/admin/sessions/<id>) is saved as
  /logs/agent/qm-session.json, the record search-effort.ts reads for QM's tool_search and mcp_call calls.
- Approval stops are results, not INFRA. Under approval "annotations" QM holds a call to a tool annotated destructive and
  ends the turn pending_approval (or ok, when the model went on), with the held call in the reply's pendingApprovals:
  command "<server id>_<tool> <arguments as canonical JSON>" (withToolApprovalGate, src/agent/agent-tools/wrappers.ts,
  and the tool naming in src/mcp/mcp-tool-service.ts). held_calls maps each back to its catalog server and tool through
  the ids and the tool names core's probe returned, and the class writes them to /logs/agent/held-calls.json (an empty
  list first, before the turn is read, and never through a symlink the agent left there; write_held), where grade.py,
  in QM cells only, takes each as a call the model made,
  flagged approval_pending. A pending_approval turn with at least one held catalog call then ends normally instead of
  failing HE-QM-003.

gbrain cells (plan "Arms" 3, decision E): QM has no gbrain installer, so its forced surfaces (full, starter, verbs) are the
gbrain arm's tasks (listing-map.ts --gbrain, --gbrain-cells), whose relay is one more MCP server, registered the same way.
"""

from __future__ import annotations

import json
import os
import re
import shlex
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import agents as mcp_agents
import qm_harbor as qm
from harbor.agents.capabilities import AgentCapabilities

FrontierQm = mcp_agents._fa.FrontierQm

QM_ID = re.compile(r"^[a-z][a-z0-9-]{1,39}$")
ORIGINS_ENV = "PRIVATE_NETWORK_ALLOWED_ORIGINS"
SANDBOX_CREATE = qm.sandbox_create()
GBRAIN_SERVER = "gbrain"
BRIDGE = Path(__file__).resolve().parent / "stdio-http-bridge.ts"
BRIDGE_DIR = "/tmp/frontier-qm-bridge"
BRIDGE_PORT = 58090


def qm_server_id(name: str, taken: set[str]) -> str:
    """A QM server id for a server name: lowercase, every run of other characters a hyphen, a leading "s-" when it would
    not start with a letter, cut to 40, "-mcp" after a one-letter name, and a -2, -3, ... suffix when two names map to
    one id."""
    base = re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]", "-", name.lower())).strip("-")
    if not base[:1].isalpha():
        base = "s-" + base if base else "server"
    base = base[:40].rstrip("-")
    if len(base) < 2:
        base += "-mcp"
    sid, n = base, 2
    while sid in taken:
        suffix = f"-{n}"
        sid = base[: 40 - len(suffix)].rstrip("-") + suffix
        n += 1
    if not QM_ID.fullmatch(sid):
        raise ValueError(f"HE-MCP-030 cannot map MCP server name {name!r} to a QM server id ({sid!r})")
    taken.add(sid)
    return sid


def server_ids(servers: list[Any]) -> dict[str, str]:
    taken: set[str] = set()
    return {s.name: qm_server_id(s.name, taken) for s in servers}


def origin(url: str) -> str:
    u = urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError(f"HE-MCP-030 QM registers only http(s) MCP servers, not {url}")
    if u.username or u.password or u.query or u.fragment:
        raise ValueError(f"HE-MCP-030 QM refuses an MCP url with credentials, a query or a fragment: {url}")
    return f"{u.scheme}://{u.hostname}:{u.port or (443 if u.scheme == 'https' else 80)}"


def bridge_ports(servers: list[Any]) -> dict[str, int]:
    """The bridge port of each stdio server, in Harbor's order. SSE is refused: QM's client speaks streamable HTTP."""
    stdio = []
    for s in servers:
        if s.transport == "sse":
            raise ValueError(f"HE-MCP-030 QM registers streamable HTTP MCP servers; {s.name} is sse")
        if s.transport == "stdio":
            stdio.append(s.name)
    return {name: BRIDGE_PORT + i for i, name in enumerate(stdio)}


def endpoints(servers: list[Any], bridged: dict[str, str]) -> dict[str, str]:
    """Each server's URL as QM registers it: its own for streamable HTTP, the bridge's for stdio."""
    bridge_ports(servers)
    out = {s.name: s.url if s.transport == "streamable-http" else bridged.get(s.name) for s in servers}
    for name, url in out.items():
        if not url:
            raise ValueError(f"HE-MCP-030 the stdio server {name} has no bridge URL yet")
        origin(url)
    return out


def registrations(servers: list[Any], bridged: dict[str, str]) -> list[dict[str, Any]]:
    """The admin calls that register the servers, in Harbor's order, each with QM's shipped defaults."""
    ids, urls = server_ids(servers), endpoints(servers, bridged)
    return [{"name": f"mcp_server:{ids[s.name]}", "method": "PUT", "path": f"/v1/admin/mcp-servers/{ids[s.name]}", "body": {"name": s.name, "url": urls[s.name], "auth": "none"}} for s in servers]


def allowed_origins(servers: list[Any], bridged: dict[str, str]) -> str:
    return ",".join(sorted({origin(u) for u in endpoints(servers, bridged).values()}))


def bridge_command(server: Any, host: str, port: int) -> str:
    """Start stdio-http-bridge.ts for one stdio server in the task container on host:port, detached, and wait for its
    /healthz. host is the task container's own address: QM core shares the container's network namespace, but QM never
    allows a loopback origin in PRIVATE_NETWORK_ALLOWED_ORIGINS (src/util/network.ts), and a wildcard bind is refused."""
    log = f"/logs/agent/bridge-{re.sub(r'[^A-Za-z0-9_.-]', '-', server.name)}.log"
    child = " ".join(shlex.quote(a) for a in [server.command, *server.args])
    probe = f"bun -e 'fetch(\"http://{host}:{port}/healthz\").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))'"
    return (f"setsid nohup bun {BRIDGE_DIR}/bridge.ts --host {host} --port {port} -- {child} > {log} 2>&1 < /dev/null & echo $! >> {BRIDGE_DIR}/pids; "
            f"for i in $(seq 50); do {probe} && break; sleep 0.2; done; {probe}")


def write_held(logs_dir: str | Path, held: dict[str, Any]) -> None:
    """Writes held-calls.json afresh. The agent's container can write that directory, so whatever it left at the path, a
    file or a symlink, is removed and never followed, and a path that reappears in between fails the write."""
    path = Path(logs_dir) / "held-calls.json"
    path.unlink(missing_ok=True)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644), "w") as f:
        f.write(json.dumps(held, indent=1) + "\n")


def held_calls(turn_body: Any, names_by_id: dict[str, str], tools_by_id: dict[str, list[str]]) -> dict[str, list[dict[str, Any]]]:
    """The calls QM held for approval in one turn reply: catalog calls as {server, tool, arguments, approval_pending,
    reason}, and any other held command under "other"."""
    qm_name = {re.sub(r"[^a-zA-Z0-9_-]", "_", f"{sid}_{t}"): (names_by_id[sid], t) for sid, ts in tools_by_id.items() for t in ts}
    out: dict[str, list[dict[str, Any]]] = {"calls": [], "other": []}
    pending = turn_body.get("pendingApprovals") if isinstance(turn_body, dict) else None
    for pa in pending if isinstance(pending, list) else []:
        command = str(pa.get("command") or "")
        label, _, rest = command.partition(" ")
        try:
            args = json.loads(rest) if rest else {}
        except json.JSONDecodeError:
            args = rest
        if label in qm_name:
            server, tool = qm_name[label]
            out["calls"].append({"server": server, "tool": tool, "arguments": args, "approval_pending": True, "reason": pa.get("reason")})
        else:
            out["other"].append({"command": command[:500], "reason": pa.get("reason")})
    return out


class McpQm(mcp_agents._McpCell, FrontierQm):
    VARIANT = "qm"
    capabilities = AgentCapabilities(**{**FrontierQm.capabilities.model_dump(), "mcp_servers": True})

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._mcp_registered = False
        self._mcp_tools: dict[str, list[str]] = {}
        self._bridged: dict[str, str] = {}
        super().__init__(*args, **kwargs)
        bridge_ports(self.mcp_servers)

    def core_env(self, env: dict[str, str]) -> dict[str, str]:
        """qm_harbor.core_env's dict for this trial, plus the servers' origins (after the proxy's, on a custom provider)."""
        if not self.mcp_servers:
            return env
        return {**env, ORIGINS_ENV: ",".join(o for o in (env.get(ORIGINS_ENV), allowed_origins(self.mcp_servers, self._bridged)) if o)}

    async def _frontier_after_install(self, environment: Any) -> None:
        await self._mcp_ready(environment)
        ports = bridge_ports(self.mcp_servers)
        if ports:
            res = await environment.exec(command="python3 -c 'import socket; print(socket.gethostbyname(socket.gethostname()))'")
            ip = (res.stdout or "").strip()
            if res.return_code != 0 or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", ip) or ip.startswith("127."):
                raise RuntimeError(f"HE-QM-004 cannot read the task container's own address for the stdio bridge: {(res.stdout or '')[-200:]} {(res.stderr or '')[-200:]}")
            await environment.exec(command=f"rm -rf {BRIDGE_DIR} && mkdir -p {BRIDGE_DIR}")
            await self._upload_config_text(environment, content=BRIDGE.read_text(), remote_path=f"{BRIDGE_DIR}/bridge.ts", filename="bridge.ts")
            for s in self.mcp_servers:
                if s.name not in ports:
                    continue
                res = await environment.exec(command=bridge_command(s, ip, ports[s.name]))
                if res.return_code != 0:
                    raise RuntimeError(f"HE-QM-004 the stdio bridge for {s.name} did not answer on port {ports[s.name]} (/logs/agent/bridge-{s.name}.log)")
                self._bridged[s.name] = f"http://{ip}:{ports[s.name]}/mcp"
            self._frontier_checks["qm_bridged"] = dict(self._bridged)
        await super()._frontier_after_install(environment)

    async def _docker(self, *args: str, stdin: bytes | None = None, timeout: float = 300, env: Any = None) -> tuple[int, str, str]:
        if args[:1] == ("run",) and qm.images(self.QM_COMMIT)[0] in args and "--env-file" in args:
            envf = Path(args[args.index("--env-file") + 1])
            core = dict(line.split("=", 1) for line in envf.read_text().splitlines() if line)
            envf.write_text(qm.env_file(self.core_env(core)))
        return await super()._docker(*args, stdin=stdin, timeout=timeout, env=env)

    async def _qm_call(self, *args: str, body: Any = None, timeout: float = 300) -> dict[str, Any]:
        if args == ("admin", SANDBOX_CREATE["method"], SANDBOX_CREATE["path"]) and body == SANDBOX_CREATE["body"] and not self._mcp_registered:
            self._mcp_registered = True
            await self._mcp_register()
        return await super()._qm_call(*args, body=body, timeout=timeout)

    async def _mcp_register(self) -> None:
        admin = self._frontier_checks.setdefault("qm_admin", {})
        for call in registrations(self.mcp_servers, self._bridged):
            out = await super()._qm_call("admin", call["method"], call["path"], body=call["body"], timeout=300)
            reply = out.get("body") if isinstance(out.get("body"), dict) else {}
            tools = reply.get("tools") if isinstance(reply.get("tools"), list) else None
            ok = out.get("http") in (200, 201)
            self._mcp_tools[call["path"].rsplit("/", 1)[1]] = [str(t) for t in tools or []]
            admin[call["name"]] = {"http": out.get("http"), "tools": len(tools) if tools is not None else None,
                                   **({"tool_names": tools} if call["body"]["name"] == GBRAIN_SERVER else {}),
                                   **({} if ok else {"error": json.dumps(reply)[-400:]})}
            if not ok:
                raise RuntimeError(f"HE-QM-002 QM refused the {call['name']} admin call: {json.dumps(out)[-400:]}")

    async def run(self, instruction: str, environment: Any, context: Any) -> None:
        try:
            await super().run(instruction, environment, context)
        except RuntimeError as e:
            held = self._frontier_checks.get("qm_held_calls") or {}
            if not (str(e).startswith("HE-QM-003") and held.get("turn_status") == "pending_approval" and held.get("calls")):
                raise

    def _turn_body(self) -> Any:
        turn = Path(self.logs_dir) / "qm-turn.json"
        return (json.loads(turn.read_text()).get("reply") or {}).get("body") if turn.exists() else None

    async def _qm_stop(self, environment: Any) -> None:
        try:
            write_held(self.logs_dir, {"calls": [], "other": []})
            body = self._turn_body()
            if body is not None:
                held = held_calls(body, {sid: name for name, sid in server_ids(self.mcp_servers).items()}, self._mcp_tools)
                write_held(self.logs_dir, held)
                self._frontier_checks["qm_held_calls"] = {"turn_status": body.get("status") if isinstance(body, dict) else None, "calls": len(held["calls"]), "other": len(held["other"])}
            await self._qm_session()
        finally:
            try:
                await super()._qm_stop(environment)
            finally:
                if self._bridged:
                    await environment.exec(command=f'[ -f {BRIDGE_DIR}/pids ] && kill $(cat {BRIDGE_DIR}/pids) 2>/dev/null; true', timeout_sec=60)

    async def _qm_session(self) -> None:
        body = self._turn_body()
        if not self._qm_core or body is None:
            return
        sid = body.get("sessionId") if isinstance(body, dict) else None
        if not sid:
            return
        out = await super()._qm_call("admin", "GET", f"/v1/admin/sessions/{sid}?scope={quote(qm.SANDBOX_SCOPE)}&limit=50000", timeout=120)
        self._frontier_checks["qm_session"] = {"http": out.get("http"), "id": sid}
        (Path(self.logs_dir) / "qm-session.json").write_text(qm.redact(json.dumps(out.get("body"), indent=1), self._qm_secrets) + "\n")

    def _mcp_record(self) -> dict[str, Any]:
        ports = bridge_ports(self.mcp_servers)
        return {**super()._mcp_record(), "server_ids": server_ids(self.mcp_servers),
                ORIGINS_ENV: allowed_origins(self.mcp_servers, self._bridged) if self.mcp_servers and len(self._bridged) == len(ports) else None,
                "bridged": dict(self._bridged) if ports else None,
                "registration": "PUT /v1/admin/mcp-servers/<id> {name, url, auth: none} after qm_harbor.admin_calls, before sandbox_create; approval, catalog, credentialScope, readOnly, enabled and validate left to QM's defaults",
                "differences_from_shipped": [f"{ORIGINS_ENV} lists the MCP servers' origins (QM ships it empty), the documented way to reach a server on a private network"]
                + ([f"stdio servers ({', '.join(ports)}) are served to QM over streamable HTTP by scripts/mcp-at-scale/stdio-http-bridge.ts in the task container (QM registers only http(s) servers); server-initiated messages such as tools/list_changed are not delivered"] if ports else [])}


# Variant name -> (class, harness in scripts/frontier-harbor/pin.json, default cell model), as agents.py VARIANTS.
VARIANTS: dict[str, tuple[type, str, str]] = {
    "qm": (McpQm, "qm", "anthropic/claude-opus-5-5"),
}


if __name__ == "__main__":
    print(json.dumps({k: {"import_path": f"agents_qm:{c.__name__}", "harness": h, "model": m, "version": str(mcp_agents.fs.PIN["harnesses"][h]["version"])} for k, (c, h, m) in VARIANTS.items()}, indent=1))
