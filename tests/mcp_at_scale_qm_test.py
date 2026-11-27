"""McpQm and the QM gbrain cells (scripts/mcp-at-scale/agents_qm.py) on Harbor 0.24.0, keyless: QM's id rule, the
registration bodies, the allowed origin added to core's environment, registration before QM's sandbox, every admin status
in install_checks, a refusal stopping the trial, the session transcript saved after the turn, and the settings record.
Docker is faked at FrontierQm._docker, so nothing starts and no key is read.

  env -i PATH=/usr/bin:/bin HOME=/tmp PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=scripts/mcp-at-scale \
      ~/.frontier-harbor/venv/bin/python -m unittest tests/mcp_at_scale_qm_test.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts/mcp-at-scale"))

import agents_qm as aq  # noqa: E402
import qm_harbor as qm  # noqa: E402
from harbor.models.task.config import MCPServerConfig  # noqa: E402

CATALOG = ["ash-tracker", "fern-chat", "kiln-db"]


def servers(names=CATALOG, extra=()):
    return [MCPServerConfig(name=n, transport="streamable-http", url=f"http://catalog:8080/mcp/{n}") for n in names] + list(extra)


# The relay as materialize.ts writes it for the verbs cell (gbrain.ts relayCommand).
GBRAIN = MCPServerConfig(name="gbrain", transport="stdio", command="/usr/local/bin/bun", args=[
    "/opt/he-gbrain/relay.js", "--log", "/var/lib/he-gbrain/calls.jsonl", "--server", "gbrain", "--trial", "search-probe__r150__gb-verbs",
    "--env", "GBRAIN_HOME=/srv/gbrain", "--", "/opt/he-gbrain/bun/bin/gbrain", "serve", "--surface", "full", "--advertise", "verbs"])


class FakeEnv:
    def __init__(self):
        self.commands: list[str] = []

    async def exec(self, command: str, **kwargs):
        self.commands.append(command)
        return mock.Mock(return_code=0, stdout="172.18.0.3\n" if "gethostbyname" in command else "", stderr="")


class FakeCore:
    """FrontierQm._docker's stand-in: answers qm-call.mjs through docker exec, records every call."""

    def __init__(self, refuse: str | None = None):
        self.calls: list[tuple[str, ...]] = []
        self.bodies: list[object] = []
        self.envs: list[object] = []
        self.refuse = refuse

    async def __call__(self, *args: str, stdin: bytes | None = None, timeout: float = 300, env=None):
        self.calls.append(args)
        self.envs.append(env)
        if args[:2] != ("exec", "-i"):
            return 0, "", ""
        mode, method, path = args[5], args[6], args[7]
        body = json.loads(stdin) if stdin else None
        self.bodies.append(body)
        if mode == "admin" and method == "PUT" and path.startswith("/v1/admin/mcp-servers/"):
            sid = path.rsplit("/", 1)[1]
            if sid == self.refuse:
                return 2, json.dumps({"http": 400, "body": {"error": "unreachable", "message": f"tools/list against {body['url']} failed"}}), ""
            tools = ["query", "list_pages"] if sid == "gbrain" else ["a", "b"]
            return 0, json.dumps({"http": 200, "body": {"ok": True, "server": {"id": sid}, "tools": tools}}), ""
        if mode == "admin" and method == "POST":
            return 0, json.dumps({"http": 201, "body": {"id": "sbx-1"}}), ""
        if mode == "admin" and method == "GET":
            return 0, json.dumps({"http": 200, "body": {"items": [{"kind": "ToolCall", "tool": "tool_search"}]}}), ""
        return 0, json.dumps({"http": 200, "body": {}}), ""


def agent(cls=aq.McpQm, mcp=None):
    d = Path(tempfile.mkdtemp(prefix="mcp-qm-")) / "listing__r30__abc" / "agent"
    d.mkdir(parents=True)
    a = cls(logs_dir=d, model_name="anthropic/claude-opus-5-5", mcp_servers=servers() if mcp is None else mcp, broker_url="http://127.0.0.1:1", cell="mcp-qm-r30", attempt=1)
    a._qm_core = "he-qm-test-core"
    return a


