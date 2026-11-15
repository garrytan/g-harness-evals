"""Delivery arms for the frontier Harbor path (HARN-61): are gstack's /review and /ship steps followed when a card carrying
them is delivered by hook or startup file? One arm per cell, set by the job's agent kwarg "delivery"; a job without the
kwarg (every existing cell) changes nothing. No Harbor import, so keyless tests can render every arm
(tests/frontier-delivery.test.ts).

  none     no gstack anywhere: nothing is written; the probe records that no gstack skill file is in the container.
  skill    gstack installed for the host from the pinned commit (delivery-pin.json), in gstack's unattended mode, as the
           host's global skills, plus the fixed told sentence before the task instruction. Pi has no gstack host, so its
           skill arm links gstack's Claude Code skills into Pi's agent skills directory: "manual install, not a gstack
           route" (HARN-61 d2).
  hook     the card on every model request, tool follow-ups included (d1), through the harness's per-step mechanism.
  startup  the same card bytes in the harness's global startup file.
  placebo  the hook route carrying the placebo text instead of the card (harnesses/routes/placebo.md unless the cell
           names another), the H10 placebo.

Every delivery and skill file goes outside /work (d8): a planned path under /work is refused (HE-DELIVERY-002), and a
harness whose only startup file is in the workspace refuses the startup arm (HE-DELIVERY-004). A hook that does not
report loaded and healthy refuses before the agent starts (HE-DELIVERY-005, the HE-ADAPTER-007 analogue, d12).

  python3 delivery.py plan <harness> <arm> <kind> <card path>   prints the arm's container plan as JSON
  python3 delivery.py cant-run                                  prints every refused harness and arm with its evidence
"""

from __future__ import annotations

import base64
import hashlib
import json
import shlex
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ASSETS = HERE / "delivery"
PIN = json.loads((HERE / "delivery-pin.json").read_text())
ARMS = ("none", "skill", "hook", "startup", "placebo")
KINDS = ("review", "ship")
HARNESSES = ("claude-code", "codex", "hermes", "openclaw", "pi")
WORK = "/work"
ROOT = "/tmp/he-delivery"
CARD = ROOT + "/card.md"
GSTACK_DIR = "/opt/gstack"
HERMES_SRC = "$HOME/.hermes-src"
PLACEBO = "harnesses/routes/placebo.md"
CARD_LIMIT = 65536

# Where Harbor 0.24.0's classes point each harness at its own config (the pinned wheel's agents/installed/*.py).
CONFIG_DIR = {
    "claude-code": "/logs/agent/sessions",  # claude_code.py run(): CLAUDE_CONFIG_DIR = environment_logs_dir / "sessions"
    "codex": "/tmp/codex-home",  # codex.py _REMOTE_CODEX_HOME, exported as CODEX_HOME by run()
    "hermes": "/tmp/hermes",  # agents.py FrontierHermes: HERMES_HOME=/tmp/hermes
    "openclaw": "$HOME/.openclaw",  # openclaw.py run(): ~/.openclaw/openclaw.json, workspace "." (the task's cwd)
    "pi": "/tmp/harbor-pi-agent",  # pi.py _REMOTE_PI_CONFIG_DIR, exported as PI_CODING_AGENT_DIR by run()
}
STARTUP_FILE = {
    "claude-code": "/logs/agent/sessions/CLAUDE.md",
    "codex": "/tmp/codex-home/AGENTS.md",
    "hermes": "/tmp/hermes/SOUL.md",
    "pi": "/tmp/harbor-pi-agent/AGENTS.md",
}
HOOK_FILES = {
    "claude-code": {ROOT + "/card-hook.py": "card-hook.py"},
    "codex": {ROOT + "/card-hook.py": "card-hook.py"},
    "hermes": {"/tmp/hermes/plugins/he-steps-card/plugin.yaml": "hermes-plugin/plugin.yaml",
               "/tmp/hermes/plugins/he-steps-card/__init__.py": "hermes-plugin/__init__.py",
               ROOT + "/hermes-check.py": "hermes-check.py"},
    "openclaw": {ROOT + "/openclaw-plugin/openclaw.plugin.json": "openclaw-plugin/openclaw.plugin.json",
                 ROOT + "/openclaw-plugin/package.json": "openclaw-plugin/package.json",
                 ROOT + "/openclaw-plugin/index.js": "openclaw-plugin/index.js",
                 ROOT + "/openclaw-check.js": "openclaw-check.js"},
    "pi": {"/tmp/harbor-pi-agent/extensions/he-steps-card.js": "pi-extension/he-steps-card.js"},
}
OPENCLAW_PLUGIN = ROOT + "/openclaw-plugin"
# The skill roots each host reads, searched for gstack SKILL.md files in every arm (the clean-arm probe).
SKILL_ROOTS = (GSTACK_DIR, "$HOME/.local/share/gstack", "$HOME/.claude/skills", "/logs/agent/sessions/skills",
               "/tmp/codex-home/skills", "$HOME/.codex/skills", "$HOME/.agents/skills", "/tmp/hermes/skills",
               "$HOME/.hermes/skills", "$HOME/.openclaw/skills", "/tmp/harbor-pi-agent/skills", "$HOME/.pi/agent/skills")

