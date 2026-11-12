#!/usr/bin/env python3
"""internal-task Step 0: summarize how a harness lists the skill catalog in the first model request of a keyless capture.

  python3 scripts/skill-resolver/step0/openclaw-hermes/analyze.py --capture <capture dir> --manifest <catalog>/manifest.json \
      --harness openclaw|hermes --provider anthropic|openai --config native|names-only|no-bundled [--config-note TEXT]

Reads <capture>/fake.ndjson (request 1), <capture>/list/ (the harness's own list commands, run by run-captures.sh) and the
trial's logs and state under <capture>/run/, and writes <capture>/summary.json.
"""
import argparse, glob, json, os, re, statistics

PINS = {"openclaw": "npm openclaw@2026.10.6", "hermes": "NousResearch/hermes-agent v2026.9.24 (f97608f178d1)"}

ap = argparse.ArgumentParser()
for k in ("capture", "manifest", "harness", "provider", "config"):
    ap.add_argument("--" + k, required=True)
ap.add_argument("--config-note", default="")
a = ap.parse_args()
cap, h = a.capture, a.harness
catalog = {s["name"] for s in json.load(open(a.manifest))["skills"]}
requests = [json.loads(ln) for ln in open(os.path.join(cap, "fake.ndjson")) if ln.strip()]
model_requests = [r for r in requests if r["method"] == "POST" and isinstance(r.get("body"), dict)]
first = model_requests[0]
body = first["body"]


def text_of(content):
    if isinstance(content, str):
        return content
    return "".join(c.get("text", "") for c in content if isinstance(c, dict))


segments = []
if a.provider == "anthropic":
    system = body.get("system")
    for k, blk in enumerate(system if isinstance(system, list) else [{"text": system or ""}]):
        segments.append((f"system[{k}]", "system prompt", blk.get("text", "")))
    for k, m in enumerate(body.get("messages", [])):
        segments.append((f"messages[{k}]", m["role"] + " message", text_of(m.get("content", ""))))
else:
    if body.get("instructions"):
        segments.append(("instructions", "system prompt (Responses instructions)", body["instructions"]))
    for k, item in enumerate(body.get("input", [])):
        role = item.get("role", item.get("type", "?"))
        segments.append((f"input[{k}]", f"{role} input item", text_of(item.get("content", ""))))

hit = next(((lab, kind, t) for lab, kind, t in segments if "<available_skills>" in t), None)
others = sorted({f"{r['method']} {r['path']} {r['status']}" for r in requests if r not in model_requests})
notes = [f"first model request = line {requests.index(first) + 1} of {len(requests)} in fake.ndjson ({len(model_requests)} model requests); path {first['path']}; model {body.get('model')}"
         + (f"; other requests: {', '.join(others)}" if others else "")]
if a.config_note:
    notes.append(a.config_note)
tool_names = [t.get("name") or (t.get("function") or {}).get("name") for t in body.get("tools", [])]

listing_location, entries, listing_chars, section = None, [], 0, ""
if hit:
    lab, kind, t = hit
    close = t.index("</available_skills>")
    i, j = t.rindex("<available_skills>", 0, close), close + len("</available_skills>")
    hdr = t.rfind("## Skills", 0, i)
    listing_location = {"where": kind, "segment": lab, "segment_chars": len(t), "start": i, "end": j,
                        "skills_section_start": hdr if hdr >= 0 else None}
    listing_chars = j - i
    section = t[hdr if hdr >= 0 else i:j]
    block = t[i:j]
    if h == "openclaw":
        for m in re.finditer(r"<skill>(.*?)</skill>", block, re.S):
            g = lambda tag: (re.search(rf"<{tag}>(.*?)</{tag}>", m.group(1), re.S) or [None, None])[1]
            loc = g("location") or ""
            entries.append({"name": g("name"), "desc": g("description"), "where": loc,
                            "catalog": loc.startswith("/workspace/skills/") and g("name") in catalog})
    else:
        cat = None
        for line in block.split("\n")[1:-1]:
            m = re.match(r"^  (\S.*?)( \[names only\])?:(.*)$", line)
            if m and not line.startswith("    "):
                cat = m.group(1)
                if m.group(2):
                    for n in [x.strip() for x in m.group(3).split(",") if x.strip()]:
                        entries.append({"name": n, "desc": None, "where": cat, "catalog": n == cat and n in catalog})
                continue
            m = re.match(r"^    - (.+?)(?:: (.*))?$", line)
            if m:
                entries.append({"name": m.group(1), "desc": m.group(2), "where": cat, "catalog": m.group(1) == cat and m.group(1) in catalog})
    limit_lines = [ln for ln in t[max(0, (hdr if hdr >= 0 else i) - 0):j].split("\n") if re.search(r"truncat|omitted|compact format|Skills catalog", ln)]
    notes += [f"prompt says: {ln.strip()}" for ln in limit_lines]
