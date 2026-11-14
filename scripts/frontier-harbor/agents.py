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

FrontierCursor is the exception: the Cursor CLI calls Cursor's servers with CURSOR_API_KEY and has no proxy route, so it
binds no slot. Its key reaches it from the 0600 file vm-run.sh names in the cursor_key_file kwarg; without one the class
stops at setup with HE-CURSOR-002 before any command runs in the task container. It subclasses Harbor's generic
BaseInstalledAgent, not Harbor's own cursor_cli.CursorCli (scripts/frontier-harbor/README.md, "Cursor").
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shlex
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import yaml

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.installed.claude_code import ClaudeCode
from harbor.agents.installed.codex import Codex
from harbor.agents.installed.hermes import Hermes
from harbor.agents.installed.mini_swe_agent import MiniSweAgent
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.installed.openclaw import OpenClaw
from harbor.agents.installed.pi import Pi
from harbor.agents.options import InstalledAgentOptions
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
        release = gstack is not None and fs.is_gstack_release(gstack)
        if release:
            fs.gstack_arm(self.HARNESS, gstack)
        self._frontier_gstack_release = gstack if release else None
        self._frontier_gstack = None if release else fs.gstack_manifest(gstack, self.HARNESS)
        if self._frontier_gstack and self._frontier_gstack["layout"]:
            kwargs["skills_dir"] = self._frontier_gstack["layout"]["skills_dir"]
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
        self._extra_env.update(fs.container_env(self.HARNESS, self._frontier_model, slot["base_url"], slot["token"], self._frontier_gstack))

    def _write_settings(self) -> None:
        settings = fs.harness_settings(self.HARNESS, self._frontier_model, self._frontier_gstack_release, getattr(self, "_frontier_version", None))
        settings["trial"] = self.frontier_trial
        settings["cell"] = self._frontier_cell
        settings["attempt"] = self._frontier_attempt
        settings["install_checks"] = self._frontier_checks
        if self._frontier_gstack_release is None:
            settings["gstack"] = fs.gstack_settings(self._frontier_gstack)
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
            await self._frontier_gstack_install(environment)
            if self._frontier_gstack_release is not None:
                await self._frontier_install_gstack(environment)
        finally:
            self._write_settings()

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        return None

    async def _frontier_gstack_install(self, environment: BaseEnvironment) -> None:
        """A gstack cell's arm (internal-task): the none arm is checked clean; any other arm gets the built runtime and tree
        uploaded, handed to the agent user, and every file checked against the lock. A failure fails the trial at agent
        setup, so it is recorded as an infra_error (to-trials.ts infra class gstack_contaminated when the none arm's
        container held gstack, else gstack_install_failed), never scored."""
        m = self._frontier_gstack
        if m is None:
            return
        g = self._frontier_checks.setdefault("gstack", {"arm": m["arm"], "spec_sha256": m["spec_sha256"]})
        if m["spec"] == "none":
            res = await environment.exec(command=fs.gstack_absent_script(m))
            g["absent_checked"] = m["absent"]
            found = fs.gstack_absent_found(m, res.return_code, res.stdout)
            g["found"] = found
            if found:
                raise RuntimeError(f"HE-FRONTIER-009 gstack arm none: the no-gstack container has gstack ({found[0]})")
            return
        res = await environment.exec(command='printf %s "$HOME"')
        home = (res.stdout or "").strip()
        g["home"] = home
        if home != m["home"]:
            raise RuntimeError(f"HE-FRONTIER-009 gstack arm {m['arm']}: the agent's HOME is {home or '(empty)'}, the arm was built for {m['home']}")
        for up in m["uploads"]:
            await environment.upload_dir(up["src"], up["dst"])
        await environment.exec(command=fs.gstack_root_script(m, environment.default_user), user="root")
        res = await environment.exec(command=fs.gstack_verify_script(m))
        out = (res.stdout or "").strip()
        g["verify"] = out
        if res.return_code != 0 or not out.startswith("ok "):
            raise RuntimeError(f"HE-FRONTIER-009 gstack arm {m['arm']} (spec {m['spec']}): the container's tree does not match the lock {m['lock']}: {out or res.stderr}")
        g["files_checked"] = len(m["files"])

    def _build_register_skills_command(self) -> str | None:
        cmd = super()._build_register_skills_command()
        m = self._frontier_gstack
        if cmd and m and m["layout"]:
            cmd += " && " + fs.gstack_copy_check(m)
        return cmd

    async def _frontier_install_gstack(self, environment: BaseEnvironment) -> None:
        """The cell's gstack arm: its release tar uploaded, checked and extracted into the agent's home after the harness
        and our settings are in place (scripts/canary/gstack/arm.json says where each host reads it)."""
        arm = fs.gstack_arm(self.HARNESS, self._frontier_gstack_release)
        await environment.upload_file(arm["tar"], self.GSTACK_REMOTE_TAR)
        res = await environment.exec(command=fs.gstack_install_command(self._frontier_gstack_release, self.GSTACK_REMOTE_TAR), user=environment.default_user, timeout_sec=600)
        facts = fs.gstack_install_facts(res.stdout or "")
        want = {"status": "ok", "router": "yes", "skills": len(arm["sidecar"]["skills"]), "version": arm["version"], "head": arm["sha"]}
        self._frontier_checks["gstack"] = {**facts, "expected": want, "matches": all(facts.get(k) == v for k, v in want.items())}
        if not self._frontier_checks["gstack"]["matches"]:
            raise RuntimeError(f"HE-FRONTIER-002 the gstack arm did not install as built: {facts} (expected {want})")


