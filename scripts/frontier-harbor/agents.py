"""Harbor 0.24.0 installed-agent classes for the frontier Harbor path (internal-task plan, Implementation step 2).

Claude Code, Codex, Hermes and OpenClaw wrap our own pinned adapter settings; Pi and mini-swe-agent are Harbor's stock
classes with overrides; Gemini CLI and Grok Build are Harbor's stock classes with our overlays, on the proxy's google and xai
routes; Muse Code is Harbor's stock class on the proxy's OpenRouter route, with the pinned binary installed in place of
Meta's self-updating launcher. frontier_settings.py renders every value; this file only plugs them into Harbor.

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
import contextlib
import hashlib
import json
import os
import re
import secrets
import shlex
import shutil
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

import yaml

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.installed.claude_code import ClaudeCode
from harbor.agents.installed.codex import Codex
from harbor.agents.installed.gemini_cli import GeminiCli
from harbor.agents.installed.grok_build import GrokBuild
from harbor.agents.installed.hermes import Hermes
from harbor.agents.installed.mini_swe_agent import MiniSweAgent
from harbor.agents.installed.muse_code import MuseCode
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.installed.openclaw import OpenClaw
from harbor.agents.installed.pi import Pi
from harbor.agents.options import InstalledAgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

import delivery as dl
import frontier_settings as fs
import qm_harbor as qm


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
    """Mixin: per-trial slot from the broker, the rendered environment, harness_settings.json, no host environment.

    The kwarg delivery (delivery.py, internal-task) sets the cell's delivery arm; without it nothing here changes. With it the
    arm's files and commands run at the end of setup, its health checks run at setup or right before the agent starts
    (LAUNCH, a substring of the class's agent command), and a failed check stops the trial before the agent starts."""

    HARNESS = ""
    LAUNCH = ""
    KWARGS = ("broker_url", "cell", "attempt", "gstack", "delivery")
    GSTACK_REMOTE_TAR = "/tmp/gstack-arm.tar.gz"

    @classmethod
    def parse_options(cls, kwargs: Mapping[str, Any] | None = None, env: Mapping[str, str] | None = None) -> Any:
        return super().parse_options({k: v for k, v in (kwargs or {}).items() if k not in cls.KWARGS}, env)

    def __init__(self, *args: Any, broker_url: str | None = None, cell: str | None = None, attempt: int | None = None, gstack: dict[str, Any] | None = None, delivery: dict[str, Any] | None = None, **kwargs: Any) -> None:
        model = cell_model(kwargs.get("model_name"))
        kwargs.update(fs.harbor_kwargs(self.HARNESS, model))
        release = gstack is not None and fs.is_gstack_release(gstack)
        if release:
            fs.gstack_arm(self.HARNESS, gstack)
        self._frontier_gstack_release = gstack if release else None
        self._frontier_gstack = None if release else fs.gstack_manifest(gstack, self.HARNESS)
        if self._frontier_gstack and self._frontier_gstack["layout"]:
            kwargs["skills_dir"] = self._frontier_gstack["layout"]["skills_dir"]
        self._frontier_delivery = dl.resolve(self.HARNESS, delivery) if delivery is not None else None
        if self._frontier_delivery is not None:
            kwargs.update(dl.harbor_kwargs(self.HARNESS, self._frontier_delivery))
            if self.HARNESS == "claude-code":
                kwargs["config"] = dl.claude_settings(kwargs["config"], self._frontier_delivery)
        self._frontier_kind: str | None = None
        self._frontier_launched = False
        self._frontier_delivery_record: dict[str, Any] = {}
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
        if self._frontier_delivery is not None:
            settings["delivery"] = self._frontier_delivery_record
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
            if self._frontier_delivery is not None:
                await self._frontier_deliver(environment)
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

    async def _frontier_sh(self, environment: BaseEnvironment, command: str, code: str, what: str) -> str:
        try:
            res = await self.exec_as_agent(environment, command=command)
        except Exception as e:
            raise dl.DeliveryRefused(code, f"{what} failed: {str(e)[-400:]}") from None
        return (res.stdout or "").strip()

    async def _frontier_gstack_probe(self, environment: BaseEnvironment, when: str) -> list[str]:
        found = sorted(set((await self._frontier_sh(environment, dl.gstack_probe(), "HE-DELIVERY-006", "the gstack probe")).split()))
        self._frontier_delivery_record["gstack_found_" + when] = found
        if found and self._frontier_delivery["arm"] != "skill":
            raise dl.DeliveryRefused("HE-DELIVERY-006", f"a {self._frontier_delivery['arm']} arm found gstack in the task container {when}: {found[:5]}")
        return found

    async def _frontier_health(self, environment: BaseEnvironment, checks: list[dict[str, str]]) -> None:
        for check in checks:
            got = await self._frontier_sh(environment, check["command"], "HE-DELIVERY-005", check["name"])
            ok = got == check["expect"] or got.splitlines()[-1:] == [check["expect"]]
            self._frontier_delivery_record.setdefault("health", []).append({"name": check["name"], "when": check["when"], "ok": ok, "got": got[-300:]})
            if not ok:
                raise dl.DeliveryRefused("HE-DELIVERY-005", f"{self.HARNESS} {self._frontier_delivery['arm']}: {check['name']}: got {got[-300:]!r}, want {check['expect']!r}; the route is not loaded and healthy, so the trial stops before the agent starts")

    async def _frontier_deliver(self, environment: BaseEnvironment) -> None:
        """The arm at the end of setup: the clean-arm probe, its files and commands, the setup-time health checks, the
        /work tree hash."""
        kind = dl.kind_of(self._frontier_delivery, self.frontier_trial)
        self._frontier_kind = kind
        plan = dl.plan(self.HARNESS, self._frontier_delivery, kind)
        self._frontier_delivery_record = {**plan["record"], "files": [{k: f[k] for k in ("path", "mode", "sha256", "bytes")} for f in plan["files"]]}
        await self._frontier_gstack_probe(environment, "before")
        for f in plan["files"]:
            await self._frontier_sh(environment, f["command"], "HE-DELIVERY-002", "writing " + f["path"])
        if self._frontier_delivery["arm"] == "skill":
            await self.ensure_system_dependencies(environment, ("curl", "git"))
            await self.exec_as_root(environment, command="command -v unzip >/dev/null || { apt-get update -qq && apt-get install -y -qq unzip >/dev/null; }")
        for i, command in enumerate(plan["commands"]):
            out = await self._frontier_sh(environment, command, "HE-DELIVERY-006" if self._frontier_delivery["arm"] == "skill" else "HE-DELIVERY-005", f"arm command {i + 1}")
            self._frontier_delivery_record.setdefault("command_output", []).append(out[-300:])
        if self._frontier_delivery["arm"] == "skill":
            found = await self._frontier_gstack_probe(environment, "after_install")
            for name in ("review", "ship"):
                if not any(p.endswith("/" + name + "/SKILL.md") for p in found):
                    raise dl.DeliveryRefused("HE-DELIVERY-006", f"gstack's {name} skill is not installed for {self.HARNESS} after setup")
            self._extra_env.update(plan["env"])
        await self._frontier_health(environment, [c for c in plan["health"] if c["when"] == "setup"])
        self._frontier_delivery_record["launch_health"] = [c for c in plan["health"] if c["when"] == "launch"]
        self._frontier_delivery_record["work_tree_sha256_setup"] = await self._frontier_sh(environment, dl.WORK_HASH, "HE-DELIVERY-005", "hashing /work")

    async def _frontier_at_launch(self, environment: BaseEnvironment) -> None:
        """Right before the agent command: the launch-time health checks, the /work tree hash at agent start, and the
        clean-arm probe again (Harbor's own run() steps have run by now)."""
        self._frontier_launched = True
        try:
            await self._frontier_health(environment, self._frontier_delivery_record.pop("launch_health", []))
            await self._frontier_gstack_probe(environment, "at_launch")
            self._frontier_delivery_record["work_tree_sha256_at_launch"] = await self._frontier_sh(environment, dl.WORK_HASH, "HE-DELIVERY-005", "hashing /work")
        finally:
            self._write_settings()

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        if self._frontier_delivery is not None and not self._frontier_launched and self.LAUNCH and self.LAUNCH in command:
            await self._frontier_at_launch(environment)
        return await super()._exec(environment, command, *args, **kwargs)

    def _frontier_instruction(self, instruction: str) -> str:
        if self._frontier_delivery is None:
            return instruction
        out = dl.instruction(self.HARNESS, self._frontier_delivery, self._frontier_kind, instruction)
        self._frontier_delivery_record["instruction"] = {"told": out != instruction, "sha256": dl.sha256(out.encode()), "task_sha256": dl.sha256(instruction.encode())}
        return out

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        return await super().run(self._frontier_instruction(instruction), environment, context)


class FrontierClaudeCode(_Frontier, ClaudeCode):
    HARNESS = "claude-code"
    LAUNCH = "claude --verbose --output-format=stream-json"

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
            skill_arm = self._frontier_delivery is not None and self._frontier_delivery["arm"] == "skill"
            if skill_arm or fs.drops_skill_links(self._frontier_gstack_release, self._frontier_gstack):
                try:
                    res = await environment.exec(command=fs.drop_skill_links_command(), timeout_sec=60)
                    words = (res.stdout or "").split()
                    self._frontier_checks["skill_links_dropped"] = int(words[-1]) if words[-2:-1] == ["SKILL_LINKS_DROPPED"] and words[-1].isdigit() else None
                finally:
                    self._write_settings()


class FrontierCodex(_Frontier, Codex):
    HARNESS = "codex"
    LAUNCH = "codex exec "

    def _build_effective_config(self, openai_base_url: str | None = None) -> dict[str, Any]:
        return fs.codex_config(self._frontier_model, self._frontier_url)


class FrontierHermes(_Frontier, Hermes):
    """Harbor's Hermes command, installed from the pinned commit, configured from our Hermes config. On an OpenRouter cell
    it also writes the he-openrouter-effort plugin (frontier_settings.hermes_openrouter_plugin_files, each file checked
    against pin.json's sha256) under $HERMES_HOME/plugins, which the config enables (amendment 1 of frontier-shootout-2026-11)."""

    HARNESS = "hermes"
    SRC = "$HOME/.hermes-src"

    async def install(self, environment: BaseEnvironment) -> None:
        pin = fs.PIN["harnesses"]["hermes"]
        await self.ensure_system_dependencies(environment, ("curl", "git", "ripgrep", "xz"))
        await self.exec_as_agent(environment, command=(
            'set -euo pipefail; export HERMES_HOME=/tmp/hermes; mkdir -p "$HERMES_HOME"; for i in 1 2 3; do '
            f"curl -fsSL --retry 6 --retry-delay 20 --retry-max-time 300 https://raw.githubusercontent.com/NousResearch/hermes-agent/{pin['commit']}/scripts/install.sh "
            f"| bash -s -- --skip-setup --dir {self.SRC} --commit {pin['commit']} && break; "
            '[ "$i" -lt 3 ] || exit 1; sleep 30; done; '
            'export PATH="$HOME/.local/bin:$PATH" && '
            'mkdir -p "$HERMES_HOME/sessions" "$HERMES_HOME/skills" "$HERMES_HOME/memories" && hermes --version'))
        await self.exec_as_agent(environment, command=(
            'set -euo pipefail; export PATH="$HOME/.local/bin:$PATH" HERMES_HOME=/tmp/hermes; hermes pm install --extra anthropic'))

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        want = fs.PIN["harnesses"]["hermes"]["commit"]
        res = await environment.exec(command=f"git -C {self.SRC} rev-parse HEAD")
        got = (res.stdout or "").strip() or None
        self._frontier_checks["hermes_commit"] = got
        if got != want:
            raise RuntimeError(f"HE-FRONTIER-002 the Hermes checkout is at {got}, not the pinned {want}")
        want_sdk = fs.PIN["harnesses"]["hermes"]["anthropic"]["version"]
        res = await environment.exec(command=(
            'export HERMES_HOME=/tmp/hermes; py=$(ls -d "$HERMES_HOME"/tools/python-*/bin/python3 | head -1); '
            f'venv=$("$py" -I -c "import sys; sys.path.insert(0, \'{self.SRC}\'); from pathlib import Path; '
            f'from pm.environments import committed_venv; print(committed_venv(Path(\'{self.SRC}\')))") && '
            '"$venv/bin/python" -c "import anthropic; print(anthropic.__version__)"'))
        sdk = (res.stdout or "").strip() or None
        self._frontier_checks["anthropic_sdk"] = sdk
        if sdk != want_sdk:
            raise RuntimeError(f"HE-FRONTIER-002 Hermes's committed environment has anthropic {sdk}, not the pinned {want_sdk}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        spec = fs.model_spec(self._frontier_model)
        instruction = self._frontier_instruction(instruction)
        config = dl.hermes_config(fs.hermes_config(self._frontier_model), self._frontier_delivery)
        provider = config["model"]["provider"]
        env = {"HERMES_HOME": "/tmp/hermes", "TERMINAL_ENV": "local", "HARBOR_INSTRUCTION": instruction}
        config_yaml = yaml.safe_dump(config, sort_keys=False)
        await self.exec_as_agent(environment, command=f"mkdir -p /tmp/hermes && cat > /tmp/hermes/config.yaml << 'EOF'\n{config_yaml}EOF", env=env, timeout_sec=10)
        for f in fs.hermes_openrouter_plugin_files(self._frontier_model):
            await self.exec_as_agent(environment, command=dl._write("/tmp/hermes/" + f["path"], f["content"].encode(), "0644"), env=env, timeout_sec=10)
        skills_command = self._build_register_skills_command()
        if skills_command:
            await self.exec_as_agent(environment, command=skills_command, env=env, timeout_sec=60)
        if self._frontier_delivery is not None:
            await self._frontier_at_launch(environment)
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
            if self._frontier_delivery is not None:
                await self._frontier_tirith(environment)

    async def _frontier_tirith(self, environment: BaseEnvironment) -> None:
        """Tirith would-flag counts (d10), descriptive: Hermes's own scanner over the session's terminal commands."""
        script = (dl.ASSETS / "tirith-would-flag.py").read_bytes()
        try:
            await self.exec_as_agent(environment, env={"HERMES_HOME": "/tmp/hermes"}, timeout_sec=120, command=(
                dl._write(dl.ROOT + "/tirith-would-flag.py", script, "0644") + f" && cd {self.SRC} && "
                f"{self.SRC}/venv/bin/python {dl.ROOT}/tirith-would-flag.py /logs/agent/hermes-session.jsonl /logs/agent/tirith-would-flag.json"))
            res = await environment.exec(command="cat /logs/agent/tirith-would-flag.json")
            self._frontier_delivery_record["tirith"] = json.loads(res.stdout or "{}")
        except Exception as e:
            self._frontier_delivery_record["tirith"] = {"readable": False, "reason": str(e)[-300:]}
        self._write_settings()


class FrontierOpenClaw(_Frontier, OpenClaw):
    """Harbor's OpenClaw class on Node 24: OpenClaw 2026.10.6 refuses Node 22 (engines >=24.22.1 <25), which Harbor's
    commands name; every command Harbor runs gets the pinned Node major instead. Particle and openrouter are added to
    Harbor's providers with no variable forwarded for them: the overlay's particle provider reads the per-trial token from
    OPENAI_API_KEY, and the openrouter one from OPENROUTER_API_KEY, which container_env sets to the token. xai is added with
    Harbor's own convention (XAI_API_KEY and XAI_BASE_URL forwarded), and the overlay's xai provider reads XAI_API_KEY. On
    OpenRouter the agent's model is openrouter/<model>, OpenClaw's bundled openrouter provider with its base URL at the
    proxy's OpenRouter route (amendment 1 of frontier-shootout-2026-11). On Gemini it is google/<model>, OpenClaw's bundled
    google provider with its baseUrl at the proxy's google route, reading GEMINI_API_KEY, which container_env sets to the
    token; Harbor forwards no variable for it (amendment 2)."""

    HARNESS = "openclaw"
    LAUNCH = "openclaw agent --local"
    NODE = str(fs.PIN["harnesses"]["openclaw"]["node_major"])
    _SUPPORTED_PROVIDERS = OpenClaw._SUPPORTED_PROVIDERS | {"particle", "openrouter", "google", "xai"}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if fs.model_spec(self._frontier_model)["provider"] == "openrouter":
            self.model_name = f"{fs.openclaw_provider(self._frontier_model)}/{fs.model_spec(self._frontier_model)['name']}"
            self._init_model_info()

    @classmethod
    def _provider_env_keys(cls, provider: str) -> tuple[str, ...]:
        return () if provider in ("particle", "openrouter", "google") else super()._provider_env_keys(provider)

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
        if self._frontier_delivery is not None:
            self._deep_merge(cfg, dl.openclaw_config(self._frontier_delivery))
        return cfg


class FrontierPi(_Frontier, Pi):
    """Harbor's Pi installs Node by piping nvm's install script from raw.githubusercontent.com. The SWE-rebench source's
    blocklist refuses *.githubusercontent.com (pin-swe-rebench-07-2026.json egress.why), so every fresh-set Pi trial ended
    at setup with no model request (HE-FRONTIER-006, s05 on 2026-11-19). In a task source environment the same nvm v0.40.2
    files, vendored under vendor/nvm-v0.40.2 and checked against NVM_SHA256, are copied into ~/.nvm instead, and the rest of
    Harbor's install runs unchanged (Node from nodejs.org and Pi from the npm registry, neither refused). Terminal-Bench
    cells keep Harbor's install as it is."""

    HARNESS = "pi"
    LAUNCH = "pi --print --mode json"
    NVM_CURL = "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | env -u NODE_VERSION bash"
    NVM_VENDOR = fs.HERE / "vendor" / "nvm-v0.40.2"
    NVM_REMOTE = "/tmp/frontier-nvm"
    NVM_SHA256 = {
        "nvm.sh": "9290aec6cc2efc89273e16a77214eb37303caaff8c943102de5116fdef47ba86",
        "nvm-exec": "e6b7a2bafac6994e1ba14282cff82c75476fba0788f68a9ecf558dfdf3331621",
    }

    async def install(self, environment: BaseEnvironment) -> None:
        from egress import SourceBlocklistDockerEnvironment

        self._frontier_nvm_staged = isinstance(environment, SourceBlocklistDockerEnvironment)
        if self._frontier_nvm_staged:
            self._frontier_checks["nvm"] = "vendored v0.40.2"
            for name, sha in self.NVM_SHA256.items():
                if hashlib.sha256((self.NVM_VENDOR / name).read_bytes()).hexdigest() != sha:
                    raise RuntimeError(f"HE-FRONTIER-002 vendor/nvm-v0.40.2/{name} is not the sha256 FrontierPi pins")
            await environment.upload_dir(self.NVM_VENDOR, self.NVM_REMOTE)
        await super().install(environment)

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        if getattr(self, "_frontier_nvm_staged", False) and self.NVM_CURL in command:
            command = command.replace(self.NVM_CURL, (
                f'mkdir -p "$HOME/.nvm" && cp {self.NVM_REMOTE}/nvm.sh {self.NVM_REMOTE}/nvm-exec "$HOME/.nvm/" && '
                'chmod 755 "$HOME/.nvm/nvm-exec"'))
        return await super()._exec(environment, command, *args, **kwargs)

    def build_cli_flags(self) -> str:
        """Harbor's Pi puts these flags right before the instruction, which it passes as an argument. Pi 1.5.0 reads an
        argument that starts with "-" as an unknown option (pytorch-model-recovery's instruction does, and every #337 Pi trial
        of it ended at "Unknown option" with no model request), so "--" ends the options and the instruction stays a message."""
        return (super().build_cli_flags() + " --").strip()

    def _build_custom_models_json(self, access: Any, model_id: str) -> dict[str, Any] | None:
        if fs.model_spec(self._frontier_model)["provider"] in ("particle", "openrouter", "google", "xai"):
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


class FrontierGeminiCli(_Frontier, GeminiCli):
    """Harbor's GeminiCli on the proxy's google route, which reaches Google's Gemini API directly (through OpenRouter only on
    the named fallback, vm-run.sh --gemini-cli-route openrouter-fallback).
    Harbor writes settings.json at run time; our overlay (frontier_settings.gemini_cli_settings) is merged into it."""

    HARNESS = "gemini-cli"
    LAUNCH = "gemini --yolo"

    def _build_settings_config(self, model: str | None = None, auth_type: str | None = None) -> tuple[dict[str, Any] | None, str | None]:
        config, alias = super()._build_settings_config(model, auth_type)
        return self._frontier_merge(config or {}, fs.gemini_cli_settings(self._frontier_model)), alias

    @staticmethod
    def _frontier_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
        for k, v in overlay.items():
            base[k] = FrontierGeminiCli._frontier_merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
        return base


class FrontierGrokBuild(_Frontier, GrokBuild):
    """Harbor's GrokBuild on the proxy's xai route: the bound slot's URL goes into the grok_config overlay Harbor merges into
    ~/.grok/config.toml (frontier_settings.grok_config), and the installed binary must hash to pin.json's sha256."""

    HARNESS = "grok-build"
    LAUNCH = "grok --no-auto-update"

    async def _frontier_bind(self) -> None:
        await super()._frontier_bind()
        self.options.grok_config = fs.grok_config(self._frontier_model, self._frontier_url)

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await self.exec_as_agent(environment, command=fs.binary_check_command(fs.GROK_BIN))
        self._frontier_checks["binary"] = fs.binary_check(self.HARNESS, getattr(res, "stdout", None), getattr(self, "_version", None))


class FrontierMuseCode(_Frontier, MuseCode):
    """Harbor's MuseCode on the proxy's OpenRouter route, on OpenRouter's Responses API: Harbor's settings.json gets our
    overlay with the bound slot's URL (frontier_settings.muse_settings), the model id it sends is OpenRouter's, and the
    pinned binary is downloaded in place of Meta's launcher and must hash to pin.json's sha256 (Harbor's own install
    fetches the newest stable release and refuses a version pin)."""

    HARNESS = "muse-code"
    LAUNCH = "muse exec"

    async def install(self, environment: BaseEnvironment) -> None:
        await self.ensure_system_dependencies(environment, ("curl", "bash", "ca_certificates", "coreutils"))
        await self.exec_as_agent(environment, command=fs.muse_install_command(getattr(self, "_version", None)))

    def _model_slug(self) -> str | None:
        return fs.model_spec(self._frontier_model)["name"]

    def _build_effective_config(self) -> dict[str, Any]:
        config = super()._build_effective_config()
        if not self._frontier_url:
            return config
        return FrontierGeminiCli._frontier_merge(config, fs.muse_settings(self._frontier_model, self._frontier_url))

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await self.exec_as_agent(environment, command=fs.binary_check_command(fs.MUSE_BIN))
        self._frontier_checks["binary"] = fs.binary_check(self.HARNESS, getattr(res, "stdout", None), getattr(self, "_version", None))


class FrontierQm(_Frontier, BaseInstalledAgent):
    """QM (yc-software/qm at the pin harnesses/qm/pin.json names) as a Harbor installed agent (internal-task). QM is a service:
    Postgres and QM core run as two containers on the VM in the task container's network namespace, and QM's own exec
    daemon runs in the task container, so every command QM runs lands there (qm_harbor.py says how). Setup checks the
    images and the daemon's sha256, starts the daemon, Postgres and core, sets the org runtime (the cell model at effort
    high), an empty command policy and, on OpenRouter, the custom provider, then creates QM's sandbox and makes it the
    default, which provisions it in the task container. The turn is one DM to core; the reply is /logs/agent/qm-turn.json.
    Core's containers are removed and the daemon stopped after the turn, or at a failed setup.

    The per-trial token goes to core alone, in a 0600 docker env file deleted once core starts: container_env gives the
    task container nothing, so no QM credential is in it."""

    HARNESS = "qm"
    options_model = InstalledAgentOptions
    QM_COMMIT = qm.COMMIT
    QM_DAEMON_SHA256 = qm.pin()["daemon_sha256"]

    @staticmethod
    def name() -> str:
        return "frontier-qm"

    def get_version_command(self) -> str | None:
        return None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._qm_slot: dict[str, str] = {}
        self._qm_names: list[str] = []
        self._qm_core = ""
        self._qm_dir: Path | None = None
        self._qm_secrets: list[str] = []
        super().__init__(*args, **kwargs)

    @property
    def _qm_jobs_dir(self) -> str:
        return str(Path(self.logs_dir).absolute().parents[2])

    async def setup(self, environment: BaseEnvironment) -> None:
        try:
            await super().setup(environment)
        except BaseException:
            await self._qm_stop(environment)
            raise

    def _write_settings(self) -> None:
        super()._write_settings()
        if self.QM_COMMIT == qm.COMMIT:
            return
        path = Path(self.logs_dir) / "harness_settings.json"
        settings = json.loads(path.read_text())
        settings["qm"].update(commit=self.QM_COMMIT, image=qm.images(self.QM_COMMIT)[0], daemon_sha256=self.QM_DAEMON_SHA256)
        settings["differences_from_pin"].append(f"QM at {self.QM_COMMIT}, set by {type(self).__name__}.QM_COMMIT, not pin.json's {qm.COMMIT}")
        path.write_text(json.dumps(settings, indent=2) + "\n")

    async def _frontier_bind(self) -> None:
        if not self._frontier_broker:
            raise RuntimeError("HE-FRONTIER-003 no broker_url: the frontier agent classes run only under scripts/frontier-harbor/vm-run.sh")
        job = Path(self.logs_dir).parent.parent.name
        slot = await asyncio.to_thread(bind_slot, self._frontier_broker, self.frontier_trial, self.HARNESS, self._frontier_model, self._frontier_cell, self._frontier_attempt, job)
        self._frontier_url = slot["base_url"]
        self._qm_slot = slot
        self._qm_secrets = [slot["token"]]
        self._extra_env.update(fs.container_env(self.HARNESS, self._frontier_model, slot["base_url"], slot["token"]))

    @staticmethod
    async def _docker(*args: str, stdin: bytes | None = None, timeout: float = 300, env: Mapping[str, str] | None = None) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec("docker", *args, stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                    env={**os.environ, **env} if env else None)
        try:
            out, err = await asyncio.wait_for(proc.communicate(stdin), timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return 124, "", f"docker {args[0]} timed out after {timeout:.0f}s"
        except asyncio.CancelledError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
            raise
        return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")

    async def _qm_call(self, *args: str, body: Any = None, timeout: float = 300) -> dict[str, Any]:
        data = (body if isinstance(body, str) else json.dumps(body)).encode() if body is not None else b""
        code, out, err = await self._docker("exec", "-i", self._qm_core, "node", f"{qm.MOUNT}/qm-call.mjs", *args, stdin=data, timeout=timeout)
        try:
            parsed = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        except json.JSONDecodeError:
            parsed = {}
        return {**parsed, "exit": code, **({"stderr": qm.redact(err, self._qm_secrets)[-500:]} if code else {})}

    async def install(self, environment: BaseEnvironment) -> None:
        image, src_image = qm.images(self.QM_COMMIT)
        if self.QM_COMMIT == qm.COMMIT and self._version not in (None, qm.QM["version"]):
            raise RuntimeError(f"HE-FRONTIER-002 the job asks for QM {self._version}, not the pinned {qm.QM['version']}")
        images = {}
        for ref, want in ((image, self.QM_COMMIT), (src_image, None), (qm.pin()["postgres_image"], None)):
            code, out, _ = await self._docker("image", "inspect", "-f", '{{if .Config.Labels}}{{index .Config.Labels "harness-eval.commit"}}{{end}}', ref, timeout=60)
            images[ref] = out.strip() if code == 0 else None
            if code != 0 or (want and out.strip() != want):
                self._frontier_checks["qm_images"] = images
                raise RuntimeError(f"HE-QM-001 image {ref} is missing{' or not built at ' + want if want else ''} on this machine: vm-run.sh builds the QM images before the first QM trial")
        self._frontier_checks["qm_images"] = images
        code, daemon, err = await self._docker("run", "--rm", "--network", "none", "--entrypoint", "cat", src_image, qm.DAEMON_SOURCE, timeout=60)
        digest = hashlib.sha256(daemon.encode()).hexdigest()
        self._frontier_checks["qm_daemon_sha256"] = digest
        if code != 0 or digest != self.QM_DAEMON_SHA256:
            raise RuntimeError(f"HE-QM-001 {qm.DAEMON_SOURCE} in {src_image} is not the pinned sha256 {self.QM_DAEMON_SHA256} ({digest})")
        code, title_src, _ = await self._docker("run", "--rm", "--network", "none", "--entrypoint", "cat", src_image, qm.TITLE_SOURCE, timeout=60)
        titles = qm.title_models(title_src) if code == 0 else []
        if not titles:
            raise RuntimeError(f"HE-QM-001 found no session-title model in {qm.TITLE_SOURCE} in {src_image}, so the title calls' models cannot be checked against this cell's proxy slot")
        self._frontier_checks["qm_title_models"] = titles
        provider = qm.route(self._frontier_model)["provider"]
        allowed = fs.slot_models(self.HARNESS, self._frontier_model)
        missing = [t for t in titles if qm.title_model_provider(t) == provider and f"{provider}:{t}" not in allowed]
        if missing:
            raise RuntimeError(f"HE-QM-001 QM at {self.QM_COMMIT} writes session titles with {', '.join(missing)} ({qm.TITLE_SOURCE}), which this cell's proxy slot does not allow: add it to qm_harbor.HOUSEKEEPING")
        if qm.route(self._frontier_model)["custom"] is None:
            code, registry_src, _ = await self._docker("run", "--rm", "--network", "none", "--entrypoint", "cat", src_image, qm.REGISTRY_SOURCE, timeout=60)
            name = fs.model_spec(self._frontier_model)["name"]
            self._frontier_checks["qm_registry_has_model"] = code == 0 and name in qm.registry_models(registry_src)
            if not self._frontier_checks["qm_registry_has_model"]:
                raise RuntimeError(f"HE-QM-001 QM at {self.QM_COMMIT} has no {name} in its model registry ({qm.REGISTRY_SOURCE}): run the cell at a QM commit that has it")
        await self.ensure_system_dependencies(environment, ("curl", "ca_certificates"))
        await self.exec_as_root(environment, command=f"rm -rf {qm.DAEMON_DIR} && mkdir -p {qm.DAEMON_DIR}" + (f" && chown {shlex.quote(str(environment.default_user))} {qm.DAEMON_DIR}" if getattr(environment, "default_user", None) is not None else ""))
        await self._upload_config_text(environment, content=daemon, remote_path=f"{qm.DAEMON_DIR}/agent.mjs", filename="agent.mjs")
        await self.exec_as_agent(environment, command=(
            f"set -euo pipefail; {nvm_node_install_snippet(int(qm.pin()['node_major']))} >/dev/null && "
            f'ln -sf "$(nvm which {qm.pin()["node_major"]})" {qm.NODE_BIN} && {qm.NODE_BIN} -v && sha256sum {qm.DAEMON_DIR}/agent.mjs'))

    async def _qm_target(self, environment: BaseEnvironment) -> str:
        from harbor.environments.docker.docker import _sanitize_docker_compose_project_name

        project = _sanitize_docker_compose_project_name(environment.session_id)
        service = environment._EGRESS_CONTROL_SERVICE_NAME if getattr(environment, "_enable_egress_control", False) else "main"
        code, out, err = await self._docker("ps", "-q", "--filter", f"label=com.docker.compose.project={project}", "--filter", f"label=com.docker.compose.service={service}", timeout=60)
        ids = out.split()
        if code != 0 or len(ids) != 1:
            raise RuntimeError(f"HE-QM-002 found {len(ids)} running {service} containers for compose project {project} (want 1): {err.strip()[-300:]}")
        self._frontier_checks["qm_network"] = {"joined": service, "compose_project": project}
        return ids[0]

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        res = await environment.exec(command=f"{qm.NODE_BIN} -v; id -u; pwd")
        words = (res.stdout or "").split()
        self._frontier_checks.update({"node": words[0] if words else None, "task_uid": words[1] if len(words) > 1 else None, "task_workdir": words[2] if len(words) > 2 else None})
        try:
            await self._qm_start(environment)
        except BaseException:
            await self._qm_stop(environment)
            raise

    async def _qm_start(self, environment: BaseEnvironment) -> None:
        checks = self._frontier_checks
        await self.exec_as_root(environment, command=qm.link_command())
        res = await environment.exec(command=qm.daemon_command())
        checks["qm_daemon"] = (res.stdout or "").strip()[-500:]
        if res.return_code != 0 or '"ok":true' not in (res.stdout or ""):
            raise RuntimeError(f"HE-QM-002 QM's exec daemon did not start in the task container: {(res.stdout or '')[-300:]} {(res.stderr or '')[-300:]}")
        target = await self._qm_target(environment)
        tag = Path(environment.session_id).name.lower()
        tag = re.sub(r"[^a-z0-9_.-]", "-", tag)[:60]
        pg, core = f"he-qm-{tag}-pg", f"he-qm-{tag}-core"
        self._qm_names = [core, pg]
        self._qm_core = core
        pg_password, secret, connector = secrets.token_hex(16), secrets.token_hex(32), secrets.token_hex(32)
        self._qm_secrets += [pg_password, secret, connector]
        code, _, err = await self._docker("run", "-d", "--name", pg, "--label", f"{qm.LABEL}={self.frontier_trial}", "--label", f"{qm.JOBS_LABEL}={self._qm_jobs_dir}", "--network", f"container:{target}",
                                          "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_DB=qm", "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD",
                                          "-e", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=scram-sha-256",
                                          qm.pin()["postgres_image"], "-c", f"port={qm.PORTS['postgres']}", timeout=120, env={"POSTGRES_PASSWORD": pg_password})
        if code != 0:
            raise RuntimeError(f"HE-QM-002 Postgres did not start: {err.strip()[-300:]}")
        for _ in range(60):
            if (await self._docker("exec", pg, "pg_isready", "-h", "127.0.0.1", "-p", str(qm.PORTS["postgres"]), "-U", "postgres", "-d", "qm", timeout=30))[0] == 0:
                break
            await asyncio.sleep(1)
        else:
            raise RuntimeError("HE-QM-002 Postgres was not ready after 60 s")
        code, _, err = await self._docker("exec", pg, "psql", "-h", "127.0.0.1", "-p", str(qm.PORTS["postgres"]), "-U", "postgres", "-d", "qm", "-w", "-c", "select 1", timeout=30)
        self._frontier_checks["qm_pg_passwordless"] = "accepted" if code == 0 else err.strip()[-200:]
        if code == 0:
            raise RuntimeError("HE-QM-002 Postgres accepted a connection from 127.0.0.1 with no password, so the task container could reach QM's database")
        if not qm.pg_auth_refused(err):
            raise RuntimeError(f"HE-QM-002 the passwordless Postgres probe failed for a reason other than an authentication refusal (exit {code}), so it proves nothing: {err.strip()[-200:]}")
        self._qm_dir = Path(tempfile.mkdtemp(prefix="frontier-qm-"))
        mounts = self._qm_dir / "mounts"
        mounts.mkdir()
        for src, name, mode in ((qm.SHIM, "docker", 0o755), (qm.CALL, "qm-call.mjs", 0o644)):
            (mounts / name).write_bytes(src.read_bytes())
            (mounts / name).chmod(mode)
        mounts.chmod(0o755)
        envf = self._qm_dir / "core.env"
        envf.touch(mode=0o600)
        envf.write_text(qm.env_file(qm.core_env(self._frontier_model, self._qm_slot["base_url"], self._qm_slot["token"], secret, connector, pg_password)))
        try:
            code, _, err = await self._docker("run", "-d", "--name", core, "--label", f"{qm.LABEL}={self.frontier_trial}", "--label", f"{qm.JOBS_LABEL}={self._qm_jobs_dir}", "--network", f"container:{target}",
                                              "--env-file", str(envf), "-v", f"{mounts}:{qm.MOUNT}:ro", qm.images(self.QM_COMMIT)[0], timeout=120)
        finally:
            envf.unlink(missing_ok=True)
        if code != 0:
            raise RuntimeError(f"HE-QM-002 QM core did not start: {qm.redact(err, self._qm_secrets).strip()[-300:]}")
        for i in range(120):
            health = await self._qm_call("health", timeout=30)
            if health.get("http") == 200:
                checks["qm_core_ready_after_s"] = i
                break
            await asyncio.sleep(1)
        else:
            raise RuntimeError("HE-QM-002 QM core did not answer /healthz within 120 s (qm-core.log)")
        admin = checks.setdefault("qm_admin", {})
        for call in qm.admin_calls(self._frontier_model, self._qm_slot["base_url"]):
            out = await self._qm_call("admin", call["method"], call["path"], body=call["body"], timeout=120)
            admin[call["name"]] = {"http": out.get("http"), "body": out.get("body") if call["name"] != "custom_provider" else {k: v for k, v in (out.get("body") or {}).items() if k in ("id", "hasKey", "models", "protocol")} if isinstance(out.get("body"), dict) else None}
            if out.get("http") not in (200, 201, 204):
                raise RuntimeError(f"HE-QM-002 QM refused the {call['name']} admin call: {json.dumps(out)[-400:]}")
        c = qm.sandbox_create()
        out = await self._qm_call("admin", c["method"], c["path"], body=c["body"], timeout=300)
        sandbox = (out.get("body") or {}).get("id") if isinstance(out.get("body"), dict) else None
        admin["sandbox_create"] = {"http": out.get("http"), "id": sandbox}
        if not sandbox:
            raise RuntimeError(f"HE-QM-002 QM did not create its sandbox in the task container: {json.dumps(out)[-400:]}")
        d = qm.sandbox_default(sandbox)
        out = await self._qm_call("admin", d["method"], d["path"], body=d["body"], timeout=120)
        admin["sandbox_default"] = {"http": out.get("http")}
        if out.get("http") not in (200, 201):
            raise RuntimeError(f"HE-QM-002 QM refused to make the task container its default sandbox: {json.dumps(out)[-400:]}")
        code, calls, _ = await self._docker("exec", core, "cat", "/data/shim/calls.log", timeout=30)
        checks["qm_shim_calls"] = [ln.split(" ", 2)[0] + (" " + ln.split(" ", 2)[1] if ln.startswith(("image", "volume", "network")) else "") for ln in calls.splitlines() if ln.strip()]
        res = await environment.exec(command=f'readlink {qm.WORKDIR}; [ -d /tmp/agent-creds ] && echo creds-dir; for p in .aws .netrc .config/gh; do [ -L "/root/$p" ] && echo "link /root/$p $(readlink "/root/$p")"; done; true')
        checks["qm_provisioned"] = (res.stdout or "").splitlines()

    async def _qm_logs(self) -> None:
        if not self._qm_core:
            return
        logs = Path(self.logs_dir)
        logs.mkdir(parents=True, exist_ok=True)
        code, out, err = await self._docker("logs", self._qm_core, timeout=60)
        (logs / "qm-core.log").write_text(qm.redact(out + err, self._qm_secrets))
        if self._qm_dir is not None and (await self._docker("cp", f"{self._qm_core}:/data/shim/calls.log", str(self._qm_dir / "calls.log"), timeout=30))[0] == 0:
            (logs / "qm-docker-shim-calls.log").write_text(qm.redact((self._qm_dir / "calls.log").read_text(errors="replace"), self._qm_secrets))

    async def _qm_stop(self, environment: BaseEnvironment) -> None:
        try:
            if self._qm_core:
                await self._docker("kill", self._qm_core, timeout=60)
            try:
                await environment.exec(command=f'[ -f {qm.DAEMON_DIR}/pid ] && kill "$(cat {qm.DAEMON_DIR}/pid)" 2>/dev/null; true', user="root", timeout_sec=60)
            except Exception:
                pass
            await self._qm_logs()
        finally:
            for name in self._qm_names:
                await self._docker("rm", "-f", "-v", name, timeout=120)
            self._qm_names = []
            self._qm_core = ""
            if self._qm_dir is not None:
                shutil.rmtree(self._qm_dir, ignore_errors=True)

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        started = datetime.now(timezone.utc)
        out: dict[str, Any] = {}
        try:
            text = self.render_instruction(self._frontier_instruction(instruction))
            out = await self._qm_call("turn", self.frontier_trial, body=text, timeout=24 * 3600)
        finally:
            status = {**qm.turn_status(out), "started_at": started.isoformat().replace("+00:00", "Z"), "ended_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
            try:
                logs = Path(self.logs_dir)
                logs.mkdir(parents=True, exist_ok=True)
                (logs / "qm-turn.json").write_text(qm.redact(json.dumps({"status": status, "reply": out}, indent=2), self._qm_secrets) + "\n")
            finally:
                await self._qm_stop(environment)
        if not status["finished"]:
            raise RuntimeError(qm.redact(f"HE-QM-003 the QM turn did not finish: http {status['http']}, status {status['status']}{', ' + status['reason'] if status['reason'] else ''}", self._qm_secrets))


CLASSES = {c.HARNESS: c for c in (FrontierClaudeCode, FrontierCodex, FrontierHermes, FrontierOpenClaw, FrontierPi, FrontierMiniSweAgent, FrontierDsh, FrontierCursor,
                                  FrontierGeminiCli, FrontierGrokBuild, FrontierMuseCode, FrontierQm)}
