# Pi harness image. The Pi coding agent (@earendil-works/pi-coding-agent, the pi-mono agent) is installed from npm
# under /opt/harness by npm ci from package-lock.json, which pins Pi and every package it pulls in by version and
# integrity, with lifecycle scripts off (Pi needs none). /opt/harness is read-only at run time; all mutable state
# goes to /harness-state through HOME, PI_CODING_AGENT_DIR and TMPDIR. The build checks pi --version against
# PI_VERSION. No API key, auth.json or models.json enters this image: the adapter writes models.json under
# /harness-state from config/ and the per-trial token stays in the process environment (HE_MODEL_API_KEY).
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG PI_VERSION=1.5.0
LABEL org.opencontainers.image.title="harness-eval Pi harness" \
      harness-eval.harness="pi" \
      harness-eval.version="${PI_VERSION}" \
      harness-eval.source="https://www.npmjs.com/package/@earendil-works/pi-coding-agent" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json /opt/harness/
RUN cd /opt/harness && npm ci --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force && rm -rf /root/.npm /root/.pi \
    && test "$(/opt/harness/node_modules/.bin/pi --version)" = "${PI_VERSION}" \
    && test -z "$(find / -xdev \( -name auth.json -o -name models.json \) -path '*/.pi/*' -print -quit)"
COPY config/ /opt/harness/config/
COPY extension/ /opt/harness/extension/
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/node_modules/.bin:${PATH}" \
    HOME=/harness-state \
    PI_CODING_AGENT_DIR=/harness-state/pi/agent \
    PI_VERSION=${PI_VERSION} \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
