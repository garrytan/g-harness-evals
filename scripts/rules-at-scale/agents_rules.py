"""Harbor installed-agent classes for the rules-at-scale eval: the frontier Harbor classes of
scripts/frontier-harbor/agents.py, subclassed (never edited), with a "rules" kwarg that places the arm's materialized
rules files in /work/repo, applies the cut-lifting settings, sets Hermes's context_length as a named setting, installs
the hook that delivers the six rules once beside the task message, runs the clean-arm probes (no gstack, no gbrain) and
starts /opt/he/watch.py right before the agent command. rules_wiring.py holds the logic and has no Harbor import.

Job config: {"import_path": "agents_rules:RulesClaudeCode", "model_name": "anthropic/claude-opus-5-5",
             "kwargs": {"version": "2.1.328", "broker_url": "http://127.0.0.1:8791", "cell": "...", "attempt": 1,
                        "rules": {"arm": "b160k", "files_dir": "<run>/rules/claude-code/b160k"}}}
with scripts/frontier-harbor and scripts/rules-at-scale on PYTHONPATH. The version must be scripts/rules-at-scale/pin.json's
(an omitted version gets it). A job without the rules kwarg runs the frontier class at our pinned version, unchanged.

Failure codes: HE-RULES-001 bad kwarg, 002 a materialized file or manifest that does not check, 003 an arm the harness
can't run, 004 a placed file changed or a rules file the arm did not place before the agent started, 005 a setup or
launch check failed, 006 gstack or gbrain found in the container, 007 no single task folder for the trial, 008 the
materializer failed, 009 QM (stub), 010 the installed harness is not the pinned version, 011 a QM SOUL over 100,000
characters. Each stops the trial before the agent starts, so it is an infrastructure failure, never a scored trial.

QM: a marked stub. RulesQm below is shaped to the QM runner's FrontierQm (one SOUL admin call before the turn) and refuses
with HE-RULES-009 until FrontierQm is on main; the FrontierQm import is guarded so this module loads on a base without it.
"""

from __future__ import annotations

import json
import shlex
import tempfile
from pathlib import Path
from typing import Any

import yaml

import agents as fa
import frontier_settings as fs
import rules_wiring as rw
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

rw.overlay_frontier_pin()

VERSION_COMMAND = {
    "claude-code": 'export PATH="$HOME/.local/bin:$PATH"; claude --version',
    "codex": '. ~/.nvm/nvm.sh >/dev/null 2>&1; export PATH="$HOME/.local/bin:$PATH"; codex --version',
    "openclaw": ". ~/.nvm/nvm.sh >/dev/null && nvm use %s >/dev/null && openclaw --version" % fs.PIN["harnesses"]["openclaw"]["node_major"],
    "pi": '. ~/.nvm/nvm.sh >/dev/null 2>&1; export PATH="$HOME/.local/bin:$PATH"; pi --version 2>&1',
    "gemini-cli": '. ~/.nvm/nvm.sh >/dev/null 2>&1; export PATH="$HOME/.local/bin:$PATH"; gemini --version',
    "hermes": "git -C $HOME/.hermes-src rev-parse HEAD",
}


