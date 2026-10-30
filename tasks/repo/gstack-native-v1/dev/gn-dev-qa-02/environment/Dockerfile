FROM node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS node
FROM python@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261028T120000Z bookworm main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261028T120000Z bookworm-security main\n' > /etc/apt/sources.list.d/snapshot.list && apt-get update && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 ca-certificates=20250419~deb12u2 curl=7.88.1-10+deb12u15 && rm -rf /var/lib/apt/lists/*
COPY requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes --no-deps -r /tmp/requirements.lock && rm /tmp/requirements.lock
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright NODE_PATH=/usr/local/lib/node_modules CONTAINER=1
RUN npm install -g playwright@1.62.1 && npx playwright install --with-deps chromium && chmod -R a+rX /opt/ms-playwright && rm -rf /var/lib/apt/lists/* /root/.npm
RUN git config --system user.name "Developer" && git config --system user.email "developer@example.com" && git config --system init.defaultBranch main && git config --system --add safe.directory "*"
COPY gh /usr/local/bin/gh
RUN chmod 755 /usr/local/bin/gh
ADD work.tar /work/
RUN mkdir -p /work/out/repros && chmod -R 777 /work/out
WORKDIR /work/repo
