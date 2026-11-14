# Cursor CLI harness image. The Cursor Agent CLI (`agent`, also `cursor-agent`) is installed from the package that
# https://cursor.com/install pointed at on 2026-11-09 (the install script is regenerated per release, so its steps are
# reproduced here at a pinned version instead of piping the moving script into bash): the linux-x64 tarball is fetched,
# checked against its sha256 and unpacked under /opt/harness (read-only at run time). All mutable state goes to
# /harness-state through HOME. No API key enters this image: the runner passes CURSOR_API_KEY by name into the running
# container only (harnesses/cursor/README.md, "Keys"). The build checks the package and launcher sha256 values and
# that agent --version prints the pinned version, then removes the HOME that check wrote.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG CURSOR_AGENT_VERSION=2026.11.05-86047df
ARG CURSOR_AGENT_SHA256=170b77786cbf4c93064d64fff12b71a178b968730561c64afc2e8e752535442e
ARG CURSOR_LAUNCHER_SHA256=2ccc9a8e167797641448b5e5c936f006ba137a2555f117f38c5eb76a5238a233
LABEL org.opencontainers.image.title="harness-eval Cursor CLI harness" \
      harness-eval.harness="cursor" \
      harness-eval.version="${CURSOR_AGENT_VERSION}" \
      harness-eval.source="https://cursor.com/install" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://downloads.cursor.com/lab/${CURSOR_AGENT_VERSION}/linux/x64/agent-cli-package.tar.gz" -o /tmp/agent-cli-package.tar.gz \
    && echo "${CURSOR_AGENT_SHA256}  /tmp/agent-cli-package.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/harness/cursor-agent /opt/harness/bin \
    && tar --strip-components=1 -xzf /tmp/agent-cli-package.tar.gz -C /opt/harness/cursor-agent \
    && rm /tmp/agent-cli-package.tar.gz \
    && echo "${CURSOR_LAUNCHER_SHA256}  /opt/harness/cursor-agent/cursor-agent" | sha256sum -c - \
    && ln -s ../cursor-agent/cursor-agent /opt/harness/bin/agent \
    && ln -s ../cursor-agent/cursor-agent /opt/harness/bin/cursor-agent \
    && test "$(HOME=/tmp/cursor-version-check /opt/harness/bin/agent --version)" = "${CURSOR_AGENT_VERSION}" \
    && rm -rf /tmp/cursor-version-check /root/.cursor /root/.cache \
    && test -z "$(find / -xdev -path /proc -prune -o -name cli-config.json -print -quit)"

COPY config/ /opt/harness/config/
COPY adapter.sh pin.json redact.cjs tool-audit-hook.cjs /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/bin:${PATH}" \
    HOME=/harness-state \
    CURSOR_AGENT_VERSION=${CURSOR_AGENT_VERSION} \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["serve"]
