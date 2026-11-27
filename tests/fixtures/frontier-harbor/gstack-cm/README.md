gstack build-check fixtures for the gstack cheap-model audit (internal-task)

Two SKILL.md files exactly as gstack 1.104.0.0 (commit e6dd567349e85506127c2f4cf69a0392923c032c) writes them, copied from
the trees gstack-fingerprints.ts's setup recipe made with the checkout at /opt/gstack-bundle/gstack, delivery.py's bundle
layout (scripts/frontier-harbor/gstack-fingerprints.json, generated):

- hermes-gstack-build-check-SKILL.md.txt: HERMES_HOME=/tmp/hermes (cd /opt/gstack-bundle/gstack && ./setup --host hermes
  --no-browser) wrote it at
  /tmp/hermes/skills/gstack/gstack-build-check/SKILL.md.
- openclaw-build-check-SKILL.md.txt: (cd /opt/gstack-bundle/gstack && ./setup --host openclaw --no-browser) wrote it at
  ~/.openclaw/skills/gstack/skills/gstack-build-check/SKILL.md (reached through the gstack router skill).

gstack is MIT licensed (Copyright (c) 2026 Garry Tan). The .txt suffix keeps the link checker and skill loaders off them.
tests/frontier-harbor-gstack-exposure.test.ts checks that the committed body fingerprints match these files.
