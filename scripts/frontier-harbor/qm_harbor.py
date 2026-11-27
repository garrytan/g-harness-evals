"""QM on the frontier Harbor path (internal-task), with no Harbor import, so keyless tests can render it.

QM is a service, not a CLI: its one agent loop (Pi) runs inside QM core, which keeps its sessions in Postgres and runs every
shell, file and app tool through a sandbox backend. agents.py FrontierQm runs it beside the task like this:

  * Postgres and QM core (images built from harnesses/qm/Dockerfile at the pin, the Postgres image by digest) run as two
    containers on the VM that join the task container's network namespace (the egress sidecar's when Harbor runs one,
    which the task container shares), so core, Postgres and the task container reach each other on 127.0.0.1 and core
    reaches the metering proxy through the same blocklist as the task. Neither container is part of the task container:
    the verifier grades only the task container, and nothing of core's (its image, its environment, the per-trial token)
    is in it.
  * QM's local sandbox backend drives the docker CLI named by LOCAL_SANDBOX_DOCKER_BIN. qm-docker-shim.sh stands in for
    that CLI inside core: it answers QM's provisioning calls as if a sandbox container ran, and says the sandbox's daemon
    listens on 127.0.0.1:<daemon port>. QM's own exec daemon (agent.mjs from the pinned source, sha256 checked) runs in
    the task container on that port, as the task's user, with /root/workspace (QM's fixed workdir) linked to the task's
    working directory. So every execute, files and apps call QM makes lands in the task container.
  * One turn per trial: the task's instruction as a DM from one person, posted to core with qm-call.mjs.

Everything here is a pure rendering of that: core's environment, the admin calls, the turn, and the settings record.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import frontier_settings as fs

HERE = fs.HERE
QM_DIR = fs.REPO / "harnesses/qm"
QM = json.loads((QM_DIR / "pin.json").read_text())
COMMIT = QM["commit"]


def images(commit: str) -> tuple[str, str]:
    """QM core's image and its src stage, as vm-run.sh tags them when it builds harnesses/qm/Dockerfile at commit."""
    return f"harness-eval/qm:{commit[:12]}", f"harness-eval/qm-src:{commit[:12]}"


IMAGE, SRC_IMAGE = images(COMMIT)
DAEMON_SOURCE = "/src/cli/templates/aws/microvm-agent/agent.mjs"
PORTS = {"postgres": 55432, "core": 58080, "daemon": 58081}
ORG = "harness-eval"
SCOPE = f"org:{ORG}"
ACTOR = "U1"
SANDBOX_SCOPE = f"personal:{ACTOR}"
CUSTOM_PROVIDER = "he-openrouter"
DAEMON_DIR = "/tmp/frontier-qm"
WORKDIR = "/root/workspace"
SHIM = HERE / "qm-docker-shim.sh"
CALL = HERE / "qm-call.mjs"
MOUNT = "/opt/he-qm"
LABEL = "harness-eval.frontier-qm"
# The jobs directory of the Harbor run that started a QM container (vm-run.sh's $run/jobs), so vm-run.sh's cleanup removes
# only its own run's containers.
JOBS_LABEL = "harness-eval.frontier-qm.jobs"
# psql's stderr when the server refuses a connection for want of a password: the only failure that shows the passwordless
# probe was refused rather than never reaching Postgres.
PG_AUTH_REFUSED = ("no password supplied", "password authentication failed")


def pg_auth_refused(stderr: str) -> bool:
    return any(m in stderr for m in PG_AUTH_REFUSED)
