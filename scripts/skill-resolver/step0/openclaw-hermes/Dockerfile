# internal-task Step 0 catalog probe image: FROM a counted harness image, with the skill catalog under /opt/step0-skills. The entry
# script puts the catalog where the harness reads skills, applies the configuration baked in STEP0_CONFIG, then execs the
# counted adapter unchanged. Built by scripts/skill-resolver/step0/openclaw-hermes/build-probe.sh.
ARG BASE
FROM ${BASE}
ARG HARNESS
ARG STEP0_CONFIG=native
USER root
COPY skills/ /opt/step0-skills/
COPY entry.sh /opt/step0/entry.sh
RUN chmod -R a+rX /opt/step0-skills /opt/step0 && chmod +x /opt/step0/entry.sh
ENV STEP0_HARNESS=${HARNESS} STEP0_CONFIG=${STEP0_CONFIG}
ENTRYPOINT ["/opt/step0/entry.sh"]
CMD ["run"]
