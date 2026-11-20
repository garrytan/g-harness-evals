#!/usr/bin/env python3
"""The MCP-at-scale verifier (internal-task plan, "Outcomes"): reads the catalog host's call log, never the agent's reply.

In a task container it runs as tests/grade.py with tests/expected.json beside it. It fetches the log from the catalog host
sidecar (GET <HE_CATALOG_URL>/_he/log with the token in HE_CATALOG_LOG_TOKEN, which only the verifier's environment holds),
keeps a copy as catalog-calls.jsonl, and writes outcomes.json and reward.txt to the output directory (/logs/verifier).

    python3 grade.py [--expected tests/expected.json] [--log <calls.jsonl>] [--ready /logs/agent/mcp-ready.json]
                     [--out /logs/verifier]

mcp-ready.json is the readiness probe scripts/mcp-at-scale/agents.py runs from inside the trial container after agent setup
and before the agent starts: {ok, url, attempts, error, connect, variant}. connect is how the cell's harness connects MCP
servers: "eager" (at start: Claude Code, Codex, Hermes, OpenClaw, Gemini CLI, Pi direct) or "lazy" (on first use: Pi
codemode and deferred). With no probe file the trial is graded as eager.

Connection rule (decided for internal-task, 2026-11-19):
  eager  every rung server must get initialize and tools/list, else HE-MCP-001;
  lazy   HE-MCP-001 only when the harness used MCP (any tools/list or tools/call) while a rung server was still not
         connected. A lazy trial that never got past initialize is scored: no right tool on a tool request, a right
         answer on a no-tool request. Pi deferred sends initialize to most servers in the background at start and, on a
         one-turn text reply, exits before tools/list (keyless check, 2026-11-19), so initialize alone is not a failed
         connect. A connect that fails inside the harness and is followed by no MCP use is not visible in this log; the
         readiness probe still proves the host was up.
  either HE-MCP-003 when the probe ran and could not reach the catalog host, so a host that was down is never scored;
         it comes before HE-MCP-002, since a host the trial could not reach also leaves its log unreadable.

outcomes.json:
  request, kind ("tool" or "none"), rung
  servers_expected      every server of the rung
  servers_connected     servers that successfully answered both initialize and tools/list
  servers_missing       expected but not connected
  servers_incomplete    servers that got initialize or tools/list but not both
  connect, ready        the cell's connect mode and the readiness probe record (null when there was none)
  infra                 null, or {code, detail}: HE-MCP-001 a server was not connected under the rule above,
                        HE-MCP-002 the log could not be read, HE-MCP-003 the readiness probe could not reach the host.
                        An INFRA trial is counted and published, never scored.
  calls                 tools/call lines, in order: server, tool, arguments, validation ok, fixture
  right_tool            tool requests: the call matched the required arguments and was not rejected. GBrain must
                        explicitly confirm success; null on no-tool requests
  first_right_call      index into calls of the first right call, or null
  wrong_tools           tool requests: catalog tools called that are not acceptable (server/tool, each once, in order)
  tool_when_none        no-tool requests: any catalog tool was called; null on tool requests
  invalid_calls         calls whose arguments the schema refused (or that named a tool the server does not have)
  discovery_calls       calls to a server's own tool-discovery tool (expected.json discovery, e.g. gbrain/request_tools),
                        which are neither right nor wrong and do not count as a tool when none was needed

GBrain evidence comes only from /he-gbrain-evidence, the sidecar's read-only volume in the trial container. The verifier
copies that log to <out>/gbrain-calls.jsonl and its first tools/list result to <out>/gbrain-tools-list.json.
reward.txt: 1 when right_tool (tool request) or not tool_when_none (no-tool request), else 0; 0 on INFRA.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any

INFRA_MISSING = "HE-MCP-001"
INFRA_LOG = "HE-MCP-002"
INFRA_NOT_READY = "HE-MCP-003"
GBRAIN_EVIDENCE = Path("/he-gbrain-evidence")


def matches(m: Any, v: Any) -> bool:
    """The catalog host's argument matchers (catalog-host.ts matches): literal, $ci, $contains, $re."""
    def norm(x: Any) -> str:
        return x.strip().lower() if isinstance(x, str) else json.dumps(x, separators=(",", ":")).lower()
    if isinstance(m, dict):
        if "$ci" in m:
            return v is not None and norm(v) == norm(m["$ci"])
        if "$contains" in m:
            return v is not None and str(m["$contains"]).lower() in norm(v)
        if "$re" in m:
            return v is not None and re.search(str(m["$re"]), v if isinstance(v, str) else json.dumps(v), re.I) is not None
    return m == v


def args_match(required: dict[str, Any] | None, args: Any) -> bool:
    a = args if isinstance(args, dict) else {}
    return all(k in a and matches(m, a[k]) for k, m in (required or {}).items())


