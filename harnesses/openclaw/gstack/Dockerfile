# internal-task overlay: harness-eval/openclaw:gstack-<pin8>, FROM the counted
# harness-eval/openclaw:dev image, with the pinned gstack checkout at /opt/gstack,
# Bun at /opt/bun and the register-then-exec wrapper in place of adapter.sh
# (the counted adapter is kept as adapter.real.sh). The counted image, pin.json
# and adapter are untouched; this image carries its own tag.
#
#   docker build -f harnesses/openclaw/gstack/Dockerfile -t harness-eval/openclaw:gstack-bd8907d6 harnesses
#
# GSTACK_COMMIT is fetched by sha, so a moved branch head cannot change what is
# built, and the build fails when HEAD is not that commit. GSTACK_REF is the
# branch the commit was announced on (internal-task), recorded as a label only.
ARG GSTACK_COMMIT=bd8907d6f53465c5e3679af20005fd0267fa436a
ARG GSTACK_REF=gsta-135/harness-registration
ARG BUN_VERSION=1.4.2
FROM harness-eval/openclaw:dev
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
    && HOME=/tmp/gstack-scratch OPENCLAW_STATE_DIR=/tmp/gstack-scratch/openclaw ./setup --host openclaw --no-browser \
    && rm -rf /tmp/gstack-scratch /opt/bun/install/cache && chmod -R a+rwX /opt/gstack /opt/bun

COPY _gstack/wrapper-lib.sh /opt/harness/gstack/wrapper-lib.sh
RUN mv /opt/harness/adapter.sh /opt/harness/adapter.real.sh
COPY openclaw/gstack/adapter.sh /opt/harness/adapter.sh
RUN chmod 0555 /opt/harness/adapter.sh /opt/harness/adapter.real.sh /opt/harness/gstack/wrapper-lib.sh
LABEL org.harness-eval.gstack.commit="${GSTACK_COMMIT}" org.harness-eval.gstack.ref="${GSTACK_REF}" org.harness-eval.gstack.overlay="openclaw"
