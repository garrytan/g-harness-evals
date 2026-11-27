#!/usr/bin/env python3
"""The MCP-at-scale verifier (internal-task plan, "Outcomes"): reads the catalog host's call log, never the agent's reply.

In a task container it runs as tests/grade.py with tests/expected.json beside it. It fetches the log from the catalog host
sidecar (GET <HE_CATALOG_URL>/_he/log with the token in HE_CATALOG_LOG_TOKEN, which only the verifier's environment holds),
keeps a copy as catalog-calls.jsonl, and writes outcomes.json and reward.txt to the output directory (/logs/verifier).

    python3 grade.py [--expected tests/expected.json] [--log <calls.jsonl>] [--out /logs/verifier]

Readiness comes from the catalog host's own log, never from a file in the trial container, which the agent can write. The
probe scripts/mcp-at-scale/agents.py runs from inside the trial container after agent setup and before the agent starts
asks the host for /_he/ready with the cell's connect mode, and the host logs it as a "ready" line. connect is how the
cell's harness connects MCP servers: "eager" (at start: Claude Code, Codex, Hermes, OpenClaw, Gemini CLI, Pi direct) or
"lazy" (on first use: Pi codemode and deferred). Only a ready line logged before any MCP request counts, so a request the
agent sends later changes nothing. With no such line (the probe could not reach the host) the trial is graded as eager.

Connection rule (decided for internal-task, 2026-11-19):
  eager  every rung server must get initialize and tools/list, else HE-MCP-001;
  lazy   HE-MCP-001 only when the harness used MCP (any tools/list or tools/call) while a rung server was still not
         connected. A lazy trial that never got past initialize is scored: no right tool on a tool request, a right
         answer on a no-tool request. Pi deferred sends initialize to most servers in the background at start and, on a
         one-turn text reply, exits before tools/list (keyless check, 2026-11-19), so initialize alone is not a failed
         connect. A connect that fails inside the harness and is followed by no MCP use is not visible in this log; the
         readiness probe still proves the host was up.
  A host that was down is never scored: it leaves no ready line, so the trial is graded as eager and every server is
  missing (HE-MCP-001), or its log is unreadable (HE-MCP-002).

outcomes.json:
  request, kind ("tool" or "none"), rung
  servers_expected      every server of the rung
  servers_connected     servers that successfully answered both initialize and tools/list
  servers_missing       expected but not connected
  servers_incomplete    servers that got initialize or tools/list but not both
  connect, ready        the cell's connect mode and the host's ready line (null when there was none)
  infra                 null, or {code, detail}: HE-MCP-001 a server was not connected under the rule above,
                        HE-MCP-002 the log could not be read, or (a QM cell) the host could not check its held calls.
                        An INFRA trial is counted and published, never scored.
  calls                 tools/call lines, in order: server, tool, arguments, validation ok, fixture, result ok,
                        approval_pending (false); then, only when the host's ready line names the qm variant, any calls
                        QM held for a person's approval (--held, default /logs/agent/held-calls.json, which agents_qm.py
                        rewrites after every turn for QM's approval "annotations" stops). The agent can write that
                        directory, so no other cell reads it. A held call never reached the host: fixture and result ok
                        are null, approval_pending is true, and validation ok is the host's check of its arguments
                        against the tool's inputSchema (POST /_he/validate, the validator tools/call uses; null when
                        the host could not compile the schema). A held call counts as a call the model made, right only when that
                        check passed and its server, tool and arguments match; a held gbrain call is never right
  held_error            null, or why the held calls could not be read (none counts; the trial is scored) or checked by
                        the host (the trial is INFRA HE-MCP-002)
  approval_pending_calls  how many calls were held for approval
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


def ready_line(lines: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """The host's ready line, when one came before any other request the host logged."""
    for line in lines or []:
        if line.get("method") != "ready":
            return None
        if line.get("ok") is True:
            return {"ok": True, "connect": line.get("connect"), "variant": line.get("variant")}
    return None


