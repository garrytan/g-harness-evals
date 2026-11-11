# The gstack arm builder (internal-task): a pinned gstack checkout, its dependencies and the Bun it needs, built the way a user
# installs gstack (fetch by sha, bun install --frozen-lockfile). build.sh then runs ./setup --host <h> --no-browser in a
# container of this image and renders each arm's skill tree with gstack-modules render. HOME is a build argument, so the
# builder's HOME matches the task container's and every path the render writes is the path the container has.
#
#   docker build -t gstack-arm-builder:<commit12> --build-arg GSTACK_COMMIT=<40 hex> --build-arg BUN_VERSION=<v> \
#     --build-arg BUN_SHA256=<hex> --build-arg BUILDER_HOME=/root scripts/frontier-harbor/gstack-builder
#
# scripts/frontier-harbor/gstack-arm.ts passes every argument from pin.json gstack_runtime and the preregistration's
# gstack_pin. The fetch is by sha, so a moved branch cannot change the build, and the build fails when HEAD is not the
# commit. Bun's download cache is dropped, as the internal-task Hermes overlay does.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG GSTACK_REPO
ARG GSTACK_COMMIT
ARG BUN_VERSION
ARG BUN_SHA256
ARG BUILDER_HOME=/root
ENV HOME=${BUILDER_HOME}
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git curl unzip ca-certificates >/dev/null && rm -rf /var/lib/apt/lists/* \
    && mkdir -p "$HOME"
RUN curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
    && echo "${BUN_SHA256}  /tmp/bun.zip" | sha256sum -c - \
    && mkdir -p "$HOME/.bun/bin" && unzip -qj /tmp/bun.zip -d "$HOME/.bun/bin" && rm /tmp/bun.zip \
    && chmod 0755 "$HOME/.bun/bin/bun" && ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun && test "$(bun --version)" = "${BUN_VERSION}"
RUN G="$HOME/.local/share/gstack" && git init -q "$G" && cd "$G" && git remote add origin "${GSTACK_REPO}" \
    && git fetch -q --depth 1 origin "${GSTACK_COMMIT}" && git checkout -q FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${GSTACK_COMMIT}" \
    && bun install --frozen-lockfile && rm -rf "$HOME/.bun/install/cache"
COPY build.sh /usr/local/bin/gstack-arm-build
RUN chmod 0555 /usr/local/bin/gstack-arm-build
