ARG BASE
FROM ${BASE}
ARG HARNESS
ARG SIZES=4,8,12,16,20,24,32,48,64,80
USER root
COPY gen-skills.py /opt/anatomy/gen-skills.py
COPY skills-entry.sh /opt/anatomy/skills-entry.sh
RUN python3 /opt/anatomy/gen-skills.py /opt/anatomy-skills ${SIZES} && chmod -R a+rX /opt/anatomy-skills /opt/anatomy && chmod +x /opt/anatomy/skills-entry.sh
ENV ANATOMY_HARNESS=${HARNESS}
ENTRYPOINT ["/opt/anatomy/skills-entry.sh"]
CMD ["run"]
