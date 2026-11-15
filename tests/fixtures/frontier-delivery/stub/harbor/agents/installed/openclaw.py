from harbor.agents.installed.base import StubInstalled


class OpenClaw(StubInstalled):
    LAUNCH_COMMAND = "openclaw agent --local --json --message {!r}"
    _SUPPORTED_PROVIDERS = frozenset({"anthropic", "openai"})

    @classmethod
    def _provider_env_keys(cls, provider):
        return ()

    @staticmethod
    def _deep_merge(a, b):
        for k, v in b.items():
            if isinstance(v, dict) and isinstance(a.get(k), dict):
                OpenClaw._deep_merge(a[k], v)
            else:
                a[k] = v

    def _build_full_openclaw_config(self):
        return {"agents": {"defaults": {"workspace": "."}}, "tools": {"deny": ["message"]}}