# The per-step mechanism each harness offers at its pin, with the pinned file and line it rests on.
HOOK = {
    "claude-code": {
        "mechanism": "settings hooks: UserPromptSubmit (request 1), PostToolUse (each tool follow-up) and PostToolUseFailure (each failed tool's follow-up) commands that print the card as hookSpecificOutput.additionalContext",
        "evidence": [
            "Claude Code 2.1.312 native binary (sha256 4f4178ce41d83e23341ebfbaecdbcf8ea6bf7baea0690025abe49eeec3a5d01d, pin.json harnesses.claude-code): the PostToolUse output path keeps additionalContext (minified: hookEventName===\"PostToolUse\"&&i.additionalContext!==void 0) and renders it as a hook_additional_context attachment",
            "harnesses/routes/README.md, \"Claude Code and Codex: where the bytes land\": UserPromptSubmit additionalContext lands right after the turn's prompt on 2.1.312",
            "Harbor 0.24.0 agents/installed/claude_code.py:1924-1961: run() passes our settings with --settings, so its hooks block reaches the CLI",
        ],
    },
    "codex": {
        "mechanism": "$CODEX_HOME/hooks.json: UserPromptSubmit (request 1) and PostToolUse (each tool follow-up) commands; Codex records their additionalContext as a developer message before the next sampling request; run with --dangerously-bypass-hook-trust",
        "evidence": [
            "codex-rs/hooks/src/engine/discovery.rs:686-694 (rust-v0.165.0): additionalContext is accepted on PreToolUse, PostToolUse, SessionStart, UserPromptSubmit and SubagentStart",
            "codex-rs/core/src/hook_runtime.rs:868-884: hook additional context is recorded into the conversation as developer messages",
            "codex-rs/hooks/src/events/model_request.rs:1: PreModelRequest is observation-only, so it cannot carry the card",
            "codex-rs/features/src/lib.rs:1403-1407: the hooks feature is stable and on by default",
            "Harbor 0.24.0 agents/installed/codex.py:98-103: the dangerously_bypass_hook_trust option adds --dangerously-bypass-hook-trust",
        ],
    },
    "hermes": {
        "mechanism": "a user plugin in $HERMES_HOME/plugins/he-steps-card registering llm_request middleware, which appends the card to the last message of every provider request (not kept in history)",
        "evidence": [
            "agent/turn_api_request.py:140-152 (f97608f): apply_llm_request_middleware runs on every API request of the tool loop and its result replaces api_kwargs",
            "hermes_cli/middleware.py:88-99: llm_request middleware returning {\"request\": {...}} replaces the provider kwargs",
            "agent/turn_context.py:745-800: pre_llm_call runs once per turn and appends to the user message, so it gives no fresh copy on a tool follow-up",
            "agent/turn_api_request.py:42-89: pre_api_request is observation-only (its return value is dropped)",
            "hermes_cli/plugins_discovery.py:232-276: a user plugin loads only when plugins.enabled names it",
        ],
    },
    "openclaw": {
        "mechanism": "a plugin loaded from plugins.load.paths: before_prompt_build prependContext (request 1) and agent tool-result middleware that appends the card to every tool result before OpenClaw feeds it back to the model",
        "evidence": [
            "docs/plugins/hooks/reference.md:128 (openclaw 2026.10.6 package): before_prompt_build adds prompt context for a turn, not per request",
            "docs/plugins/sdk-agent-harness/attempt-runtime.md:72-78: registerAgentToolResultMiddleware runs before the harness feeds tool output back into the model, runtime id openclaw",
            "docs/plugins/sdk-migration/how-to-migrate.md:740-746: installed plugins may register it when enabled and their manifest declares contracts.agentToolResultMiddleware",
            "docs/plugins/hooks.md:125-130: non-bundled plugins need plugins.entries.<id>.hooks.allowConversationAccess for before_prompt_build",
        ],
    },
    "pi": {
        "mechanism": "an extension in $PI_CODING_AGENT_DIR/extensions on the context event, which appends the card to the last message before each LLM call (a deep copy, not kept in history)",
        "evidence": [
            "dist/core/extensions/types.d.ts:691-701 (@earendil-works/pi-coding-agent 1.5.0): the context event fires before each LLM call and can modify messages",
            "docs/extensions.md:815-825: event.messages is a deep copy, safe to modify",
            "docs/extensions.md:131 and docs/configuration.md:21: <agent-dir>/extensions/*.js are auto-discovered",
            "docs/cli.md:244: --help lists flags registered by loaded extensions (the loaded check)",
        ],
    },
}
STARTUP = {
    "claude-code": "$CLAUDE_CONFIG_DIR/CLAUDE.md, Claude Code's user memory file (harnesses/routes/README.md route-startup on 2.1.312)",
    "codex": "$CODEX_HOME/AGENTS.md, Codex's global instructions (harnesses/codex/adapter.sh route-startup)",
    "hermes": "$HERMES_HOME/SOUL.md: Hermes's seeded default (hermes_cli/config.py:499-523, sha256 = harnesses/hermes/pin.json soul_md) plus a blank line, the card and a newline, as the H10 route-startup",
    "pi": "$PI_CODING_AGENT_DIR/AGENTS.md, Pi's user instructions across working directories (docs/configuration.md:18)",
}
CANT_RUN: dict[tuple[str, str], dict[str, Any]] = {
    ("openclaw", "startup"): {
        "code": "HE-DELIVERY-004",
        "label": "can't run (startup file only in the workspace)",
        "why": "OpenClaw reads startup files only from the agent workspace, and Harbor's OpenClaw class sets the workspace to the task's working directory (/work/repo), so the only startup file is /work/repo/AGENTS.md, inside /work (d8)",
        "evidence": [
            "Harbor 0.24.0 agents/installed/openclaw.py:372-379: openclaw setup --baseline --workspace . and agents.defaults.workspace \".\"",
            "openclaw 2026.10.6 docs/concepts/system-prompt.md:161: identity, instructions and memory come from the configured agent workspace",
            "docs/automation/hooks/bundled-hooks.md:66-68: bootstrap-extra-files paths resolve inside the workspace and must stay inside it",
        ],
    },
}