# core.env keys a Harbor cell drops: no QM budget (a budget that binds would stop a trial on QM's own spend estimate; the
# ledger lease is the cap), and the model, which each cell sets below.
DROPPED_CORE_ENV = ("BUDGET_USD_PER_WINDOW", "ORG_BUDGET_USD_PER_WINDOW", "BUDGET_WINDOW_MS", "PI_MODEL", "MODEL_PROVIDER")
# QM's own utility model per provider at the pin, its shipped default (auxiliaryModelFor, src/model/pi-models.ts and
# model-registry.ts auxiliary true). A custom provider has none, so its utility calls name the cell model.
HOUSEKEEPING = {"anthropic": ("claude-haiku-5-5", "claude-sonnet-5-5"), "openai": ("gpt-5.6-luna",)}
TITLE_SOURCE = "/src/src/agent/session-title-prompt.ts"
REGISTRY_SOURCE = "/src/src/model/model-registry.ts"
# Every command policy rule QM ships as the org floor is require_approval or deny (src/policy/command-policy.ts
# ORG_FLOOR_RULES: recursive rm, force push, drop or truncate table and curl piped to a shell need approval; mkfs and a fork
# bomb are denied). A headless turn has nobody to approve, so the first rm -r would end it pending_approval. A stored org
# policy replaces the floor; this one has no rules, as Claude Code runs bypassPermissions and Hermes --yolo.
COMMAND_POLICY = {"mode": "denylist", "rules": []}


def pin() -> dict[str, Any]:
    return fs.PIN["harnesses"]["qm"]


def route(model: str) -> dict[str, Any]:
    """How QM reaches the cell model: its built-in anthropic or openai provider, or a custom provider (protocol openai) on
    the proxy's OpenRouter route, with the model id QM's runtime names and its housekeeping model."""
    spec = fs.model_spec(model)
    if model not in pin()["models"]:
        raise ValueError(f"HE-QM-001 QM runs only {', '.join(pin()['models'])} on this path (scripts/frontier-harbor/pin.json harnesses.qm.models), not {model}")
    provider = spec["provider"]
    if provider in HOUSEKEEPING:
        return {"provider": provider, "pi_model": spec["name"], "housekeeping": [f"{provider}:{m}" for m in HOUSEKEEPING[provider]], "custom": None}
    if provider != "openrouter":
        raise ValueError(f"HE-QM-001 QM has no route for {provider} models on this path")
    custom = {"id": spec["name"], "name": spec["name"], "reasoning": True, "contextWindow": spec["context_window"], "maxTokens": spec["max_output_tokens"]}
    return {"provider": provider, "pi_model": f"custom/{CUSTOM_PROVIDER}/{spec['name']}", "housekeeping": [], "custom": custom}


def housekeeping_models(model: str) -> list[str]:
    return list(route(model)["housekeeping"])


def title_models(source: str) -> list[str]:
    """The model ids QM's session-title code names (TITLE_MODEL_ID, DESCRIPTIVE_TITLE_MODEL_ID and the like) in
    src/agent/session-title-prompt.ts at a commit; agents.py checks each one the cell's provider serves is in the slot."""
    return re.findall(r'export const [A-Z_]*MODEL_ID = "([^"]+)"', source)


def registry_models(source: str) -> list[str]:
    """The model ids in QM's src/model/model-registry.ts at a commit: a built-in provider's cell model must be one of them,
    or QM refuses it at the first turn (gpt-6.2-sol is at 77024e79, not at the older 90e4ced7)."""
    return re.findall(r'^\s*id: "([^"]+)"', source, flags=re.M)


def title_model_provider(model_id: str) -> str | None:
    return "anthropic" if model_id.startswith("claude-") else "openai" if model_id.startswith("gpt-") else None


def shipped_core_env() -> dict[str, str]:
    """harnesses/qm/config/core.env as data, without the keys a Harbor cell drops."""
    out: dict[str, str] = {}
    for line in (QM_DIR / "config/core.env").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        if k not in DROPPED_CORE_ENV:
            out[k] = v
    return out