def run(coro):
    return asyncio.run(coro)


class Ids(unittest.TestCase):
    def test_qm_rule(self):
        taken: set[str] = set()
        got = [aq.qm_server_id(n, taken) for n in ["ash-tracker", "GitHub_MCP", "1password", "a", "x" * 50, "x" * 50, "slack.v2--beta"]]
        self.assertEqual(got[:4], ["ash-tracker", "github-mcp", "s-1password", "a-mcp"])
        self.assertEqual(got[4], "x" * 40)
        self.assertEqual(got[5], "x" * 38 + "-2")
        self.assertEqual(got[6], "slack-v2-beta")
        for sid in got:
            self.assertRegex(sid, r"^[a-z][a-z0-9-]{1,39}$")
        self.assertEqual(len(set(got)), len(got))


class Registration(unittest.TestCase):
    def test_bodies_keep_qm_defaults(self):
        calls = aq.registrations(servers(), {})
        self.assertEqual([c["path"] for c in calls], [f"/v1/admin/mcp-servers/{n}" for n in CATALOG])
        self.assertEqual(calls[0]["body"], {"name": "ash-tracker", "url": "http://catalog:8080/mcp/ash-tracker", "auth": "none"})
        self.assertTrue(aq.McpQm.capabilities.mcp_servers)
        self.assertFalse(aq.FrontierQm.capabilities.mcp_servers)
        self.assertEqual(aq.allowed_origins(servers(), {}), "http://catalog:8080")

    def test_refuses_what_qm_cannot_register(self):
        with self.assertRaisesRegex(ValueError, "HE-MCP-030"):
            aq.registrations([MCPServerConfig(name="s", transport="stdio", command="x")], {})
        with self.assertRaisesRegex(ValueError, "HE-MCP-030"):
            aq.registrations([MCPServerConfig(name="s", transport="streamable-http", url="http://catalog:8080/mcp/s?x=1")], {})

    def test_registers_after_admin_calls_and_before_the_sandbox(self):
        a = agent()
        fake = FakeCore()
        with mock.patch.object(aq.FrontierQm, "_docker", new=staticmethod(fake)):
            for c in qm.admin_calls(a._frontier_model, "http://h/t/anthropic"):
                run(a._qm_call("admin", c["method"], c["path"], body=c["body"]))
            s = qm.sandbox_create()
            out = run(a._qm_call("admin", s["method"], s["path"], body=s["body"]))
            run(a._qm_call("admin", s["method"], s["path"], body=s["body"]))
        paths = [c[7] for c in fake.calls]
        self.assertEqual(paths, [c["path"] for c in qm.admin_calls(a._frontier_model, "http://h/t/anthropic")]
                         + [f"/v1/admin/mcp-servers/{n}" for n in CATALOG] + [s["path"], s["path"]])
        self.assertEqual(out["http"], 201)
        self.assertEqual(a._frontier_checks["qm_admin"]["mcp_server:fern-chat"], {"http": 200, "tools": 2})

    def test_a_refusal_stops_setup_and_is_recorded(self):
        a = agent()
        fake = FakeCore(refuse="fern-chat")
        s = qm.sandbox_create()
        with mock.patch.object(aq.FrontierQm, "_docker", new=staticmethod(fake)):
            with self.assertRaisesRegex(RuntimeError, "HE-QM-002 QM refused the mcp_server:fern-chat admin call"):
                run(a._qm_call("admin", s["method"], s["path"], body=s["body"]))
        admin = a._frontier_checks["qm_admin"]
        self.assertEqual(admin["mcp_server:fern-chat"]["http"], 400)
        self.assertIn("unreachable", admin["mcp_server:fern-chat"]["error"])
        self.assertNotIn("mcp_server:kiln-db", admin)
        self.assertNotIn(s["path"], [c[7] for c in fake.calls if len(c) > 7 and c[6] == "POST"])