class DeliveryRefused(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code} {message}")
        self.code = code


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def cant_run(harness: str, arm: str) -> dict[str, Any] | None:
    if arm in ("hook", "placebo") and harness not in HOOK:
        return {"code": "HE-DELIVERY-003", "label": "can't run (no per-step hook)", "why": f"{harness} has no per-step injection on this path", "evidence": []}
    return CANT_RUN.get((harness, arm))


def resolve(harness: str, delivery: dict[str, Any]) -> dict[str, Any]:
    """The job's delivery kwarg, checked on the host before the trial is ready: {"arm", "cards": {kind: repo path},
    "card_sha256": {kind: sha256} (optional), "placebo": repo path (optional, default harnesses/routes/placebo.md),
    "placebo_sha256" (optional), "kinds": {task id: kind}}. Card and placebo bytes are read from the repository."""
    def bad(m: str) -> DeliveryRefused:
        return DeliveryRefused("HE-DELIVERY-001", m)
    if harness not in HARNESSES:
        raise bad(f"{harness} has no delivery arms (only {', '.join(HARNESSES)})")
    arm = delivery.get("arm")
    if arm not in ARMS:
        raise bad(f"arm must be one of {', '.join(ARMS)}, not {arm!r}")
    refused = cant_run(harness, arm)
    if refused:
        raise DeliveryRefused(refused["code"], f"{harness} {arm}: {refused['label']}: {refused['why']}")
    kinds = delivery.get("kinds") or {}
    if not kinds or any(k not in KINDS for k in kinds.values()):
        raise bad("kinds must map every task id to review or ship")
    def load(what: str, rel: str | None, want: str | None) -> dict[str, Any]:
        if not rel:
            raise bad(f"no {what}")
        path = (REPO / rel).resolve()
        if REPO.resolve() not in path.parents or not path.is_file():
            raise bad(f"{what} {rel} is not a file in the repository")
        body = path.read_bytes()
        if want and sha256(body) != want:
            raise bad(f"{what} {rel} has sha256 {sha256(body)}, not the preregistered {want}")
        if not body or len(body) > CARD_LIMIT:
            raise bad(f"{what} {rel} is {len(body)} bytes; it must be 1 to {CARD_LIMIT} bytes")
        return {"path": rel, "sha256": sha256(body), "bytes": len(body), "body_b64": base64.b64encode(body).decode()}
    cards = {kind: load(f"card for kind {kind}", (delivery.get("cards") or {}).get(kind), (delivery.get("card_sha256") or {}).get(kind))
             for kind in sorted(set(kinds.values()))}
    placebo = load("placebo", delivery.get("placebo") or PLACEBO, delivery.get("placebo_sha256"))
    return {"arm": arm, "cards": cards, "placebo": placebo, "kinds": dict(kinds)}


