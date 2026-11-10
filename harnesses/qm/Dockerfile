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
ARG QM_COMMIT=90e4ced75dba0f711e9737e5bb2f2d718870fb0f
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
RUN npm ci --prefix deploy/connector-sdk --ignore-scripts --no-audit --no-fund --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
    && node deploy/connector-sdk/build.mjs

FROM ${NODE_IMAGE} AS web-ui-build
WORKDIR /app/plugins/web-ui
ARG WEB_UI_BASE=/
ENV WEB_UI_BASE=$WEB_UI_BASE
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY --from=src /src/plugins/web-ui/package.json /src/plugins/web-ui/package-lock.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY --from=src /src/plugins/web-ui/index.html /src/plugins/web-ui/shared.html /src/plugins/web-ui/vite.config.ts /src/plugins/web-ui/tsconfig.json ./
COPY --from=src /src/plugins/web-ui/public ./public
COPY --from=src /src/plugins/web-ui/src ./src
COPY --from=src /src/plugins/chassis/src /app/plugins/chassis/src
COPY --from=src /src/docs/images/slack-app-config-token-setup.gif /app/docs/images/slack-app-config-token-setup.gif
RUN npm run build

FROM ${NODE_IMAGE}
ARG QM_VERSION=main@90e4ced7
ARG QM_COMMIT=90e4ced75dba0f711e9737e5bb2f2d718870fb0f
LABEL org.opencontainers.image.title="harness-eval QM harness (core + adapter)" \
      harness-eval.harness="qm" \
      harness-eval.version="${QM_VERSION}" \
      harness-eval.commit="${QM_COMMIT}" \
      harness-eval.source="https://github.com/yc-software/qm" \
      harness-eval.topology="sidecar"
RUN apk add --no-cache ca-certificates curl git git-daemon docker-cli bash util-linux
WORKDIR /app
COPY --from=src /src/package.json /src/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 && rm -rf /root/.npm /tmp/node-compile-cache
COPY --from=connector-sdk-build /app/.generated/connector-sdk ./.generated/connector-sdk
COPY --from=src /src/src ./src
COPY --from=src /src/cli/src/canonical-json.ts /src/cli/src/credential-paths.ts /src/cli/src/render-job-command.ts /src/cli/src/render-source.ts /src/cli/src/scope-storage-key.ts /src/cli/src/tool-descriptor.ts /src/cli/src/web-release.ts ./cli/src/
COPY --from=src /src/cli/templates/slack-manifest.json ./cli/templates/slack-manifest.json
COPY --from=src /src/skills-seed ./skills-seed
COPY --from=src /src/plugins/onboarding ./plugins/onboarding
COPY --from=src /src/plugins/chassis ./plugins/chassis
COPY --from=src /src/plugins/auth/src ./plugins/auth/src
COPY --from=src /src/plugins/portal/src ./plugins/portal/src
COPY --from=src /src/plugins/web-ui/server ./plugins/web-ui/server
COPY --from=src /src/plugins/web-ui/src/app-edit.ts ./plugins/web-ui/src/app-edit.ts
COPY --from=web-ui-build /app/plugins/web-ui/dist-web ./plugins/web-ui/dist-web
COPY --from=src /src/tsconfig.json ./

COPY config/ /opt/harness/config/
COPY adapter.sh qm-api.mjs qm-directory.mjs pin.json /opt/harness/
RUN chmod 0555 /opt/harness/adapter.sh && mkdir -p /data /workspace /harness-state && chown node:node /data /workspace /harness-state

ENV NODE_ENV=production DATA_DIR=/data QM_VERSION=${QM_VERSION} GIT_SHA=${QM_COMMIT}
EXPOSE 8080
USER node
# Default command is the core service; compose overrides it for the task container.
CMD ["node", "src/index.ts"]
