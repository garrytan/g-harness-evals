#!/usr/bin/env python3
"""Fail when a Markdown file links to a repository path that does not exist.

Checks relative links only; http(s) links and anchors are not fetched.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
SKIP_DIRS = {".git", "node_modules"}
problems = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for name in filenames:
        if not name.endswith(".md"):
            continue
        path = os.path.join(dirpath, name)
        text = open(path, encoding="utf-8").read()
        for m in LINK.finditer(text):
            target = m.group(1)
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = target.split("#", 1)[0]
            if not target:
                continue
            resolved = os.path.normpath(os.path.join(dirpath, target))
            if not os.path.exists(resolved):
                problems.append(f"{os.path.relpath(path, ROOT)}: broken link {m.group(1)}")
for p in problems:
    print(p)
print(f"check-links: {len(problems)} problem(s)")
sys.exit(1 if problems else 0)
