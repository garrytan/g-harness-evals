#!/usr/bin/env python3
# internal-task step 0: copy a built catalog and replace each SKILL.md frontmatter description with the skill's own name.
# A top-level when_to_use key is dropped too, since Claude Code appends it to the description in its listing.
#
#   python3 scripts/skill-resolver/step0/claude-codex/names-only.py <catalog>/skills <out dir>
import re
import shutil
import sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
if out.exists():
    shutil.rmtree(out)
shutil.copytree(src, out, symlinks=False)
KEY = re.compile(r'^([A-Za-z_][A-Za-z0-9_-]*):')
changed = 0
for md in sorted(out.glob('*/SKILL.md')):
    text = md.read_text(encoding='utf-8')
    lines = text.split('\n')
    if lines[0].strip() != '---':
        sys.exit(f'{md}: no frontmatter')
    end = next(i for i in range(1, len(lines)) if lines[i].strip() == '---')
    front, name, kept, skipping = lines[1:end], None, [], False
    for line in front:
        m = KEY.match(line)
        if m:
            skipping = m.group(1) in ('description', 'when_to_use')
            if m.group(1) == 'name':
                name = line.split(':', 1)[1].strip().strip('"\'')
        if not skipping:
            kept.append(line)
    if not name or name != md.parent.name:
        sys.exit(f'{md}: frontmatter name {name!r} is not the directory name')
    i = next(j for j, l in enumerate(kept) if l.startswith('name:'))
    kept.insert(i + 1, f'description: {name}')
    md.write_text('\n'.join([lines[0], *kept, *lines[end:]]), encoding='utf-8')
    changed += 1
print(f'NAMES_ONLY skills={changed} out={out}')