def kind_of(resolved: dict[str, Any], trial: str) -> str:
    """The task kind of a Harbor trial, whose directory is <first 32 chars of the task name, _- stripped>__<suffix>
    (Harbor 0.24.0 models/trial/config.py:545-548)."""
    prefix = trial.rsplit("__", 1)[0]
    hits = {k for t, k in resolved["kinds"].items() if t[:32].rstrip("_-") == prefix}
    if len(hits) != 1:
        raise DeliveryRefused("HE-DELIVERY-007", f"trial {trial} matches {len(hits)} task kinds in the delivery kinds map, not one")
    return hits.pop()


def text(resolved: dict[str, Any], kind: str) -> bytes | None:
    """The bytes the arm delivers: the kind's card (hook, startup), the placebo (placebo), or none (none, skill)."""
    arm = resolved["arm"]
    if arm in ("none", "skill"):
        return None
    return base64.b64decode((resolved["placebo"] if arm == "placebo" else resolved["cards"][kind])["body_b64"])


def told(harness: str, arm: str, kind: str) -> str | None:
    if arm != "skill":
        return None
    sentence = PIN["told"][harness][kind]
    if sha256(sentence.encode()) != PIN["told_sha256"].get(sentence):
        raise DeliveryRefused("HE-DELIVERY-001", f"the told sentence for {harness} {kind} is not its pinned sha256")
    return sentence


def instruction(harness: str, resolved: dict[str, Any] | None, kind: str | None, task_instruction: str) -> str:
    """The instruction the harness gets: unchanged, except the skill arm's told sentence and a blank line before it."""
    sentence = told(harness, resolved["arm"], kind) if resolved and kind else None
    return f"{sentence}\n\n{task_instruction}" if sentence else task_instruction


def harbor_kwargs(harness: str, resolved: dict[str, Any] | None) -> dict[str, Any]:
    if resolved and harness == "codex" and resolved["arm"] in ("hook", "placebo"):
        return {"dangerously_bypass_hook_trust": True}
    return {}


def _hook_command(event: str) -> list[dict[str, Any]]:
    return [{"type": "command", "command": f"python3 {ROOT}/card-hook.py {event}", "timeout": 30}]


