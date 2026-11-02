#!/usr/bin/env python3
"""Control-arm audit: per arm, tool calls that touch gstack, the Capy drive or a gstack skill. Counts only.
   audit.py <results dir> [<results dir> ...]  (each holds trials.jsonl and trials/<cell>/<task>/r<n>/harbor/agent/sdk-messages.jsonl)"""
import json, os, re, sys, collections
BUILTIN = {"doctor", "plugin-authoring"}
def sessions(res):
    for l in open(os.path.join(res, "trials.jsonl")):
        if not l.strip(): continue
        t = json.loads(l)
        p = os.path.join(res, t["paths"]["trial_dir"], "harbor", "agent", "sdk-messages.jsonl")
        msgs = []
        if os.path.exists(p):
            for x in open(p):
                try: msgs.append(json.loads(x))
                except Exception: pass
        yield t, msgs
args = sys.argv[1:]
extra = []
if args and args[0] == "--names-from": extra, args = [args[1]], args[2:]
rows = [(t, m) for res in args for t, m in sessions(res)]
names = set()
for t, msgs in rows + [(t, m) for res in extra for t, m in sessions(res)]:
    for m in msgs:
        if m.get("type") == "SystemMessage" and m.get("subtype") == "init":
            names |= set((m.get("init") or {}).get("skills") or []) - BUILTIN
names_re = "|".join(re.escape(n) for n in sorted(names)) or "^$"
pat = re.compile(r"gstack|\.capy/drive|\.capy\b|\.claude/skills|/skills/(%s)\b" % names_re, re.I)
arms = collections.OrderedDict()
for t, msgs in rows:
    arm = t["laneb"]["arm"]
    a = arms.setdefault(arm, {"sessions": 0, "with_transcript": 0, "tool_calls": 0, "touching_calls": 0, "sessions_touching": 0, "skill_md_reads": 0, "skill_tool_calls": 0, "init_gstack_skills": 0, "init_any_nonbuiltin_skill": 0, "by_tool": collections.Counter()})
    a["sessions"] += 1
    if msgs: a["with_transcript"] += 1
    hit = 0
    for m in msgs:
        if m.get("type") == "SystemMessage" and m.get("subtype") == "init":
            sk = set((m.get("init") or {}).get("skills") or [])
            if "gstack" in sk: a["init_gstack_skills"] += 1
            if sk - BUILTIN: a["init_any_nonbuiltin_skill"] += 1
        if m.get("type") != "AssistantMessage": continue
        for c in m.get("content") or []:
            if not (isinstance(c, dict) and c.get("name") and c.get("id")): continue
            a["tool_calls"] += 1
            s = json.dumps(c.get("input") or {})
            if c["name"] == "Skill":
                a["skill_tool_calls"] += 1
            if c["name"] == "Skill" or pat.search(s):
                hit += 1; a["by_tool"][c["name"]] += 1
                if re.search(r"SKILL\.md", s): a["skill_md_reads"] += 1
    a["touching_calls"] += hit
    if hit: a["sessions_touching"] += 1
print(json.dumps({"skill_names_from_gstack_init": sorted(names), "arms": {k: {**v, "by_tool": dict(v["by_tool"])} for k, v in arms.items()}}, indent=1))
