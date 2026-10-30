#!/usr/bin/env python3
"""Write probe skills of chosen sizes for the anatomy skill-budget capture (internal-task).
Each skill is a SKILL.md with a one-line description and filler body up to the target size."""
import os, sys
root = sys.argv[1]
for kb in [int(x) for x in sys.argv[2].split(',')]:
    d = os.path.join(root, f'probe-{kb}k')
    os.makedirs(d, exist_ok=True)
    head = f"---\nname: probe-{kb}k\ndescription: Anatomy probe skill of about {kb} KB. Use only when asked for probe {kb}k.\n---\n# Probe {kb}k\n\n"
    line = 'This line is filler for the internal-task skill size probe; it carries no instruction.\n'
    body = head
    while len(body.encode()) + len(line) <= kb * 1024:
        body += line
    open(os.path.join(d, 'SKILL.md'), 'w').write(body)
