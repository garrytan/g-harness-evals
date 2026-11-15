from harbor.agents.installed.base import StubInstalled


class Codex(StubInstalled):
    LAUNCH_COMMAND = "codex exec --json -- {!r}"
