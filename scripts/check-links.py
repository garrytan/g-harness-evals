#!/usr/bin/env python3
"""Fail when a Markdown file links to a repository path that does not exist.

Checks relative links only; http(s) links and anchors are not fetched. scripts/check-links-allow.txt lists links that may
point at a path the public copy leaves out, because a hash pins the file that holds them (one per line: source, a tab,
the link target, a tab, the reason).
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOW_FILE = os.path.join(ROOT, "scripts", "check-links-allow.txt")
ALLOW = set()
if os.path.exists(ALLOW_FILE):
    for line in open(ALLOW_FILE, encoding="utf-8"):
        if line.strip() and not line.startswith("#"):
            source, target = line.rstrip("\n").split("\t")[:2]
            ALLOW.add((source, target))
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
# results/ is gitignored scratch (runs, exported install bundle views with their own placeholder links); never checked.
SKIP_DIRS = {".git", "node_modules", "results"}
# Fragment files render into a generated file elsewhere (scripts/fold-hub-fragments.ts), so their links resolve from there.
RENDERED_FROM = {os.path.join(ROOT, "todos.d"): ROOT}
# The report template is copied to docs/benchmarks/<run>/report.md before use, so its links resolve from a run folder.
COPIED_TO = {os.path.join(ROOT, "docs", "report-template.md"): os.path.join(ROOT, "docs", "benchmarks", "<run>")}
# Generated files are checked through their fragments: between folds they may still carry an item whose file and link target a pull request deleted.
GENERATED = {os.path.join(ROOT, "TODOS.md")}
problems = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for name in filenames:
        if not name.endswith(".md"):
            continue
        path = os.path.join(dirpath, name)
        if path in GENERATED:
            continue
        text = open(path, encoding="utf-8").read()
        for m in LINK.finditer(text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = target.split("#", 1)[0]
            if not target:
                continue
            base = COPIED_TO.get(path, RENDERED_FROM.get(dirpath, dirpath) if name != "README.md" else dirpath)
            resolved = os.path.normpath(os.path.join(base, target))
            if not os.path.exists(resolved) and (os.path.relpath(path, ROOT), m.group(1)) not in ALLOW:
                problems.append(f"{os.path.relpath(path, ROOT)}: broken link {m.group(1)}")
for p in problems:
    print(p)
print(f"check-links: {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
