# QM harness image. QM is a service, not a CLI: this image is the QM core
# (built from the pinned source the same way deploy/core/Dockerfile in the QM
# repository builds it, minus the WireGuard egress helper) plus our adapter.
# compose.yaml runs it twice: as the `core` service beside Postgres, and as the
# `task` container whose entrypoint is adapter.sh and which posts turns to
# core over HTTP. No API key enters this image; core gets the
# per-trial token and proxy base URL from the environment at run time.
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS src
ARG QM_REPO=https://github.com/yc-software/qm
ARG QM_TAG=v0.1.15
ARG QM_COMMIT=7417aa2a3f917cf97406914897078ae3b273e173
RUN apk add --no-cache git \
    && git clone --quiet --depth 1 --branch "${QM_TAG}" "${QM_REPO}" /src \
    && test "$(git -C /src rev-parse HEAD)" = "${QM_COMMIT}" \
    && rm -rf /src/.git

FROM ${NODE_IMAGE} AS connector-sdk-build
WORKDIR /app
COPY --from=src /src/deploy/connector-sdk ./deploy/connector-sdk
RUN npm ci --prefix deploy/connector-sdk --ignore-scripts --no-audit --no-fund \
    && node deploy/connector-sdk/build.mjs

FROM ${NODE_IMAGE}
ARG QM_TAG=v0.1.15
ARG QM_COMMIT=7417aa2a3f917cf97406914897078ae3b273e173
LABEL org.opencontainers.image.title="harness-eval QM harness (core + adapter)" \
      harness-eval.harness="qm" \
      harness-eval.version="${QM_TAG}" \
      harness-eval.commit="${QM_COMMIT}" \
      harness-eval.source="https://github.com/yc-software/qm" \
      harness-eval.topology="sidecar"
RUN apk add --no-cache ca-certificates curl git git-daemon docker-cli bash util-linux
WORKDIR /app
COPY --from=src /src/package.json /src/package-lock.json ./
COPY --from=src /src/.husky/install.mjs .husky/install.mjs
RUN npm ci --omit=dev --no-audit --no-fund && rm -rf /root/.npm /tmp/node-compile-cache
COPY --from=connector-sdk-build /app/.generated/connector-sdk ./.generated/connector-sdk
COPY --from=src /src/src ./src
COPY --from=src /src/cli/src/credential-paths.ts /src/cli/src/scope-storage-key.ts /src/cli/src/tool-descriptor.ts ./cli/src/
COPY --from=src /src/cli/templates/slack-manifest.json ./cli/templates/slack-manifest.json
COPY --from=src /src/skills-seed ./skills-seed
COPY --from=src /src/plugins/onboarding ./plugins/onboarding
COPY --from=src /src/plugins/chassis ./plugins/chassis
COPY --from=src /src/tsconfig.json ./

COPY config/ /opt/harness/config/
COPY adapter.sh qm-api.mjs qm-directory.mjs pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /data /workspace /harness-state && chown node:node /data /workspace /harness-state

ENV NODE_ENV=production DATA_DIR=/data QM_VERSION=${QM_TAG}
EXPOSE 8080
USER node
# Default command is the core service; compose overrides it for the task container.
CMD ["node", "src/index.ts"]