def grade(expected: dict[str, Any], lines: list[dict[str, Any]] | None, log_error: str | None = None,
          ready: dict[str, Any] | None = None) -> dict[str, Any]:
    servers = list(expected["servers"])
    seen: dict[str, set[str]] = {s: set() for s in servers}
    calls: list[dict[str, Any]] = []
    discovered: list[dict[str, Any]] = []
    tried_listing = False
    discovery = [[d["server"], d["tool"]] for d in expected.get("discovery") or []]
    for line in lines or []:
        server, method = line.get("server"), line.get("method")
        if server in seen and method in ("initialize", "tools/list") and line.get("ok") is True:
            seen[server].add(method)
        if server in seen and method in ("tools/list", "tools/list:received", "tools/list:rejected"):
            tried_listing = True
        if method == "tools/call":
            if [server, line.get("tool")] in discovery:
                discovered.append({"server": server, "tool": line.get("tool"), "arguments": line.get("arguments")})
                continue
            calls.append({"server": server, "tool": line.get("tool"), "arguments": line.get("arguments"),
                          "validation_ok": (line.get("validation") or {}).get("ok"), "fixture": line.get("fixture"),
                          "result_ok": line.get("ok")})
    connected = [s for s in servers if seen[s] == {"initialize", "tools/list"}]
    missing = [s for s in servers if s not in connected]
    incomplete = [s for s in servers if len(seen[s]) == 1]
    connect = "lazy" if (ready or {}).get("connect") == "lazy" else "eager"
    not_connected = f"{len(missing)} of {len(servers)} expected MCP servers were not connected (initialize and tools/list): {', '.join(missing)}"
    infra = None
    if ready is not None and not ready.get("ok"):
        infra = {"code": INFRA_NOT_READY, "detail": f"the readiness probe could not reach the catalog host at {ready.get('url')} from the trial container: {ready.get('error')}"}
    elif lines is None:
        infra = {"code": INFRA_LOG, "detail": f"the catalog host's log could not be read: {log_error}"}
    elif connect == "eager" and missing:
        infra = {"code": INFRA_MISSING, "detail": not_connected}
    elif connect == "lazy" and missing and (calls or tried_listing):
        infra = {"code": INFRA_MISSING, "detail": f"the harness used MCP ({len(calls)} tool calls) while {not_connected[0].lower() + not_connected[1:]}"}
    acceptable = expected.get("acceptable") or []
    tool_request = expected["kind"] == "tool"
    right_index = None
    wrong: list[str] = []
    for i, c in enumerate(calls):
        ok_rules = [a for a in acceptable if a["server"] == c["server"] and a["tool"] == c["tool"]]
        if not ok_rules:
            name = f"{c['server']}/{c['tool']}"
            if name not in wrong:
                wrong.append(name)
            continue
        result_ok = c["result_ok"] is True if c["server"] == "gbrain" else c["result_ok"] is not False
        if right_index is None and result_ok and c["validation_ok"] is not False and any(args_match(a.get("required"), c["arguments"]) for a in ok_rules):
            right_index = i
    out = {
        "request": expected["request"], "kind": expected["kind"], "rung": expected.get("rung"),
        "servers_expected": servers, "servers_connected": connected, "servers_missing": missing,
        "servers_incomplete": incomplete, "connect": connect, "ready": ready, "infra": infra,
        "calls": calls,
        "right_tool": (right_index is not None) if tool_request else None,
        "first_right_call": right_index,
        "wrong_tools": wrong if tool_request else [],
        "tool_when_none": None if tool_request else bool(calls),
        "invalid_calls": sum(1 for c in calls if c["validation_ok"] is False),
        "discovery_calls": discovered,
    }
    out["reward"] = 0 if infra else int(bool(out["right_tool"]) if tool_request else not out["tool_when_none"])
    return out


def read_log(path: str | None) -> tuple[list[dict[str, Any]] | None, str | None, str]:
    try:
        if path:
            text = Path(path).read_text()
        else:
            url = os.environ.get("HE_CATALOG_URL", "http://catalog:8080").rstrip("/") + "/_he/log"
            req = urllib.request.Request(url, headers={"x-he-log-token": os.environ.get("HE_CATALOG_LOG_TOKEN", "")})
            with urllib.request.urlopen(req, timeout=30) as res:
                text = res.read().decode()
        return [json.loads(l) for l in text.splitlines() if l.strip()], None, text
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {str(e)[:300]}", ""


def main() -> int:
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--expected", default=str(here / "expected.json"))
    ap.add_argument("--log", default=None)
    ap.add_argument("--ready", default="/logs/agent/mcp-ready.json")
    ap.add_argument("--out", default="/logs/verifier")
    a = ap.parse_args()
    expected = json.loads(Path(a.expected).read_text())
    lines, err, text = read_log(a.log)
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    if lines is not None:
        (out_dir / "catalog-calls.jsonl").write_text(text)
        if "gbrain" in expected["servers"]:
            try:
                if not os.statvfs(GBRAIN_EVIDENCE).f_flag & os.ST_RDONLY:
                    raise ValueError("the GBrain evidence mount is writable")
                relay_text = (GBRAIN_EVIDENCE / "calls.jsonl").read_text()
                lines += [json.loads(l) for l in relay_text.splitlines() if l.strip()]
                (out_dir / "gbrain-calls.jsonl").write_text(relay_text)
                tools_list = GBRAIN_EVIDENCE / "tools-list.json"
                if tools_list.exists():
                    (out_dir / "gbrain-tools-list.json").write_text(tools_list.read_text())
            except Exception as e:  # noqa: BLE001
                lines, err = None, f"GBrain evidence: {type(e).__name__}: {str(e)[:300]}"
    try:
        ready = json.loads(Path(a.ready).read_text())
    except FileNotFoundError:
        ready = None
    except Exception as e:  # noqa: BLE001
        ready = {"ok": False, "url": None, "error": f"the probe record could not be read: {type(e).__name__}: {str(e)[:200]}"}
    result = grade(expected, lines, err, ready)
    (out_dir / "outcomes.json").write_text(json.dumps(result, indent=1) + "\n")
    (out_dir / "reward.txt").write_text(str(result["reward"]) + "\n")
    print(json.dumps({k: result[k] for k in ("request", "infra", "right_tool", "wrong_tools", "tool_when_none", "reward")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
