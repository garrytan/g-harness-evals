# Fake toy fixture (internal-task). python:3.12-bookworm carries git; pinned by digest.
FROM python:3.12-bookworm@sha256:a5bab0ff300f91231c2e68bf73a8a8d60762ac39ce1c50eaf6803e4c38a9062b
COPY gh /usr/local/bin/gh
COPY repo/ /work/repo/
RUN chmod 0755 /usr/local/bin/gh \
 && cd /work/repo \
 && git init -q -b main \
 && git -c user.name=fixture -c user.email=fixture@example.invalid add -A \
 && git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "toy fixture" \
 && mkdir -p /logs/verifier
WORKDIR /work/repo
