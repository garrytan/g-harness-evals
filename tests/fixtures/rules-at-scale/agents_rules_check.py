"""Drives scripts/rules-at-scale/agents_rules.py on the Harbor stand-in of tests/fixtures/frontier-delivery/stub
(tests/rules-at-scale-harness.test.ts). Prints one JSON object: for each case, the commands the fake environment ran,
the uploads, the refusal code if setup or launch refused, the settings each harness would get and the
harness_settings.json rules record.  python3 agents_rules_check.py <scratch dir> <materializer>"""
import asyncio
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
sys.path[:0] = [str(REPO / "tests/fixtures/frontier-delivery/stub"), str(REPO / "scripts/frontier-harbor"), str(REPO / "scripts/rules-at-scale")]

from harbor.agents.installed import claude_code as stub_cc  # noqa: E402

_orig = stub_cc.ClaudeCode.__init__


def _cc_init(self, *a, **k):
    _orig(self, *a, **k)
    self._base_settings = k.get("config")


stub_cc.ClaudeCode.__init__ = _cc_init

import agents  # noqa: E402
import agents_rules as ar  # noqa: E402
import agents_rules_qm as arq  # noqa: E402
import rules_wiring as rw  # noqa: E402

agents.bind_slot = lambda broker, trial, harness, model, *a, **k: {"token": "trial-token:stub", "base_url": f"http://gw/{trial}/{model.split(':')[0]}"}
TASK = "rs-map-stub-01"
MODEL = {"codex": "openai/gpt-6.2-sol", "gemini-cli": "google/gemini-4-carbon"}
VERSION_OUT = {"claude-code": "2.1.328 (Claude Code)", "codex": "codex-cli 0.171.0", "openclaw": "OpenClaw 2026.11.5", "pi": "1.5.2", "gemini-cli": "0.69.0",
               "hermes": rw.PIN["harnesses"]["hermes"]["commit"]}


class Res:
    def __init__(self, stdout="", rc=0):
        self.stdout, self.stderr, self.return_code = stdout, "", rc


class FakeEnv:
    """Answers the version command with the pinned version (or old), each check with its expected text unless broken
    names it, the probes with nothing (or planted), a placed file's sha with the bytes uploaded to its stage, and the
    watcher start with a pid."""

    def __init__(self, harness, checks, broken=(), planted="", old=False):
        self.harness, self.checks, self.broken, self.planted, self.old = harness, {c["command"]: c["expect"] for c in checks}, set(broken), planted, old
        self.commands, self.uploads = [], {}

    async def upload_file(self, local, remote):
        self.uploads[remote] = hashlib.sha256(Path(local).read_bytes()).hexdigest()

    async def exec(self, command, user=None, env=None, cwd=None, timeout_sec=None):
        self.commands.append(command)
        if command == ar.VERSION_COMMAND.get(self.harness):
            return Res("codex-cli 0.165.0" if self.old else VERSION_OUT[self.harness])
        if "rev-parse HEAD" in command and "anthropic" in command:
            return Res(rw.PIN["harnesses"]["hermes"]["commit"] + "\n" + rw.PIN["harnesses"]["hermes"]["anthropic"]["version"])
        if "claude --version" in command:
            return Res(rw.PIN["harnesses"]["claude-code"]["native_binary_sha256"] + " 2.1.328 (Claude Code)")
        if command in (agents.dl.gstack_probe(), rw.gbrain_probe()):
            return Res(self.planted if command == rw.gbrain_probe() else "")
        if "/tmp/he-rules/stage/" in command and "sha256sum" in command:
            stage = command.split("cp ", 1)[1].split(" ", 1)[0]
            return Res(self.uploads.get(stage, "missing"))
        if command == rw.watch_start():
            return Res("watching 4242")
        for c, expect in self.checks.items():
            if c == command:
                return Res("wrong" if any(b in c for b in self.broken) else expect)
        return Res("")


