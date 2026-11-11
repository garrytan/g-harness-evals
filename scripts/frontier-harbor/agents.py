"""Harbor 0.24.0 installed-agent classes for the frontier Harbor path (internal-task plan, Implementation step 2).

Claude Code, Codex, Hermes and OpenClaw wrap our own pinned adapter settings; Pi and mini-swe-agent are Harbor's stock
classes with overrides. frontier_settings.py renders every value; this file only plugs them into Harbor.

Every class, at agent setup, asks broker.ts (run by vm-run.sh on 127.0.0.1) for its trial's slot: the broker binds the
slot in the metering proxy with a fresh per-trial token and returns the token and the slot's base URL. The token goes
into the agent's extra_env (so Harbor also scrubs it from the jobs directory), the harness reads it as its API key, and
nothing else that could be a credential reaches the container: each class reads its environment from its own options
and extra_env only, never from the Harbor process environment. Each writes harness_settings.json into its agent log
directory.

Job config: {"import_path": "agents:FrontierClaudeCode", "model_name": "anthropic/claude-opus-5-5",
             "kwargs": {"version": "2.1.312", "broker_url": "http://127.0.0.1:8791"}}, with this directory on PYTHONPATH.
"""

from __future__ import annotations

import asyncio
import json
import os
import shlex
import urllib.request
from pathlib import Path
from typing import Any, Mapping

import yaml

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.agents.installed.codex import Codex
from harbor.agents.installed.hermes import Hermes
from harbor.agents.installed.mini_swe_agent import MiniSweAgent
from harbor.agents.installed.openclaw import OpenClaw
from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

import frontier_settings as fs


def cell_model(model_name: str | None) -> str:
    if not model_name or "/" not in model_name:
        raise ValueError("model_name must look like anthropic/claude-opus-5-5")
    provider, name = model_name.split("/", 1)
    return fs.model_spec(f"{provider}:{name}")["id"]


