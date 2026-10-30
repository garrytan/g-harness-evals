# Fake toy fixture (internal-task): the separate verifier image. Same pinned base as the agent image, without the starting
# /work; Harbor restores the agent's /work here as an artifact before verify.sh runs.
FROM python:3.12-bookworm@sha256:a5bab0ff300f91231c2e68bf73a8a8d60762ac39ce1c50eaf6803e4c38a9062b
COPY . /tests/
RUN chmod -R a+rX /tests && mkdir -p /logs/verifier
