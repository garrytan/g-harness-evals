FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils procps && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir pytest==9.0.1
COPY watch.py /opt/he/watch.py
COPY repo /work/repo
RUN chmod 755 /work/repo/scripts/precheck /work/repo/scripts/notes && mkdir -p /work/.he && cd /work/repo \
 && git init -q -b main && git config user.name "Harness Eval" && git config user.email "eval@harness-evals.invalid" \
 && git config --system --add safe.directory '*' && git add -A && git commit -q -m "stub base" && test -z "$(git status --porcelain)"
WORKDIR /work/repo