class CoreEnv(unittest.TestCase):
    def test_origin_added_to_cores_env_file(self):
        a = agent()
        envf = Path(tempfile.mkdtemp()) / "core.env"
        envf.write_text(qm.env_file({"PORT": "58080", "PI_MODEL": "claude-opus-5-5"}))
        fake = FakeCore()
        with mock.patch.object(aq.FrontierQm, "_docker", new=staticmethod(fake)):
            run(a._docker("run", "-d", "--name", "c", "--env-file", str(envf), qm.images(qm.COMMIT)[0]))
            run(a._docker("run", "-d", "--name", "pg", "-e", "POSTGRES_DB=qm", qm.pin()["postgres_image"]))
        self.assertEqual(envf.read_text(), "PORT=58080\nPI_MODEL=claude-opus-5-5\nPRIVATE_NETWORK_ALLOWED_ORIGINS=http://catalog:8080\n")
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(fake.envs, [None, None])


class SessionAndSettings(unittest.TestCase):
    def test_session_saved_before_core_goes(self):
        a = agent()
        (Path(a.logs_dir) / "qm-turn.json").write_text(json.dumps({"reply": {"http": 200, "body": {"status": "ok", "sessionId": "ses-1"}}}))
        fake = FakeCore()
        with mock.patch.object(aq.FrontierQm, "_docker", new=staticmethod(fake)):
            run(a._qm_session())
        self.assertEqual(fake.calls[0][5:8], ("admin", "GET", "/v1/admin/sessions/ses-1?scope=personal%3AU1&limit=50000"))
        self.assertEqual(json.loads((Path(a.logs_dir) / "qm-session.json").read_text())["items"][0]["tool"], "tool_search")

    def test_settings_record(self):
        a = agent()
        a._write_settings()
        cell = json.loads((Path(a.logs_dir) / "harness_settings.json").read_text())["mcp_cell"]
        self.assertEqual(cell["variant"], "qm")
        self.assertEqual(cell["server_ids"], {n: n for n in CATALOG})
        self.assertEqual(cell["PRIVATE_NETWORK_ALLOWED_ORIGINS"], "http://catalog:8080")
        self.assertEqual(len(cell["differences_from_shipped"]), 1)


PENDING = {"status": "pending_approval", "sessionId": "ses-1", "pendingApprovals": [
    {"requestId": "r1", "command": 'kiln-db_drop_table {"table":"users","workspace":"acme"}', "reason": "the tool is marked destructive", "summary": "kiln-db_drop_table"},
    {"requestId": "r2", "command": "execute rm -rf /", "reason": "policy"}]}


class Approvals(unittest.TestCase):
    def test_held_calls_map_back_to_catalog_tools(self):
        held = aq.held_calls(PENDING, {"kiln-db": "kiln-db"}, {"kiln-db": ["drop_table", "list_rows"]})
        self.assertEqual(held["calls"], [{"server": "kiln-db", "tool": "drop_table", "arguments": {"table": "users", "workspace": "acme"}, "approval_pending": True, "reason": "the tool is marked destructive"}])
        self.assertEqual(held["other"], [{"command": "execute rm -rf /", "reason": "policy"}])
        self.assertEqual(aq.held_calls({"status": "ok"}, {}, {}), {"calls": [], "other": []})

    def test_a_pending_turn_with_a_held_catalog_call_is_a_result(self):
        for body, raises in ((PENDING, False), ({**PENDING, "pendingApprovals": PENDING["pendingApprovals"][1:]}, True)):
            a = agent()
            a._mcp_tools = {"kiln-db": ["drop_table"]}

            async def fake_run(self, instruction, environment, context, body=body):
                (Path(self.logs_dir) / "qm-turn.json").write_text(json.dumps({"status": {}, "reply": {"http": 200, "body": body}}))
                await self._qm_stop(environment)
                raise RuntimeError("HE-QM-003 the QM turn did not finish: http 200, status pending_approval")

            fake = FakeCore()
            with mock.patch.object(aq.FrontierQm, "run", new=fake_run), mock.patch.object(aq.FrontierQm, "_qm_stop", new=mock.AsyncMock()),                     mock.patch.object(aq.FrontierQm, "_docker", new=staticmethod(fake)):
                if raises:
                    with self.assertRaisesRegex(RuntimeError, "HE-QM-003"):
                        run(a.run("x", None, None))
                else:
                    run(a.run("x", None, None))
            held = json.loads((Path(a.logs_dir) / "held-calls.json").read_text())
            self.assertEqual(len(held["calls"]), 0 if raises else 1)

    def test_held_file_is_written_afresh_never_through_a_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            outside = Path(d, "outside.txt")
            outside.write_text("keep")
            logs = Path(d, "logs")
            logs.mkdir()
            (logs / "held-calls.json").symlink_to(outside)
            aq.write_held(logs, {"calls": [], "other": []})
            self.assertEqual(outside.read_text(), "keep")
            self.assertFalse((logs / "held-calls.json").is_symlink())
            self.assertEqual(json.loads((logs / "held-calls.json").read_text()), {"calls": [], "other": []})

    def test_a_planted_held_file_is_cleared_even_when_the_turn_cannot_be_read(self):
        a = agent()
        (Path(a.logs_dir) / "held-calls.json").write_text(json.dumps({"calls": [{"server": "kiln-db", "tool": "drop_table", "arguments": {}}]}))
        (Path(a.logs_dir) / "qm-turn.json").write_text("{cut off")
        with mock.patch.object(aq.FrontierQm, "_qm_stop", new=mock.AsyncMock()):
            with self.assertRaises(json.JSONDecodeError):
                run(a._qm_stop(None))
        self.assertEqual(json.loads((Path(a.logs_dir) / "held-calls.json").read_text()), {"calls": [], "other": []})

