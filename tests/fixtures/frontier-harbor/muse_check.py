import asyncio, json, sys
from pathlib import Path
import agents
broker, root, sha = sys.argv[1], sys.argv[2], sys.argv[3]
out = {}
class Res:
    def __init__(self, stdout=""):
        self.stdout, self.stderr, self.return_code = stdout, "", 0
class Env:
    default_user = None
    def __init__(self, stdout=""):
        self.calls, self.uploads, self.stdout = [], [], stdout
    async def exec(self, command, env=None, cwd=None, timeout_sec=None, user=None, **kw):
        self.calls.append({"command": command, "env": env or {}})
        return Res(self.stdout)
    async def upload_file(self, source_path, target_path, *a, **kw):
        self.uploads.append({"target": str(target_path), "content": open(source_path).read()})
    async def upload_dir(self, source_dir, target_dir, *a, **kw):
        self.uploads.append({"target": str(target_dir), "dir": True})
m = agents.FrontierMuseCode(logs_dir=Path(root + "/muse-wonder__a1/muse-wonder__Trial/agent"), model_name="openrouter/meta/muse-wonder", broker_url=broker, cell="muse-wonder", attempt=1, version="1.4.20-R8619.1")
asyncio.run(m._frontier_bind())
env = Env()
asyncio.run(m.install(env))
out["install"] = [c["command"] for c in env.calls][-1:]
env = Env()
asyncio.run(m.run("Fix the build.", env, None))
run = [c for c in env.calls if "muse exec" in c["command"]]
settings = [{"target": u["target"], "settings": json.loads(u["content"])} for u in env.uploads if u["target"].endswith("settings.json")]
out["muse"] = {"extra_env": m._extra_env, "settings": settings, "run_command": run[0]["command"] if run else None, "run_env": run[0]["env"] if run else None}
asyncio.run(m._frontier_after_install(Env(sha + "  /home/agent/.local/bin/muse\n")))
out["muse"]["checks"] = m._frontier_checks
try:
    asyncio.run(m._frontier_after_install(Env("0" * 64 + "  /x\n")))
    out["muse"]["mismatch"] = None
except RuntimeError as e:
    out["muse"]["mismatch"] = str(e)
print(json.dumps(out))