class FrontierClaudeCode(_Frontier, ClaudeCode):
    HARNESS = "claude-code"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        gstack = kwargs.get("gstack")
        kwargs["config"] = fs.claude_settings_merge(gstack if gstack is not None and fs.is_gstack_release(gstack) else None)["settings"]
        self._frontier_version = kwargs.get("version")
        fs.harness_pin(self.HARNESS, self._frontier_version)
        super().__init__(*args, **kwargs)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        want = fs.harness_pin(self.HARNESS, self._frontier_version)["native_binary_sha256"]
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
            if fs.drops_skill_links(self._frontier_gstack_release, self._frontier_gstack):
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
            "set -euo pipefail; for i in 1 2 3; do "
            f"curl -fsSL --retry 6 --retry-delay 20 --retry-max-time 300 https://raw.githubusercontent.com/NousResearch/hermes-agent/{pin['commit']}/scripts/install.sh "
            f"| bash -s -- --skip-setup --dir {self.SRC} --branch {pin['version']} --commit {pin['commit']} && break; "
            '[ "$i" -lt 3 ] || exit 1; sleep 30; done; '
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
        config = fs.hermes_config(self._frontier_model)
        provider = config["model"]["provider"]
        env = {"HERMES_HOME": "/tmp/hermes", "TERMINAL_ENV": "local", "HARBOR_INSTRUCTION": instruction}
        config_yaml = yaml.safe_dump(config, sort_keys=False)
        await self.exec_as_agent(environment, command=f"mkdir -p /tmp/hermes && cat > /tmp/hermes/config.yaml << 'EOF'\n{config_yaml}EOF", env=env, timeout_sec=10)
        skills_command = self._build_register_skills_command()
        if skills_command:
            await self.exec_as_agent(environment, command=skills_command, env=env, timeout_sec=60)
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
    commands name; every command Harbor runs gets the pinned Node major instead. Particle and openrouter-proxy are added to
    Harbor's providers with no variable forwarded for them: the overlay's provider reads the per-trial token from
    OPENAI_API_KEY. On OpenRouter the agent's model is openrouter-proxy/<model>, so Harbor's --model names the overlay's
    provider and not OpenClaw's bundled openrouter provider."""

    HARNESS = "openclaw"
    NODE = str(fs.PIN["harnesses"]["openclaw"]["node_major"])
    _SUPPORTED_PROVIDERS = OpenClaw._SUPPORTED_PROVIDERS | {"particle", "openrouter-proxy"}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if fs.model_spec(self._frontier_model)["provider"] == "openrouter":
            self.model_name = f"{fs.openclaw_provider(self._frontier_model)}/{fs.model_spec(self._frontier_model)['name']}"
            self._init_model_info()

    @classmethod
    def _provider_env_keys(cls, provider: str) -> tuple[str, ...]:
        return () if provider in ("particle", "openrouter-proxy") else super()._provider_env_keys(provider)

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        command = command.replace("nvm install 22", "nvm install " + self.NODE).replace("nvm use 22", "nvm use " + self.NODE)
        return await super()._exec(environment, command, *args, **kwargs)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await environment.exec(command=". ~/.nvm/nvm.sh >/dev/null && nvm use %s >/dev/null && node -v && openclaw --version" % self.NODE)
        words = (res.stdout or "").split()
        self._frontier_checks.update({"node": words[0] if words else None, "openclaw_version": " ".join(words[1:]) or None})

    def _build_full_openclaw_config(self) -> dict[str, Any]:
        cfg = super()._build_full_openclaw_config()
        overlay = fs.openclaw_config(self._frontier_model, self._frontier_url)
        deny = overlay["tools"].pop("deny")
        self._deep_merge(cfg, overlay)
        cfg["tools"]["deny"] += [d for d in deny if d not in cfg["tools"]["deny"]]
        return cfg