else:
    notes.append("no <available_skills> block in any system block or message of request 1")

listed = [e for e in entries if e["catalog"]]
bundled = [e for e in entries if not e["catalog"]]
names = [e["name"] for e in entries]
dl = [len(e["desc"] or "") for e in listed]


def order_rule():
    if not names:
        return "none"
    key = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    if h == "openclaw":
        if names == sorted(names, key=lambda s: s.lower()) or names == sorted(names, key=key):
            return "alphabetical by name (String.localeCompare 'en', prepareSkillsForPrompt), one flat list; bundled and workspace skills interleaved"
        return "not alphabetical: " + ", ".join(names[:5])
    cats = []
    for e in entries:
        if not cats or cats[-1] != e["where"]:
            cats.append(e["where"])
    ok_cats = cats == sorted(cats)
    ok_within = all([e["name"] for e in entries if e["where"] == c] == sorted(e["name"] for e in entries if e["where"] == c) for c in set(cats))
    return ("by category, categories sorted (Python str sort) and names sorted within each; a flat catalog skill's category is its own directory name, "
            "so catalog skills come out alphabetical with each bundled category (e.g. productivity/) slotted in as one group"
            if ok_cats and ok_within else f"categories sorted={ok_cats}, names sorted within categories={ok_within}")


logs = []
for f in sorted(glob.glob(os.path.join(cap, "run/trials/*/*/r1/logs/*.log")) + glob.glob(os.path.join(cap, "run/trials/*/*/r1/state/hermes/logs/*.log"))):
    for ln in open(f, errors="replace"):
        if re.search(r"\[skills\]|skill.*(truncat|limit|skip|ignor|exceed|shadow|collision)", ln, re.I):
            s = re.sub(r"^\S+ \S+ ", "", ln.strip())[:300]
            if s not in logs:
                logs.append(s)
notes += [f"harness log: {s}" for s in logs[:12]]

eligible_count, ineligible = None, []
listed_names = {e["name"] for e in listed}
ld = os.path.join(cap, "list")
if h == "openclaw" and os.path.exists(os.path.join(ld, "skills-list.json")):
    sl = json.load(open(os.path.join(ld, "skills-list.json")))
    chk = json.load(open(os.path.join(ld, "skills-check.json"))) if os.path.exists(os.path.join(ld, "skills-check.json")) else {}
    by = {}
    for s in sl["skills"]:
        by.setdefault(s["name"], []).append(s)
    ws = {n: next((s for s in v if s["source"] == "openclaw-workspace"), None) for n, v in by.items()}
    ni = {x["name"]: x["reason"] for x in chk.get("notInjected", [])}
    elig = [n for n in catalog if ws.get(n) and ws[n]["eligible"]]
    vis = [n for n in elig if ws[n]["modelVisible"]]
    eligible_count = len(elig)
    err = open(os.path.join(ld, "skills-list.err")).read() if os.path.exists(os.path.join(ld, "skills-list.err")) else ""
    trunc = re.search(r"childDirCount=(\d+) maxCandidatesPerRoot=(\d+) maxSkillsLoadedPerSource=(\d+)", err)
    for n in sorted(catalog):
        w = ws.get(n)
        if w is None:
            other = ",".join(sorted({s["source"] for s in by.get(n, [])}))
            r = "not loaded: workspace skills root truncated at discovery" + (f" (childDirCount={trunc.group(1)}, maxCandidatesPerRoot={trunc.group(2)}, maxSkillsLoadedPerSource={trunc.group(3)})" if trunc else "")
            ineligible.append({"name": n, "reason": r + (f"; a same-named {other} skill is loaded instead" if other else "")})
        elif not w["eligible"]:
            miss = {k: v for k, v in (w.get("missing") or {}).items() if v}
            ineligible.append({"name": n, "reason": "missing requirements: " + json.dumps(miss, separators=(",", ":")) if miss else
                               ("disabled" if w.get("disabled") else "blocked by allowlist" if w.get("blockedByAllowlist") else "ineligible (no reason given)")})
        elif not w["modelVisible"]:
            ineligible.append({"name": n, "reason": f"eligible but not model-visible: {ni.get(n, 'not injected')}"})
    summ = chk.get("summary", {})
    notes.append(f"openclaw skills check summary (all sources): {json.dumps(summ, separators=(',', ':'))}")
    notes.append(f"catalog skills: {len(set(ws) & catalog if False else [n for n in catalog if ws.get(n)])} loaded from /workspace/skills, {eligible_count} eligible, {len(vis)} model-visible, {len(listed_names)} in the prompt listing; "
                 f"{len([n for n in vis if n not in listed_names])} model-visible catalog skills left out of the prompt by the prompt budget")
    bundled_loaded = sorted({s['name'] + ':' + s['source'] for s in sl['skills'] if s['source'] != 'openclaw-workspace'})
    notes.append(f"non-workspace skills loaded ({len(bundled_loaded)}): {', '.join(bundled_loaded)}")
