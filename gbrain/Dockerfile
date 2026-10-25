# gbrain sidecar image for the gbrain arm and the install ladder (docs/gbrain-arm.md). Build from the repository root:
#
#   docker build -f gbrain/Dockerfile -t harness-eval/gbrain:dev .                   # keyword brains, keyless (the default target)
#   scripts/build-gbrain-image.sh [--gbrain <sha>] [--embedded]                        # the same, or the embedded target too
#
# The image holds gbrain at GBRAIN_COMMIT (default the pin in gbrain/pin.json), run from source with bun, and prebuilt
# PGLite brains: /brains/dev and /brains/heldout, each the bot-visible slice of the Pemberline corpus for its split, and
# /brains/dev-company and /brains/heldout-company, each the whole corpus for its split in one federated gbrain source per
# reader set with one bearer token per member in tokens.json (gbrain/build-brain.ts; docs/gbrain-arm.md, "Company brain"),
# every brain with a manifest.json listing its pages and their sha256. gbrain records absolute paths inside a brain, so
# each brain is built at /brain in its own stage and the entrypoint copies the trial's brain back to /brain before serving.
# No API key enters the build or the image; every brain in the default target is keyword-only. The member tokens in the
# company brains are plaintext inside the image: the image is built and used on one machine, never pushed to a registry,
# and the tokens unlock only a disposable per-trial brain on the host loopback.
#
# internal-task (the install ladder): /install holds the install bundle, what gbrain's own docs tell a user to run for OpenClaw
# and Hermes at this commit, run once here by gbrain/build-install.ts (skillpack scaffold per harness, compile-context per
# split for Hermes, and gbrain setup <harness> --instructions-only where the commit has it, internal-task) with a manifest of every
# file's sha256; a gbrain-docs or gbrain-installer cell mounts one harness and split view of it into the harness container. The "embedded" target adds /brains/dev-embedded and /brains/heldout-embedded, bot-visible brains
# whose pages carry OpenAI embeddings; they are built outside this file by scripts/build-gbrain-image.sh --embedded, in a
# container from the "builder" target, through the metering proxy (OPENAI_BASE_URL only, no key), into gbrain/.build/brains/,
# and copied in. GBRAIN_VERSION, when set, must equal the checkout's VERSION file (the check tool builds any commit and
# leaves it unset).
#
# Tag discipline: the gbrain arm's trials record the tag harness-eval/gbrain:dev; a run that needs another image while that
# arm is between preregistration and report builds under its own tag (-t harness-eval/gbrain:<name>) and passes --gbrain-image.
ARG GBRAIN_COMMIT=089bf0d848b50b0ac8be756f3363af5401fce1a1
ARG GBRAIN_VERSION=
ARG CORPUS_COMMIT=6999ebc9da0ac784ac05995b586d22293544e924

