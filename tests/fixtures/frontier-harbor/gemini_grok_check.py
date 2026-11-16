import asyncio, json, sys, tomllib
import agents
broker, root, sha = sys.argv[1], sys.argv[2], sys.argv[3]
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
def make(cls, cell, model, version):
    return cls(logs_dir=root + "/" + cell + "__a1/" + cell + "__Trial/agent", model_name=model, broker_url=broker, cell=cell, attempt=1, version=version)
g = make(agents.FrontierGeminiCli, "gemini-carbon", "google/gemini-4-carbon", "0.68.0")
asyncio.run(g._frontier_bind())
settings, alias = g._build_settings_config("gemini-4-carbon", g._resolve_env_auth_type())
env = Env()
asyncio.run(g.run("Fix the build.", env, None))
run = [c for c in env.calls if "gemini --yolo" in c["command"]]
out["gemini"] = {"extra_env": g._extra_env, "settings": settings, "alias": alias, "auth_env": g._resolve_auth_env(), "run_command": run[0]["command"] if run else None, "run_env": run[0]["env"] if run else None,
                 "settings_written": [c["command"] for c in env.calls if "settings.json" in c["command"]]}
k = make(agents.FrontierGrokBuild, "grok-47", "xai/grok-4.7", "1.0.77")
asyncio.run(k._frontier_bind())
cfg = tomllib.loads(k._build_config_toml())
env = Env()
asyncio.run(k.run("Fix the build.", env, None))
run = [c for c in env.calls if "grok --no-auto-update" in c["command"]]
out["grok"] = {"extra_env": k._extra_env, "config": cfg, "run_command": run[0]["command"] if run else None, "run_env": run[0]["env"] if run else None}
asyncio.run(k._frontier_after_install(Env(sha + "  /home/agent/.grok/downloads/grok-1.0.77-linux-x86_64\n")))
out["grok"]["checks"] = k._frontier_checks
try:
    asyncio.run(k._frontier_after_install(Env("0" * 64 + "  /x\n")))
    out["grok"]["mismatch"] = None
except RuntimeError as e:
    out["grok"]["mismatch"] = str(e)
print(json.dumps(out))
