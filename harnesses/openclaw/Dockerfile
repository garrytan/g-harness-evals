# OpenClaw harness image. The CLI is installed from npm at a pinned version
# under /opt/harness (read-only at run time); all mutable state goes to
# /harness-state through OPENCLAW_STATE_DIR. Nothing in this image knows a
# real API key: the adapter passes the per-trial token and proxy base URL from
# HE_MODEL_API_KEY and HE_MODEL_BASE_URL into the config by env substitution.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG OPENCLAW_VERSION=2026.10.6
LABEL org.opencontainers.image.title="harness-eval OpenClaw harness" \
      harness-eval.harness="openclaw" \
      harness-eval.version="${OPENCLAW_VERSION}" \
      harness-eval.source="https://www.npmjs.com/package/openclaw" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*

# npm 12 blocks lifecycle scripts unless allowed; npm 11 accepts the flag with a warning.
RUN npm install -g --prefix /opt/harness "openclaw@${OPENCLAW_VERSION}" --allow-scripts=openclaw \
    && npm cache clean --force \
    && /opt/harness/bin/openclaw --version

COPY config/ /opt/harness/config/
COPY routes/ /opt/harness/routes/
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/bin:${PATH}" \
    HOME=/harness-state \
    OPENCLAW_STATE_DIR=/harness-state/openclaw \
    OPENCLAW_CONFIG_PATH=/harness-state/openclaw/openclaw.json \
    OPENCLAW_VERSION=${OPENCLAW_VERSION} \
    CI=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
