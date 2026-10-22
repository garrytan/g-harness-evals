# Hermes Agent harness image. The source is checked out at a pinned tag into
# /opt/harness/src and installed with uv into /opt/harness/venv (read-only at
# run time); all mutable state goes to /harness-state through HERMES_HOME.
# The install is editable (-e) because Hermes refuses to build a wheel outside
# Nix (setup.py guard); the source checkout is the supported layout. The native
# Anthropic extra is installed at build time because Hermes would otherwise
# lazy-install it on first use, which a read-only /opt/harness forbids. No API
# key enters this image.
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
    && uv pip install --python /opt/harness/venv/bin/python --no-cache -e "/opt/harness/src[anthropic]" \
    && /opt/harness/venv/bin/hermes --version

COPY config/ /opt/harness/config/
COPY adapter.sh pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /workspace /harness-state

ENV PATH="/opt/harness/venv/bin:${PATH}" \
    HOME=/harness-state \
    HERMES_HOME=/harness-state/hermes \
    HERMES_VERSION=${HERMES_TAG} \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