def core_env(model: str, url: str, token: str, secret: str, connector_key: str, pg_password: str) -> dict[str, str]:
    """QM core's whole environment for one trial. The token appears here only; agents.py writes it to a 0600 env file that
    docker reads, never to an argument, and the task container gets none of it."""
    r = route(model)
    if not url.rstrip("/").endswith("/" + r["provider"]):
        raise ValueError(f"a QM cell on {model} runs on the proxy's {r['provider']} route <proxy>/<slot>/{r['provider']}, not {url}")
    if len(secret) < 32:
        raise ValueError("CORE_SIGNING_SECRET must be at least 32 characters (QM core refuses to start otherwise)")
    env = {
        **shipped_core_env(),
        "DATABASE_URL": urlunsplit(("postgres", f"postgres:{pg_password}@127.0.0.1:{PORTS['postgres']}", "/qm", "", "")),
        "PORT": str(PORTS["core"]),
        "CORE_SIGNING_SECRET": secret,
        "CONNECTOR_SECRET_KEY": connector_key,
        "LOCAL_SANDBOX_DOCKER_BIN": f"{MOUNT}/docker",
        "LOCAL_SANDBOX_IMAGE": "harbor-task",
        "HE_QM_SANDBOX_PORT": str(PORTS["daemon"]),
        "HE_QM_SHIM_STATE": "/data/shim",
        "PI_MODEL": r["pi_model"],
    }
    if r["provider"] == "anthropic":
        env.update({"MODEL_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": token, "ANTHROPIC_BASE_URL": url.rstrip("/")})
    elif r["provider"] == "openai":
        env.update({"MODEL_PROVIDER": "openai", "OPENAI_API_KEY": token, "OPENAI_BASE_URL": url.rstrip("/") + "/v1"})
    else:
        origin = urlsplit(url)
        env.update({"HE_QM_PROXY_TOKEN": token, "PRIVATE_NETWORK_ALLOWED_ORIGINS": f"{origin.scheme}://{origin.netloc}"})
    return env


def env_file(env: dict[str, str]) -> str:
    for k, v in env.items():
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", k) or "\n" in v:
            raise ValueError(f"core environment entry {k} cannot go in a docker env file")
    return "".join(f"{k}={v}\n" for k, v in env.items())


def admin_calls(model: str, url: str) -> list[dict[str, Any]]:
    """The admin calls before the turn, in order: the custom provider (OpenRouter cells only; its key is the placeholder
    qm-call.mjs fills from core's environment), the org runtime (the cell model at effort high, fast mode off), and the org
    command policy. The sandbox is created after these (sandbox_create)."""
    r = route(model)
    calls = []
    if r["custom"]:
        calls.append({"name": "custom_provider", "method": "PUT", "path": f"/v1/admin/custom-providers/{CUSTOM_PROVIDER}", "body": {
            "name": "OpenRouter through the metering proxy", "protocol": "openai", "baseUrl": url.rstrip("/") + "/v1",
            "models": [r["custom"]], "apiKey": "@HE_QM_PROXY_TOKEN@", "validate": False}})
    calls.append({"name": "runtime", "method": "PUT", "path": f"/v1/admin/scopes/{SCOPE}/runtime", "body": {"modelId": r["pi_model"], "effortLevel": fs.EFFORT, "fastMode": False}})
    calls.append({"name": "command_policy", "method": "PUT", "path": f"/v1/admin/scopes/{SCOPE}/command-policy", "body": COMMAND_POLICY})
    return calls


def sandbox_create() -> dict[str, Any]:
    return {"method": "POST", "path": f"/v1/admin/sandboxes/{SANDBOX_SCOPE}", "body": {"action": "create", "backend": "local", "name": "task"}}


def sandbox_default(sandbox_id: str) -> dict[str, Any]:
    return {"method": "POST", "path": f"/v1/admin/sandboxes/{SANDBOX_SCOPE}", "body": {"action": "default", "sandboxId": sandbox_id}}


NODE_BIN = DAEMON_DIR + "/node"


def link_command() -> str:
    """As root in the task container: link QM's fixed workdir to the task's working directory. A real /root/workspace is
    left alone and stops the trial (HE-QM-002), since QM would then work outside the task's files."""
    return (f'mkdir -p /root && if [ -L {WORKDIR} ]; then rm {WORKDIR}; elif [ -e {WORKDIR} ]; then '
            f'echo "HE-QM-002 {WORKDIR} already exists in the task container" >&2; exit 1; fi; ln -s "$(pwd)" {WORKDIR}')


