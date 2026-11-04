# internal-task overlay: harness-eval/hermes:gstack-<pin8>, FROM the counted
# harness-eval/hermes:dev image, with the pinned gstack checkout at /opt/gstack,
# Bun at /opt/bun and the register-then-run wrapper in place of adapter.sh
# (the counted adapter is kept as adapter.real.sh). The counted image, pin.json
# and adapter are untouched; this image carries its own tag.
#
#   docker build -f harnesses/hermes/gstack/Dockerfile -t harness-eval/hermes:gstack-bd8907d6 harnesses
#   docker build -f harnesses/hermes/gstack/Dockerfile --build-arg HE_GSTACK_HERMES_MODE=chat -t harness-eval/hermes:gstack-bd8907d6-chat harnesses
#
# GSTACK_COMMIT is fetched by sha, so a moved branch head cannot change what is
# built, and the build fails when HEAD is not that commit. GSTACK_REF is the
# branch the commit was announced on (internal-task), recorded as a label only.
# HE_GSTACK_HERMES_MODE (oneshot, the default, or chat) is baked as ENV so the
# per-cell mode comes from the image: run-trial.sh passes no extra environment.
# The chat image carries the -chat tag suffix (harnesses/README.md).
ARG GSTACK_COMMIT=bd8907d6f53465c5e3679af20005fd0267fa436a
ARG GSTACK_REF=gsta-135/harness-registration
ARG BUN_VERSION=1.4.2
ARG HE_GSTACK_HERMES_MODE=oneshot
FROM harness-eval/hermes:dev
ARG GSTACK_COMMIT
ARG GSTACK_REF
ARG BUN_VERSION

ENV BUN_INSTALL=/opt/bun PATH="/opt/bun/bin:${PATH}" GSTACK_DIR=/opt/gstack
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && bun --version

# One layer: the pinned checkout, its dependencies, one setup against a
# scratch state directory so compiled bits and caches exist (the per-trial
# registration, the wrapper, then runs in seconds as the host uid run-trial.sh
# passes), Bun's download cache dropped, and the tree opened to that uid.
RUN git init -q /opt/gstack && cd /opt/gstack \
    && git remote add origin https://github.com/garrytan/gstack \
    && git fetch --depth 1 origin "${GSTACK_COMMIT}" && git checkout -q FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${GSTACK_COMMIT}" \
    && echo "gstack checkout $(git rev-parse HEAD) version $(cat VERSION) (announced on ${GSTACK_REF})" \
    && bun install --frozen-lockfile \
    && git config --system --add safe.directory /opt/gstack \
    && mkdir -p /tmp/gstack-scratch \
    && HOME=/tmp/gstack-scratch HERMES_HOME=/tmp/gstack-scratch/hermes ./setup --host hermes --no-browser \
    && rm -rf /tmp/gstack-scratch /opt/bun/install/cache && chmod -R a+rwX /opt/gstack /opt/bun

# Hermes's terminal tool takes its environment from a login shell
# (tools/environments/local.py, _run_bash with login) and /etc/profile resets
# PATH to the system default, dropping /opt/bun/bin: without this file the
# harness's own shell cannot run bun or any Bun-backed gstack helper (found by
# the runtime preflight, scripts/gsta-135/preflight.sh, 2026-10-28). It is
# what bun's installer writes to a user's profile, system-wide.
RUN printf 'export PATH="/opt/bun/bin:$PATH"\n' > /etc/profile.d/bun.sh

ARG HE_GSTACK_HERMES_MODE
ENV HE_GSTACK_HERMES_MODE=${HE_GSTACK_HERMES_MODE}
COPY _gstack/wrapper-lib.sh /opt/harness/gstack/wrapper-lib.sh
RUN mv /opt/harness/adapter.sh /opt/harness/adapter.real.sh
COPY hermes/gstack/adapter.sh /opt/harness/adapter.sh
RUN chmod 0555 /opt/harness/adapter.sh /opt/harness/adapter.real.sh /opt/harness/gstack/wrapper-lib.sh
LABEL org.harness-eval.gstack.commit="${GSTACK_COMMIT}" org.harness-eval.gstack.ref="${GSTACK_REF}" org.harness-eval.gstack.overlay="hermes" org.harness-eval.gstack.hermes_mode="${HE_GSTACK_HERMES_MODE}"
