from harbor.agents.installed.base import StubInstalled


class Pi(StubInstalled):
    LAUNCH_COMMAND = "pi --print --mode json {!r}"
