import asyncio, json, sys
from pathlib import Path
import agents
broker, root = sys.argv[1], sys.argv[2]
out = {}
class Res:
    def __init__(self, stdout=""):
        self.stdout, self.stderr, self.return_code = stdout, "", 0
class Env:
    default_user = None
    def __init__(self, stdout=""):
        self.calls, self.stdout = [], stdout
    async def exec(self, command, env=None, cwd=None, timeout_sec=None, user=None, **kw):
        self.calls.append({"command": command, "env": env or {}})
        return Res(self.stdout)
    async def upload_file(self, source_path, target_path, **kw):
        self.calls.append({"upload": target_path, "text": open(source_path).read()})
def make(cls, cell, version):
    logs = Path(root + "/" + cell + "__a1/" + cell + "__Trial/agent")
    logs.mkdir(parents=True, exist_ok=True)
    return cls(logs_dir=logs, model_name="xai/grok-4.7", broker_url=broker, cell=cell, attempt=1, version=version)
for h, cls, version, marker in (("pi", agents.FrontierPi, "1.5.0", "pi --print"), ("openclaw", agents.FrontierOpenClaw, "2026.10.6", "openclaw agent --local"), ("hermes", agents.FrontierHermes, None, "hermes --yolo")):
    a = make(cls, h + "-grok", version)
    asyncio.run(a._frontier_bind())
    env = Env()
    err = None
    try:
        asyncio.run(a.run("Fix the build.", env, None))
    except Exception as e:
        err = type(e).__name__ + ": " + str(e)[:300]
    run = [c for c in env.calls if marker in c.get("command", "")]
    rec = {"extra_env": a._extra_env, "error": err, "run_command": run[0]["command"] if run else None, "run_env": run[0]["env"] if run else None,
           "writes": [c.get("upload") or c["command"][:4000] for c in env.calls if "models.json" in str(c) or "openclaw.json" in str(c) or "config.yaml" in str(c)]}
    models = [c["text"] for c in env.calls if str(c.get("upload", "")).endswith("models.json")]
    rec["models_json"] = json.loads(models[0]) if models else None
    if h == "openclaw":
        rec["config"] = a._build_full_openclaw_config()
    out[h] = rec
print(json.dumps(out, default=str))
