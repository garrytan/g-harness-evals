from harbor.agents.installed.base import StubInstalled


class ClaudeCode(StubInstalled):
    LAUNCH_COMMAND = 'printf "%s" {!r} | claude --verbose --output-format=stream-json --print'
