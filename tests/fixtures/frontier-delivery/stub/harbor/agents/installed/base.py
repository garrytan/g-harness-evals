class StubInstalled:
    LAUNCH_COMMAND = "{}"

    def __init__(self, logs_dir=None, model_name=None, extra_env=None, **kwargs):
        self.logs_dir = logs_dir
        self.model_name = model_name
        self._extra_env = dict(extra_env or {})
        self.options = kwargs

    @classmethod
    def parse_options(cls, kwargs=None, env=None):
        return dict(kwargs or {})

    def _env_sources(self):
        return ()

    def _build_register_skills_command(self):
        return None

    async def _exec(self, environment, command, user=None, env=None, cwd=None, timeout_sec=None):
        res = await environment.exec(command=command, user=user, env=env, cwd=cwd, timeout_sec=timeout_sec)
        if res.return_code != 0:
            raise RuntimeError("stub command failed: " + command[:80])
        return res

    async def exec_as_agent(self, environment, command, env=None, cwd=None, timeout_sec=None):
        return await self._exec(environment, command, env=env, cwd=cwd, timeout_sec=timeout_sec)

    async def exec_as_root(self, environment, command, env=None, cwd=None, timeout_sec=None):
        return await self._exec(environment, command, user="root", env=env, cwd=cwd, timeout_sec=timeout_sec)

    async def ensure_system_dependencies(self, environment, packages):
        return None

    async def setup(self, environment):
        await self.exec_as_agent(environment, command="stub-install " + type(self).__name__)

    async def run(self, instruction, environment, context):
        await self.exec_as_agent(environment, command=self.LAUNCH_COMMAND.format(instruction))


BaseInstalledAgent = StubInstalled