def daemon_command() -> str:
    """Start QM's exec daemon in the task container, detached, as the task's user. It runs on the node binary linked at
    NODE_BIN with the container's own PATH, so the commands it runs for QM see the task's environment, not nvm's."""
    port = PORTS["daemon"]
    probe = f"{NODE_BIN} -e 'fetch(\"http://127.0.0.1:{port}/health\").then(r => r.text()).then(t => {{ console.log(t); process.exit(0); }}, () => process.exit(1))'"
    return (
        f"AGENT_PORT={port} setsid nohup {NODE_BIN} {DAEMON_DIR}/agent.mjs > /logs/agent/qm-daemon.log 2>&1 < /dev/null & echo $! > {DAEMON_DIR}/pid; "
        f"for i in $(seq 50); do {probe} >/dev/null 2>&1 && break; sleep 0.2; done; "
        f'{probe} && echo "workdir $(pwd)" && echo "link $(readlink {WORKDIR})"'
    )


def turn_status(out: dict[str, Any] | None) -> dict[str, Any]:
    """What a turn's reply says: the HTTP status, QM's TurnResult status and refusal kind, and whether the turn finished
    (ok or silent). pending_approval, refused, failed and queued are not a finished turn."""
    body = (out or {}).get("body")
    body = body if isinstance(body, dict) else {}
    status = body.get("status")
    return {"http": (out or {}).get("http"), "status": status, "refusal_kind": body.get("refusalKind"),
            "reason": (body.get("reason") or "")[:500] or None, "finished": (out or {}).get("http") == 200 and status in ("ok", "silent")}


def redact(text: str, secrets: list[str]) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "<redacted>")
    return text


