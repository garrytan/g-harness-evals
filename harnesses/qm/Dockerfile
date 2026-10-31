# QM harness image. QM is a service, not a CLI: this image is the QM core
# (built from the pinned source the same way deploy/core/Dockerfile in the QM
# repository builds it, minus the WireGuard egress helper and the npm audit
# step) plus our adapter. compose.yaml runs it twice: as the `core` service
# beside Postgres, and as the `task` container whose entrypoint is adapter.sh
# and which posts turns to core over HTTP. No API key enters this image; core
# gets the per-trial token and proxy base URL from the environment at run time.
#
# QM is pinned by commit (main has no release tag past v0.1.15): QM_COMMIT is
# fetched by sha, so a moved branch cannot change what is built, and the build
# fails when HEAD is not that commit. The base image is the digest QM's own
# deploy/core/Dockerfile pins at that commit.
ARG NODE_IMAGE=node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
FROM ${NODE_IMAGE} AS src
ARG QM_REPO=https://github.com/yc-software/qm
ARG QM_COMMIT=b6786d675f83d9a818c5d5335cc017ffea9ec7a7
RUN apk add --no-cache git \
    && git init -q /src && cd /src \
    && git remote add origin "${QM_REPO}" \
    && git fetch --quiet --depth 1 origin "${QM_COMMIT}" && git checkout -q FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${QM_COMMIT}" \
    && echo "qm checkout $(git rev-parse HEAD)" \
    && rm -rf /src/.git

FROM ${NODE_IMAGE} AS connector-sdk-build
WORKDIR /app
COPY --from=src /src/deploy/connector-sdk ./deploy/connector-sdk
RUN npm ci --prefix deploy/connector-sdk --ignore-scripts --no-audit --no-fund \
    && node deploy/connector-sdk/build.mjs

FROM ${NODE_IMAGE}
ARG QM_VERSION=main@b6786d67
ARG QM_COMMIT=b6786d675f83d9a818c5d5335cc017ffea9ec7a7
LABEL org.opencontainers.image.title="harness-eval QM harness (core + adapter)" \
      harness-eval.harness="qm" \
      harness-eval.version="${QM_VERSION}" \
      harness-eval.commit="${QM_COMMIT}" \
      harness-eval.source="https://github.com/yc-software/qm" \
      harness-eval.topology="sidecar"
RUN apk add --no-cache ca-certificates curl git git-daemon docker-cli bash util-linux
WORKDIR /app
COPY --from=src /src/package.json /src/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf /root/.npm /tmp/node-compile-cache
COPY --from=connector-sdk-build /app/.generated/connector-sdk ./.generated/connector-sdk
COPY --from=src /src/src ./src
COPY --from=src /src/cli/src/canonical-json.ts /src/cli/src/credential-paths.ts /src/cli/src/render-job-command.ts /src/cli/src/render-source.ts /src/cli/src/scope-storage-key.ts /src/cli/src/tool-descriptor.ts ./cli/src/
COPY --from=src /src/cli/templates/slack-manifest.json ./cli/templates/slack-manifest.json
COPY --from=src /src/skills-seed ./skills-seed
COPY --from=src /src/plugins/onboarding ./plugins/onboarding
COPY --from=src /src/plugins/chassis ./plugins/chassis
COPY --from=src /src/tsconfig.json ./

COPY config/ /opt/harness/config/
COPY adapter.sh qm-api.mjs qm-directory.mjs pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /data /workspace /harness-state && chown node:node /data /workspace /harness-state

ENV NODE_ENV=production DATA_DIR=/data QM_VERSION=${QM_VERSION} GIT_SHA=${QM_COMMIT}
EXPOSE 8080
USER node
# Default command is the core service; compose overrides it for the task container.
CMD ["node", "src/index.ts"]
