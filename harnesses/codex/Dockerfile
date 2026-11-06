# Codex CLI harness image. The npm package @openai/codex is installed globally
# at a pinned version on node:24-bookworm-slim; its vendored linux-x64 native
# binary is checked against the sha256 in pin.json at build time, and
# "codex --version" must print the pinned version. All mutable state goes to
# /harness-state through HOME and CODEX_HOME. No API key, no auth.json and no
# login enter this image: the adapter points Codex at the metering proxy with
# the per-trial token.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG CODEX_VERSION=0.165.0
ARG CODEX_BIN_SHA256=c06a67fd8ac76508dc78bd99ce20c9f317b8d568beda59485f3f4134df9962d5
LABEL org.opencontainers.image.title="harness-eval Codex CLI harness" \
      harness-eval.harness="codex" \
      harness-eval.version="${CODEX_VERSION}" \
      harness-eval.source="https://www.npmjs.com/package/@openai/codex" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl jq procps ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g --no-audit --no-fund "@openai/codex@${CODEX_VERSION}" \
    && bin="$(find "$(npm root -g)/@openai" -path '*codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex' -type f | head -1)" \
    && test -n "$bin" \
    && echo "${CODEX_BIN_SHA256}  $bin" | sha256sum -c - \
    && test "$(codex --version)" = "codex-cli ${CODEX_VERSION}" \
    && npm cache clean --force

COPY config/ /opt/harness/config/
COPY ablation/ /opt/harness/ablation/
COPY routes/ /opt/harness/routes/
COPY adapter.sh pin.json trust-hash.cjs /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV HOME=/harness-state \
    CODEX_HOME=/harness-state/codex \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