def settings_fields(model: str) -> dict[str, Any]:
    """The harness_settings.json fields of a QM cell beyond the shared ones (frontier_settings._record)."""
    r = route(model)
    spec = fs.model_spec(model)
    cw, mo = spec["context_window"], spec["max_output_tokens"]
    custom = r["custom"] is not None
    return {
        "context_window": {"value": cw, "set_by": f"the custom provider's model contextWindow {cw}" if custom else "QM's own registry row for the model (src/model/model-registry.ts at the pin)"},
        "max_output_tokens": {"value": mo, "set_by": f"the custom provider's model maxTokens {mo}, sent by pi-ai as max_completion_tokens (a custom model without it defaults to 8,192)" if custom else "QM's registry row maxTokens, sent by pi-ai as max_tokens (Anthropic) or max_output_tokens (OpenAI Responses)"},
        "compaction": {"threshold": "QM's shipped compaction (src/agent/context-compaction.ts and compactHistory in src/agent/agent-run.ts at the pin)", "set_by": "shipped default"},
        "tools": {"hosted_web_search": "none: QM's agent loop declares no web search or fetch tool at the pin (seen keyless: execute, skills, files, apps, memory, history, background, subagents, sandbox, attach, finish_silently, withdraw_approval, goal, runtime, context); its connectors are an org setting, unset here",
                  "disabled": [], "enabled": "every tool QM's Pi loop declares at the pin; no MCP server, no connector"},
        "effort": {"requested": fs.EFFORT, "setting": f"org runtime effortLevel {fs.EFFORT} (PUT /v1/admin/scopes/{SCOPE}/runtime), which applyTurnEffort turns into Pi's thinking level {fs.EFFORT}: "
                   + ("adaptive thinking plus output_config.effort high on Anthropic" if r["provider"] == "anthropic" else "reasoning {effort: high} on the Responses API" if r["provider"] == "openai" else "top-level reasoning_effort high on Chat Completions (pi-ai's openai-completions treats the proxy URL as a plain OpenAI-compatible endpoint, not OpenRouter)")
                   + "; QM's shipped default is low on Anthropic and auto (medium) elsewhere"},
        "housekeeping_model": {"model": (r["housekeeping"] or [model])[0], "models": r["housekeeping"] or [model], "note": ("harness housekeeping, shipped default, metered and never scored: QM's auxiliary model for the provider takes the utility calls (auxiliaryModelFor, src/model/pi-models.ts)"
                               + (", and Claude Sonnet 5.5 writes session titles (DESCRIPTIVE_TITLE_MODEL_ID at the pin; TITLE_MODEL_ID for every title on QM main from 2026-11; src/agent/session-title-prompt.ts)" if r["provider"] == "anthropic" else "")
                               if r["housekeeping"] else "a custom provider has no auxiliary model in QM, so its utility calls name the cell model (shipped behaviour, src/model/pi-models.ts); QM's Claude title model has no Anthropic key in this cell, so no call goes to it (QM main from 2026-11 then titles on the cell model)")},
        **({"reasoning_replay": {"field": "reasoning_details", "verdict": "replays", "how": "QM's vendored pi-ai (@earendil-works/pi-ai 0.82.0-qm.3, openai-completions) keeps the reasoning_details the endpoint streams with each assistant message and sends them back on that message in every later request, the tool-call turn included; seen keyless, the Gemini signature entry still keyed to its unchanged call id. Seen accepted live: OpenRouter's Gemini endpoint (pinned to Google AI Studio) answered HTTP 200 to every replayed tool-call turn carrying them (install-check-qm-smoke.json)", "checked": "keyless, install-check-qm.json (qm-carbon replay_verdict): the real QM core at the pin, through broker.ts and the metering proxy to a fake upstream that answers shell tool calls with a Gemini thought signature in reasoning_details and checks it on each replayed tool-call turn; then one metered trial, install-check-qm-smoke.json"}} if custom else {}),
        "qm": {
            "commit": COMMIT, "image": IMAGE, "pi_model": r["pi_model"], "provider_route": "custom provider " + CUSTOM_PROVIDER + " (protocol openai)" if custom else "QM's built-in " + r["provider"] + " provider",
            "topology": "Postgres and QM core as two containers on the VM in the task container's network namespace; QM's exec daemon (agent.mjs, sha256 " + pin()["daemon_sha256"][:12] + "...) in the task container on 127.0.0.1:" + str(PORTS["daemon"]) + "; qm-docker-shim.sh as core's docker CLI",
            "ports": PORTS, "org": ORG, "actor": ACTOR, "security_posture": shipped_core_env().get("HARNESS_SECURITY_POSTURE"), "command_policy": COMMAND_POLICY,
        },
        "differences_from_pin": [
            "runs through agents.py FrontierQm on Harbor (core and Postgres beside the task container, QM's sandbox replaced by the task container through its own exec daemon), not harnesses/qm/compose.yaml and adapter.sh",
            "QM's workdir /root/workspace is a link to the task's working directory, and provisioning adds QM's credential links under /root (.aws, .netrc, .config/gh and the rest of src/credentials/resident-paths.ts, into /tmp/agent-creds) in the task container",
            "Node " + str(pin()["node_major"]) + " installed through nvm in the task container for QM's daemon only; the daemon runs with the container's own PATH",
            f"org runtime effort {fs.EFFORT} (QM ships low on Anthropic, medium elsewhere)",
            "org command policy with no rules in place of QM's floor (which needs approval for recursive rm, force push, drop or truncate table and curl piped to a shell, so a headless turn would stop at the first one)",
            "no QM budget (core.env's BUDGET_USD_PER_WINDOW and ORG_BUDGET_USD_PER_WINDOW of 5 dropped); the ledger lease caps spend",
            "one turn: the task's instruction as one DM; no world-MCP server, no directory push, no skills seed beyond QM's built-in ones",
            "QM's refusal fallback to claude-opus-5 has no route: the proxy slot allows only the cell model and its housekeeping models",
        ] + (["PRIVATE_NETWORK_ALLOWED_ORIGINS in core's environment lists the proxy's origin and nothing else, so QM accepts the custom provider's private-network base URL"] if custom else []) + (["Carbon through a QM custom provider on the proxy's OpenRouter route, where the proxy pins Google AI Studio's standard endpoint; QM's native OpenRouter provider is not used (it reads its model list live from openrouter.ai)"] if custom else []),
    }

