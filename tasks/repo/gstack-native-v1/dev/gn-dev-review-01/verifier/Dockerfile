FROM python@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261028T120000Z bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261028T120000Z bookworm-security main\n' > /etc/apt/sources.list.d/snapshot.list && apt-get update && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 ca-certificates=20250419~deb12u2 curl=7.88.1-10+deb12u15 && rm -rf /var/lib/apt/lists/*
COPY requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes --no-deps -r /tmp/requirements.lock && rm /tmp/requirements.lock
RUN git config --system user.name "Developer" && git config --system user.email "developer@example.com" && git config --system init.defaultBranch main && git config --system --add safe.directory "*"
COPY . /tests/
RUN rm -f /tests/Dockerfile /tests/requirements.lock && chmod -R go-rwx /tests

