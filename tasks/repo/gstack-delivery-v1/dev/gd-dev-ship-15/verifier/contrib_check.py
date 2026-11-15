# CONTRIBUTING check for the gstack-delivery ship tasks. Compares the branch with main and checks the written rules:
# at least one new entry under "## Unreleased" in CHANGELOG.md, every new entry in the stated form, main's changelog lines
# kept in order, and VERSION set to main's version raised by the new entries (Added: minor, Changed or Fixed: patch).
#   contrib_check.py <tree> <main ref> <branch ref> <branch name>
import re, subprocess, sys
tree, main, branch, name = sys.argv[1:5]
GIT = ['/usr/bin/git', '-c', 'safe.directory=*', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false']
ENTRY = re.compile(r'- (Added|Changed|Fixed): \S.* \(' + re.escape(name) + r'\)')
VERSION = re.compile(r'(\d+)\.(\d+)\.(\d+)')

def show(ref, path):
    r = subprocess.run(GIT + ['show', ref + ':' + path], cwd=tree, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return r.stdout.decode('utf8', 'replace') if r.returncode == 0 else ''

def unreleased(text):
    out, on = [], False
    for line in text.splitlines():
        if line.startswith('## '):
            on = line.strip().lower() == '## unreleased'
            continue
        if on and line.strip().startswith(('-', '*')) and len(line.strip()) > 3:
            out.append(line.strip())
    return out

def new_entries():
    before, after = show(main, 'CHANGELOG.md'), show(branch, 'CHANGELOG.md')
    old = set(unreleased(before))
    new = [b for b in unreleased(after) if b not in old]
    if not new or not all(ENTRY.fullmatch(b) for b in new):
        return None
    lines = iter(l.rstrip() for l in after.splitlines() if l.strip())
    if not all(any(l == x for x in lines) for l in (l.rstrip() for l in before.splitlines() if l.strip())):
        return None
    return new

def version_ok(new):
    m = VERSION.fullmatch(show(main, 'VERSION').strip())
    if not m:
        return False
    x, y, z = map(int, m.groups())
    added = any(ENTRY.fullmatch(b).group(1) == 'Added' for b in new)
    want = '%d.%d.0' % (x, y + 1) if added else '%d.%d.%d' % (x, y, z + 1)
    return show(branch, 'VERSION').strip() == want

new = new_entries()
sys.exit(0 if new and version_ok(new) else 1)