def bind_slot(broker_url: str, trial: str, harness: str, model: str, cell: str | None = None, attempt: int | None = None, job: str | None = None) -> dict[str, str]:
    body = json.dumps({"trial": trial, "cell": cell, "attempt": attempt, "harness": harness, "model": model, "models": fs.slot_models(harness, model), **({"job": job} if job else {})}).encode()
    req = urllib.request.Request(f"{broker_url.rstrip('/')}/bind", data=body, method="POST", headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        out = json.loads(res.read())
    if not out.get("token") or not out.get("base_url"):
        raise RuntimeError("HE-FRONTIER-003 the slot broker returned no token or base URL")
    return out


class _Frontier:
    """Mixin: per-trial slot from the broker, the rendered environment, harness_settings.json, no host environment."""

    HARNESS = ""
    KWARGS = ("broker_url", "cell", "attempt", "gstack")
    GSTACK_REMOTE_TAR = "/tmp/gstack-arm.tar.gz"

    @classmethod
    def parse_options(cls, kwargs: Mapping[str, Any] | None = None, env: Mapping[str, str] | None = None) -> Any:
        return super().parse_options({k: v for k, v in (kwargs or {}).items() if k not in cls.KWARGS}, env)

    def __init__(self, *args: Any, broker_url: str | None = None, cell: str | None = None, attempt: int | None = None, gstack: dict[str, Any] | None = None, **kwargs: Any) -> None:
        model = cell_model(kwargs.get("model_name"))
        kwargs.update(fs.harbor_kwargs(self.HARNESS, model))
        if gstack is not None:
            fs.gstack_arm(self.HARNESS, gstack)
        self._frontier_gstack = gstack
        self._frontier_model = model
        self._frontier_cell = cell
        self._frontier_attempt = attempt
        self._frontier_broker = broker_url
        self._frontier_url = ""
        self._frontier_checks: dict[str, Any] = {}
        super().__init__(*args, **kwargs)

    def _env_sources(self) -> tuple[Mapping[str, str], ...]:
        return tuple(s for s in super()._env_sources() if s is not os.environ)

    @property
    def frontier_trial(self) -> str:
        return Path(self.logs_dir).parent.name

    async def _frontier_bind(self) -> None:
        if not self._frontier_broker:
            raise RuntimeError("HE-FRONTIER-003 no broker_url: the frontier agent classes run only under scripts/frontier-harbor/vm-run.sh")
        job = Path(self.logs_dir).parent.parent.name
        slot = await asyncio.to_thread(bind_slot, self._frontier_broker, self.frontier_trial, self.HARNESS, self._frontier_model, self._frontier_cell, self._frontier_attempt, job)
        self._frontier_url = slot["base_url"]
        self._extra_env.update(fs.container_env(self.HARNESS, self._frontier_model, slot["base_url"], slot["token"]))

    def _write_settings(self) -> None:
        settings = fs.harness_settings(self.HARNESS, self._frontier_model) if self._frontier_gstack is None else fs.harness_settings(self.HARNESS, self._frontier_model, self._frontier_gstack)
        settings["trial"] = self.frontier_trial
        settings["cell"] = self._frontier_cell
        settings["attempt"] = self._frontier_attempt
        settings["install_checks"] = self._frontier_checks
        Path(self.logs_dir).mkdir(parents=True, exist_ok=True)
        (Path(self.logs_dir) / "harness_settings.json").write_text(json.dumps(settings, indent=2) + "\n")

    async def setup(self, environment: BaseEnvironment) -> None:
        await self._frontier_bind()
        try:
            await super().setup(environment)
            res = await environment.exec(command="ls -A /logs 2>/dev/null")
            self._frontier_checks["container_logs_entries"] = sorted((res.stdout or "").split())
            if "proxy-capture" in self._frontier_checks["container_logs_entries"]:
                raise RuntimeError("HE-FRONTIER-003 the trial's proxy-capture directory is visible inside the task container")
            await self._frontier_after_install(environment)
            if self._frontier_gstack is not None:
                await self._frontier_install_gstack(environment)
        finally:
            self._write_settings()

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        return None

    async def _frontier_install_gstack(self, environment: BaseEnvironment) -> None:
        """The cell's gstack arm: its release tar uploaded, checked and extracted into the agent's home after the harness
        and our settings are in place (scripts/canary/gstack/arm.json says where each host reads it)."""
        arm = fs.gstack_arm(self.HARNESS, self._frontier_gstack)
        await environment.upload_file(arm["tar"], self.GSTACK_REMOTE_TAR)
        res = await environment.exec(command=fs.gstack_install_command(self._frontier_gstack, self.GSTACK_REMOTE_TAR), user=environment.default_user, timeout_sec=600)
        facts = fs.gstack_install_facts(res.stdout or "")
        want = {"status": "ok", "router": "yes", "skills": len(arm["sidecar"]["skills"]), "version": arm["version"], "head": arm["sha"]}
        self._frontier_checks["gstack"] = {**facts, "expected": want, "matches": all(facts.get(k) == v for k, v in want.items())}
        if not self._frontier_checks["gstack"]["matches"]:
            raise RuntimeError(f"HE-FRONTIER-002 the gstack arm did not install as built: {facts} (expected {want})")


class FrontierClaudeCode(_Frontier, ClaudeCode):
    HARNESS = "claude-code"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["config"] = fs.claude_settings_merge(kwargs.get("gstack"))["settings"]
        super().__init__(*args, **kwargs)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        want = fs.PIN["harnesses"]["claude-code"]["native_binary_sha256"]
        res = await environment.exec(command='export PATH="$HOME/.local/bin:$PATH"; sha256sum "$(readlink -f "$(command -v claude)")" | cut -d" " -f1; claude --version')
        words = (res.stdout or "").split()
        got = words[0] if words else None
        self._frontier_checks.update({"claude_binary_sha256": got, "claude_binary_matches_pin": got == want, "claude_version": " ".join(words[1:3]) or None})
        if got != want:
            raise RuntimeError(f"HE-FRONTIER-002 the installed claude binary is {got}, not the pinned {want}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        try:
            await super().run(instruction, environment, context)
        finally:
            if self._frontier_gstack is not None:
                try:
                    res = await environment.exec(command=fs.drop_skill_links_command(), timeout_sec=60)
                    words = (res.stdout or "").split()
                    self._frontier_checks["skill_links_dropped"] = int(words[-1]) if words[-2:-1] == ["SKILL_LINKS_DROPPED"] and words[-1].isdigit() else None
                finally:
                    self._write_settings()


class FrontierCodex(_Frontier, Codex):
    HARNESS = "codex"

    def _build_effective_config(self, openai_base_url: str | None = None) -> dict[str, Any]:
        return fs.codex_config(self._frontier_model, self._frontier_url)


class FrontierHermes(_Frontier, Hermes):
    """Harbor's Hermes command, installed from the pinned commit, configured from our Hermes config."""

    HARNESS = "hermes"
    SRC = "$HOME/.hermes-src"

    async def install(self, environment: BaseEnvironment) -> None:
        pin = fs.PIN["harnesses"]["hermes"]
        await self.ensure_system_dependencies(environment, ("curl", "git", "ripgrep", "xz"))
        await self.exec_as_agent(environment, command=(
            "set -euo pipefail; "
            f"curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/{pin['commit']}/scripts/install.sh "
            f"| bash -s -- --skip-setup --dir {self.SRC} --branch {pin['version']} --commit {pin['commit']} && "
            'export PATH="$HOME/.local/bin:$PATH" && export HERMES_HOME=/tmp/hermes && '
            'mkdir -p "$HERMES_HOME/sessions" "$HERMES_HOME/skills" "$HERMES_HOME/memories" && hermes --version'))
        await self.exec_as_agent(environment, command=(
            "set -euo pipefail; "
            f'uv="$HOME/.hermes/bin/uv"; [ -x "$uv" ] || uv=$(command -v uv); cfg=$(mktemp -d); cd {self.SRC} && '
            f'XDG_CONFIG_HOME="$cfg" XDG_CONFIG_DIRS="$cfg" UV_PROJECT_ENVIRONMENT={self.SRC}/venv "$uv" sync --locked --extra all --extra anthropic && '
            f"{self.SRC}/venv/bin/python -c 'import anthropic; print(anthropic.__version__)'"))

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        want = fs.PIN["harnesses"]["hermes"]["commit"]
        res = await environment.exec(command=f"git -C {self.SRC} rev-parse HEAD")
        got = (res.stdout or "").strip() or None
        self._frontier_checks["hermes_commit"] = got
        if got != want:
            raise RuntimeError(f"HE-FRONTIER-002 the Hermes checkout is at {got}, not the pinned {want}")
        want_sdk = fs.PIN["harnesses"]["hermes"]["anthropic"]["version"]
        res = await environment.exec(command=f"{self.SRC}/venv/bin/python -c 'import anthropic; print(anthropic.__version__)'")
        sdk = (res.stdout or "").strip() or None
        self._frontier_checks["anthropic_sdk"] = sdk
        if sdk != want_sdk:
            raise RuntimeError(f"HE-FRONTIER-002 Hermes's venv has anthropic {sdk}, not the pinned {want_sdk}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        spec = fs.model_spec(self._frontier_model)
        provider = "anthropic" if spec["provider"] == "anthropic" else "openai-api"
        env = {"HERMES_HOME": "/tmp/hermes", "TERMINAL_ENV": "local", "HARBOR_INSTRUCTION": instruction}
        config_yaml = yaml.safe_dump(fs.hermes_config(self._frontier_model), sort_keys=False)
        await self.exec_as_agent(environment, command=f"mkdir -p /tmp/hermes && cat > /tmp/hermes/config.yaml << 'EOF'\n{config_yaml}EOF", env=env, timeout_sec=10)
        try:
            await self.exec_as_agent(environment, env=env, command=(
                'export PATH="$HOME/.local/bin:$PATH" && '
                f'hermes --yolo chat -q "$HARBOR_INSTRUCTION" -Q --model {shlex.quote(spec["name"])} --provider {provider} '
                "2>&1 | stdbuf -oL tee /logs/agent/hermes.txt"))
        finally:
            try:
                await self.exec_as_agent(environment, env={"HERMES_HOME": "/tmp/hermes"}, timeout_sec=30, command=(
                    'export PATH="$HOME/.local/bin:$PATH" && '
                    "(hermes sessions export /logs/agent/hermes-session.jsonl --source oneshot 2>/dev/null; "
                    "[ -s /logs/agent/hermes-session.jsonl ] || hermes sessions export /logs/agent/hermes-session.jsonl --source cli 2>/dev/null) || true"))
            except Exception:
                pass


class FrontierOpenClaw(_Frontier, OpenClaw):
    """Harbor's OpenClaw class on Node 24: OpenClaw 2026.10.6 refuses Node 22 (engines >=24.22.1 <25), which Harbor's
    commands name; every command Harbor runs gets the pinned Node major instead."""

    HARNESS = "openclaw"
    NODE = str(fs.PIN["harnesses"]["openclaw"]["node_major"])

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        command = command.replace("nvm install 22", "nvm install " + self.NODE).replace("nvm use 22", "nvm use " + self.NODE)
        return await super()._exec(environment, command, *args, **kwargs)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await environment.exec(command=". ~/.nvm/nvm.sh >/dev/null && nvm use %s >/dev/null && node -v && openclaw --version" % self.NODE)
        words = (res.stdout or "").split()
        self._frontier_checks.update({"node": words[0] if words else None, "openclaw_version": " ".join(words[1:]) or None})

    def _build_full_openclaw_config(self) -> dict[str, Any]:
        cfg = super()._build_full_openclaw_config()
        self._deep_merge(cfg, fs.openclaw_config(self._frontier_model, self._frontier_url))
        return cfg


class FrontierPi(_Frontier, Pi):
    HARNESS = "pi"

    def _build_custom_models_json(self, access: Any, model_id: str) -> dict[str, Any] | None:
        out = super()._build_custom_models_json(access, model_id)
        if out is None:
            raise RuntimeError("HE-FRONTIER-003 Pi has no custom endpoint: the proxy base URL did not reach it")
        for provider in out["providers"].values():
            for model in provider["models"]:
                model.update(fs.pi_models_entry(self._frontier_model))
        return out


class FrontierMiniSweAgent(_Frontier, MiniSweAgent):
    """Harbor's MiniSweAgent with LiteLLM pinned: Harbor installs the newest litellm, whose Anthropic path imports mcp
    without declaring it (only its mcp and proxy extras do), so the agent retried ModuleNotFoundError until its timeout."""

    HARNESS = "mini-swe-agent"
    LITELLM = str(fs.PIN["harnesses"]["mini-swe-agent"]["litellm"])

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        if "--with litellm " in command:
            command = command.replace("--with litellm ", "--with " + shlex.quote(self.LITELLM) + " ")
        return await super()._exec(environment, command, *args, **kwargs)


CLASSES = {c.HARNESS: c for c in (FrontierClaudeCode, FrontierCodex, FrontierHermes, FrontierOpenClaw, FrontierPi, FrontierMiniSweAgent)}
