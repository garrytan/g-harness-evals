# Fake harness image: the adapter protocol with no model. Used by
# tests/adapter-conformance.test.ts; it is the smallest image that can prove
# the mount and exit-code contract, so every real harness image follows the
# same layout (/opt/harness, ENTRYPOINT adapter.sh, CMD run).
FROM debian:bookworm-slim
LABEL org.opencontainers.image.title="harness-eval fake harness" \
      harness-eval.harness="_fake" \
      harness-eval.version="0" \
      harness-eval.topology="in-container"
# jq reads TurnRequest files and writes TurnResponse files; curl makes the
# [fake:call] world-MCP request in serve mode.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl jq \
    && rm -rf /var/lib/apt/lists/*
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state
WORKDIR /workspace
ENV HOME=/harness-state
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