async def case(tmp, materializer, harness, arm=None, **kw):
    cls = ar.CLASSES[harness]
    name = f"{harness}-{arm}-{'-'.join(sorted(kw))}"
    logs = Path(tmp) / name / "jobs" / "job" / f"{TASK}__abc1234" / "agent"
    kwargs = {"logs_dir": str(logs), "model_name": MODEL.get(harness, "anthropic/claude-opus-5-5"), "broker_url": "http://broker", "cell": "c", "attempt": 1}
    if arm:
        rules = {"arm": arm}
        if arm != "none":
            files = Path(tmp) / name / "rules"
            subprocess.run(["bun", materializer, "--task", str(REPO / "scripts/rules-at-scale/map/stub-task"), "--arm", arm, "--harness", harness, "--out", str(files / TASK)], check=True, capture_output=True)
            rules["files_dir"] = str(files)
        kwargs["rules"] = rules
    if kw.get("version"):
        kwargs["version"] = kw["version"]
    out = {"harness": harness, "arm": arm}
    try:
        agent = cls(**kwargs)
    except rw.RulesRefused as e:
        return {**out, "refused_at": "init", "code": e.code}
    checks = []
    if agent._rules is not None:
        p = rw.plan(harness, agent._rules, rw.load_files(agent._rules, harness, rw.task_dir_for(agent._rules, f"{TASK}__abc1234")), agent._rules_model)
        checks = p["checks_setup"] + p["checks_launch"]
    env = FakeEnv(harness, checks, kw.get("broken", ()), kw.get("planted", ""), kw.get("old", False))
    try:
        await agent.setup(env)
        await agent.run("Fix the clamp bug.", env, None)
    except rw.RulesRefused as e:
        out.update(code=e.code, message=str(e)[:240])
    out["uploads"] = len(env.uploads)
    out["watch_started"] = rw.watch_start() in env.commands
    launch = agent.RULES_LAUNCH
    out["watch_before_agent"] = (env.commands.index(rw.watch_start()) < next(i for i, c in enumerate(env.commands) if launch in c)) if out["watch_started"] and any(launch in c for c in env.commands) else None
    out["agent_ran"] = any(launch in c for c in env.commands)
    out["placed"] = [c.split(" && cp ")[1].split(" ")[1] for c in env.commands if "/tmp/he-rules/stage/" in c and "sha256sum" in c]
    if harness == "claude-code":
        out["claude_hooks"] = (agent._base_settings or {}).get("hooks")
    if harness == "codex":
        out["codex_config"] = {k: v for k, v in agent._build_effective_config().items() if k in ("project_doc_max_bytes", "model_context_window")}
        out["bypass_hook_trust"] = agent.options.get("dangerously_bypass_hook_trust")
    if harness == "openclaw":
        if agent._rules is not None:
            await agent._exec(env, ". ~/.nvm/nvm.sh && nvm use 22 && openclaw setup --baseline --workspace .")
            out["setup_command"] = env.commands[-1]
        cfg = agent._build_full_openclaw_config()
        out["openclaw_config"] = {"defaults": {k: v for k, v in cfg["agents"]["defaults"].items() if k.startswith("bootstrap")}, "plugins": cfg.get("plugins")}
    if harness == "hermes":
        hc = rw.hermes_config(agents.fs.hermes_config(agent._frontier_model), agent._rules, agent._frontier_model)
        out["hermes_config"] = {k: hc.get(k) for k in ("context_file_max_chars", "hooks", "hooks_auto_accept")} | {"context_length": hc["model"]["context_length"]}
        out["hermes_config_written"] = any("/tmp/hermes/config.yaml" in c and "1000000" in c for c in env.commands)
    settings = logs / "harness_settings.json"
    out["rules_record"] = json.loads(settings.read_text()).get("rules") if settings.exists() else None
    return out


class FakeQm(arq.RulesQm):
    """RulesQm with QM itself replaced: no images, containers or daemon. Every QM call is logged in order with the event
    names qm_started, admin <path>, turn and qm_stopped; an admin call to the SOUL path answers soul_http. Like FrontierQm's
    own stop, which reads core's log and removes containers only while they are up, a stop with nothing up logs nothing."""

    soul_http = 200
    start_fails = False

    def __init__(self, *a, **k):
        self.qm_events = []
        super().__init__(*a, **k)

    async def install(self, environment):
        return None

    def render_instruction(self, text):
        return text

    async def _frontier_after_install(self, environment):
        self.qm_events.append("qm_started")
        self._qm_names = ["qm-pg", "qm-core"]
        if self.start_fails:
            await self._qm_stop(environment)
            raise RuntimeError("HE-QM-002 QM core did not answer /healthz within 120 s (qm-core.log)")

    async def _qm_call(self, *args, body=None, timeout=300):
        if args[0] == "turn":
            self.qm_events.append(f"turn launched={str(self._rules_launched).lower()}")
            return {"http": 200, "body": {"status": "ok"}, "exit": 0}
        self.qm_events.append(" ".join(args[:3]))
        self.qm_body = body
        return {"http": self.soul_http if args[2] == rw.QM_SOUL_PATH else 200, "exit": 0}

    async def _qm_stop(self, environment):
        if self._qm_names:
            self.qm_events.append("qm_stopped")
        self._qm_names = []


