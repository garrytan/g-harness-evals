# gbrain sidecar image for the gbrain arm (docs/gbrain-arm.md). Build from the repository root:
#
#   docker build -f gbrain/Dockerfile -t harness-eval/gbrain:dev .
#
# The image holds gbrain at the pinned commit (gbrain/pin.json), run from source with bun, and four
# prebuilt PGLite brains: /brains/dev and /brains/heldout, each the bot-visible slice of the Pemberline
# corpus for its split, and /brains/dev-company and /brains/heldout-company, each the whole corpus for its
# split in one federated gbrain source per reader set with one bearer token per member in tokens.json
# (gbrain/build-brain.ts; docs/gbrain-arm.md, "Company brain"), every brain with a manifest.json listing
# its pages and their sha256. gbrain records absolute paths inside a brain, so each brain is built at
# /brain in its own stage and the entrypoint copies the trial's brain back to /brain before serving. No
# API key enters the build or the image; every brain is keyword-only. The member tokens in the company
# brains are plaintext inside the image: the image is built and used on one machine, never pushed to a
# registry, and the tokens unlock only a disposable per-trial brain on the host loopback.
#
# Tag discipline: the gbrain arm's trials record the tag harness-eval/gbrain:dev; a run that needs this
# four-brain image while that arm is between preregistration and report builds it under its own tag
# (-t harness-eval/gbrain:company) and passes --gbrain-image.
ARG GBRAIN_COMMIT=089bf0d848b50b0ac8be756f3363af5401fce1a1
ARG CORPUS_COMMIT=6999ebc9da0ac784ac05995b586d22293544e924

FROM oven/bun:1.4.4-debian AS base
ARG GBRAIN_COMMIT
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --quiet https://github.com/garrytan/gbrain.git /opt/gbrain \
    && cd /opt/gbrain && git checkout --quiet "$GBRAIN_COMMIT" \
    && test "$(cat VERSION)" = "0.60.431.0" \
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

FROM base AS brain-dev-company
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
COPY --from=corpus /opt/corpus/eval/data/messy-company-v1/corpus /opt/corpus
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split dev --brain company \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM base AS brain-heldout-company
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
COPY --from=corpus /opt/corpus/eval/data/messy-company-v1/corpus /opt/corpus
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split heldout --brain company \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM base
LABEL org.opencontainers.image.title="harness-eval gbrain sidecar" \
      harness-eval.role="gbrain-sidecar" \
      harness-eval.gbrain-commit="089bf0d848b50b0ac8be756f3363af5401fce1a1" \
      harness-eval.gbrain-version="0.60.431.0"
COPY --from=brain-dev /brain /brains/dev
COPY --from=brain-heldout /brain /brains/heldout
COPY --from=brain-dev-company /brain /brains/dev-company
COPY --from=brain-heldout-company /brain /brains/heldout-company
# /brain is the per-trial working copy; the container runs as the calling user, so it must be writable by anyone.
RUN chmod -R a+rX /brains && mkdir -m 0777 /brain && chmod 0555 /opt/sidecar/gbrain/entrypoint.sh
EXPOSE 3131
ENTRYPOINT ["/opt/sidecar/gbrain/entrypoint.sh"]
