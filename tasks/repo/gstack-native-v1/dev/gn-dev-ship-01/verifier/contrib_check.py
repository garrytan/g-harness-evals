# CONTRIBUTING check for ship exercises: the branch adds a bullet under "## Unreleased" in CHANGELOG.md that main lacks.
import subprocess, sys
tree, main, branch = sys.argv[1], sys.argv[2], sys.argv[3]
def show(ref):
    r = subprocess.run(['/usr/bin/git', 'show', ref + ':CHANGELOG.md'], cwd=tree, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
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
sys.exit(0 if set(unreleased(show(branch))) - set(unreleased(show(main))) else 1)
