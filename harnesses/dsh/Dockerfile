# DeepSeek Harness (dsh) image. dsh is installed from npm with `npm ci` against the committed
# package-lock.json, so every package (dsh and its 653 dependencies) is fixed by integrity hash:
# dsh declares most dependencies with ~ or ^ ranges, and a plain `npm install` would build a different
# tree on another day. The runtime lives under /opt/harness (read-only at run time); all mutable
# state goes to /harness-state through HOME and DSH_HOME. No API key enters this image: the adapter
# passes the per-trial token and the proxy base URL from HE_MODEL_API_KEY and HE_MODEL_BASE_URL in the
# process environment, and config/patch.yml reads them there.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG DSH_VERSION=0.2.2-rc.1
# Unset by default (registry.npmjs.org). A build behind a registry mirror passes its URL; the
# lockfile's integrity hashes still decide what is installed, whichever host serves the tarballs.
ARG npm_config_registry
LABEL org.opencontainers.image.title="harness-eval DeepSeek Harness (dsh)" \
      harness-eval.harness="dsh" \
      harness-eval.version="${DSH_VERSION}" \
      harness-eval.source="https://github.com/deepseek-ai/deepseek-harness" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

# package.json's allowScripts runs the three install scripts dsh needs (its subprocess helper for the
# bash tool, and two native modules) and denies the other two (@google/genai, protobufjs).
COPY package.json package-lock.json /opt/harness/
RUN cd /opt/harness \
    && npm ci --no-audit --no-fund ${npm_config_registry:+--replace-registry-host=always} \
    && npm cache clean --force \
    && test "$(/opt/harness/node_modules/.bin/dsh --version)" = "${DSH_VERSION}" \
    && rm -rf /root/.dsh /root/.npm \
    && test -z "$(find / -xdev -name .credentials.yaml -print -quit)"

COPY config/ /opt/harness/config/
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/node_modules/.bin:${PATH}" \
    HOME=/harness-state \
    DSH_HOME=/harness-state/dsh \
    DSH_VERSION=${DSH_VERSION} \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
