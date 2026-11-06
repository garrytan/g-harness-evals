# Hermes Agent harness image. The source is checked out at a pinned tag into
# /opt/harness/src and installed with uv into /opt/harness/venv (read-only at
# run time); all mutable state goes to /harness-state through HERMES_HOME.
# The install is editable (-e) because Hermes refuses to build a wheel outside
# Nix (setup.py guard); the source checkout is the supported layout. The native
# Anthropic extra and the MCP client extra (the world-MCP server in serve mode)
# are installed at build time because Hermes would otherwise lazy-install them
# on first use, which a read-only /opt/harness forbids. No API key enters this
# image. Tirith, the command scanner Hermes runs before terminal commands, is
# pinned (internal-task, H10): one release, checked by sha256, at /opt/tirith/bin.
# TIRITH_BIN names that path, so Hermes never downloads a scanner at trial time
# (tools/tirith_security.py treats an explicit path as authoritative), and
# TIRITH_OFFLINE=1 stops Tirith's own threat-DB download, so the scan is a
# function of the pinned binary alone (pin.json tirith).
ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.6
FROM ${UV_IMAGE} AS uv_source
FROM ${PYTHON_IMAGE}
ARG HERMES_REPO=https://github.com/NousResearch/hermes-agent
ARG HERMES_TAG=v2026.9.24
ARG HERMES_COMMIT=f97608f178d1ffeca59860195ab7da295f7c8e5f
LABEL org.opencontainers.image.title="harness-eval Hermes Agent harness" \
      harness-eval.harness="hermes" \
      harness-eval.version="${HERMES_TAG}" \
      harness-eval.commit="${HERMES_COMMIT}" \
      harness-eval.source="${HERMES_REPO}" \
      harness-eval.topology="in-container"

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl ripgrep procps \
    && rm -rf /var/lib/apt/lists/*
COPY --from=uv_source /uv /uvx /usr/local/bin/

RUN git clone --quiet --depth 1 --branch "${HERMES_TAG}" "${HERMES_REPO}" /opt/harness/src \
    && test "$(git -C /opt/harness/src rev-parse HEAD)" = "${HERMES_COMMIT}" \
    && rm -rf /opt/harness/src/.git
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN uv venv --python /usr/local/bin/python3 /opt/harness/venv \
    && uv pip install --python /opt/harness/venv/bin/python --no-cache -e "/opt/harness/src[anthropic,mcp]" \
    && /opt/harness/venv/bin/hermes --version

ARG TIRITH_VERSION=0.4.2
ARG TIRITH_SHA256_AMD64=efa6bf414a83dba385d4f13137e8677f850ced9102fe74ebb14c72f31df0dc77
ARG TIRITH_SHA256_ARM64=c550b1bfb0c8c872ab3421cd6ef756f260f7cf4981a18cedd49f141fa2d77569
ARG TARGETARCH
RUN case "${TARGETARCH:-amd64}" in \
      amd64) target=x86_64-unknown-linux-gnu sum="${TIRITH_SHA256_AMD64}" ;; \
      arm64) target=aarch64-unknown-linux-gnu sum="${TIRITH_SHA256_ARM64}" ;; \
      *) echo "no pinned tirith build for ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/tirith.tar.gz "https://github.com/sheeki03/tirith/releases/download/v${TIRITH_VERSION}/tirith-${target}.tar.gz" \
    && echo "${sum}  /tmp/tirith.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/tirith/bin && tar -xzf /tmp/tirith.tar.gz -C /opt/tirith/bin tirith && rm /tmp/tirith.tar.gz \
    && test "$(HOME=/tmp TIRITH_OFFLINE=1 /opt/tirith/bin/tirith --version)" = "tirith ${TIRITH_VERSION}" \
    && rm -rf /tmp/.local

COPY config/ /opt/harness/config/
COPY routes/ /opt/harness/routes/
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/venv/bin:${PATH}" \
    HOME=/harness-state \
    HERMES_HOME=/harness-state/hermes \
    HERMES_VERSION=${HERMES_TAG} \
    TIRITH_BIN=/opt/tirith/bin/tirith TIRITH_OFFLINE=1 \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