elif h == "hermes":
    snaps = glob.glob(os.path.join(cap, "run/trials/*/*/r1/state/hermes/.skills_prompt_snapshot.json"))
    if snaps:
        snap = json.load(open(snaps[0]))["skills"]
        flat = {s["skill_name"]: s for s in snap if s["category"] == s["skill_name"]}
        on_disk_bundled = sorted(s["category"] + "/" + s["skill_name"] for s in snap if s["category"] != s["skill_name"])
        notes.append(f"HERMES_HOME/skills at the end of the trial: {len(snap)} SKILL.md entries in the prompt snapshot, {len(flat)} flat (the catalog), {len(on_disk_bundled)} in category directories (Hermes's bundled skills, seeded by sync_skills at startup)")
        for n in sorted(catalog):
            s = flat.get(n)
            if n in listed_names:
                continue
            if s is None:
                ineligible.append({"name": n, "reason": "not in the skills snapshot"})
                continue
            c = s.get("conditions") or {}
            pl = s.get("platforms") or []
            if pl and not any(p.lower() == "linux" for p in pl):
                r = f"platforms {pl} exclude linux"
            elif c.get("requires_toolsets"):
                r = f"requires_toolsets {c['requires_toolsets']} not all available in this session"
            elif c.get("requires_tools"):
                r = f"requires_tools {c['requires_tools']} not all available"
            elif c.get("fallback_for_toolsets") or c.get("fallback_for_tools"):
                r = f"fallback_for {c.get('fallback_for_toolsets') or c.get('fallback_for_tools')}: hidden because the primary is available"
            elif c.get("session_platforms"):
                r = f"session_platforms {c['session_platforms']} exclude this session"
            elif s.get("requires_apps"):
                r = f"requires_apps {s['requires_apps']} not present"
            else:
                fm = open(os.path.join(os.path.dirname(a.manifest), "skills", n, "SKILL.md"), errors="replace").read().split("\n---", 1)[0]
                env = re.search(r"^environments:\s*(.+)$", fm, re.M)
                r = f"environments {env.group(1).strip()} not detected in this session (agent/skill_utils.py skill_matches_environment)" if env else "hidden for an unidentified reason"
            ineligible.append({"name": n, "reason": r})
        eligible_count = len([n for n in catalog if n in flat]) - len(ineligible)
    lt = os.path.join(ld, "skills-list.txt")
    if os.path.exists(lt):
        m = re.search(r"(\d+) hub-installed, (\d+) builtin, (\d+) local — (\d+) enabled, (\d+) disabled", open(lt).read())
        if m:
            notes.append(f"hermes skills list (catalog copied, before any chat start, so before the bundled sync): {m.group(0)}")
    dup = sorted({e["name"] for e in bundled} & {e["name"] for e in listed})
    if dup:
        notes.append(f"{len(dup)} names listed twice, once as a flat catalog skill and once under a bundled category: {', '.join(dup)}")

if h == "openclaw":
    sysall = "\n".join(t for lab, kind, t in segments if kind.startswith(("system", "developer")))
    deferred = [n for n in ("skills_search", "skills_read") if re.search(rf"^- {n} \(", sysall, re.M)]
    notes.append(f"skills_search in request tools: {'skills_search' in tool_names}; skills_read in request tools: {'skills_read' in tool_names}; "
                 f"in the system prompt's deferred tool list: {deferred or 'neither'}; request tools: {', '.join(tool_names)}")
else:
    notes.append(f"skill tools in request tools: {[n for n in tool_names if 'skill' in n]}"
                 + ("; skill_manage is offered although the prompt carries the one-shot skills block (agent/oneshot_footprint.py says one-shot hides it)"
                    if "skill_manage" in tool_names and "this is a one-shot run" in (hit[2] if hit else "") else ""))
notes.append(f"skills section chars (from '## Skills' to </available_skills>): {len(section)}")

summary = {
    "harness": h, "pin": PINS[h], "provider": a.provider, "config": a.config,
    "listing_location": listing_location, "listed_count": len(listed), "listed_names": [e["name"] for e in listed],
    "order_rule": order_rule(),
    "desc_chars": {"min": min(dl) if dl else 0, "median": statistics.median(dl) if dl else 0, "max": max(dl) if dl else 0},
    "listing_chars": listing_chars,
    "bundled_listed": [e["name"] + (f" ({e['where']})" if e["where"] else "") for e in bundled],
    "eligible_count": eligible_count, "ineligible": ineligible, "notes": notes,
}
json.dump(summary, open(os.path.join(cap, "summary.json"), "w"), indent=1, ensure_ascii=False)
print(f"SUMMARY {h}-{a.provider}-{a.config}: listed={len(listed)} bundled={len(bundled)} desc={summary['desc_chars']} listing_chars={listing_chars} eligible={eligible_count} ineligible={len(ineligible)}")