def grade(expected: dict[str, Any], lines: list[dict[str, Any]] | None, log_error: str | None = None, held: list[dict[str, Any]] | None = None,
          held_error: str | None = None, check_error: str | None = None) -> dict[str, Any]:
    ready = ready_line(lines)
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
                          "result_ok": line.get("ok"), "approval_pending": False})
    for h in (held or []) if (ready or {}).get("variant") == "qm" else []:
        calls.append({"server": h.get("server"), "tool": h.get("tool"), "arguments": h.get("arguments"), "validation_ok": h.get("validation_ok"),
                      "fixture": None, "result_ok": None, "approval_pending": True})
    connected = [s for s in servers if seen[s] == {"initialize", "tools/list"}]
    missing = [s for s in servers if s not in connected]
    incomplete = [s for s in servers if len(seen[s]) == 1]
    connect = "lazy" if (ready or {}).get("connect") == "lazy" else "eager"
    not_connected = f"{len(missing)} of {len(servers)} expected MCP servers were not connected (initialize and tools/list): {', '.join(missing)}"
    infra = None
    if lines is None:
        infra = {"code": INFRA_LOG, "detail": f"the catalog host's log could not be read: {log_error}"}
    elif check_error and (ready or {}).get("variant") == "qm":
        infra = {"code": INFRA_LOG, "detail": f"the catalog host could not check the held calls: {check_error}"}
    elif expected.get("require_ready") and (not ready or ready.get("connect") not in ("lazy", "eager")):
        infra = {"code": INFRA_MISSING, "detail": "the catalog host did not log readiness before the first MCP request"}
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
        valid = c["validation_ok"] is True if c["approval_pending"] else c["validation_ok"] is not False
        if right_index is None and result_ok and valid and any(args_match(a.get("required"), c["arguments"]) for a in ok_rules):
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
        "approval_pending_calls": sum(1 for c in calls if c["approval_pending"]),
        "held_error": held_error or check_error,
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


def check_held(held: list[dict[str, Any]], log_path: str | None) -> tuple[list[dict[str, Any]], str | None]:
    """Each held call with validation_ok from the host's check of its arguments (POST /_he/validate); a held gbrain call
    is not checked. When the host could not answer, the error comes back and grade() makes the trial INFRA."""
    out = [{**h, "validation_ok": None} for h in held]
    todo = [i for i, h in enumerate(out) if h.get("server") != "gbrain"]
    if not todo:
        return out, None
    if log_path:
        return out, "held calls were not checked: the log came from --log, not the host"
    try:
        url = os.environ.get("HE_CATALOG_URL", "http://catalog:8080").rstrip("/") + "/_he/validate"
        body = json.dumps([{k: out[i].get(k) for k in ("server", "tool", "arguments")} for i in todo]).encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "content-type": "application/json", "x-he-log-token": os.environ.get("HE_CATALOG_LOG_TOKEN", "")})
        with urllib.request.urlopen(req, timeout=30) as res:
            checks = json.loads(res.read().decode())
        if not isinstance(checks, list) or len(checks) != len(todo):
            raise ValueError(f"the host answered {len(checks) if isinstance(checks, list) else 'no list'} for {len(todo)} held calls")
        for i, c in zip(todo, checks):
            out[i]["validation_ok"] = c.get("ok") if isinstance(c, dict) else None
        return out, None
    except Exception as e:  # noqa: BLE001
        return out, f"held calls were not checked: {type(e).__name__}: {str(e)[:300]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--expected", default=str(here / "expected.json"))
    ap.add_argument("--log", default=None)
    ap.add_argument("--out", default="/logs/verifier")
    ap.add_argument("--held", default="/logs/agent/held-calls.json")
    a = ap.parse_args()
    expected = json.loads(Path(a.expected).read_text())
    lines, err, text = read_log(a.log)
    held, held_error, check_error = None, None, None
    if (ready_line(lines) or {}).get("variant") == "qm" and Path(a.held).is_file():
        try:
            listed = json.loads(Path(a.held).read_text()).get("calls")
            if not isinstance(listed, list) or not all(isinstance(h, dict) for h in listed):
                raise ValueError("calls is not a list of objects")
            held, check_error = check_held(listed, a.log)
        except Exception as e:  # noqa: BLE001
            held, held_error = [], f"held-calls.json could not be read: {type(e).__name__}: {str(e)[:300]}"
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
    result = grade(expected, lines, err, held, held_error, check_error)
    (out_dir / "outcomes.json").write_text(json.dumps(result, indent=1) + "\n")
    (out_dir / "reward.txt").write_text(str(result["reward"]) + "\n")
    print(json.dumps({k: result[k] for k in ("request", "infra", "right_tool", "wrong_tools", "tool_when_none", "reward")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
