# QM in the skill listing map (keyless)

QM (main@90e4ced7, Pi inside) lists skills in a "## Skills" block of the system prompt, capped at 12,000 characters. The names-only cell is the same catalog with each description replaced by the skill's name, so it shows whether names alone fit. Route: PLUGIN_SKILLS_DIRS (the probe images with only their environment changed: ENV DEPLOYMENT_LAYER= PLUGIN_SKILLS_DIRS=/app/plugins/onboarding/skills,/opt/catalog-layer/skills).

| Config | Skills | With description | Name only | Installed, not shown | Not installed | Targets listed | Block chars | Left out |
|---|---|---|---|---|---|---|---|---|
| native | 700 | 0 | 663 | 37 | 0 | 95 of 100 | 12,307 | 37 |
| names-only | 700 | 0 | 663 | 37 | 0 | 95 of 100 | 12,307 | 37 |
| native | 1500 | 0 | 675 | 825 | 0 | 45 of 100 | 12,309 | 838 |
| names-only | 1500 | 0 | 675 | 825 | 0 | 45 of 100 | 12,309 | 838 |