class Gbrain(unittest.TestCase):
    """The gbrain arm's relay is a stdio server (materialize.ts relayCommand); QM gets it through the bridge."""

    def test_stdio_server_registered_through_its_bridge(self):
        a = agent(mcp=servers(extra=[GBRAIN]))
        with self.assertRaisesRegex(ValueError, "no bridge URL yet"):
            aq.registrations(a.mcp_servers, {})
        self.assertEqual(aq.bridge_ports(a.mcp_servers), {"gbrain": 58090})
        a._bridged = {"gbrain": "http://172.18.0.3:58090/mcp"}
        fake = FakeCore()
        s = qm.sandbox_create()
        with mock.patch.object(aq.FrontierQm, "_docker", new=staticmethod(fake)):
            run(a._qm_call("admin", s["method"], s["path"], body=s["body"]))
        self.assertEqual(fake.bodies[-2], {"name": "gbrain", "url": "http://172.18.0.3:58090/mcp", "auth": "none"})
        self.assertEqual(a._frontier_checks["qm_admin"]["mcp_server:gbrain"], {"http": 200, "tools": 2, "tool_names": ["query", "list_pages"]})
        a._write_settings()
        cell = json.loads((Path(a.logs_dir) / "harness_settings.json").read_text())["mcp_cell"]
        self.assertEqual(cell["PRIVATE_NETWORK_ALLOWED_ORIGINS"], "http://172.18.0.3:58090,http://catalog:8080")
        self.assertEqual(len(cell["differences_from_shipped"]), 2)

    def test_bridge_started_in_the_task_container_before_core(self):
        a = agent(mcp=servers(extra=[GBRAIN]))
        env = FakeEnv()
        with mock.patch.object(aq.FrontierQm, "_frontier_after_install", new=mock.AsyncMock()) as base, \
                mock.patch.object(aq.McpQm, "_upload_config_text", new=mock.AsyncMock()) as up:
            run(a._frontier_after_install(env))
        self.assertEqual(a._bridged, {"gbrain": "http://172.18.0.3:58090/mcp"})
        self.assertEqual(up.call_args.kwargs["remote_path"], "/tmp/frontier-qm-bridge/bridge.ts")
        start = env.commands[-1]
        self.assertIn("http://172.18.0.3:58090/healthz", start)
        self.assertIn("bun /tmp/frontier-qm-bridge/bridge.ts --host 172.18.0.3 --port 58090 -- /usr/local/bin/bun /opt/he-gbrain/relay.js --log /var/lib/he-gbrain/calls.jsonl", start)
        base.assert_awaited_once()

    def test_sse_is_refused(self):
        with self.assertRaisesRegex(ValueError, "HE-MCP-030"):
            agent(mcp=[MCPServerConfig(name="s", transport="sse", url="http://catalog:8080/sse")])

if __name__ == "__main__":
    unittest.main()