class _Rules:
    """Mixin in front of a frontier class. The kwarg rules (rules_wiring.resolve) selects the arm; without it nothing
    but the pinned version changes."""

    RULES_LAUNCH = ""
    KWARGS = fa._Frontier.KWARGS + ("rules",)

    def __init__(self, *args: Any, rules: dict[str, Any] | None = None, **kwargs: Any) -> None:
        model = fa.cell_model(kwargs.get("model_name"))
        if rules is not None and kwargs.get("delivery") is not None:
            raise rw.RulesRefused("HE-RULES-001", "a job sets rules or delivery, not both")
        want = rw.PIN["harnesses"][self.HARNESS]["version"]
        if kwargs.get("version") not in (None, want):
            raise rw.RulesRefused("HE-RULES-010", f"the job asks for {self.HARNESS} {kwargs.get('version')}, not the pinned {want} (scripts/rules-at-scale/pin.json)")
        kwargs["version"] = want
        self._rules = rw.resolve(self.HARNESS, rules, model) if rules is not None else None
        self._rules_model = model
        self._rules_record: dict[str, Any] = {}
        self._rules_plan: dict[str, Any] | None = None
        self._rules_launched = False
        super().__init__(*args, **kwargs)

    def _write_settings(self) -> None:
        super()._write_settings()
        path = Path(self.logs_dir) / "harness_settings.json"
        settings = json.loads(path.read_text())
        settings["rules"] = {"pin_file": "scripts/rules-at-scale/pin.json", **(self._rules or {"arm": None}), **self._rules_record}
        path.write_text(json.dumps(settings, indent=2) + "\n")

    async def _rules_sh(self, environment: BaseEnvironment, command: str, code: str, what: str) -> str:
        try:
            res = await self.exec_as_agent(environment, command=command)
        except Exception as e:
            raise rw.RulesRefused(code, f"{what} failed: {str(e)[-400:]}") from None
        return (res.stdout or "").strip()

    async def _rules_checks(self, environment: BaseEnvironment, checks: list[dict[str, str]], when: str) -> None:
        for check in checks:
            got = await self._rules_sh(environment, check["command"], "HE-RULES-005", check["name"])
            ok = got == check["expect"].strip()
            self._rules_record.setdefault("checks", []).append({"name": check["name"], "when": when, "ok": ok, "got": got[-600:]})
            if not ok:
                code = "HE-RULES-004" if when == "launch" else "HE-RULES-005"
                raise rw.RulesRefused(code, f"{self.HARNESS} {self._rules['arm']}: {check['name']}: got {got[-300:]!r}, want {check['expect'][-300:]!r}")

    async def _rules_probe(self, environment: BaseEnvironment, when: str) -> None:
        found = sorted(set((await self._rules_sh(environment, fa.dl.gstack_probe(), "HE-RULES-006", "the gstack probe")).split()))
        brain = sorted(set((await self._rules_sh(environment, rw.gbrain_probe(), "HE-RULES-006", "the gbrain probe")).split()))
        self._rules_record.setdefault("clean_arm", {})[when] = {"gstack": found, "gbrain": brain}
        if found or brain:
            raise rw.RulesRefused("HE-RULES-006", f"gstack or gbrain in the task container {when}: {(found + brain)[:5]}")

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)
        try:
            out = await self._rules_sh(environment, VERSION_COMMAND[self.HARNESS], "HE-RULES-010", "the version check")
            self._rules_record["installed_version"] = out[-200:]
            if not rw.version_matches(self.HARNESS, out):
                raise rw.RulesRefused("HE-RULES-010", f"the installed {self.HARNESS} prints {out[-200:]!r}, not the pinned {rw.PIN['harnesses'][self.HARNESS]['version']}")
            if self._rules is None:
                return
            await self._rules_probe(environment, "setup")
            folder = rw.task_dir_for(self._rules, self.frontier_trial)
            loaded = rw.load_files(self._rules, self.HARNESS, folder)
            self._rules_plan = rw.plan(self.HARNESS, self._rules, loaded, self._rules_model)
            self._rules_record.update(self._rules_plan["record"])
            self._rules_record["task_folder"] = folder.name if folder else None
            self._rules_record["repo_before"] = await self._rules_sh(environment, f"ls -A {rw.REPO_DIR}", "HE-RULES-005", "listing the repository")
            head = (await self._rules_sh(environment, f"git -C {rw.REPO_DIR} rev-parse HEAD", "HE-RULES-005", "reading the base commit")).splitlines()
            self._rules_record["base_commit"] = head[-1] if head else None
            await self._rules_checks(environment, self._rules_plan["checks_setup"][:1], "setup")
            await self._rules_place(environment, self._rules_plan["files"])
            for i, command in enumerate(self._rules_plan["commands"]):
                await self._rules_sh(environment, command, "HE-RULES-005", f"arm command {i + 1}")
            await self._rules_checks(environment, self._rules_plan["checks_setup"][1:], "setup")
        finally:
            self._write_settings()

    async def _rules_place(self, environment: BaseEnvironment, files: list[dict[str, Any]]) -> None:
        """Uploads each file to a staging path, then copies it into place as the agent user and checks its sha256."""
        await self.exec_as_root(environment, command=f"mkdir -p {rw.ROOT}/stage && chmod 777 {rw.ROOT} {rw.ROOT}/stage")
        with tempfile.TemporaryDirectory(prefix="he-rules-") as tmp:
            for i, f in enumerate(files):
                local = Path(tmp) / str(i)
                local.write_bytes(f["body"])
                stage = f"{rw.ROOT}/stage/{i}"
                try:
                    await environment.upload_file(local, stage)
                    await self.exec_as_root(environment, command=f"chmod 644 {stage}")
                except Exception as e:
                    raise rw.RulesRefused("HE-RULES-002", f"uploading {f['path']} failed: {str(e)[-300:]}") from None
                got = await self._rules_sh(environment, rw.install_staged(stage, f), "HE-RULES-002", "placing " + f["path"])
                if got.splitlines()[-1:] != [f["sha256"]]:
                    raise rw.RulesRefused("HE-RULES-002", f"{f['path']} has sha256 {got[-80:]!r} after placing, not {f['sha256']}")
        await self.exec_as_root(environment, command=f"rm -rf {rw.ROOT}/stage")

    async def _rules_at_launch(self, environment: BaseEnvironment) -> None:
        """Right before the agent command: the placed files unchanged and no rules file the arm did not place, the
        clean-arm probes again, then the watcher."""
        self._rules_launched = True
        try:
            self._rules_record["repo_at_launch"] = await self._rules_sh(environment, f"ls -A {rw.REPO_DIR}", "HE-RULES-005", "listing the repository")
            await self._rules_checks(environment, self._rules_plan["checks_launch"], "launch")
            await self._rules_probe(environment, "launch")
            got = await self._rules_sh(environment, rw.watch_start(), "HE-RULES-005", "starting /opt/he/watch.py")
            self._rules_record["watcher"] = got.splitlines()[-1:] or [got]
            if not got.splitlines() or not got.splitlines()[-1].startswith("watching "):
                raise rw.RulesRefused("HE-RULES-005", f"/opt/he/watch.py did not start: {got[-300:]!r}")
        finally:
            self._write_settings()

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        if self._rules is not None and not self._rules_launched and self.RULES_LAUNCH and self.RULES_LAUNCH in command:
            await self._rules_at_launch(environment)
        return await super()._exec(environment, command, *args, **kwargs)