def claude_settings(settings: dict[str, Any], resolved: dict[str, Any] | None) -> dict[str, Any]:
    if not resolved or resolved["arm"] not in ("hook", "placebo"):
        return settings
    if "hooks" in settings:
        raise DeliveryRefused("HE-DELIVERY-001", "harnesses/claude-code/config/settings.json already has hooks")
    return {**settings, "hooks": {"UserPromptSubmit": [{"hooks": _hook_command("UserPromptSubmit")}],
                                  "PostToolUse": [{"matcher": "*", "hooks": _hook_command("PostToolUse")}],
                                  "PostToolUseFailure": [{"matcher": "*", "hooks": _hook_command("PostToolUseFailure")}]}}


def codex_hooks_json() -> bytes:
    hooks = {"UserPromptSubmit": [{"hooks": _hook_command("UserPromptSubmit")}], "PostToolUse": [{"hooks": _hook_command("PostToolUse")}]}
    return (json.dumps({"hooks": hooks}, indent=2) + "\n").encode()


def hermes_config(config: dict[str, Any], resolved: dict[str, Any] | None) -> dict[str, Any]:
    if not resolved or resolved["arm"] not in ("hook", "placebo"):
        return config
    if "plugins" in config or "hooks" in config:
        raise DeliveryRefused("HE-DELIVERY-001", "the Hermes config already has plugins or hooks")
    return {**config, "plugins": {"enabled": ["he-steps-card"]}}


def openclaw_config(resolved: dict[str, Any] | None) -> dict[str, Any]:
    if not resolved or resolved["arm"] not in ("hook", "placebo"):
        return {}
    return {"plugins": {"load": {"paths": [OPENCLAW_PLUGIN]},
                        "entries": {"he-steps-card": {"enabled": True, "hooks": {"allowConversationAccess": True}}}}}


def _sh_path(path: str) -> str:
    return '"$HOME"/' + shlex.quote(path[len("$HOME/"):]) if path.startswith("$HOME/") else shlex.quote(path)


def _write(path: str, body: bytes, mode: str) -> str:
    q = _sh_path(path)
    return f"mkdir -p \"$(dirname {q})\" && printf %s {base64.b64encode(body).decode()} | base64 -d > {q} && chmod {mode} {q}"


def outside_work(path: str) -> bool:
    p = path.replace("$HOME", "/root")
    return not (p == WORK or p.startswith(WORK + "/"))


def gstack_probe() -> str:
    """Prints one line per gstack skill file under any host's skill roots, and the gstack checkout if present."""
    roots = " ".join(_sh_path(r) for r in SKILL_ROOTS)
    return (f"for r in {roots}; do [ -e \"$r\" ] || continue; [ \"$r\" = {GSTACK_DIR} ] && echo {GSTACK_DIR}; "
            "find -L \"$r\" -maxdepth 4 -name SKILL.md 2>/dev/null | while read -r f; do grep -qi gstack \"$f\" 2>/dev/null && echo \"$f\"; done; "
            "done; true")


WORK_HASH = ("cd /work 2>/dev/null && find . -xdev \\( -type f -o -type l \\) -print0 | LC_ALL=C sort -z "
             "| xargs -0 -r sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1")


def skill_install(harness: str) -> list[str]:
    """gstack's own install for the host, as harnesses/<h>/gstack/Dockerfile does it, at agent setup in the task container."""
    g = PIN["gstack"]
    env = " ".join(f"{k}={shlex.quote(v)}" for k, v in g["session"].items())
    host = {"claude-code": "claude", "codex": "codex", "hermes": "hermes", "openclaw": "openclaw", "pi": "claude"}[harness]
    scope = {"codex": "CODEX_HOME=/tmp/codex-home ", "hermes": "HERMES_HOME=/tmp/hermes "}.get(harness, "")
    steps = [
        f"set -eu; rm -rf {GSTACK_DIR}; git init -q {GSTACK_DIR} && cd {GSTACK_DIR} && git remote add origin {g['repo']} "
        f"&& git fetch -q --depth 1 origin {g['commit']} && git checkout -q FETCH_HEAD && test \"$(git rev-parse HEAD)\" = {g['commit']} "
        f"&& test \"$(cat VERSION)\" = {g['version']} && git config --global --add safe.directory {GSTACK_DIR}",
        f"set -eu; curl -fsSL https://bun.sh/install | bash -s bun-v{g['bun']} >/dev/null && \"$HOME/.bun/bin/bun\" --version",
        f"set -eu; export PATH=\"$HOME/.bun/bin:$PATH\"; mkdir -p {g['session']['GSTACK_STATE_ROOT']}; cd {GSTACK_DIR} "
        f"&& bun install --frozen-lockfile >/dev/null && {env} {scope}./setup --host {host} --no-browser",
    ]
    if harness == "pi":
        steps.append("set -eu; mkdir -p /tmp/harbor-pi-agent/skills && for d in \"$HOME\"/.claude/skills/*/; do "
                     "[ -f \"$d/SKILL.md\" ] || continue; n=$(basename \"$d\"); [ \"$n\" = gstack ] && continue; "
                     "ln -sfn \"${d%/}\" /tmp/harbor-pi-agent/skills/\"$n\"; done; test -f /tmp/harbor-pi-agent/skills/review/SKILL.md "
                     "&& test -f /tmp/harbor-pi-agent/skills/ship/SKILL.md")
    return steps


