"""Harbor 0.24.0 installed-agent classes for the MCP-at-scale cells (internal-task plan, "Arms").

Each class is the frontier class from scripts/frontier-harbor/agents.py (same pins, settings, proxy slot and
harness_settings.json) with only its MCP behaviour changed. The task's mcp_servers (task.toml [environment], written by
scripts/mcp-at-scale/materialize.ts: one streamable HTTP server per catalog server, on the catalog host sidecar) reach every
class through Harbor's trial. Where a frontier class already passes them to the harness as Harbor does, the class here adds
nothing; where it drops them, the class here puts them back the way Harbor's own class writes them.

- McpClaudeCode: as the frontier class. Harbor writes the servers into $CLAUDE_CONFIG_DIR/.claude.json (user scope, so no
  trust prompt). Tool search stays at Claude Code's default.
- McpClaudeCodeNoToolSearch: the same with ENABLE_TOOL_SEARCH=false in the agent's environment (every tool with its schema).
- McpCodex: the frontier class replaces Harbor's effective config with ours (fs.codex_config), which has no mcp_servers; this
  class adds [mcp_servers.<name>] url = ... exactly as Harbor's Codex._build_effective_config does.
- McpHermes: the frontier class writes its own config.yaml in run() and never registers MCP servers; this class appends
  Harbor's own mcp_servers block (Hermes._build_register_mcp_servers_command) right after that write.
- McpOpenClaw, McpGeminiCli: as the frontier classes (both call Harbor's config builders, which add the servers).
  OpenClaw 2026.10 and later keep the session transcript in the agent's SQLite store, so Harbor's copy of
  agentMeta.sessionFile finds no file; McpOpenClaw then exports the store's transcript events to the same
  /logs/agent/openclaw.session.jsonl (one event per line, Harbor's format; zstd-compressed rows, which Python 3.12
  cannot read, become {"type": "compressed", "seq": n}), for scripts/mcp-at-scale/search-effort.ts.
- McpPi, McpPiDeferred, McpPiDirect: Pi's own MCP support (Pi 1.5 reads mcp.json in its agent directory, docs/mcp.md), not
  Harbor's pi-mcp-adapter extension, which Harbor installs only for Pi 0.84.1 to 0.85.x and which replaces the built-in
  support. The servers are kept away from Harbor's Pi class (so it installs no adapter and passes no --extension) and
  written to $PI_CODING_AGENT_DIR/mcp.json with the cell's exposure: codemode (Pi's default), deferred or direct.

QM: no class here. internal-task is adding QM to the Harbor runner (handoffs/internal-task/qm-harness.md); when its class lands, an
McpQm subclass registers each catalog server through QM's admin API and lists the catalog host's origin in
PRIVATE_NETWORK_ALLOWED_ORIGINS (plan, "Arms" 1), and scripts/mcp-at-scale/listing-map.ts drops its "qm" skip entry.

Versions: a job may name pin.json's version of a harness or the release frozen in scripts/mcp-at-scale/versions.json (the
newest on 2026-11-19); pin.json stays internal-task's. At a frozen version McpClaudeCode checks the native binary's sha256 against
versions.json instead of pin.json, every other class checks the harness's own --version, and harness_settings.json records the
installed version as harness_version with the pin.json one under "mcp_version" (HE-MCP-050 on a mismatch or any other version).

Models: frontier_settings.model_spec reads only pin.json's models, and pin.json does not list GPT-6.2 Sol, the codex cells'
model under R116 (2026-11-21). This file replaces fs.model_spec with model_spec below, which keeps pin.json's row for every model
pin.json lists and otherwise reads versions.json's "models" (same entry shape); a model in neither is refused (HE-MCP-048).

Every class records its MCP set-up under "mcp_cell" in harness_settings.json. After agent setup and before the agent
starts, every class probes the catalog host's /_he/ready from inside the trial container with the cell's connect mode
(CONNECT: "lazy" for Pi codemode and deferred, which connect MCP servers on first use, else "eager"). The host logs it, and
grade.py's connection rule reads it from that log; the record the probe writes to /logs/agent/mcp-ready.json is for
people reading the trial only, since the agent can write there.
"""

from __future__ import annotations