class RulesClaudeCode(_Rules, fa.FrontierClaudeCode):
    RULES_LAUNCH = fa.FrontierClaudeCode.LAUNCH

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._base_settings = rw.claude_hooks(self._base_settings, self._rules)


class RulesCodex(_Rules, fa.FrontierCodex):
    RULES_LAUNCH = fa.FrontierCodex.LAUNCH

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        rules = kwargs.get("rules")
        if isinstance(rules, dict) and rules.get("arm") == "hook":
            kwargs["dangerously_bypass_hook_trust"] = True
        super().__init__(*args, **kwargs)

    def _build_effective_config(self, openai_base_url: str | None = None) -> dict[str, Any]:
        return rw.codex_config(super()._build_effective_config(openai_base_url), self._rules)


class RulesHermes(_Rules, fa.FrontierHermes):
    """Hermes at the rules pin. From v0.23.x Hermes installs its dependencies into an environment its own package manager
    (pm) keeps under HERMES_HOME, so the install runs with --hermes-home /tmp/hermes (the HERMES_HOME every Hermes command
    here uses; with the default home, hermes then refuses to start: "no dependency environment is committed for this
    install"), and the anthropic extra, which the default install leaves out, is added through pm's own ensure_import
    at setup, since our config turns lazy installs off. Run is the frontier class's, with rules_wiring.hermes_config."""

    RULES_LAUNCH = "hermes --yolo chat"
    PM_PY = ('py=$(find /tmp/hermes/installs -path "*environments/*/venv/bin/python" | head -1); '
             'run_pm() { (cd "$HOME/.hermes-src" && HERMES_HOME=/tmp/hermes PYTHONPATH="$HOME/.hermes-src" "$py" "$@"); }; ')
    ACTIVE_ANTHROPIC = ('v=$(run_pm -c "import sys; from pathlib import Path; from pm.environments import committed_venv; print(committed_venv(Path(sys.argv[1])))" "$HOME/.hermes-src"); '
                        '"$v/bin/python" -c "import anthropic; print(anthropic.__version__)"')

    async def install(self, environment: BaseEnvironment) -> None:
        pin = rw.PIN["harnesses"]["hermes"]
        await self.ensure_system_dependencies(environment, ("curl", "git", "ripgrep", "xz"))
        await self.exec_as_agent(environment, command=(
            "set -euo pipefail; for i in 1 2 3; do "
            f"curl -fsSL --retry 6 --retry-delay 20 --retry-max-time 300 https://raw.githubusercontent.com/NousResearch/hermes-agent/{pin['commit']}/scripts/install.sh "
            f"| bash -s -- --skip-setup --dir {self.SRC} --hermes-home /tmp/hermes --branch {pin['install_branch']} --commit {pin['commit']} && break; "
            '[ "$i" -lt 3 ] || exit 1; sleep 30; done; '
            'export PATH="$HOME/.local/bin:$PATH" && export HERMES_HOME=/tmp/hermes && '
            'mkdir -p "$HERMES_HOME/sessions" "$HERMES_HOME/skills" "$HERMES_HOME/memories" && hermes --version'))
        await self.exec_as_agent(environment, command=(
            "set -euo pipefail; " + self.PM_PY + "run_pm -c \"from pm import ensure_import; ensure_import('anthropic')\"; " + self.ACTIVE_ANTHROPIC))

    async def _frontier_after_install(self, environment: BaseEnvironment) -> None:
        pin = rw.PIN["harnesses"]["hermes"]
        res = await environment.exec(command=f"git -C {self.SRC} rev-parse HEAD; " + self.PM_PY + self.ACTIVE_ANTHROPIC)
        words = (res.stdout or "").split()
        self._frontier_checks.update({"hermes_commit": words[0] if words else None, "anthropic_sdk": words[-1] if len(words) > 1 else None})
        if self._frontier_checks["hermes_commit"] != pin["commit"]:
            raise RuntimeError(f"HE-RULES-010 the Hermes checkout is at {self._frontier_checks['hermes_commit']}, not the pinned {pin['commit']}")
        if self._frontier_checks["anthropic_sdk"] != pin["anthropic"]["version"]:
            raise RuntimeError(f"HE-RULES-010 Hermes's active environment has anthropic {self._frontier_checks['anthropic_sdk']}, not the pinned {pin['anthropic']['version']}")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        spec = fs.model_spec(self._frontier_model)
        config = rw.hermes_config(fs.hermes_config(self._frontier_model), self._rules, self._frontier_model)
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


