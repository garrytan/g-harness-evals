# internal-task step 0 catalog probe image: FROM a counted harness image, the catalog where that harness reads user skills,
# then the counted adapter unchanged (the pattern of scripts/anatomy/probe-skills).
#   docker build -f scripts/skill-resolver/step0/claude-codex/Dockerfile --build-context catalog=<dir with native/ and names-only/>
#     --build-arg BASE=harness-eval/<h>:dev --build-arg HARNESS=<claude-code|codex> --build-arg VARIANT=<native|names-only|no-bundled>
#     -t harness-eval/<h>:step0-<variant> scripts/skill-resolver/step0
ARG BASE
FROM ${BASE}
ARG HARNESS
ARG VARIANT=native
USER root
COPY --from=catalog native /opt/step0-catalog/native
COPY --from=catalog names-only /opt/step0-catalog/names-only
COPY catalog-entry.sh /opt/step0/catalog-entry.sh
COPY codex-names-only.toml codex-no-bundled.toml /opt/step0/
RUN chmod -R a+rX /opt/step0-catalog /opt/step0 && chmod +x /opt/step0/catalog-entry.sh \
  && if [ "$HARNESS" = codex ] && [ "$VARIANT" != native ]; then mkdir -p /etc/codex && cp /opt/step0/codex-$VARIANT.toml /etc/codex/config.toml && chmod a+r /etc/codex/config.toml; fi
ENV STEP0_HARNESS=${HARNESS} STEP0_VARIANT=${VARIANT}
ENTRYPOINT ["/opt/step0/catalog-entry.sh"]
CMD ["run"]