import importlib.util
import json
import shlex
import sys
from pathlib import Path
from typing import Any

FRONTIER = Path(__file__).resolve().parent.parent / "frontier-harbor"
if str(FRONTIER) not in sys.path:
    sys.path.insert(1, str(FRONTIER))

import frontier_settings as fs  # noqa: E402
from harbor.environments.base import BaseEnvironment  # noqa: E402


def _load_frontier() -> Any:
    """scripts/frontier-harbor/agents.py under the module name frontier_agents: this file is also agents.py, so a plain
    import would find itself. Harbor loads this file with scripts/mcp-at-scale on PYTHONPATH (import path agents:<Class>)."""
    if "frontier_agents" in sys.modules:
        return sys.modules["frontier_agents"]
    spec = importlib.util.spec_from_file_location("frontier_agents", FRONTIER / "agents.py")
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules["frontier_agents"] = mod
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


_fa = _load_frontier()
FrontierClaudeCode = _fa.FrontierClaudeCode
FrontierCodex = _fa.FrontierCodex
FrontierGeminiCli = _fa.FrontierGeminiCli
FrontierHermes = _fa.FrontierHermes
FrontierOpenClaw = _fa.FrontierOpenClaw
FrontierPi = _fa.FrontierPi

PI_AGENT_DIR = "/tmp/harbor-pi-agent"
VERSIONS = json.loads((Path(__file__).resolve().parent / "versions.json").read_text())
_pin_model_spec = fs.model_spec


def model_spec(model: str) -> dict[str, Any]:
    """pin.json's row of a provider:model id when pin.json lists it, else versions.json's "models" row, with its provider and
    bare name; a model in neither file is refused."""
    if model in fs.PIN["models"]:
        return _pin_model_spec(model)
    if model not in VERSIONS["models"]:
        raise ValueError(f"HE-MCP-048 model {model} is in neither scripts/frontier-harbor/pin.json models nor scripts/mcp-at-scale/versions.json models")
    provider, name = model.split(":", 1)
    return {**VERSIONS["models"][model], "id": model, "name": name, "provider": provider}


fs.model_spec = model_spec


def frozen_version(harness: str, version: str | None) -> dict[str, Any] | None:
    """versions.json's entry when the job asks for a harness version that scripts/frontier-harbor/pin.json does not pin (the
    frozen release internal-task runs), None for pin.json's own versions; any other version is refused."""
    if version is None:
        return None
    try:
        fs.harness_pin(harness, version)
        return None
    except ValueError:
        pass
    entry = VERSIONS["harnesses"].get(harness)
    if entry is None or entry["version"] != version:
        raise ValueError(f"HE-MCP-050 {harness} {version} is neither pinned in scripts/frontier-harbor/pin.json nor frozen in scripts/mcp-at-scale/versions.json ({entry['version'] if entry else 'no entry'})")
    return entry


def installed_version(harness: str, stdout: str) -> str | None:
    """The release the last line of a harness's --version output names (nvm's "Now using node" line comes first):
    "2.1.328 (Claude Code)", "codex-cli 0.170.0", "OpenClaw 2026.11.5 (e13cf15)", "1.5.2"."""
    lines = [ln for ln in stdout.splitlines() if ln.strip()]
    words = [w.removeprefix("v") for w in (lines[-1].split() if lines else []) if w[:1].isdigit() or (w[:1] == "v" and w[1:2].isdigit())]
    return words[0] if words else None
HERMES_CONFIG_WRITE = "mkdir -p /tmp/hermes && cat > /tmp/hermes/config.yaml << 'EOF'\n"


def server_record(servers: list[Any]) -> list[dict[str, Any]]:
    return [{"name": s.name, "transport": s.transport, "url": s.url, "command": s.command, "args": list(s.args)} for s in servers]


def pi_mcp_json(servers: list[Any], exposure: str) -> dict[str, Any]:
    """Pi 1.5's mcp.json (docs/mcp.md, "Configure servers"): a url selects streamable HTTP, a command selects stdio."""
    out: dict[str, Any] = {}
    for s in servers:
        if s.transport == "sse":
            raise ValueError(f"HE-MCP-020 Pi has no SSE transport (docs/mcp.md); server {s.name} must be streamable-http or stdio")
        entry: dict[str, Any] = {"command": s.command, "args": list(s.args)} if s.transport == "stdio" else {"url": s.url}
        entry["exposure"] = exposure
        out[s.name] = entry
    return {"mcpServers": out}


