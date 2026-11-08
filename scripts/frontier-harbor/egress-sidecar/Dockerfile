# Adapted from Harbor 0.24.0 harbor/environments/docker/harbor-docker-egress-control-sidecar/Dockerfile (Apache-2.0,
# harbor-framework/harbor). Changed for the frontier Harbor path (internal-task): blocklist.txt is added.
FROM gogost/gost:3.2.7-nightly.20260602@sha256:afc0137758ab4ce399d47a299f9abbacbf522b52a17e59cbb4b4e7a1a66e9196

COPY gost.yaml allowlist.txt blocklist.txt /opt/egress-sidecar/
COPY --chmod=755 entrypoint.sh /opt/egress-sidecar/entrypoint.sh
COPY --chmod=755 bin/network-policy /usr/local/bin/network-policy
