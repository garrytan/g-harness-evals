# Harness Zero image (internal-task). zero.ts runs on Bun built-ins only, so the image is the pinned Bun base plus four files
# and the config directory under /opt/harness, read-only at run time. All mutable state goes to /harness-state through
# HOME and TMPDIR (adapter.sh). No API key enters this image: the adapter passes the per-trial token and the proxy base
# URL from HE_MODEL_API_KEY and HE_MODEL_BASE_URL in the process environment. The Dockerfile is copied in too, because
# the candidate hash (zero.ts candidateHash) covers it.
FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288
LABEL org.opencontainers.image.title="harness-eval Harness Zero" \
      harness-eval.harness="harness-zero" \
      harness-eval.version="bun-1.4.3" \
      harness-eval.topology="in-container"

COPY zero.ts adapter.sh pin.json Dockerfile /opt/harness/
COPY config/ /opt/harness/config/
RUN test "$(bun --version)" = "1.4.3" \
    && chmod 0555 /opt/harness/adapter.sh && chmod -R a-w /opt/harness \
    && mkdir -p /workspace /harness-state && chmod 0777 /workspace /harness-state

ENV HOME=/harness-state CI=1 TERM=dumb NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["/opt/harness/adapter.sh"]
CMD ["run"]
