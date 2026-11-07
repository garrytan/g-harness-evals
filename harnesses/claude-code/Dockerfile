# Claude Code harness image. The CLI is installed from npm at a pinned version
# under /opt/harness (read-only at run time); all mutable state goes to
# /harness-state through HOME and CLAUDE_CONFIG_DIR. The npm package is a
# wrapper whose postinstall copies the platform's native binary over
# bin/claude.exe; npm 12 skips that script unless it is allowed, npm 11 runs it
# and accepts the flag. The build checks the version and the linux-x64 native
# binary's sha256 against pin.json. No API key and no .credentials.json enter
# this image: the adapter passes the per-trial token and the proxy base URL
# from HE_MODEL_API_KEY and HE_MODEL_BASE_URL in the process environment.
# The Agent SDK driver (sdk-driver.ts, H10 PR 4) runs with node's type stripping
# beside @anthropic-ai/claude-agent-sdk from package-lock.json, installed without
# optional packages (the SDK's own copy of the CLI binary) or peer packages; it
# drives /opt/harness/bin/claude. The build checks the SDK's version, that its
# claudeCodeVersion is this CLI's, and that its manifest's linux-x64 checksum is
# CLAUDE_CODE_SHA256, so the SDK release bundles the same binary that runs.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG CLAUDE_CODE_VERSION=2.1.312
ARG CLAUDE_CODE_SHA256=4f4178ce41d83e23341ebfbaecdbcf8ea6bf7baea0690025abe49eeec3a5d01d
ARG CLAUDE_AGENT_SDK_VERSION=0.3.312
LABEL org.opencontainers.image.title="harness-eval Claude Code harness" \
      harness-eval.harness="claude-code" \
      harness-eval.version="${CLAUDE_CODE_VERSION}" \
      harness-eval.agent-sdk-version="${CLAUDE_AGENT_SDK_VERSION}" \
      harness-eval.source="https://www.npmjs.com/package/@anthropic-ai/claude-code" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g --prefix /opt/harness --allow-scripts=@anthropic-ai/claude-code "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force \
    && test "$(/opt/harness/bin/claude --version)" = "${CLAUDE_CODE_VERSION} (Claude Code)" \
    && echo "${CLAUDE_CODE_SHA256}  /opt/harness/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-linux-x64/claude" | sha256sum -c - \
    && echo "${CLAUDE_CODE_SHA256}  /opt/harness/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe" | sha256sum -c - \
    && rm -rf /root/.claude /root/.claude.json \
    && test -z "$(find / -xdev -name .credentials.json -print -quit)"

COPY package.json package-lock.json /opt/harness/
RUN cd /opt/harness && npm ci --omit=optional --legacy-peer-deps --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && node -e 'const p = require("/opt/harness/node_modules/@anthropic-ai/claude-agent-sdk/package.json"), m = require("/opt/harness/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json"); const [v, c, s] = process.argv.slice(1); if (p.version !== v || p.claudeCodeVersion !== c || m.version !== c || m.platforms["linux-x64"].checksum !== s) { console.error("agent sdk", p.version, p.claudeCodeVersion, m.platforms["linux-x64"].checksum); process.exit(1); }' "${CLAUDE_AGENT_SDK_VERSION}" "${CLAUDE_CODE_VERSION}" "${CLAUDE_CODE_SHA256}" \
    && test ! -e /opt/harness/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64 \
    && rm -rf /root/.npm
COPY config/ /opt/harness/config/
COPY ablation/ /opt/harness/ablation/
COPY routes/ /opt/harness/routes/
COPY adapter.sh pin.json sdk-driver.ts /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/bin:${PATH}" \
    HOME=/harness-state \
    CLAUDE_CONFIG_DIR=/harness-state/claude \
    CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION} \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