class RulesOpenClaw(_Rules, fa.FrontierOpenClaw):
    """OpenClaw reads AGENTS.md from its agent workspace, which Harbor's config sets to "." (the task's working directory,
    /work/repo), so the placed AGENTS.md is the one it reads. Harbor's class first runs openclaw setup --baseline
    --workspace . there, before it copies the config that sets skipBootstrap, and that setup writes OpenClaw's own
    AGENTS.md, IDENTITY.md, SOUL.md and USER.md templates into the repository (delivery map, 2026-11-19): in the none arm
    the agent would read OpenClaw's template AGENTS.md. On a rules job the setup runs against a scratch workspace instead;
    the agent's workspace is still "." from the copied config, and the launch check refuses any rules or bootstrap file in
    the repository that the arm did not place."""

    RULES_LAUNCH = fa.FrontierOpenClaw.LAUNCH
    SETUP = "openclaw setup --baseline --workspace ."

    async def _exec(self, environment: BaseEnvironment, command: str, *args: Any, **kwargs: Any) -> Any:
        if self._rules is not None and self.SETUP in command:
            command = command.replace(self.SETUP, "openclaw setup --baseline --workspace " + rw.OPENCLAW_SETUP_WORKSPACE)
            self._rules_record["openclaw_setup_workspace"] = rw.OPENCLAW_SETUP_WORKSPACE
        return await super()._exec(environment, command, *args, **kwargs)

    async def _rules_at_launch(self, environment: BaseEnvironment) -> None:
        self._rules_record["openclaw_setup_wrote"] = (await self._rules_sh(environment, f"ls -A {rw.OPENCLAW_SETUP_WORKSPACE} 2>/dev/null; true", "HE-RULES-005", "listing the setup workspace")).split()
        await super()._rules_at_launch(environment)

    def _build_full_openclaw_config(self) -> dict[str, Any]:
        return rw.openclaw_config(super()._build_full_openclaw_config(), self._rules)


class RulesPi(_Rules, fa.FrontierPi):
    RULES_LAUNCH = fa.FrontierPi.LAUNCH


class RulesGeminiCli(_Rules, fa.FrontierGeminiCli):
    """Descriptive row of the keyless delivery map only (plan decision E): GEMINI.md, no hook or cutlift arm."""

    RULES_LAUNCH = fa.FrontierGeminiCli.LAUNCH


FrontierQm = getattr(fa, "FrontierQm", None)


class RulesQm:
    """STUB until the QM runner's agents.py FrontierQm (rendered by scripts/frontier-harbor/qm_harbor.py) is on main; this base
    has no FrontierQm, so the import is guarded and the class refuses with HE-RULES-009. The design it is shaped to:
    subclass FrontierQm and add rules_wiring.qm_soul_call(rules_wiring.qm_soul_text(arm,
    rules_wiring.load_files(...))) to its admin calls before the turn (none sets no SOUL; qm-repo places the b8k AGENTS.md in the repository and
    sets an empty SOUL); a text over 100,000 characters fails the trial and is never cut; FrontierQm's own install_checks.qm_admin
    stops a non-2xx; and the proof is rules_wiring.qm_soul_delivered on the captured first agent-loop request, never the
    admin reply. QM runs one organization per trial (its own core and Postgres), so a SOUL cannot leak across trials."""

    HARNESS = "qm"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise rw.RulesRefused("HE-RULES-009", "QM rules arms are a stub: they wait for the QM runner's FrontierQm on main" + ("" if FrontierQm is None else " (FrontierQm is importable here; wire RulesQm to it)"))


CLASSES = {c.HARNESS: c for c in (RulesClaudeCode, RulesCodex, RulesHermes, RulesOpenClaw, RulesPi, RulesGeminiCli)}
