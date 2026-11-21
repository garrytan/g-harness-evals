#!/usr/bin/env python3
"""report.py: how much of your rules file reached the model, from the requests fake_server.py recorded.

usage: report.py --rules FILE --capture DIR [--harness NAME] [--json]

It checks each line of the rules file that is unique in the file and at least 12 characters long (short or repeated lines such
as "---" could match text the harness sends anyway; trailing spaces ignored) against the text of each captured request and
reports the request that holds the most of them: how many lines arrived, the first line that did not, whether the last
line arrived, and any truncation note the harness added. A line counts as arrived when the request holds it word for word."""
import argparse, glob, json, os, re

MARKERS = [
    ("openclaw truncated the file", re.compile(r"\[\.\.\.truncated, read [^\]\n]*for full content\.\.\.\]")),
    ("openclaw policy digest", re.compile(r"\[Policy digest from [^\]\n]+\]")),
    ("openclaw truncation warning", re.compile(r"\[Bootstrap truncation warning\]")),
    ("hermes truncated the file", re.compile(r"\[\.\.\.truncated [^\]\n]*: kept \d+\+\d+ of \d+ chars")),
]


def strings(o, out):
    if isinstance(o, str):
        out.append(o)
    elif isinstance(o, list):
        for v in o:
            strings(v, out)
    elif isinstance(o, dict):
        for v in o.values():
            strings(v, out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rules", required=True)
    ap.add_argument("--capture", required=True)
    ap.add_argument("--harness", default="")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    raw = open(a.rules, "rb").read()
    text = raw.decode("utf-8", "replace")
    every = [(i + 1, l.rstrip()) for i, l in enumerate(text.split("\n")) if l.strip()]
    counts = {}
    for _, l in every:
        counts[l] = counts.get(l, 0) + 1
    lines = [(n, l) for n, l in every if counts[l] == 1 and len(l.strip()) >= 12]
    reqs = []
    for f in sorted(glob.glob(os.path.join(a.capture, "*-POST-*.json"))):
        r = json.load(open(f))
        hay = "\n".join(strings(r.get("body"), []))
        found = [n for n, l in lines if l in hay]
        reqs.append({"file": os.path.basename(f), "path": r.get("path"), "bytes": r.get("body_bytes_decoded"), "found": found,
                     "markers": [name for name, rx in MARKERS if rx.search(hay)]})
    out = {"harness": a.harness, "rules_file": a.rules, "rules_bytes": len(raw), "rules_chars": len(text), "lines_checked": len(lines),
           "requests": len(reqs)}
    if not reqs:
        out["error"] = "no POST request was captured: the harness never called the model (see its stderr)"
    else:
        main_req = max(reqs, key=lambda r: (len(r["found"]), r["bytes"] or 0))
        got = set(main_req["found"])
        missing = [(n, l) for n, l in lines if n not in got]
        gaps = ranges([i for i, (n, _) in enumerate(lines) if n not in got])
        delivered_bytes = sum(len(l.encode()) + 1 for n, l in lines if n in got)
        out.update({"main_request": main_req["file"], "main_request_bytes": main_req["bytes"], "lines_arrived": len(got),
                    "share_of_lines": round(len(got) / len(lines), 4) if lines else None,
                    "bytes_of_arrived_lines": delivered_bytes,
                    "first_line_arrived": bool(lines) and lines[0][0] in got, "last_line_arrived": bool(lines) and lines[-1][0] in got,
                    "first_missing_line": {"line": missing[0][0], "text": missing[0][1][:160]} if missing else None,
                    "missing_ranges": [[lines[x][0], lines[y][0]] for x, y in gaps], "markers": main_req["markers"]})
    if a.json:
        print(json.dumps(out, indent=1))
        return
    print(f"harness: {a.harness or '?'}   rules file: {a.rules} ({len(raw):,} bytes, {len(text):,} characters, {len(lines):,} lines checked)")
    if "error" in out:
        print(out["error"])
        return
    print(f"requests captured: {out['requests']}; checked the one holding the most of your file ({out['main_request_bytes']:,} bytes)")
    print(f"lines that arrived word for word: {out['lines_arrived']:,} of {len(lines):,} ({out['share_of_lines'] * 100:.1f}%)")
    print(f"first line arrived: {'yes' if out['first_line_arrived'] else 'no'}; last line arrived: {'yes' if out['last_line_arrived'] else 'no'}")
    if out["first_missing_line"]:
        m = out["first_missing_line"]
        print(f"first line that did not arrive: line {m['line']}: {m['text']}")
        print("missing line ranges: " + ", ".join(f"{x}-{y}" if x != y else str(x) for x, y in out["missing_ranges"][:12]) + (" ..." if len(out["missing_ranges"]) > 12 else ""))
    else:
        print("every line arrived.")
    if out["markers"]:
        print("truncation notes in the request: " + "; ".join(out["markers"]))


def ranges(ns):
    out = []
    for n in ns:
        if out and n == out[-1][1] + 1:
            out[-1][1] = n
        else:
            out.append([n, n])
    return out


if __name__ == "__main__":
    main()
