# Anatomy dissector fixtures

Request logs for tests/anatomy-dissect.test.ts, gzipped with `gzip -n -9`. Each sha256 is over the decompressed ndjson, the value `source_log_sha256` records.

- `openclaw-2026.10.6-spike.ndjson.gz`: OpenClaw 2026.10.6, first request through the metering proxy to the fake endpoint (internal-task spike, ~/.capy/work/harn15/spike/fake.ndjson). One request. sha256 915e679f7ef547ecf66d57405ce7ff6530fa1f84bb5771937ff05153bda69b2d.
- `hermes-oneshot-probe.ndjson.gz`: Hermes one-shot, internal-task-a panel preflight (private drive handoffs/internal-task-b/gsta-135/panel-preflight/probe-hermes-oneshot-probe/requests.ndjson). Older fake format: no status on success. sha256 0059502299c1420fac34dbf81bc201d469b620b7eb5ab5f7a0e47cbbc3efcced.
- `hermes-chat-probe.ndjson.gz`: Hermes chat, same preflight (probe-hermes-chat-probe/requests.ndjson). sha256 57d0c9b0ff214a2a27ab728eb288b06678621ee5ae0b8b6f39c3c8043ef3a560.

Each log holds one full agent request body. The Hermes pair is both modes on purpose: the test checks one-shot against chat. The logs carry no headers and no credentials.
