"""Drives scripts/frontier-harbor/agents.py's delivery wiring on the Harbor stand-in in stub/ (tests/frontier-delivery.test.ts).
Prints one JSON object: for each case, the commands the fake environment ran, the error code if setup or run refused, and
the harness_settings.json the class wrote.  python3 agents_check.py <scratch dir>"""
import asyncio
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent
sys.path[:0] = [str(HERE / "stub"), str(REPO / "scripts/frontier-harbor")]

import agents  # noqa: E402
import delivery as dl  # noqa: E402

agents.bind_slot = lambda broker, trial, harness, model, *a, **k: {"token": "trial-token:stub", "base_url": f"http://gw/{trial}/{model.split(':')[0]}"}
KINDS = {"gn-dev-review-01": "review", "gn-dev-ship-01": "ship"}
CARDS = {"review": "tests/fixtures/frontier-delivery/review-card.md", "ship": "tests/fixtures/frontier-delivery/ship-card.md"}
INSTRUCTION = "Review the change in /work/repo and write /work/out/review.json."


class Res:
    def __init__(self, stdout="", rc=0):
        self.stdout, self.stderr, self.return_code = stdout, "", rc


class FakeEnv:
    """Answers each health check with its expected line unless broken names it, the gstack probe with nothing (or the
    installed skills once the skill arm's ./setup ran, or a planted file), and anything else with empty output."""

    def __init__(self, health, broken=(), planted=None):
        self.health = {c["command"]: c["expect"] for c in health}
        self.broken = set(broken)
        self.planted = planted
        self.commands = []
        self.installed = False

    async def exec(self, command, user=None, env=None, cwd=None, timeout_sec=None):
        self.commands.append(command)
        if "./setup --host" in command:
            self.installed = True
        if command == dl.gstack_probe():
            if self.planted:
                return Res(self.planted)
            return Res("/root/.claude/skills/review/SKILL.md\n/root/.claude/skills/ship/SKILL.md\n" if self.installed else "")
        if "rev-parse HEAD" in command:
            return Res(agents.fs.PIN["harnesses"]["hermes"]["commit"])
        if "import anthropic" in command:
            return Res(agents.fs.PIN["harnesses"]["hermes"]["anthropic"]["version"])
        if "claude --version" in command:
            return Res(agents.fs.PIN["harnesses"]["claude-code"]["native_binary_sha256"] + " 2.1.312 (Claude Code)")
        if command == dl.WORK_HASH:
            return Res("work-hash-1")
        if command == agents.fs.drop_skill_links_command():
            return Res("SKILL_LINKS_DROPPED 2")
        for c, expect in self.health.items():
            if c in command:
                return Res("wrong" if any(b in c for b in self.broken) else expect)
        return Res("")


async def case(tmp, harness, arm=None, broken=(), planted=None, task="gn-dev-review-01"):
    cls = agents.CLASSES[harness]
    logs = Path(tmp) / f"{harness}-{arm}-{len(broken)}-{bool(planted)}" / "jobs" / "job" / f"{task}__abc1234" / "agent"
    kwargs = {"logs_dir": str(logs), "model_name": "openai/gpt-6.1-sol" if harness == "codex" else "anthropic/claude-opus-5-5", "broker_url": "http://broker", "cell": "c", "attempt": 1}
    if arm:
        kwargs["delivery"] = {"arm": arm, "cards": CARDS, "kinds": KINDS}
    out = {"harness": harness, "arm": arm}
    try:
        agent = cls(**kwargs)
    except dl.DeliveryRefused as e:
        return {**out, "refused_at": "init", "code": e.code}
    health = dl.plan(harness, agent._frontier_delivery, KINDS[task])["health"] if arm else []
    env = FakeEnv(health, broken, planted)
    try:
        await agent.setup(env)
        await agent.run(INSTRUCTION, env, None)
    except dl.DeliveryRefused as e:
        out.update(code=e.code, message=str(e)[:200])
    out["commands"] = env.commands
    launch = agent.LAUNCH or "hermes --yolo chat"
    out["launched"] = any(launch in c for c in env.commands)
    out["launch_command"] = next((c for c in env.commands if launch in c), None)
    out["config"] = getattr(agent, "options", {}).get("config")
    out["extra_env_keys"] = sorted(agent._extra_env)
    settings = logs / "harness_settings.json"
    out["settings"] = json.loads(settings.read_text()) if settings.exists() else None
    if harness == "openclaw":
        out["openclaw_config"] = agent._build_full_openclaw_config()
    return out


async def main(tmp):
    cases = {}
    for h in ("claude-code", "codex", "hermes", "openclaw", "pi"):
        cases[f"{h} default"] = await case(tmp, h)
        for arm in dl.ARMS:
            cases[f"{h} {arm}"] = await case(tmp, h, arm)
    cases["pi hook broken"] = await case(tmp, "pi", "hook", broken=("pi --help",))
    cases["codex hook broken"] = await case(tmp, "codex", "hook", broken=("card-hook.py PostToolUse",))
    cases["openclaw hook broken at launch"] = await case(tmp, "openclaw", "hook", broken=("openclaw plugins inspect",))
    cases["claude-code none planted"] = await case(tmp, "claude-code", "none", planted="/root/.claude/skills/review/SKILL.md\n")
    cases["pi startup ship"] = await case(tmp, "pi", "startup", task="gn-dev-ship-01")
    cases["hermes hook broken at launch"] = await case(tmp, "hermes", "hook", broken=("hermes-check.py",))
    print(json.dumps(cases))


asyncio.run(main(sys.argv[1]))