def skill_env(resolved: dict[str, Any] | None) -> dict[str, str]:
    """gstack's unattended session, in the harness's environment on the skill arm only."""
    return dict(PIN["gstack"]["session"]) if resolved and resolved["arm"] == "skill" else {}


def plan(harness: str, resolved: dict[str, Any], kind: str) -> dict[str, Any]:
    """What the arm does in the task container, in order: files to write, commands to run, health checks (a command and
    the exact last line it must print, at setup or right before the agent starts), and the harness_settings.json record."""
    arm = resolved["arm"]
    body = text(resolved, kind)
    files: list[tuple[str, bytes, str]] = []
    commands: list[str] = []
    health: list[dict[str, str]] = []
    record: dict[str, Any] = {"arm": arm, "kind": kind, "harness": harness}
    if body is not None:
        source = resolved["placebo"] if arm == "placebo" else resolved["cards"][kind]
        record["text"] = {"what": "placebo" if arm == "placebo" else "card", **{k: v for k, v in source.items() if k != "body_b64"}}
    if arm in ("hook", "placebo"):
        files.append((CARD, body, "0644"))
        for dest, src in HOOK_FILES[harness].items():
            files.append((dest, (ASSETS / src).read_bytes(), "0755" if dest.endswith((".py", ".js")) else "0644"))
        if harness == "codex":
            files.append(("/tmp/codex-home/hooks.json", codex_hooks_json(), "0644"))
        record["route"] = {"mechanism": HOOK[harness]["mechanism"], "evidence": HOOK[harness]["evidence"]}
        if harness in ("claude-code", "codex"):
            for event in ("UserPromptSubmit", "PostToolUse") + (("PostToolUseFailure",) if harness == "claude-code" else ()):
                health.append({"name": f"the {event} hook prints the arm's bytes as additionalContext", "when": "setup",
                               "command": f"printf '{{\"hook_event_name\":\"{event}\"}}' | HE_DELIVERY_CHECK=1 python3 {ROOT}/card-hook.py {event} "
                                          "| python3 -c 'import hashlib,json,sys; d=json.load(sys.stdin)[\"hookSpecificOutput\"]; print(d[\"hookEventName\"], hashlib.sha256(d[\"additionalContext\"].encode()).hexdigest())'",
                               "expect": f"{event} {sha256(body)}"})
        if harness == "codex":
            health.append({"name": "hooks.json names both events", "when": "setup",
                           "command": "python3 -c 'import json; print(\",\".join(sorted(json.load(open(\"/tmp/codex-home/hooks.json\"))[\"hooks\"])))'",
                           "expect": "PostToolUse,UserPromptSubmit"})
        if harness == "hermes":
            health.append({"name": "Hermes's own plugin loader loads the plugin and registers its llm_request middleware", "when": "launch",
                           "command": f"cd {HERMES_SRC} && HERMES_HOME=/tmp/hermes {HERMES_SRC}/venv/bin/python {ROOT}/hermes-check.py",
                           "expect": "loaded he-steps-card llm_request"})
        if harness == "openclaw":
            health.append({"name": "openclaw plugins inspect --runtime reports the plugin loaded with both registrations", "when": "launch",
                           "command": f". ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null && openclaw plugins inspect he-steps-card --runtime --json 2>/dev/null | node {ROOT}/openclaw-check.js",
                           "expect": "loaded he-steps-card"})
        if harness == "pi":
            health.append({"name": "pi --help lists the extension's flag, so Pi loaded the extension", "when": "setup",
                           "command": ". ~/.nvm/nvm.sh >/dev/null; PI_CODING_AGENT_DIR=/tmp/harbor-pi-agent pi --help 2>&1 | grep -o -- '--he-steps-card' | head -1",
                           "expect": "--he-steps-card"})
        health.append({"name": "the card file holds the arm's bytes", "when": "setup", "command": f"sha256sum {CARD} | cut -d' ' -f1", "expect": sha256(body)})
    if arm == "startup":
        dest = STARTUP_FILE[harness]
        record["route"] = {"file": dest, "what": STARTUP[harness]}
        if harness == "hermes":
            seed = PIN["hermes_soul_seed_sha256"]
            files.append((CARD, body, "0644"))
            commands.append(f"set -e; s=/tmp/hermes/SOUL.md; if [ ! -e $s ]; then cd {HERMES_SRC} && HERMES_HOME=/tmp/hermes {HERMES_SRC}/venv/bin/python "
                            "-c 'from hermes_cli.default_soul import DEFAULT_SOUL_MD as s; open(\"/tmp/hermes/SOUL.md\", \"w\", encoding=\"utf-8\").write(s)'; fi; "
                            f"test \"$(sha256sum $s | cut -d' ' -f1)\" = {seed}; {{ printf '\\n\\n'; cat {CARD}; printf '\\n'; }} >> $s")
            health.append({"name": "SOUL.md is Hermes's seed, a blank line, the card and a newline", "when": "setup",
                           "command": f"head -c 667 /tmp/hermes/SOUL.md | sha256sum | cut -d' ' -f1; tail -c +670 /tmp/hermes/SOUL.md | head -c {len(body)} | sha256sum | cut -d' ' -f1",
                           "expect": f"{seed}\n{sha256(body)}"})
        else:
            files.append((dest, body, "0644"))
            health.append({"name": "the startup file holds the card's bytes", "when": "setup", "command": f"sha256sum {dest} | cut -d' ' -f1", "expect": sha256(body)})
    if arm == "skill":
        sentence = told(harness, arm, kind)
        record["route"] = {"gstack": {k: PIN["gstack"][k] for k in ("repo", "commit", "version", "bun")}, "session": PIN["gstack"]["session"],
                           "told": sentence, "told_sha256": sha256(sentence.encode())}
        if harness == "pi":
            record["route"]["label"] = "manual install, not a gstack route"
            record["route"]["how"] = "gstack has no Pi host (./setup --host takes claude, codex, kiro, factory, opencode, cursor, copilot, agy, gemini, slate, openclaw, hermes or gbrain), so ./setup --host claude installs gstack's Claude Code skills and each skill directory is linked into $PI_CODING_AGENT_DIR/skills"
        commands.extend(skill_install(harness))
    for path, _, _ in files:
        if not outside_work(path):
            raise DeliveryRefused("HE-DELIVERY-002", f"{path} is under {WORK}; every delivery and skill file goes outside /work (d8)")
    return {"record": record, "files": [{"path": p, "mode": m, "sha256": sha256(b), "bytes": len(b), "command": _write(p, b, m)} for p, b, m in files],
            "commands": commands, "health": health, "env": skill_env(resolved)}


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["cant-run"]:
        print(json.dumps({f"{h} {a}": cant_run(h, a) for h in HARNESSES for a in ARMS if cant_run(h, a)}, indent=2))
    elif args[:1] == ["plan"] and len(args) == 5:
        h, arm, kind, card = args[1:5]
        try:
            r = resolve(h, {"arm": arm, "cards": {kind: card}, "kinds": {"task": kind}})
            print(json.dumps(plan(h, r, kind), indent=2))
        except DeliveryRefused as e:
            print(json.dumps({"refused": e.code, "message": str(e)}))
            sys.exit(2)
    else:
        sys.exit(__doc__)