class FrontierPi(_Frontier, Pi):
    HARNESS = "pi"

    def build_cli_flags(self) -> str:
        """Harbor's Pi puts these flags right before the instruction, which it passes as an argument. Pi 1.5.0 reads an
        argument that starts with "-" as an unknown option (pytorch-model-recovery's instruction does, and every #337 Pi trial
        of it ended at "Unknown option" with no model request), so "--" ends the options and the instruction stays a message."""
        return (super().build_cli_flags() + " --").strip()

    def _build_custom_models_json(self, access: Any, model_id: str) -> dict[str, Any] | None:
        if fs.model_spec(self._frontier_model)["provider"] in ("particle", "openrouter"):
            return fs.pi_chat_models_json(self._frontier_model, self._frontier_url)
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


class FrontierDsh(_Frontier, BaseInstalledAgent):
    """DeepSeek Harness (dsh). Harbor 0.24.0 ships no dsh class, so this is an installed agent of its own in the style of
    Harbor's Pi: Node 24 through nvm, then dsh from our multi-user lockfile (harnesses/dsh/package.json and
    package-lock.json, sha256 checked against pin.json) with npm ci, so dsh and every plugin its profile names are installed
    at setup and nothing is installed when it runs. The headless profile's patch layer is our multi-user adapter's route and
    base rows (frontier_settings.dsh_profile_patch); setup checks the composed profile (dsh --dump-config) has the web, the
    DeepSeek-hosted and the instruction-file plugins off and records the instruction and skill files on disk. One headless
    turn, the instruction on stdin, newline-delimited events in /logs/agent/dsh.jsonl."""

    HARNESS = "dsh"
    options_model = InstalledAgentOptions
    ROOT = fs.DSH_ROOT
    BIN = f"{fs.DSH_ROOT}/install/node_modules/.bin/dsh"
    NODE = str(fs.PIN["harnesses"]["dsh"]["node_major"])
    PROFILE = f"{fs.DSH_ROOT}/home/profiles/headless/cordis.patch.yml"
    NVM = (f"export DSH_HOME={fs.DSH_ROOT}/home DSH_AGENTS_HOME={fs.DSH_ROOT}/agents DSH_TELEMETRY_MODE=DISABLED && "
           ". ~/.nvm/nvm.sh >/dev/null && nvm use %s >/dev/null && " % fs.PIN["harnesses"]["dsh"]["node_major"])

    @staticmethod
    def name() -> str:
        return "dsh"

    def get_version_command(self) -> str | None:
        return self.NVM + self.BIN + " --version"

    async def install(self, environment: BaseEnvironment) -> None:
        pin = fs.PIN["harnesses"]["dsh"]
        if self._version != pin["version"]:
            raise RuntimeError(f"HE-FRONTIER-002 the job asks for dsh {self._version}, not the pinned {pin['version']}")
        await self.ensure_system_dependencies(environment, ("curl", "ca_certificates"))
        await self.exec_as_agent(environment, command=f"rm -rf {self.ROOT} && mkdir -p {self.ROOT}/install {self.ROOT}/home/profiles/headless {self.ROOT}/agents")
        for key in ("package_json", "package_lock"):
            path = fs.REPO / pin["lockfile"][key]
            text = path.read_text()
            if hashlib.sha256(text.encode()).hexdigest() != pin["lockfile"][key + "_sha256"]:
                raise RuntimeError(f"HE-FRONTIER-002 {pin['lockfile'][key]} is not the sha256 scripts/frontier-harbor/pin.json pins")
            await self._upload_config_text(environment, content=text, remote_path=f"{self.ROOT}/install/{path.name}", filename=path.name)
        await self.exec_as_agent(environment, command=(
            "set -euo pipefail; "
            f"{nvm_node_install_snippet(int(self.NODE))} && cd {self.ROOT}/install && "
            "npm ci --no-audit --no-fund --strict-allow-scripts && npm cache clean --force >/dev/null 2>&1; "
            f'test "$({self.BIN} --version)" = {shlex.quote(pin["version"])}'))

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await environment.exec(command=self.NVM + "node -v && " + self.BIN + " --version")
        words = (res.stdout or "").split()
        self._frontier_checks.update({"node": words[0] if words else None, "dsh_version": words[1] if len(words) > 1 else None})
        if self._frontier_checks["dsh_version"] != fs.PIN["harnesses"]["dsh"]["version"]:
            raise RuntimeError(f"HE-FRONTIER-002 the installed dsh is {self._frontier_checks['dsh_version']}, not the pinned {fs.PIN['harnesses']['dsh']['version']}")
        patch = fs.dsh_profile_patch(self._frontier_model, self._frontier_url)
        await self._upload_config_text(environment, content=patch, remote_path=self.PROFILE, filename="cordis.patch.yml")
        res = await environment.exec(command=f"cp {self.PROFILE} /logs/agent/cordis.patch.yml && {self.NVM}{self.BIN} --profile headless --dump-config | tee /logs/agent/dsh-config.yml")
        dump = fs.dsh_dump_checks(res.stdout or "")
        self._frontier_checks["dsh_config"] = dump
        if res.return_code != 0 or not dump["all_off"] or dump["telemetry_mode"] != "DISABLED" or dump["default_provider"] != "he-" + fs.model_spec(self._frontier_model)["provider"]:
            raise RuntimeError("HE-FRONTIER-002 dsh --profile headless --dump-config did not compose the profile with the web, DeepSeek-hosted and instruction-file plugins off on the proxy route (install_checks.dsh_config)")
        res = await environment.exec(command=(
            f"export DSH_HOME={fs.DSH_ROOT}/home DSH_AGENTS_HOME={fs.DSH_ROOT}/agents; "
            'cwd=$(pwd); root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$cwd"); case "$cwd" in "$root"*) ;; *) root=$cwd ;; esac; '
            'echo "cwd $cwd"; echo "root $root"; d=$cwd; while :; do '
            'for f in AGENTS.md CLAUDE.md AGENTS.local.md CLAUDE.local.md; do [ -e "$d/$f" ] && echo "file $d/$f"; done; '
            '[ "$d" = "$root" ] || [ "$d" = / ] && break; d=$(dirname "$d"); done; '
            'for f in "$DSH_HOME/AGENTS.md" "$DSH_AGENTS_HOME/AGENTS.md"; do [ -e "$f" ] && echo "file $f"; done; '
            'for s in "$root/.dsh/skills" "$root/.agents/skills" "$DSH_HOME/skills" "$DSH_AGENTS_HOME/skills"; do [ -d "$s" ] && echo "skills $s"; done; true'))
        lines = [ln.split(" ", 1) for ln in (res.stdout or "").splitlines() if " " in ln]
        self._frontier_checks["instruction_files"] = {
            "cwd": next((v for k, v in lines if k == "cwd"), None), "project_root": next((v for k, v in lines if k == "root"), None),
            "on_disk": [v for k, v in lines if k == "file"], "skill_dirs": [v for k, v in lines if k == "skills"],
            "agent_instructions_plugin": "disabled" if dump["off"]["agent-instructions"] else "on",
            "auto_loaded": [],
        }

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        pin = fs.PIN["harnesses"]["dsh"]
        await self._upload_config_text(environment, content=self.render_instruction(instruction), remote_path=f"{self.ROOT}/instruction.md", filename="instruction.md")
        await self.exec_as_agent(environment, command=(
            f"{self.NVM}{self.BIN} --profile headless --json --permission-mode {pin['permission_mode']} --approval-policy {pin['approval_policy']} - "
            f"< {self.ROOT}/instruction.md 2> /logs/agent/dsh.stderr.log | stdbuf -oL tee /logs/agent/dsh.jsonl"))

    def populate_context_post_run(self, context: AgentContext) -> None:
        events = Path(self.logs_dir) / "dsh.jsonl"
        if not events.exists():
            return
        usage = []
        for line in events.read_text().splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(e, dict) and e.get("type") == "status" and e.get("phase") == "step_end" and isinstance(e.get("usage"), dict):
                usage.append(e["usage"])
        n = lambda u, k: u.get(k) if isinstance(u.get(k), int) else 0
        context.n_input_tokens = sum(n(u, "inputTokens") + n(u, "cacheReadTokens") + n(u, "cacheWriteTokens") for u in usage)
        context.n_cache_tokens = sum(n(u, "cacheReadTokens") for u in usage)
        context.n_output_tokens = sum(n(u, "outputTokens") for u in usage)


