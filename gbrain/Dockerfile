# gbrain sidecar image for the gbrain arm (docs/gbrain-arm.md). Build from the repository root:
#
#   docker build -f gbrain/Dockerfile -t harness-eval/gbrain:dev .
#
# The image holds gbrain at the pinned commit (gbrain/pin.json), run from source with bun, and two
# prebuilt PGLite brains, /brains/dev and /brains/heldout, each the bot-visible slice of the Pemberline
# corpus for its split (gbrain/build-brain.ts) with a manifest.json listing every page and its sha256.
# gbrain records absolute paths inside a brain, so each brain is built at /brain in its own stage and the
# entrypoint copies the trial's brain back to /brain before serving. No API key enters the build or the
# image; both brains are keyword-only.
ARG GBRAIN_COMMIT=f241216c133771545bd93e97874f859366b3ef8d
ARG CORPUS_COMMIT=6999ebc9da0ac784ac05995b586d22293544e924

FROM oven/bun:1.4.4-debian AS base
ARG GBRAIN_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --quiet https://github.com/garrytan/gbrain.git /opt/gbrain \
    && cd /opt/gbrain && git checkout --quiet "$GBRAIN_COMMIT" \
    && test "$(cat VERSION)" = "0.60.413.0" \
    && bun install --frozen-lockfile \
    && rm -rf .git
COPY gbrain/build-brain.ts gbrain/pin.json gbrain/entrypoint.sh /opt/sidecar/gbrain/
COPY world/types.ts /opt/sidecar/world/types.ts
COPY world/seed/world.json /opt/sidecar/world/seed/world.json

FROM base AS corpus
ARG CORPUS_COMMIT
RUN git clone --quiet --filter=blob:none --no-checkout https://github.com/garrytan/gbrain-evals.git /opt/corpus \
    && cd /opt/corpus && git sparse-checkout init --cone \
    && git sparse-checkout set eval/data/messy-company-v1/corpus \
    && git checkout --quiet "$CORPUS_COMMIT" && rm -rf .git

# One stage per split: the brain is built at /brain, the path it is served from, with no key in the environment.
FROM base AS brain-dev
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
COPY --from=corpus /opt/corpus/eval/data/messy-company-v1/corpus /opt/corpus
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split dev \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM base AS brain-heldout
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
COPY --from=corpus /opt/corpus/eval/data/messy-company-v1/corpus /opt/corpus
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split heldout \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM base
LABEL org.opencontainers.image.title="harness-eval gbrain sidecar" \
      harness-eval.role="gbrain-sidecar" \
      harness-eval.gbrain-commit="f241216c133771545bd93e97874f859366b3ef8d" \
      harness-eval.gbrain-version="0.60.413.0"
COPY --from=brain-dev /brain /brains/dev
COPY --from=brain-heldout /brain /brains/heldout
# /brain is the per-trial working copy; the container runs as the calling user, so it must be writable by anyone.
RUN chmod -R a+rX /brains && mkdir -m 0777 /brain && chmod 0555 /opt/sidecar/gbrain/entrypoint.sh
EXPOSE 3131
ENTRYPOINT ["/opt/sidecar/gbrain/entrypoint.sh"]
