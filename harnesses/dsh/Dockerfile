# DeepSeek Harness (dsh) harness image. dsh is installed from npm at an exact version under /opt/harness/dsh
# (read-only at run time) with npm ci from package-lock.json, so every one of its packages, the plugins included, is
# fixed by version and integrity and installed here at build: the adapter's profile names only plugins that ship
# inside this install (the world MCP client is @deepseek-ai/dsh-mcp-client), and nothing is installed at run time.
# Five packages carry install scripts; package.json allowScripts runs three and skips two, and --strict-allow-scripts
# fails the build if the lock ever brings one it does not name (pin.json install_scripts). All mutable state goes to /harness-state through HOME (dsh's home is $HOME/.dsh). No API key and no
# credential file enter this image: the adapter passes the per-trial token and the proxy base URL from
# HE_MODEL_API_KEY and HE_MODEL_BASE_URL, and the profile names the token by variable (apiKeyEnv), never by value.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG DSH_VERSION=0.2.2-rc.1
LABEL org.opencontainers.image.title="harness-eval DeepSeek Harness (dsh) harness" \
      harness-eval.harness="dsh" \
      harness-eval.version="${DSH_VERSION}" \
      harness-eval.source="https://www.npmjs.com/package/@deepseek-ai/dsh" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep procps jq \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json /opt/harness/dsh/
RUN cd /opt/harness/dsh \
    && npm ci --no-audit --no-fund --strict-allow-scripts \
    && npm cache clean --force \
    && test "$(node -p 'require("/opt/harness/dsh/node_modules/@deepseek-ai/dsh/package.json").version')" = "${DSH_VERSION}" \
    && test "$(/opt/harness/dsh/node_modules/.bin/dsh --version)" = "${DSH_VERSION}" \
    && test -f /opt/harness/dsh/node_modules/@deepseek-ai/dsh-mcp-client/package.json \
    && rm -rf /root/.npm /root/.dsh \
    && test -z "$(find / -xdev \( -name .credentials.yaml -o -name '.env' \) -print -quit)"
COPY config/ /opt/harness/config/
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /opt/harness/bin /workspace /harness-state \
    && ln -s /opt/harness/dsh/node_modules/.bin/dsh /opt/harness/bin/dsh

ENV PATH="/opt/harness/bin:${PATH}" \
    HOME=/harness-state \
    DSH_VERSION=${DSH_VERSION} \
    DSH_TELEMETRY_MODE=DISABLED \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