READY_PROBE = r'''
import json, sys, time, urllib.parse, urllib.request
url, connect, variant = sys.argv[1:4]
out = {"ok": False, "url": url, "attempts": 0, "error": None, "connect": connect, "variant": variant}
if url == "-":
    out["error"] = "the cell has no HTTP MCP server to probe"
else:
    url += "?" + urllib.parse.urlencode({"connect": connect, "variant": variant})
for i in range(10 if url != "-" else 0):
    out["attempts"] = i + 1
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            if r.status == 200:
                out["ok"], out["error"] = True, None
                break
            out["error"] = "HTTP %d" % r.status
    except Exception as e:
        out["error"] = "%s: %s" % (type(e).__name__, str(e)[:200])
    time.sleep(1)
open("/logs/agent/mcp-ready.json", "w").write(json.dumps(out) + "\n")
sys.exit(0 if out["ok"] else 1)
'''


def ready_url(servers: list[Any]) -> str:
    """The catalog host's /_he/ready, from the first streamable HTTP server's URL (http://catalog:8080/mcp/<server>)."""
    for s in servers:
        url = getattr(s, "url", None)
        if url and "/mcp/" in url:
            return url.split("/mcp/", 1)[0] + "/_he/ready"
    return "-"


class _McpCell:
    """Mixin: the cell's MCP set-up recorded in harness_settings.json, and the readiness probe."""

    VARIANT = ""
    CONNECT = "eager"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._mcp_frozen = frozen_version(self.HARNESS, kwargs.get("version"))  # type: ignore[attr-defined]
        super().__init__(*args, **kwargs)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        await super()._frontier_after_install(environment)  # type: ignore[misc]
        if self._mcp_frozen is None or self._mcp_frozen.get("same_as_pin"):
            return
        want = self._mcp_frozen["version"]
        command = self.get_version_command()  # type: ignore[attr-defined]
        if self.HARNESS == "openclaw":
            command = command.replace("nvm use 22", "nvm use " + self.NODE)  # type: ignore[attr-defined]
        res = await environment.exec(command=command)
        got = installed_version(self.HARNESS, res.stdout or "")
        self._frontier_checks["mcp_version"] = {"want": want, "got": got, "matches": got == want, "source": self._mcp_frozen["source"]}  # type: ignore[attr-defined]
        if got != want:
            raise RuntimeError(f"HE-MCP-050 the installed {self.HARNESS} is {got}, not the frozen {want} (scripts/mcp-at-scale/versions.json)")

    def _cell_servers(self) -> list[Any]:
        return list(self.mcp_servers)  # type: ignore[attr-defined]

    def _mcp_record(self) -> dict[str, Any]:
        return {"variant": self.VARIANT, "connect": self.CONNECT, "servers": server_record(self._cell_servers())}

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)  # type: ignore[misc]
        args = " ".join(shlex.quote(a) for a in (ready_url(self._cell_servers()), self.CONNECT, self.VARIANT))
        probe = await environment.exec(command="mkdir -p /logs/agent && python3 -c " + shlex.quote(READY_PROBE) + " " + args, timeout_sec=60)
        if probe.return_code != 0:
            raise RuntimeError("HE-MCP-001 the catalog was not ready during agent setup")
        if self.HARNESS in ("claude-code", "codex"):
            cli = "claude" if self.HARNESS == "claude-code" else "codex"
            command = 'export PATH="$HOME/.local/bin:$PATH"; claude --version' if cli == "claude" else self.get_version_command()
            checked = await environment.exec(command=command, timeout_sec=30)
            version = installed_version(self.HARNESS, checked.stdout or "") if checked.return_code == 0 else None
            if version is None:
                raise RuntimeError(f"HE-MCP-047 could not observe the {cli} version before running the agent")
            (Path(self.logs_dir).parent / "observed-cli-version.json").write_text(json.dumps(version) + "\n")

    def _write_settings(self) -> None:
        super()._write_settings()  # type: ignore[misc]
        path = Path(self.logs_dir) / "harness_settings.json"  # type: ignore[attr-defined]
        settings = json.loads(path.read_text())
        settings["mcp_cell"] = self._mcp_record()
        if self._mcp_frozen is not None and not self._mcp_frozen.get("same_as_pin"):
            pinned = settings["harness_version"]
            settings["harness_version"] = self._mcp_frozen["version"]
            settings["mcp_version"] = {"frozen": self._mcp_frozen["version"], "pin_json": pinned, "file": "scripts/mcp-at-scale/versions.json", **{k: v for k, v in self._mcp_frozen.items() if k != "version"}}
            settings["differences_from_pin"] = [*settings.get("differences_from_pin", []),
                f"{self.HARNESS} {self._mcp_frozen['version']} (frozen in scripts/mcp-at-scale/versions.json) instead of pin.json's {pinned}; the settings text above was written for {pinned}"]
        path.write_text(json.dumps(settings, indent=2) + "\n")


