"""Rules-at-scale harness wiring without a Harbor import: the job kwarg "rules", where each
harness's rules file goes, the cut-lifting settings, the hook route that delivers the six rules once beside the task
message, the watcher start, the clean-arm probe and the pin checks. agents_rules.py plugs these into the frontier Harbor
classes; tests/rules-at-scale-harness.test.ts runs this file directly.

The kwarg: {"arm": <arm>, "files_dir": <host dir>, "hooktext": <bool, optional>, "cutlift": <bool, optional>}.
files_dir holds one folder per task, named by task id, each written by
  bun scripts/rules-at-scale/materialize.ts --task <task dir> --arm <arm> --harness <h> --out <files_dir>/<task id>
(lane B; the "materialize" command below runs it for every task of a run). A folder holds manifest.json and the files it
lists, each with a placement: "repo" (placed at its path in the repository), "hook" (hooktext.md, delivered through the
harness hook) or "qm-organization-instructions" (soul.txt, set as QM's SOUL). Only "repo" files reach the repository.
A files_dir that holds manifest.json itself serves every task.

  python3 scripts/rules-at-scale/rules_wiring.py plan <harness> <arm> <files dir> [<model>]   the container plan as JSON
  python3 scripts/rules-at-scale/rules_wiring.py cant-run                                      every refused harness and arm
  python3 scripts/rules-at-scale/rules_wiring.py materialize --tasks <dir> --harness <h> --arm <a> --out <files_dir>
          [--materializer <script>] [--ids a,b]
  python3 scripts/rules-at-scale/rules_wiring.py version <harness> <version output>            exit 0 when it matches pin.json
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "scripts" / "frontier-harbor"))

import delivery as dl  # noqa: E402  (the frontier delivery module: its gstack probe and file writer, imported, never edited)
import frontier_settings as fs  # noqa: E402
import qm_harbor as qh  # noqa: E402

PIN = json.loads((HERE / "pin.json").read_text())
HOOK_ASSETS = HERE / "hooks"
ARMS = ("none", "short", "b8k", "b28k", "b80k", "b160k", "split", "hook", "cutlift", "qm-repo", "qm-top")
HARNESSES = ("claude-code", "codex", "hermes", "openclaw", "pi", "gemini-cli")
RULES_FILE = {"claude-code": "CLAUDE.md", "codex": "AGENTS.md", "hermes": "AGENTS.md", "openclaw": "AGENTS.md", "pi": "AGENTS.md",
              "gemini-cli": "GEMINI.md"}
HOOK_HARNESSES = ("claude-code", "codex", "hermes", "openclaw")
CUTLIFT_HARNESSES = ("codex", "openclaw", "hermes")
PLACEMENTS = ("repo", "hook", "qm-organization-instructions")
REPO_DIR = "/work/repo"
HE_DIR = "/work/.he"
WATCH = "/opt/he/watch.py"
ROOT = "/tmp/he-rules"
HOOKTEXT = ROOT + "/hooktext.md"
HOOK_SCRIPT = ROOT + "/rules-hook.py"
FIRES = "/logs/agent/he-rules-fires.jsonl"
WATCH_LOG = "/logs/agent/he-watch.log"
WATCH_PID = ROOT + "/watch.pid"
OPENCLAW_PLUGIN = ROOT + "/openclaw-plugin"
OPENCLAW_SETUP_WORKSPACE = ROOT + "/openclaw-setup-workspace"
CODEX_HOOKS = "/tmp/codex-home/hooks.json"
RULE_FILE_NAMES = ("AGENTS.md", "CLAUDE.md", "GEMINI.md", ".hermes.md", "HERMES.md", ".cursorrules", "AGENTS.override.md", "CLAUDE.local.md",
                   "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "BOOTSTRAP.md", "HEARTBEAT.md", "MEMORY.md")
# The cut-lifting settings of the plan's cutlift arm (wave0-spec.md, "Harness wiring").
CUTLIFT = {
    "codex": {"project_doc_max_bytes": 262144},
    "openclaw": {"agents": {"defaults": {"bootstrapMaxChars": 200000, "bootstrapTotalMaxChars": 300000}}},
    "hermes": {"context_file_max_chars": 200000},
}
# Each hook route, with the pinned source it rests on. One copy of the six rules beside the task message, once per run.
HOOK = {
    "claude-code": {"event": "UserPromptSubmit", "mechanism": "settings hooks.UserPromptSubmit: a command printing hookSpecificOutput.additionalContext, which Claude Code adds after the turn's prompt",
                    "evidence": ["scripts/frontier-harbor/delivery.py HOOK claude-code (UserPromptSubmit additionalContext lands right after the prompt, harnesses/routes/README.md)"]},
    "codex": {"event": "UserPromptSubmit", "mechanism": "$CODEX_HOME/hooks.json UserPromptSubmit: additionalContext recorded as a developer message before the first sampling request; run with --dangerously-bypass-hook-trust",
              "evidence": ["scripts/frontier-harbor/delivery.py HOOK codex (codex-rs/hooks/src/engine/discovery.rs, codex-rs/core/src/hook_runtime.rs)"]},
    "hermes": {"event": "pre_llm_call", "mechanism": "config.yaml hooks.pre_llm_call shell hook (hooks_auto_accept true): its {\"context\": ...} is added to the turn's user message, once per turn",
               "evidence": ["hermes-agent v0.23.2 agent/shell_hooks.py:680-686 (_parse_pre_llm_call returns the context)", "agent/turn_context.py:907-967 (pre_llm_call context injected into the user message)", "website/docs/user-guide/features/hooks.md:2058-2059 and 2166-2170"]},
    "openclaw": {"event": "before_prompt_build", "mechanism": "a plugin from plugins.load.paths returning appendContext from before_prompt_build, which adds the text after the turn's prompt",
                 "evidence": ["openclaw 2026.11.5 docs/plugins/hooks/prompt-and-session.md:40-53 (before_prompt_build returns prependContext or appendContext)", "scripts/frontier-harbor/delivery.py HOOK openclaw (plugins.entries.<id>.hooks.allowConversationAccess)"]},
}


# QM (the QM runner's design, read at yc-software/qm 90e4ced7): no workspace rules file; the
# organization instructions (SOUL) are set by one admin call before the turn and shown to the model under
# "## Organization instructions". agents_rules_qm.RulesQm calls these helpers on the QM runner's FrontierQm.
QM_PIN_FILE = "harnesses/qm/pin.json"
QM_ARMS = ("none", "qm-repo", "short", "b8k", "b28k", "b80k", "qm-top")
QM_SOUL_PATH = f"/v1/admin/scopes/{qh.SCOPE}/soul"
QM_SOUL_HEADING = "## Organization instructions"
QM_MAX_SOUL_CHARS = 100_000


def qm_chars(text: str) -> int:
    """The length QM's TypeScript reads (string.length, UTF-16 code units), which a code-point count undercounts for any
    character outside the Basic Multilingual Plane."""
    return len(text.encode("utf-16-le")) // 2


def qm_soul_call(text: str) -> dict[str, Any]:
    """The admin call that sets the trial's organization instructions, which agents_rules_qm.RulesQm makes after FrontierQm's own admin calls. A text over QM's
    MAX_SOUL_CHARS (src/api/routes/admin-resources.ts) fails the trial; it is never cut."""
    if qm_chars(text) > QM_MAX_SOUL_CHARS:
        raise RulesRefused("HE-RULES-011", f"the organization instructions are {qm_chars(text)} characters, over QM's MAX_SOUL_CHARS of {QM_MAX_SOUL_CHARS}; the trial stops and the text is not cut")
    return {"name": "soul", "method": "PUT", "path": QM_SOUL_PATH, "body": {"content": text}}


def qm_soul_text(arm: str, loaded: dict[str, Any]) -> str | None:
    """What a QM arm sets as the SOUL, from load_files: None on none (QM's default SOUL stays), else the manifest's
    qm-organization-instructions file (empty on qm-repo, whose b8k AGENTS.md is placed in the repository)."""
    if arm == "none":
        return None
    if loaded.get("soul") is None:
        raise RulesRefused("HE-RULES-002", f"QM arm {arm} needs a qm-organization-instructions file in its manifest")
    if arm != "qm-repo" and not loaded["soul"].strip():
        raise RulesRefused("HE-RULES-002", f"QM arm {arm} has an empty qm-organization-instructions file")
    return loaded["soul"]


def qm_soul_delivered(system_prompt: str, text: str) -> str:
    """The proof the SOUL took, from the captured first agent-loop request (never the admin reply): whole when the text
    sits under "## Organization instructions", absent when that section holds something else, unscorable when the
    request has no such section."""
    at = system_prompt.find(QM_SOUL_HEADING)
    if at < 0:
        return "unscorable"
    return "whole" if text.strip() and text.strip() in system_prompt[at + len(QM_SOUL_HEADING):] else "absent"


class RulesRefused(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code} {message}")
        self.code = code


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def cant_run(harness: str, arm: str) -> dict[str, str] | None:
    """The refusals the plan names, with the reason, or None."""
    if harness == "qm":
        if arm not in QM_ARMS:
            return {"code": "HE-RULES-003", "why": f"QM has no {arm} arm (plan cell table: none, qm-repo, short, b8k, b28k, b80k, qm-top)"}
        return None
    if arm in ("qm-repo", "qm-top"):
        return {"code": "HE-RULES-003", "why": "qm-repo and qm-top are QM arms"}
    if arm == "hook" and harness not in HOOK_HARNESSES:
        return {"code": "HE-RULES-003", "why": f"{harness} has no hook route here (plan, changes accepted at the gate: Pi drops out of the hook arm; Gemini CLI is a descriptive row)"}
    if arm == "cutlift" and harness not in CUTLIFT_HARNESSES:
        return {"code": "HE-RULES-003", "why": f"{harness} sends a 160 KB rules file whole at its default, so there is no cut to lift"}
    return None


def hermes_default_cap(model: str) -> int:
    """Hermes v0.23.2's context-file cap with no context_file_max_chars: max(20000, min(window x 4 x 0.06, 500000))
    characters (agent/prompt_builder.py:1044-1061), at the context_length we set (the model's real window)."""
    return max(20_000, min(int(context_length(model) * 4 * 0.06), 500_000))


def context_length(model: str) -> int:
    """Hermes's context_length, a named setting: the model's real window from scripts/frontier-harbor/pin.json."""
    return int(fs.model_spec(model)["context_window"])


def resolve(harness: str, rules: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    """The job's rules kwarg, checked on the host before the trial is ready."""
    def bad(m: str) -> RulesRefused:
        return RulesRefused("HE-RULES-001", m)
    if harness not in HARNESSES + ("qm",):
        raise bad(f"{harness} has no rules arms (only {', '.join(HARNESSES + ('qm',))})")
    if not isinstance(rules, dict):
        raise bad("the rules kwarg must be an object")
    arm = rules.get("arm")
    if arm not in ARMS:
        raise bad(f"arm must be one of {', '.join(ARMS)}, not {arm!r}")
    refused = cant_run(harness, arm)
    if refused:
        raise RulesRefused(refused["code"], f"{harness} {arm}: {refused['why']}")
    if harness == "qm" and model and model not in fs.PIN["harnesses"]["qm"]["models"]:
        raise RulesRefused("HE-RULES-003", f"the QM runner routes only {', '.join(fs.PIN['harnesses']['qm']['models'])} (scripts/frontier-harbor/pin.json harnesses.qm.models), not {model}")
    extra = set(rules) - {"arm", "files_dir", "hooktext", "cutlift"}
    if extra:
        raise bad(f"unknown rules keys {sorted(extra)}")
    hook = rules.get("hooktext", arm == "hook")
    lift = rules.get("cutlift", arm == "cutlift")
    if hook != (arm == "hook") or lift != (arm == "cutlift"):
        raise bad(f"arm {arm}: hooktext must be {arm == 'hook'} and cutlift {arm == 'cutlift'}")
    if lift and harness == "hermes" and model:
        cap = hermes_default_cap(model)
        if cap >= 163_840 * 1.02:
            raise RulesRefused("HE-RULES-003", f"hermes cutlift on {model}: the default cap at context_length {context_length(model)} is {cap} characters, above the 160 KB file, so the default does not cut it and the arm is not run (plan: cut lifted only if the chosen context length cuts 160 KB)")
    files_dir = rules.get("files_dir")
    if arm != "none" and (not files_dir or not Path(files_dir).is_dir()):
        raise bad(f"files_dir {files_dir!r} is not a directory on the host")
    return {"arm": arm, "files_dir": str(Path(files_dir).resolve()) if files_dir else None, "hooktext": hook, "cutlift": lift}


def task_dir_for(resolved: dict[str, Any], trial: str) -> Path | None:
    """The materialized folder of a Harbor trial, whose directory is <first 32 characters of the task name, _- stripped>__<suffix>
    (Harbor 0.24.0 models/trial/config.py:545-548, as delivery.kind_of reads it)."""
    if not resolved["files_dir"]:
        return None
    root = Path(resolved["files_dir"])
    if (root / "manifest.json").is_file():
        return root
    prefix = trial.rsplit("__", 1)[0]
    folders = [d for d in sorted(root.iterdir()) if d.is_dir() and (d / "manifest.json").is_file()]
    hits = [d for d in folders if d.name[:32].rstrip("_-") == prefix] or (folders if trial == "any__x" and len(folders) == 1 else [])
    if len(hits) != 1:
        raise RulesRefused("HE-RULES-007", f"trial {trial} matches {len(hits)} task folders under {root}, not one")
    return hits[0]


def load_files(resolved: dict[str, Any], harness: str, folder: Path | None) -> dict[str, Any]:
    """The files of a materialized folder, each checked against its manifest entry and sorted by its placement: "repo" files
    to place, the "hook" text and the "qm-organization-instructions" text (QM's SOUL)."""
    arm = resolved["arm"]
    if folder is None:
        return {"manifest": None, "files": [], "hooktext": None, "soul": None}
    man = json.loads((folder / "manifest.json").read_text())
    if man.get("arm") != arm or man.get("harness") != harness:
        raise RulesRefused("HE-RULES-002", f"{folder}/manifest.json is for {man.get('harness')} {man.get('arm')}, not {harness} {arm}")
    files, by = [], {"hook": [], "qm-organization-instructions": []}
    for f in man.get("files") or []:
        rel, where = f.get("path") or "", f.get("placement")
        if where not in PLACEMENTS:
            raise RulesRefused("HE-RULES-002", f"manifest file {rel!r} has placement {where!r}, not one of {', '.join(PLACEMENTS)}")
        if rel.startswith("/") or ".." in Path(rel).parts or rel.split("/")[0] in (".git", ".he") or rel == "manifest.json":
            raise RulesRefused("HE-RULES-002", f"manifest path {rel!r} is not a plain path inside the repository")
        body = (folder / rel).read_bytes()
        if sha256(body) != f.get("sha256") or len(body) != f.get("bytes"):
            raise RulesRefused("HE-RULES-002", f"{folder / rel} does not match its manifest sha256 and bytes")
        if where == "repo":
            files.append({"path": rel, "body": body})
        else:
            by[where].append(body)
    if any(len(v) > 1 for v in by.values()):
        raise RulesRefused("HE-RULES-002", f"{folder}/manifest.json lists more than one hook or organization-instructions file")
    if arm != "none" and harness in RULES_FILE and not any(f["path"] == RULES_FILE[harness] for f in files):
        raise RulesRefused("HE-RULES-002", f"{folder}/manifest.json has no root {RULES_FILE[harness]} for {harness}")
    hooktext = by["hook"][0] if by["hook"] else None
    if bool(resolved["hooktext"]) != (hooktext is not None) or (hooktext is not None and not hooktext.strip()):
        raise RulesRefused("HE-RULES-002", f"arm {arm} {'needs' if resolved['hooktext'] else 'must not have'} a non-empty hook file in {folder}/manifest.json")
    soul = by["qm-organization-instructions"][0].decode("utf-8") if by["qm-organization-instructions"] else None
    return {"manifest": man, "files": files, "hooktext": hooktext, "soul": soul}


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    for k, v in over.items():
        base[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return base


def codex_config(config: dict[str, Any], resolved: dict[str, Any] | None) -> dict[str, Any]:
    return _merge(config, CUTLIFT["codex"]) if resolved and resolved["cutlift"] else config


def openclaw_config(config: dict[str, Any], resolved: dict[str, Any] | None) -> dict[str, Any]:
    if not resolved:
        return config
    if resolved["cutlift"]:
        _merge(config, json.loads(json.dumps(CUTLIFT["openclaw"])))
    if resolved["hooktext"]:
        plugins = config.setdefault("plugins", {})
        plugins.setdefault("load", {}).setdefault("paths", []).append(OPENCLAW_PLUGIN)
        plugins.setdefault("entries", {})["he-rules-hook"] = {"enabled": True, "hooks": {"allowConversationAccess": True}}
    return config


def hermes_config(config: dict[str, Any], resolved: dict[str, Any] | None, model: str) -> dict[str, Any]:
    """Our Hermes config plus the named context_length (the model's real window), the cutlift cap and the hook."""
    config["model"]["context_length"] = context_length(model)
    if not resolved:
        return config
    if resolved["cutlift"]:
        config.update(CUTLIFT["hermes"])
    if resolved["hooktext"]:
        if "hooks" in config:
            raise RulesRefused("HE-RULES-001", "the Hermes config already has hooks")
        config["hooks"] = {"pre_llm_call": [{"command": f"python3 {HOOK_SCRIPT} pre_llm_call", "timeout": 30}]}
        config["hooks_auto_accept"] = True
    return config


def claude_hooks(settings: dict[str, Any], resolved: dict[str, Any] | None) -> dict[str, Any]:
    if not resolved or not resolved["hooktext"]:
        return settings
    if "hooks" in settings:
        raise RulesRefused("HE-RULES-001", "the Claude Code settings already have hooks")
    return {**settings, "hooks": {"UserPromptSubmit": [{"hooks": [{"type": "command", "command": f"python3 {HOOK_SCRIPT} UserPromptSubmit", "timeout": 30}]}]}}


def codex_hooks_json() -> bytes:
    hooks = {"UserPromptSubmit": [{"hooks": [{"type": "command", "command": f"python3 {HOOK_SCRIPT} UserPromptSubmit", "timeout": 30}]}]}
    return (json.dumps({"hooks": hooks}, indent=2) + "\n").encode()


def gbrain_probe() -> str:
    """One line per gbrain install, binary or skill file found in the container's usual places."""
    return ('for p in "$HOME/.gbrain" /opt/gbrain "$HOME/.local/share/gbrain"; do [ -e "$p" ] && echo "$p"; done; '
            'command -v gbrain 2>/dev/null; '
            'for r in "$HOME/.claude/skills" /logs/agent/sessions/skills /tmp/codex-home/skills "$HOME/.codex/skills" "$HOME/.agents/skills" '
            '/tmp/hermes/skills "$HOME/.hermes/skills" "$HOME/.openclaw/skills" /tmp/harbor-pi-agent/skills "$HOME/.pi/agent/skills"; do '
            '[ -d "$r" ] || continue; find -L "$r" -maxdepth 4 -name SKILL.md 2>/dev/null | while read -r f; do grep -qi gbrain "$f" 2>/dev/null && echo "$f"; done; done; true')


def rules_files_in_repo() -> str:
    """Every rules or bootstrap file name anywhere in the repository (outside .git), one path per line."""
    names = " -o ".join(f"-name {shlex.quote(n)}" for n in RULE_FILE_NAMES)
    return f"cd {REPO_DIR} && find . -path ./.git -prune -o -type f \\( {names} \\) -print | LC_ALL=C sort; true"


def plan(harness: str, resolved: dict[str, Any], loaded: dict[str, Any], model: str) -> dict[str, Any]:
    """What the arm does in the task container: files to write (repository files and hook files), the commands, the checks
    at setup and at launch, and the harness_settings.json record."""
    if harness == "qm":
        want = ["AGENTS.md"] if resolved["arm"] == "qm-repo" else []
        if [f["path"] for f in loaded["files"]] != want:
            raise RulesRefused("HE-RULES-002", f"QM arm {resolved['arm']} places {[f['path'] for f in loaded['files']]} in the repository, not {want}")
        record: dict[str, Any] = {"arm": resolved["arm"], "harness": harness, "rules_file": "AGENTS.md" if loaded["files"] else None,
                                  "pin": {"commit": json.loads((REPO / QM_PIN_FILE).read_text())["commit"]}}
        soul = qm_soul_text(resolved["arm"], loaded)
        record["soul"] = None if soul is None else {"sha256": sha256(soul.encode()), "chars": qm_chars(soul)}
    else:
        record = {"arm": resolved["arm"], "harness": harness, "rules_file": RULES_FILE[harness], "pin": {"version": PIN["harnesses"][harness]["version"]}}
        soul = None
    if harness == "hermes":
        record["named_settings"] = {"model.context_length": context_length(model), "default_context_file_cap_chars": hermes_default_cap(model)}
    if resolved["cutlift"]:
        record["cutlift"] = CUTLIFT[harness]
    repo_files = [{"path": f"{REPO_DIR}/{f['path']}", "rel": f["path"], "body": f["body"]} for f in loaded["files"]]
    hook_files: list[dict[str, Any]] = []
    if loaded["hooktext"] is not None:
        hook_files.append({"path": HOOKTEXT, "body": loaded["hooktext"], "mode": "0644"})
        if harness in ("claude-code", "codex", "hermes"):
            hook_files.append({"path": HOOK_SCRIPT, "body": (HOOK_ASSETS / "rules-hook.py").read_bytes(), "mode": "0755"})
        if harness == "codex":
            hook_files.append({"path": CODEX_HOOKS, "body": codex_hooks_json(), "mode": "0644"})
        if harness == "openclaw":
            for name in ("openclaw.plugin.json", "package.json", "index.js"):
                hook_files.append({"path": f"{OPENCLAW_PLUGIN}/{name}", "body": (HOOK_ASSETS / "openclaw-rules-plugin" / name).read_bytes(), "mode": "0644"})
        record["hook"] = {**HOOK[harness], "hooktext_sha256": sha256(loaded["hooktext"]), "hooktext_bytes": len(loaded["hooktext"])}
    for f in hook_files:
        if not dl.outside_work(f["path"]):
            raise RulesRefused("HE-RULES-002", f"{f['path']} is under /work; hook files go outside it")
    record["files"] = [{"path": f["rel"], "sha256": sha256(f["body"]), "bytes": len(f["body"])} for f in repo_files]
    checks_setup = [{"name": "the repository is clean and /work/.he is empty before placing",
                     "command": f"test -z \"$(git -C {REPO_DIR} status --porcelain --untracked-files=all)\" && test -d {HE_DIR} && test -z \"$(ls -A {HE_DIR})\" && echo clean",
                     "expect": "clean"}]
    if loaded["hooktext"] is not None and harness in ("claude-code", "codex", "hermes"):
        event = HOOK[harness]["event"]
        field = "context" if harness == "hermes" else "hookSpecificOutput.additionalContext"
        getter = "d['context']" if harness == "hermes" else "d['hookSpecificOutput']['additionalContext']"
        checks_setup.append({"name": f"the {event} hook prints the hook text as {field}",
                             "command": f"printf '{{}}' | HE_RULES_CHECK=1 python3 {HOOK_SCRIPT} {event} | python3 -c \"import hashlib,json,sys; d=json.load(sys.stdin); print(hashlib.sha256({getter}.encode()).hexdigest())\"",
                             "expect": sha256(loaded["hooktext"])})
    expect_files = "\n".join(f"./{f['rel']}" for f in sorted(repo_files, key=lambda f: "./" + f["rel"]) if Path(f["rel"]).name in RULE_FILE_NAMES)
    checks_launch = [{"name": "the placed files still hold the manifest's bytes",
                      "command": "; ".join(f"sha256sum {shlex.quote(f['path'])} | cut -d' ' -f1" for f in repo_files) or "true",
                      "expect": "\n".join(sha256(f["body"]) for f in repo_files)},
                     {"name": "the only rules or bootstrap files in the repository are the ones the arm placed", "command": rules_files_in_repo(),
                      "expect": expect_files}]
    exclude = "".join(f"/{f['rel']}\n" for f in repo_files)
    commands = []
    if repo_files:
        commands.append(f"set -e; mkdir -p {REPO_DIR}/.git/info && printf %s {base64.b64encode(exclude.encode()).decode()} | base64 -d >> {REPO_DIR}/.git/info/exclude")
    return {"record": record,
            "files": [{"path": f["path"], "mode": f.get("mode", "0644"), "sha256": sha256(f["body"]), "bytes": len(f["body"]), "body": f["body"]}
                      for f in repo_files + hook_files],
            "commands": commands, "checks_setup": checks_setup, "checks_launch": checks_launch, "soul": soul}


def install_staged(stage: str, f: dict[str, Any]) -> str:
    """Moves a file uploaded to stage into place as the agent user, and prints its sha256 (Harbor's exec passes commands
    as one docker argument, so a 160 KB file cannot ride in the command line)."""
    q = dl._sh_path(f["path"])
    return f"set -e; mkdir -p \"$(dirname {q})\" && cp {shlex.quote(stage)} {q} && chmod {f['mode']} {q} && sha256sum {q} | cut -d' ' -f1"


def watch_start() -> str:
    """Starts /opt/he/watch.py detached from the exec session, before the agent (lane A's watcher; it appends to
    /work/.he/edits.log). Prints the pid."""
    return (f"set -e; test -f {WATCH} || {{ echo no-watcher; exit 3; }}; mkdir -p {ROOT} {HE_DIR}; "
            f"setsid nohup python3 {WATCH} > {WATCH_LOG} 2>&1 < /dev/null & echo $! > {WATCH_PID}; sleep 1.2; "
            f"pid=$(cat {WATCH_PID}); kill -0 \"$pid\" && echo \"watching $pid\"")


def version_matches(harness: str, output: str) -> bool:
    p = PIN["harnesses"][harness]
    if harness == "hermes":
        return output.strip() == p["commit"]
    return bool(re.search(p["version_pattern"], output.strip(), re.M))


def overlay_frontier_pin() -> None:
    """Adds this file's versions to the frontier pin's in-memory release table, so the frontier classes accept them
    (harness_pin, the Claude Code binary check), and this file's models the frontier pin lacks (model_spec).
    scripts/frontier-harbor/pin.json on disk is not touched."""
    for h, p in PIN["harnesses"].items():
        entry = fs.PIN["harnesses"].get(h)
        if entry is None or entry["version"] == p["version"]:
            continue
        release = {k: p[k] for k in ("npm_integrity", "native_binary_sha256", "commit") if k in p}
        release["why"] = "rules-at-scale pin (scripts/rules-at-scale/pin.json), added in memory by rules_wiring.overlay_frontier_pin"
        entry.setdefault("releases", {})[p["version"]] = release
    for model, spec in PIN.get("models", {}).items():
        fs.PIN["models"].setdefault(model, spec)


def materialize(tasks: str, harness: str, arm: str, out: str, materializer: str | None = None, ids: list[str] | None = None) -> list[str]:
    """Runs the lane B materializer once per task under a scrubbed environment, into <out>/<task id>/."""
    script = materializer or str(HERE / "materialize.ts")
    if not Path(script).is_file():
        raise RulesRefused("HE-RULES-008", f"no materializer at {script} (lane B's scripts/rules-at-scale/materialize.ts)")
    done = []
    for d in sorted(Path(tasks).iterdir()):
        if not (d / "task.toml").is_file() or (ids and d.name not in ids):
            continue
        dest = Path(out) / d.name
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": os.environ.get("HOME", "/tmp"), "TZ": "UTC"}
        res = subprocess.run(["bun", script, "--task", str(d), "--arm", arm, "--harness", harness, "--out", str(dest)], env=env, capture_output=True, text=True, cwd=REPO)
        if res.returncode != 0 or not (dest / "manifest.json").is_file():
            raise RulesRefused("HE-RULES-008", f"materialize {d.name} {harness} {arm} failed: {(res.stderr or res.stdout)[-400:]}")
        done.append(d.name)
    return done


def _cli(argv: list[str]) -> int:
    if argv[:1] == ["cant-run"]:
        print(json.dumps({f"{h} {a}": cant_run(h, a) for h in HARNESSES + ("qm",) for a in ARMS if cant_run(h, a)}, indent=2))
        return 0
    if argv[:1] == ["plan"] and len(argv) in (4, 5):
        h, arm, files_dir = argv[1:4]
        model = argv[4] if len(argv) == 5 else ("openai:gpt-6.2-sol" if h == "codex" else "google:gemini-4-carbon" if h == "gemini-cli" else "anthropic:claude-opus-5-5")
        try:
            r = resolve(h, {"arm": arm, "files_dir": files_dir}, model)
            p = plan(h, r, load_files(r, h, task_dir_for(r, "any__x") if r["files_dir"] else None), model)
        except RulesRefused as e:
            print(json.dumps({"refused": e.code, "message": str(e)}))
            return 2
        for f in p["files"]:
            f.pop("body")
        print(json.dumps(p, indent=2))
        return 0
    if argv[:1] == ["materialize"]:
        a = dict(zip(argv[1::2], argv[2::2]))
        try:
            done = materialize(a["--tasks"], a["--harness"], a["--arm"], a["--out"], a.get("--materializer"), a["--ids"].split(",") if a.get("--ids") else None)
        except RulesRefused as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"materialized": done}))
        return 0
    if argv[:1] == ["version"] and len(argv) == 3:
        return 0 if version_matches(argv[1], argv[2]) else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