class FrontierCursor(_Frontier, BaseInstalledAgent):
    """The Cursor CLI (harnesses/cursor, clean-room) as a Harbor installed agent: the pinned package installed in the task
    container, our cli-config.json, documented tool hooks, one headless turn, the stream-json parsed on the host.

    Every flag, file and record name comes from harnesses/cursor (Cursor's public docs, the CLI's --help and --version,
    and what the CLI did at run time with no key), rendered by frontier_settings.py. Nothing comes from the CLI's
    JavaScript or from Harbor's cursor_cli.py."""

    HARNESS = "cursor"
    KWARGS = ("broker_url", "cell", "attempt", "cursor_key_file")
    HOOK = Path(__file__).resolve().parent / "cursor-tool-hook.sh"

    def __init__(self, *args: Any, cursor_key_file: str | None = None, **kwargs: Any) -> None:
        self._cursor_key_file = cursor_key_file
        super().__init__(*args, **kwargs)

    @staticmethod
    def name() -> str:
        return "frontier-cursor"

    async def _frontier_bind(self) -> None:
        key = Path(self._cursor_key_file) if self._cursor_key_file else None
        present = bool(key and key.is_file() and key.stat().st_size > 0)
        self._frontier_checks["cursor_api_key"] = "present" if present else "absent"
        if not present:
            self._frontier_checks["stopped_before"] = "install: no command ran in the task container, so nothing reached Cursor"
            self._write_settings()
            raise RuntimeError("HE-CURSOR-002 no CURSOR_API_KEY: vm-run.sh passes a Cursor cell its key file only when CURSOR_API_KEY is set in its shell and the run is not --fake-upstream; this Cursor trial stopped at setup, before any command ran in the task container")

    async def install(self, environment: BaseEnvironment) -> None:
        await self.ensure_system_dependencies(environment, ("curl",))
        await self.exec_as_root(environment, command=fs.cursor_install_command())

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await environment.exec(command=f'h=$(mktemp -d); HOME="$h" {fs.CURSOR_BIN} --version; rm -rf "$h"')
        got = (res.stdout or "").strip() or None
        self._frontier_checks.update({"cursor_version": got, "cursor_package_sha256_checked": True})
        if got != fs.CURSOR_PIN["version"]:
            raise RuntimeError(f"HE-FRONTIER-002 agent --version printed {got}, not the pinned {fs.CURSOR_PIN['version']}")

    async def _put(self, environment: BaseEnvironment, path: str, content: str | None = None, source: str | None = None, mode: str = "600") -> None:
        if content is not None:
            with tempfile.TemporaryDirectory(prefix="frontier-cursor-") as tmp:
                local = Path(tmp) / Path(path).name
                local.write_text(content)
                await environment.upload_file(local, path)
        else:
            await environment.upload_file(source, path)
        owner = f"chown {shlex.quote(str(environment.default_user))} {shlex.quote(path)} && " if getattr(environment, "default_user", None) is not None else ""
        await self.exec_as_root(environment, command=f"{owner}chmod {mode} {shlex.quote(path)}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        d, home = fs.CURSOR_RUN_DIR, fs.CURSOR_RUN_DIR + "/home"
        owner = f"chown -R {shlex.quote(str(environment.default_user))} {d} && " if getattr(environment, "default_user", None) is not None else ""
        await self.exec_as_root(environment, command=f"mkdir -p {d}/home {d}/tmp && {owner}chmod 700 {d}")
        await self.exec_as_agent(environment, command=fs.cursor_preflight_command())
        await self.exec_as_agent(environment, command=f"mkdir -p {home}/.cursor")
        await self._put(environment, f"{home}/.cursor/cli-config.json", content=json.dumps(fs.cursor_cli_config(), indent=2) + "\n")
        await self._put(environment, f"{d}/tool-hook.sh", source=str(self.HOOK), mode="700")
        hooks = fs.cursor_hooks(f"{d}/tool-hook.sh", f"{fs.CURSOR_LOG_DIR}/{fs.CURSOR_HOOK_LOG}")
        await self._put(environment, f"{home}/.cursor/hooks.json", content=json.dumps(hooks, indent=2) + "\n")
        await self._put(environment, f"{d}/key", source=self._cursor_key_file)
        started = datetime.now(timezone.utc)
        code: int | None = None
        try:
            await self.exec_as_agent(environment, env={"HARBOR_INSTRUCTION": instruction}, command=fs.cursor_run_command(self._frontier_model))
            code = 0
        except Exception as e:
            code = self._exit_code_of(e)
            raise
        finally:
            ended = datetime.now(timezone.utc)
            status = self._status(code, started, ended)
            if status["model_ok"] is False and code == 0:
                raise RuntimeError(f"HE-CURSOR-001 the stream-json init record names model {status['init_model']!r}, not {status['init_model_expected']!r} (harnesses/cursor/pin.json model_cursor.init_model_name)")

    @staticmethod
    def _exit_code_of(e: Exception) -> int | None:
        text = str(e)
        if text.startswith("Command failed (exit "):
            try:
                return int(text[len("Command failed (exit "):].split(")", 1)[0])
            except ValueError:
                return None
        return None

    def _status(self, code: int | None, started: datetime, ended: datetime) -> dict[str, Any]:
        logs = Path(self.logs_dir)
        read = lambda name: (logs / name).read_text(errors="replace") if (logs / name).exists() else ""
        status = fs.cursor_status(read(fs.CURSOR_STREAM), read(fs.CURSOR_STDERR), code, self._frontier_model)
        hooks = [l for l in read(fs.CURSOR_HOOK_LOG).splitlines() if l.strip()]
        found = [l.split(" ", 1) for l in read(fs.CURSOR_INSTRUCTION_FILES).splitlines() if " " in l]
        status.update({
            "agent_started_at": started.isoformat().replace("+00:00", "Z"), "agent_ended_at": ended.isoformat().replace("+00:00", "Z"),
            "hook_lines": len(hooks), "instruction_files": {"workdir": [p for w, p in found if w == "workdir"], "home": [p for w, p in found if w == "home"]},
        })
        logs.mkdir(parents=True, exist_ok=True)
        (logs / fs.CURSOR_STATUS).write_text(json.dumps(status, indent=2) + "\n")
        return status


CLASSES = {c.HARNESS: c for c in (FrontierClaudeCode, FrontierCodex, FrontierHermes, FrontierOpenClaw, FrontierPi, FrontierMiniSweAgent, FrontierDsh, FrontierCursor)}