class McpClaudeCode(_McpCell, FrontierClaudeCode):
    VARIANT = "claude-code"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        frozen = frozen_version(self.HARNESS, kwargs.get("version"))
        if frozen is None:
            super().__init__(*args, **kwargs)
            return
        if kwargs.get("gstack") is not None:
            raise ValueError("HE-MCP-050 a gstack arm runs only at a Claude Code version pin.json pins")
        kwargs["config"] = fs.claude_settings_merge(None)["settings"]
        self._mcp_frozen = frozen
        self._frontier_version = None
        super(FrontierClaudeCode, self).__init__(*args, **kwargs)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        if self._mcp_frozen is None:
            await super()._frontier_after_install(environment)
            return
        want = self._mcp_frozen["native_binary_sha256"]
        res = await environment.exec(command='export PATH="$HOME/.local/bin:$PATH"; sha256sum "$(readlink -f "$(command -v claude)")" | cut -d" " -f1; claude --version')
        words = (res.stdout or "").split()
        got = words[0] if words else None
        version = installed_version(self.HARNESS, " ".join(words[1:]))
        self._frontier_checks.update({"claude_binary_sha256": got, "claude_version": " ".join(words[1:3]) or None,
                                      "mcp_version": {"want": self._mcp_frozen["version"], "got": version, "binary_sha256_matches": got == want, "matches": got == want and version == self._mcp_frozen["version"], "source": self._mcp_frozen["source"]}})
        if got != want or version != self._mcp_frozen["version"]:
            raise RuntimeError(f"HE-MCP-050 the installed claude binary is {got} ({version}), not the frozen {self._mcp_frozen['version']} {want} (scripts/mcp-at-scale/versions.json)")


class McpClaudeCodeNoToolSearch(McpClaudeCode):
    VARIANT = "claude-code-no-tool-search"
    ENV = {"ENABLE_TOOL_SEARCH": "false"}

    async def _frontier_bind(self) -> None:
        await super()._frontier_bind()
        self._extra_env.update(self.ENV)

    def _mcp_record(self) -> dict[str, Any]:
        return {**super()._mcp_record(), "env": dict(self.ENV)}


class McpCodex(_McpCell, FrontierCodex):
    VARIANT = "codex"

    def _build_effective_config(self, openai_base_url: str | None = None) -> dict[str, Any]:
        config = super()._build_effective_config(openai_base_url)
        servers = config.setdefault("mcp_servers", {})
        for s in self.mcp_servers:
            servers[s.name] = {"command": s.command, "args": list(s.args)} if s.transport == "stdio" else {"url": s.url}
        return config