FROM oven/bun:1.4.4-debian AS base
ARG GBRAIN_COMMIT
ARG GBRAIN_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git jq \
    && rm -rf /var/lib/apt/lists/*
# A shallow fetch of exactly the pinned commit (a full sha or a branch name; GitHub serves both).
RUN git init --quiet /opt/gbrain && cd /opt/gbrain \
    && git remote add origin https://github.com/garrytan/gbrain.git \
    && git fetch --quiet --depth 1 origin "$GBRAIN_COMMIT" \
    && git checkout --quiet FETCH_HEAD \
    && resolved="$(git rev-parse HEAD)" && version="$(cat VERSION)" \
    && if [ -n "$GBRAIN_VERSION" ] && [ "$version" != "$GBRAIN_VERSION" ]; then echo "gbrain VERSION is $version, GBRAIN_VERSION asks for $GBRAIN_VERSION" >&2; exit 1; fi \
    && bun install --frozen-lockfile \
    && rm -rf .git \
    && mkdir -p /opt/sidecar \
    && printf '{"gbrain_commit":"%s","gbrain_ref":"%s","gbrain_version":"%s","bun":"%s"}\n' "$resolved" "$GBRAIN_COMMIT" "$version" "$(bun --version)" > /opt/sidecar/image.json
COPY gbrain/build-brain.ts gbrain/build-install.ts gbrain/pin.json gbrain/entrypoint.sh gbrain/export-install.sh /opt/sidecar/gbrain/
COPY world/types.ts /opt/sidecar/world/types.ts
COPY world/seed/world.json /opt/sidecar/world/seed/world.json

FROM base AS corpus
ARG CORPUS_COMMIT
RUN git clone --quiet --filter=blob:none --no-checkout https://github.com/garrytan/gbrain-evals.git /opt/corpus \
    && cd /opt/corpus && git sparse-checkout init --cone \
    && git sparse-checkout set eval/data/messy-company-v1/corpus \
    && git checkout --quiet "$CORPUS_COMMIT" && rm -rf .git

# The brain builder: gbrain plus the corpus, nothing built yet. scripts/build-gbrain-image.sh --embedded runs this stage as a
# container with /brain bind-mounted and OPENAI_BASE_URL pointing at the metering proxy to build the embedded brains.
FROM base AS builder
COPY --from=corpus /opt/corpus/eval/data/messy-company-v1/corpus /opt/corpus
RUN mkdir -m 0777 /brain

# One stage per split: the brain is built at /brain, the path it is served from, with no key in the environment.
FROM builder AS brain-dev
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split dev \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM builder AS brain-heldout
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split heldout \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM builder AS brain-dev-company
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split dev --brain company \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

FROM builder AS brain-heldout-company
ARG GBRAIN_COMMIT
ARG CORPUS_COMMIT
RUN env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-brain.ts --split heldout --brain company \
      --corpus /opt/corpus --world /opt/sidecar/world/seed/world.json --out /brain --staging /tmp/staging \
      --gbrain "bun /opt/gbrain/src/cli.ts" --commit "$GBRAIN_COMMIT" --corpus-commit "$CORPUS_COMMIT"

# internal-task: the install bundle, built from the gbrain checkout and the two bot-visible brains, keyless. internal-task: the installer
# section runs gbrain setup <harness> --instructions-only; for Hermes the build HERMES_HOME is seeded first with Hermes's own
# SOUL.md at the pinned Hermes commit (harnesses/hermes/pin.json soul_md: what Hermes's first run writes into HERMES_HOME, which
# gbrain never creates), fetched here and checked against the pinned sha256.
FROM base AS install
ARG GBRAIN_COMMIT
ARG HERMES_COMMIT=f97608f178d1ffeca59860195ab7da295f7c8e5f
ARG HERMES_SOUL_SHA256=36c1f5a2e92cd1d018311eaf4c8f1e8886672eae78212e033c681d0e3d5d506f
COPY --from=brain-dev /brain /brains/dev
COPY --from=brain-heldout /brain /brains/heldout
RUN mkdir -p /opt/sidecar/hermes && curl -fsSL "https://raw.githubusercontent.com/NousResearch/hermes-agent/$HERMES_COMMIT/SOUL.md" -o /opt/sidecar/hermes/SOUL.md \
    && echo "$HERMES_SOUL_SHA256  /opt/sidecar/hermes/SOUL.md" | sha256sum -c --quiet
RUN mkdir -m 0777 /brain && env -i PATH="$PATH" HOME=/tmp bun /opt/sidecar/gbrain/build-install.ts --out /install \
      --gbrain "bun /opt/gbrain/src/cli.ts" --brains /brains --brain-home /brain --commit "$GBRAIN_COMMIT" --scratch /tmp/install-scratch \
      --hermes-soul /opt/sidecar/hermes/SOUL.md --hermes-commit "$HERMES_COMMIT"

FROM base AS keyword
ARG GBRAIN_COMMIT
LABEL org.opencontainers.image.title="harness-eval gbrain sidecar" \
      harness-eval.role="gbrain-sidecar" \
      harness-eval.gbrain-commit="$GBRAIN_COMMIT"
COPY --from=brain-dev /brain /brains/dev
COPY --from=brain-heldout /brain /brains/heldout
COPY --from=brain-dev-company /brain /brains/dev-company
COPY --from=brain-heldout-company /brain /brains/heldout-company
COPY --from=install /install /install
# /brain is the per-trial working copy; the container runs as the calling user, so it must be writable by anyone.
RUN chmod -R a+rX /brains /install && mkdir -m 0777 /brain && chmod 0555 /opt/sidecar/gbrain/entrypoint.sh /opt/sidecar/gbrain/export-install.sh
EXPOSE 3131
ENTRYPOINT ["/opt/sidecar/gbrain/entrypoint.sh"]

# internal-task: the embedded target adds the two bot-visible brains with OpenAI embeddings, built by scripts/build-gbrain-image.sh
# --embedded into gbrain/.build/brains/<split>-embedded (gitignored) through the metering proxy; their manifest.json records
# the embedding model, dimensions and the proxy's usage summary.
FROM keyword AS embedded
COPY gbrain/.build/brains/dev-embedded /brains/dev-embedded
COPY gbrain/.build/brains/heldout-embedded /brains/heldout-embedded
RUN chmod -R a+rX /brains && test -s /brains/dev-embedded/manifest.json && test -s /brains/heldout-embedded/manifest.json \
    && jq -e '.embeddings.model' /brains/dev-embedded/manifest.json >/dev/null && jq -e '.embeddings.model' /brains/heldout-embedded/manifest.json >/dev/null

# The default target is the keyword image.
FROM keyword