async def qm_case(tmp, materializer, arm, soul_http=200, planted="", start_fails=False, broken=(), blank_soul=False, qm_commit=None):
    name = f"qm-{arm}-{soul_http}-{bool(planted)}-{start_fails}-{bool(broken)}-{blank_soul}-{bool(qm_commit)}"
    logs = Path(tmp) / name / "jobs" / "job" / f"{TASK}__abc1234" / "agent"
    rules = {"arm": arm}
    if arm != "none":
        files = Path(tmp) / name / "rules"
        files.mkdir(parents=True)
        if arm in rw.QM_ARMS:
            subprocess.run(["bun", materializer, "--task", str(REPO / "scripts/rules-at-scale/map/stub-task"), "--arm", arm, "--harness", "qm", "--out", str(files / TASK)], check=True, capture_output=True)
        if blank_soul:
            man_path = files / TASK / "manifest.json"
            man = json.loads(man_path.read_text())
            (files / TASK / "soul.txt").write_text(" \n")
            for f in man["files"]:
                if f["path"] == "soul.txt":
                    f.update(sha256=hashlib.sha256(b" \n").hexdigest(), bytes=2)
            man_path.write_text(json.dumps(man))
        rules["files_dir"] = str(files)
    out = {"arm": arm}
    attrs = {"soul_http": soul_http, "start_fails": start_fails, **({"QM_COMMIT": qm_commit} if qm_commit else {})}
    try:
        agent = type("FakeQm", (FakeQm,), attrs)(logs_dir=str(logs), model_name="anthropic/claude-opus-5-5", broker_url="http://broker", cell="c", attempt=1, rules=rules)
    except rw.RulesRefused as e:
        return {**out, "refused_at": "init", "code": e.code}
    try:
        p = rw.plan("qm", agent._rules, rw.load_files(agent._rules, "qm", rw.task_dir_for(agent._rules, f"{TASK}__abc1234")), agent._rules_model)
        checks = p["checks_setup"] + p["checks_launch"]
    except rw.RulesRefused:
        checks = []
    env = FakeEnv("qm", checks, broken=broken, planted=planted)
    try:
        await agent.setup(env)
        await agent.run("Fix the clamp bug.", env, None)
    except rw.RulesRefused as e:
        out.update(code=e.code, message=str(e)[:240])
    except RuntimeError as e:
        out.update(code=str(e).split(" ", 1)[0], message=str(e)[:240])
    events = agent.qm_events
    out["events"] = [e if e.startswith(("qm_", "turn")) or e.endswith(rw.QM_SOUL_PATH) else "admin" for e in events]
    out["soul_body"] = agent.qm_body if any(e.endswith(rw.QM_SOUL_PATH) for e in events) else None
    out["placed"] = [c.split(" && cp ")[1].split(" ")[1] for c in env.commands if "/tmp/he-rules/stage/" in c and "sha256sum" in c]
    out["watch_started"] = rw.watch_start() in env.commands
    settings = logs / "harness_settings.json"
    out["rules_record"] = json.loads(settings.read_text()).get("rules") if settings.exists() else None
    soul = Path(rules["files_dir"]) / TASK / "soul.txt" if arm != "none" else None
    out["soul_file"] = soul.read_text() if soul and soul.exists() else None
    return out


async def main(tmp, materializer):
    cases = {}
    for h in ("claude-code", "codex", "hermes", "openclaw", "pi", "gemini-cli"):
        cases[f"{h} default"] = await case(tmp, materializer, h)
        for arm in ("none", "b160k", "split", "hook", "cutlift"):
            cases[f"{h} {arm}"] = await case(tmp, materializer, h, arm)
    cases["codex old version"] = await case(tmp, materializer, "codex", "b8k", old=True)
    cases["codex job version"] = await case(tmp, materializer, "codex", "b8k", version="0.165.0")
    cases["pi gbrain planted"] = await case(tmp, materializer, "pi", "b8k", planted="/root/.gbrain\n")
    cases["openclaw extra rules file"] = await case(tmp, materializer, "openclaw", "b8k", broken=("-name AGENTS.md",))
    cases["claude-code hook broken"] = await case(tmp, materializer, "claude-code", "hook", broken=("HE_RULES_CHECK=1",))
    for arm in ("none", "qm-repo", "b8k", "qm-top", "b160k"):
        cases[f"qm {arm}"] = await qm_case(tmp, materializer, arm)
    cases["qm soul refused"] = await qm_case(tmp, materializer, "b8k", soul_http=500)
    cases["qm gbrain planted"] = await qm_case(tmp, materializer, "b8k", planted="/root/.gbrain\n")
    cases["qm start fails"] = await qm_case(tmp, materializer, "b8k", start_fails=True)
    cases["qm launch check fails"] = await qm_case(tmp, materializer, "b8k", broken=("-name AGENTS.md",))
    cases["qm blank soul"] = await qm_case(tmp, materializer, "b8k", blank_soul=True)
    cases["qm commit override"] = await qm_case(tmp, materializer, "b8k", qm_commit="a" * 40)
    print(json.dumps(cases))


asyncio.run(main(sys.argv[1], sys.argv[2]))