class McpHermes(_McpCell, FrontierHermes):
    VARIANT = "hermes"

    async def exec_as_agent(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        res = await super().exec_as_agent(environment, command, *args, **kwargs)
        if command.startswith(HERMES_CONFIG_WRITE) and self.mcp_servers:
            register = self._build_register_mcp_servers_command()
            if register:
                await super().exec_as_agent(environment, register, *args, **kwargs)
        return res


OPENCLAW_EXPORT = r'''
import json, sqlite3, sys
from pathlib import Path
dst = Path("/logs/agent/openclaw.session.jsonl")
if dst.exists():
    sys.exit(0)
stores = sorted(Path.home().glob(".openclaw/agents/*/agent/openclaw-agent.sqlite"))
lines = []
for store in stores:
    db = sqlite3.connect("file:%s?mode=ro" % store, uri=True)
    rows = db.execute("select seq, event_json from transcript_events order by session_id, seq").fetchall()
    lines += [ej if ej else json.dumps({"type": "compressed", "seq": seq}) for seq, ej in rows]
if lines:
    dst.write_text("\n".join(lines) + "\n")
'''


class McpOpenClaw(_McpCell, FrontierOpenClaw):
    VARIANT = "openclaw"

    async def _copy_openclaw_session_file_to_agent_logs(self, environment: BaseEnvironment, env: dict[str, str]) -> None:
        await super()._copy_openclaw_session_file_to_agent_logs(environment, env)
        try:
            await self.exec_as_agent(environment, command="python3 -c " + shlex.quote(OPENCLAW_EXPORT), env=env)
        except Exception:
            self.logger.debug("Could not export the OpenClaw transcript store (non-fatal)", exc_info=True)


class McpGeminiCli(_McpCell, FrontierGeminiCli):
    VARIANT = "gemini-cli"


class McpPi(_McpCell, FrontierPi):
    VARIANT = "pi-codemode"
    EXPOSURE = "codemode"
    CONNECT = "lazy"

    def __init__(self, *args: Any, mcp_servers: list[Any] | None = None, **kwargs: Any) -> None:
        self._native_mcp = list(mcp_servers or [])
        super().__init__(*args, **kwargs)

    def _cell_servers(self) -> list[Any]:
        return list(self._native_mcp)

    def _mcp_record(self) -> dict[str, Any]:
        return {"variant": self.VARIANT, "connect": self.CONNECT, "servers": server_record(self._native_mcp), "exposure": self.EXPOSURE,
                "config": f"{PI_AGENT_DIR}/mcp.json (Pi's own MCP support; Harbor's pi-mcp-adapter not installed)"}

    async def _write_custom_models_json(self, environment: BaseEnvironment, models_json: dict[str, Any]) -> None:
        await super()._write_custom_models_json(environment, models_json)
        if not self._native_mcp:
            return
        path = f"{PI_AGENT_DIR}/mcp.json"
        await self._upload_config_text(environment, content=json.dumps(pi_mcp_json(self._native_mcp, self.EXPOSURE), indent=2) + "\n", remote_path=path, filename="mcp.json")
        await self.exec_as_agent(environment, command=f"chmod 600 {shlex.quote(path)}")


class McpPiDeferred(McpPi):
    VARIANT = "pi-deferred"
    EXPOSURE = "deferred"


class McpPiDirect(McpPi):
    VARIANT = "pi-direct"
    EXPOSURE = "direct"
    CONNECT = "eager"


# Variant name -> (class, harness in scripts/frontier-harbor/pin.json, default cell model from pin.json or versions.json's
# "models"). QM is not here yet (see above).
VARIANTS: dict[str, tuple[type, str, str]] = {
    "claude-code": (McpClaudeCode, "claude-code", "anthropic/claude-opus-5-5"),
    "claude-code-no-tool-search": (McpClaudeCodeNoToolSearch, "claude-code", "anthropic/claude-opus-5-5"),
    "codex": (McpCodex, "codex", "openai/gpt-6.2-sol"),
    "hermes": (McpHermes, "hermes", "anthropic/claude-opus-5-5"),
    "openclaw": (McpOpenClaw, "openclaw", "anthropic/claude-opus-5-5"),
    "pi-codemode": (McpPi, "pi", "anthropic/claude-opus-5-5"),
    "pi-deferred": (McpPiDeferred, "pi", "anthropic/claude-opus-5-5"),
    "pi-direct": (McpPiDirect, "pi", "anthropic/claude-opus-5-5"),
    "gemini-cli": (McpGeminiCli, "gemini-cli", "google/gemini-4-carbon"),
}


if __name__ == "__main__":
    print(json.dumps({k: {"import_path": f"agents:{c.__name__}", "harness": h, "model": m, "version": str(fs.PIN["harnesses"][h]["version"])} for k, (c, h, m) in VARIANTS.items()}, indent=1))
