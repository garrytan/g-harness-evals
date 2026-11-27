"""Settings for the frontier Harbor path (internal-task), with no Harbor import, so keyless tests can render them.

agents.py turns these into Harbor installed-agent classes. For one harness, one cell model and one trial endpoint,
render() returns what the agent sets in the task container (environment, Harbor options, config overlays) and the
harness_settings.json record of the run: context window, max output, compaction threshold, tools, effort setting,
housekeeping model and every difference from our pins (harnesses/<h>/pin.json and adapter.sh). Values come from
pin.json beside this file and from our own harness config files. The per-trial token is passed in by the caller and
appears only in the returned environment, never in a config overlay or in the settings record.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import tarfile
import tempfile
import tomllib
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PIN = json.loads((HERE / "pin.json").read_text())
EFFORT = PIN["effort"]["level"]
HARNESSES = ("claude-code", "codex", "hermes", "openclaw", "pi", "mini-swe-agent", "dsh", "cursor", "gemini-cli", "grok-build", "muse-code", "qm")
CLAUDE_MODEL_VARS = (
    "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL", "CLAUDE_CODE_AUTO_MODE_MODEL",
    "CLAUDE_CODE_BG_CLASSIFIER_MODEL",
)
OPENCLAW_ANTHROPIC_HOUSEKEEPING = "claude-haiku-5-5"
# Web search and web fetch are off in every codegen cell (Captain ruling 2026-11-09, after internal-task). Hermes v0.23.1, as v2026.9.24:
# web.keyless_fallback false turns off the keyless Exa, Parallel, Firecrawl and Keenable ring behind web_search and
# web_extract (plugins/web/keyless_mcp.py; website/docs/user-guide/features/web-search.md, which also turns keyless_rescue
# off), and agent.disabled_toolsets removes the web toolset (web_search, web_extract) and the browser toolset at tool
# granularity, after every other toolset choice (website/docs/user-guide/configuration.md "Global Toolset Disable").
HERMES_DISABLED_TOOLSETS = ["web", "browser"]
# On xAI, Hermes v0.23.1 also turns on its x_search toolset (X search through xAI's built-in x_search Responses tool)
# whenever xAI credentials are present (hermes_cli/tools_config.py _composite_toolsets; upstream
# NousResearch/hermes-agent#68001). agent.disabled_toolsets is subtracted after that, so an xAI cell disables it too
# (amendment 19 of frontier-shootout-2026-11, after s24's web-tools check).
HERMES_XAI_DISABLED_TOOLSETS = [*HERMES_DISABLED_TOOLSETS, "x_search"]
# OpenClaw 2026.10.6: tools.deny group:web (web_search, x_search, web_fetch) and browser
# (docs/gateway/config-tools/tool-policy.md), plus tools.web.search.enabled and tools.web.fetch.enabled false
# (docs/tools/web.md, docs/tools/web-fetch.md), which also turn off native hosted OpenAI search.
OPENCLAW_WEB_DENY = ["group:web", "browser"]
# OpenClaw 2026.10.6's bundled openrouter provider lists these two media tools, and lines about them, in the system
# prompt of an OpenRouter cell (they are never in the request's tools); denying them keeps that prompt as it was under
# the custom provider id (amendment 1 of frontier-shootout-2026-11).
OPENCLAW_OPENROUTER_DENY = ["music_generate", "video_generate"]
# Hermes's built-in openrouter provider sends no reasoning effort and no output cap behind the proxy (as of v0.23.1); this
# plugin, pinned file by file in pin.json, adds both (amendment 1 of frontier-shootout-2026-11).
HERMES_OPENROUTER_PLUGIN = PIN["harnesses"]["hermes"]["openrouter_plugin"]
PROVIDERS = {"claude-code": ("anthropic",), "codex": ("openai",), "dsh": ("anthropic", "openai", "particle", "openrouter"), "cursor": ("anthropic",),
             "gemini-cli": ("google",), "grok-build": ("xai",), "muse-code": ("openrouter",), "qm": ("anthropic", "openai", "openrouter", "particle"),
             **{h: ("anthropic", "openai", "particle", "openrouter", "google", "xai") for h in ("hermes", "openclaw", "pi")}}
# Amendment 2 of frontier-shootout-2026-11: Gemini 4 Carbon and Hydrogen in Hermes, OpenClaw and Pi go to Google's Gemini API on
# the proxy's google route, each through the harness's own Gemini provider. Hermes v0.23.1 runs its native Gemini client only for
# a base URL that contains Google's API host name (agent/gemini_native_adapter.py is_native_gemini_base_url, a substring test
# that its docs do not promise: website/docs/guides/google-gemini.md treats a proxy as OpenAI-compatible), so its base URL puts
# that name in the path, <route>/generativelanguage.googleapis.com/v1beta, and the proxy drops it (GOOGLE_HOST_SEGMENT).
HERMES_GEMINI_SEGMENT = "generativelanguage.googleapis.com"
# Hermes v0.23.1 sends maxOutputTokens 65,535 on every Gemini request (agent/gemini_native_adapter.py
# GEMINI_DEFAULT_MAX_OUTPUT_TOKENS, applied for the gemini provider in agent/agent_init.py) and reads no output setting for
# Gemini, so its Gemini cells run one token under the pin.json row's 65,536 (amendment 2, declared).
HERMES_GEMINI_MAX_OUTPUT = 65535
# Gemini CLI 0.68.0's own calls beyond the cell model, at their shipped defaults, seen keyless against a fake Gemini API
# (scripts/frontier-harbor/README.md, "Gemini CLI"): the loop-detection check every 30 turns on gemini-3-flash-preview, and the
# loop double-check and chat compression on gemini-3-pro-preview, which the CLI resolves to gemini-3.1-pro-preview-customtools
# with an API key. The proxy's google route sends each to Google's Gemini API, as it does the cell model (through the same
# OpenRouter translation on the named fallback, vm-run.sh --gemini-cli-route openrouter-fallback).
GEMINI_CLI_HOUSEKEEPING = ("gemini-3-flash-preview", "gemini-3.1-pro-preview-customtools")
# Grok Build 1.0.77 (binary at ~/.grok/bin/grok, a link into ~/.grok/downloads): the installed binary's sha256 must be pin.json's.
GROK_BIN = "$HOME/.grok/bin/grok"
# Grok Build 1.0.77's session-title model at its shipped default (models.session_summary in its built-in catalog), on the
# proxy's xai route through its own [model.<id>] block; seen keyless as a forced session_title call at the start of a run.
GROK_HOUSEKEEPING = "grok-4.6"
# Muse Code 1.4.20 (agents.py FrontierMuseCode): the pinned binary, downloaded straight to ~/.local/bin/muse, whose sha256 must
# be pin.json's. It reaches Muse Wonder through OpenRouter's Responses API on the proxy's OpenRouter route, so the model id it
# sends is OpenRouter's (meta/muse-wonder), the id the proxy's synthetic /muse-code/models catalog lists.
MUSE_BIN = "$HOME/.local/bin/muse"
# DeepSeek Harness 0.2.2-rc.1 (agents.py FrontierDsh): its install, home and agents roots in the task container, all fresh at
# setup, and the plugins our multi-user adapter's base.patch.yml turns off (the DeepSeek-hosted model adapters and package
# inventory, web search and web fetch, auto-loaded instruction files), which the composed profile must show off.
DSH_ROOT = "/tmp/frontier-dsh"
DSH_OFF = ("llm-deepseek", "llm-deepseek-account", "plugin-package-inventory-deepseek", "web", "web-search-deepseek",
           "web-deepseek-api", "web-fetch-http", "tool-web", "agent-instructions")
DSH_WEB_OFF = ("web", "web-search-deepseek", "web-deepseek-api", "web-fetch-http", "tool-web")
# Cursor (harnesses/cursor, the clean-room rebuild of 2026-11-09): every Cursor-specific value below is read from
# harnesses/cursor/pin.json and harnesses/cursor/config/cli-config.json, whose sources are Cursor's public docs, the CLI's
# own --help and --version output (harnesses/cursor/cli-help.txt) and what the CLI did at run time with no key. Nothing
# comes from the CLI's JavaScript or from Harbor's own cursor_cli.py (scripts/frontier-harbor/README.md, "Cursor").
CURSOR_PIN = json.loads((REPO / "harnesses/cursor/pin.json").read_text())
CURSOR_DIR = "/opt/frontier-cursor"
CURSOR_BIN = CURSOR_DIR + "/bin/agent"
CURSOR_RUN_DIR = "/tmp/frontier-cursor"
CURSOR_LOG_DIR = "/logs/agent"
CURSOR_STREAM = "cursor-stream.jsonl"
CURSOR_STDERR = "cursor-stderr.log"
CURSOR_HOOK_LOG = "cursor-tool-hooks.ndjson"
CURSOR_INSTRUCTION_FILES = "cursor-instruction-files.txt"
CURSOR_STATUS = "cursor-status.json"
# The names Cursor's docs say the CLI loads on its own (harnesses/cursor/pin.json instruction_files, adapter.sh).
CURSOR_AUTOLOADED = ("AGENTS.md", "CLAUDE.md", ".cursor", ".agents", ".claude", ".codex", ".cursorignore")
CURSOR_UNREACHABLE = "Failed to reach the Cursor API"


def harness_pin(harness: str, version: str | None = None) -> dict[str, Any]:
    """pin.json's entry for a harness at the version a preregistration selects: the entry itself for its own version or
    none, else the entry with that release's fields (Claude Code's releases); any other version is refused."""
    pin = PIN["harnesses"][harness]
    if version is None or version == pin["version"]:
        return pin
    release = pin.get("releases", {}).get(version)
    if release is None:
        raise ValueError(f"{harness} {version} is not pinned in scripts/frontier-harbor/pin.json (version {pin['version']}, releases {', '.join(pin.get('releases', {})) or 'none'})")
    return {**pin, **release, "version": version}



# The workspace git setup (internal-task, ported for gstack-cheap-model-2026-11): opt-in per job (the environment kwarg
# workspace_git, which plan.ts sets from a preregistration's gstack_delivery.workspace_git), so every other run's
# containers are unchanged. A failed setup, or an agent that does not see git and the setup's origin/main, stops the
# trial before any model call with HE-FRONTIER-016 (to-trials.ts infra class workspace_git).
GIT_SETUP_FILE = "git-setup.json"
GIT_SETUP_TIMEOUT_SEC = 900
GIT_STATIC = PIN["git_static"]
WORKSPACE_GIT = {
    "phase": "environment start (egress.py BlocklistDockerEnvironment.start, when the job's environment kwargs set workspace_git), before agent setup and outside the agent timeout, the same for every agent and arm (oracle and nop too)",
    "where": "the task container's working directory (the task's workdir, else the image WORKDIR), as root, then .git and the origin handed to the directory's owner",
    "git": f"the image's own git when it has one (git_provided image); otherwise the pinned static git {GIT_STATIC['version']} (pin.json git_static) copied to {GIT_STATIC['install_dir']} and linked into {GIT_STATIC['linked_into']}, on the agent's PATH in every arm (git_provided injected)",
    "git_static": {k: GIT_STATIC[k] for k in ("version", "url", "tarball_sha256", "install_dir", "linked_into")},
    "author": {"name": "Frontier Harbor", "email": "setup@frontier-harbor.invalid", "date": "2026-01-01T00:00:00+00:00"},
    "commit_message": "Task starting state",
    "branch": "main",
    "origin": "/opt/frontier-origin.git",
    "origin_head": "refs/remotes/origin/HEAD -> origin/main; git rev-parse origin/main must resolve",
    "exclude_over_bytes": 50 * 1024 * 1024,
    "exclude_file": ".git/info/exclude",
    "existing_repository": "kept: no new commit when it has one (an unborn one gets the starting commit on main); a remote named origin already there is kept and recorded as present (existing_origin yes, never its URL, which may hold a credential, and whether origin/main resolves), and no origin of ours is added",
    "identity_left": "none: no user.name or user.email is configured in the repository",
    "agent_check": "agents.py, at the end of agent setup, as the agent in its starting folder: command -v git and git rev-parse origin/main must give the setup's commit",
    "result": "workspace_git_result, from git-setup.json beside this file (git_provided, sha, seconds, excluded files, the agent check)",
}

def static_git_dir(cache: str | Path | None = None) -> Path:
    """The pinned static git (pin.json git_static) unpacked on the host, downloaded once into the cache and checked: the
    tarball's sha256, then the sha256 of each file pin.json names. Returns the release's tree (bin, cmd, libexec, share),
    which egress.py copies whole into a container whose image has no git."""
    import fcntl
    import shutil
    import urllib.request
    root = Path(cache or os.environ.get("FRONTIER_GIT_CACHE") or Path.home() / ".frontier-harbor" / "git-static") / GIT_STATIC["tarball_sha256"]
    out = root / "tree"
    root.mkdir(parents=True, exist_ok=True)
    with open(root / ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (out / ".unpacked").is_file() and all((out / f).is_file() and hashlib.sha256((out / f).read_bytes()).hexdigest() == h for f, h in GIT_STATIC["files"].items()):
            return out
        tarball = root / Path(GIT_STATIC["url"]).name
        if not tarball.is_file() or hashlib.sha256(tarball.read_bytes()).hexdigest() != GIT_STATIC["tarball_sha256"]:
            with urllib.request.urlopen(GIT_STATIC["url"], timeout=120) as r:
                tarball.write_bytes(r.read())
        got = hashlib.sha256(tarball.read_bytes()).hexdigest()
        if got != GIT_STATIC["tarball_sha256"]:
            raise RuntimeError(f"static git tarball {GIT_STATIC['url']} is {got}, not pin.json's {GIT_STATIC['tarball_sha256']}")
        staging = Path(tempfile.mkdtemp(dir=root))
        with tarfile.open(tarball) as t:
            t.extractall(staging, filter="data")
        tree = staging / GIT_STATIC["top_dir"]
        for f, want in GIT_STATIC["files"].items():
            got = hashlib.sha256((tree / f).read_bytes()).hexdigest() if (tree / f).is_file() else "missing"
            if got != want:
                raise RuntimeError(f"static git file {f} is {got}, not pin.json's {want}")
        (tree / ".unpacked").write_text(GIT_STATIC["tarball_sha256"] + "\n")
        if out.exists():
            shutil.rmtree(out)
        tree.rename(out)
        shutil.rmtree(staging)
        return out


def static_git_link_command() -> str:
    """Root's command after the static git tree is copied to install_dir: each name in links linked into linked_into,
    pointing at the release's launcher, then a check that the https helper is there and git runs."""
    d, l = GIT_STATIC["install_dir"], GIT_STATIC["linked_into"]
    links = " && ".join(f"ln -sf {d}/cmd/{b} {l}/{b}" for b in GIT_STATIC["links"])
    return f"rm -f {d}/.unpacked && mkdir -p {l} && {links} && test -x {d}/libexec/git-core/git-remote-https && {l}/git --version"


def workspace_git_script(origin: str = WORKSPACE_GIT["origin"]) -> str:
    """The workspace git setup (WORKSPACE_GIT), a POSIX sh script run as root in the task container's working directory.
    It prints GIT_EXCLUDED <path> per file over the size limit, GIT_EXISTING_ORIGIN <url> when the repository already
    has an origin (then left as it is), then one GIT_SETUP line; GIT_SETUP_FAIL <why> and exit 3 when it cannot run (no
    git, the working directory is /, or it is inside another repository)."""
    a, o, b = WORKSPACE_GIT["author"], shlex.quote(origin), WORKSPACE_GIT["branch"]
    ident = " ".join(f"GIT_{who}_{k.upper()}={shlex.quote(a[k])}" for who in ("AUTHOR", "COMMITTER") for k in ("name", "email", "date"))
    return "\n".join([
        "set -eu",
        'fail() { echo "GIT_SETUP_FAIL $*"; exit 3; }',
        "ws=$(pwd -P)",
        '[ "$ws" != / ] || fail "the working directory is /"',
        'command -v git >/dev/null 2>&1 || fail "no git in the image"',
        "cfg=$(mktemp); trap 'rm -f \"$cfg\"' EXIT",
        "printf '[safe]\\n\\tdirectory = *\\n' > \"$cfg\"",
        f'export GIT_CONFIG_GLOBAL="$cfg" GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 {ident}',
        "g() { git -c core.hooksPath=/dev/null -c commit.gpgsign=false \"$@\"; }",
        "repo=created",
        'if top=$(g rev-parse --show-toplevel 2>/dev/null); then repo=existing; [ "$top" = "$ws" ] || fail "the working directory is inside the repository $top"; else g init -q; fi',
        "gd=$(cd \"$(g rev-parse --git-dir)\" && pwd -P)",
        "existing=no",
        'if g remote get-url origin >/dev/null 2>&1; then existing=yes; echo "GIT_EXISTING_ORIGIN yes"; fi',
        "committed=no",
        "if ! g rev-parse -q --verify HEAD >/dev/null; then",
        f"  g symbolic-ref HEAD refs/heads/{b}",
        '  mkdir -p "$gd/info"',
        f"  find . -path ./.git -prune -o -type f -size +{WORKSPACE_GIT['exclude_over_bytes']}c -print | sort | while IFS= read -r f; do p=${{f#.}}; echo \"GIT_EXCLUDED $p\"; printf '%s\\n' \"$p\" | sed 's/[][*?\\\\]/\\\\&/g' >> \"$gd/info/exclude\"; done",
        "  g add -A",
        f"  g commit -q --allow-empty -m {shlex.quote(WORKSPACE_GIT['commit_message'])}",
        "  committed=yes",
        "fi",
        'if [ "$existing" = no ]; then',
        f"  rm -rf {o} && g init -q --bare {o} && g --git-dir={o} symbolic-ref HEAD refs/heads/{b}",
        f"  g remote add origin {o}",
        f"  g push -q origin HEAD:refs/heads/{b}",
        "  g fetch -q origin",
        f"  g symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/{b}",
        "fi",
        f"sha=$(g rev-parse --verify -q origin/{b}) || sha=none",
        f'[ "$existing" = yes ] || [ "$sha" != none ] || fail "origin/{b} does not resolve"',
        'owner=$(stat -c %u:%g "$ws")',
        f'[ "$owner" = 0:0 ] || chown -R "$owner" "$gd" $([ "$existing" = yes ] || echo {o})',
        "set -- $(git --version); version=${3:-unknown}",
        'echo "GIT_SETUP repo=$repo committed=$committed existing_origin=$existing branch=$(g symbolic-ref -q --short HEAD || echo detached) head=$(g rev-parse HEAD) origin_main=$sha files=$(g ls-files | wc -l | tr -d \' \') git=$(command -v git) git_version=$version owner=$owner workdir=$ws"',
    ]) + "\n"


def workspace_git_record(stdout: str | None, exit_code: int | None, seconds: float, error: str | None = None, git_provided: str | None = None) -> dict[str, Any]:
    """git-setup.json from the script's output and the wall seconds the host measured around it (git included when it
    was copied in). error is set (and the trial stops with HE-FRONTIER-016) when the script failed or printed no
    GIT_SETUP line, or when origin/main is not HEAD in a repository whose origin is ours."""
    lines = (stdout or "").splitlines()
    fields = dict(w.split("=", 1) for l in lines if l.startswith("GIT_SETUP ") for w in l.split(" ")[1:] if "=" in w)
    why = next((l[len("GIT_SETUP_FAIL "):] for l in lines if l.startswith("GIT_SETUP_FAIL ")), None)
    existing = next((l[len("GIT_EXISTING_ORIGIN "):] for l in lines if l.startswith("GIT_EXISTING_ORIGIN ")), None)
    if error is None and (exit_code != 0 or not fields):
        error = why or f"the setup exited {exit_code} with no GIT_SETUP line"
    if error is None and existing is None and fields.get("head") != fields.get("origin_main"):
        error = f"HEAD {fields.get('head')} is not origin/main {fields.get('origin_main')}"
    origin_main = fields.get("origin_main")
    return {
        "schema": "frontier-harbor-workspace-git/2",
        "exit": exit_code,
        "seconds": round(seconds, 3),
        "git_provided": git_provided,
        "git": fields.get("git"),
        "git_version": fields.get("git_version"),
        "workdir": fields.get("workdir"),
        "repo": fields.get("repo"),
        "committed": fields.get("committed") == "yes" if fields else None,
        "branch": fields.get("branch"),
        "sha": fields.get("head"),
        "existing_origin": existing,
        "origin_main": None if origin_main in (None, "none") else origin_main,
        "origin_main_resolves": None if not fields else origin_main not in (None, "none"),
        "files_tracked": int(fields["files"]) if fields.get("files", "").isdigit() else None,
        "owner": fields.get("owner"),
        "excluded": [l[len("GIT_EXCLUDED "):] for l in lines if l.startswith("GIT_EXCLUDED ")],
        **({"error": error} if error else {}),
    }


def workspace_git_agent_command() -> str:
    """What agents.py runs as the agent, in its starting folder, at the end of agent setup: where git resolves on the
    agent's PATH and what origin/main is."""
    return 'echo "AGENT_GIT git=$(command -v git || echo none) origin_main=$(git rev-parse --verify -q origin/main 2>/dev/null || echo none) pwd=$(pwd -P)"'


def model_spec(model: str) -> dict[str, Any]:
    """The pin.json row of a provider:model id, with its provider and bare name."""
    if model not in PIN["models"]:
        raise ValueError(f"model {model} is not in scripts/frontier-harbor/pin.json models ({', '.join(PIN['models'])})")
    provider, name = model.split(":", 1)
    return {**PIN["models"][model], "id": model, "name": name, "provider": provider}


def check_cell(harness: str, model: str) -> dict[str, Any]:
    """The model row of a harness and cell model this path can run, or a ValueError naming why not."""
    if harness not in HARNESSES:
        raise ValueError(f"unknown harness {harness}")
    if harness == "cursor" and model not in PIN["harnesses"]["cursor"]["models"]:
        raise ValueError(f"HE-CURSOR-001 a Cursor cell must be {', '.join(PIN['harnesses']['cursor']['models'])} (harnesses/cursor/pin.json model_cursor.cell_model), not {model}")
    spec = model_spec(model)
    if "harnesses" in spec and harness not in spec["harnesses"]:
        raise ValueError(f"HE-FRONTIER-012 {harness} has no route for {model} on this path; scripts/frontier-harbor/pin.json runs it only on {', '.join(spec['harnesses'])}")
    if spec["provider"] not in PROVIDERS.get(harness, ("anthropic", "openai", "particle", "openrouter")):
        raise ValueError(f"{harness} runs only on {', '.join(PROVIDERS[harness])} models, not {model}")
    return spec


def housekeeping_models(harness: str, model: str) -> list[str]:
    """provider:model ids, beyond the cell model, that a harness may call on its own (metered, never scored)."""
    if harness == "openclaw" and model.startswith("anthropic:"):
        return [f"anthropic:{OPENCLAW_ANTHROPIC_HOUSEKEEPING}"]
    if harness == "gemini-cli":
        return [f"google:{m}" for m in GEMINI_CLI_HOUSEKEEPING]
    if harness == "grok-build":
        return [f"xai:{GROK_HOUSEKEEPING}"]
    if harness == "qm":
        import qm_harbor
        return qm_harbor.housekeeping_models(model)
    return []


def slot_models(harness: str, model: str) -> list[str]:
    """The models a trial's proxy slot allows. A Cursor trial has no slot: its calls go to Cursor's backend."""
    if harness == "cursor":
        return []
    return [model, *housekeeping_models(harness, model)]


def base_url(gateway: str, slot: str, provider: str) -> str:
    """The proxy route for one trial slot, without the API version suffix."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", slot):
        raise ValueError(f"slot {slot!r} must be letters, digits, dot, underscore or dash")
    if provider not in ("anthropic", "openai", "particle", "openrouter", "google", "xai"):
        raise ValueError(f"provider {provider!r} has no proxy route on this path")
    return f"{gateway.rstrip('/')}/{slot}/{provider}"


def _pin_text(path: str) -> str:
    return (REPO / path).read_text()


def codex_config(model: str, url: str) -> dict[str, Any]:
    """Our harnesses/codex/config/config.toml for the cell, effort high, the trial's proxy route and the model's window."""
    spec = model_spec(model)
    pin = json.loads(_pin_text("harnesses/codex/pin.json"))["codex_config"]
    text = _pin_text("harnesses/codex/config/config.toml")
    for k, v in {"MODEL": spec["name"], "BASE_URL": f"{url}/v1", "EFFORT": EFFORT,
                 "REQUEST_RETRIES": pin["request_max_retries"], "STREAM_RETRIES": pin["stream_max_retries"]}.items():
        text = text.replace(f"@{k}@", json.dumps(v))
    cfg = tomllib.loads(text)
    cfg["model_providers"]["he-proxy"]["env_key"] = "OPENAI_API_KEY"
    cfg["model_context_window"] = codex_window(model)
    return cfg


def codex_window(model: str) -> int:
    """The window Codex 0.165.0 runs the model at: its built-in max_context_window caps model_context_window."""
    return min(model_spec(model)["context_window"], PIN["harnesses"]["codex"]["max_context_window"]["value"])


def hermes_config(model: str) -> dict[str, Any]:
    """Our Hermes config (config.yaml, config.openai.yaml on OpenAI, config.particle.yaml on Particle) as data, effort
    high, the model's real window. On Particle a custom_providers entry (custom:particle) runs Hermes's custom-endpoint
    provider on Chat Completions; Hermes sends no effort or output cap of its own there, so extra_body adds both. On
    OpenRouter it is Hermes's built-in openrouter provider with its base URL at the proxy's OpenRouter route (amendment 1
    of frontier-shootout-2026-11), plus the he-openrouter-effort plugin (hermes_openrouter_plugin_files), which adds the
    effort and the cap that provider sends only to openrouter.ai. On xAI it is Hermes's own xai provider (the Responses
    API, api_mode codex_responses), whose base URL is XAI_BASE_URL (hermes_cli/providers.py)."""
    spec = model_spec(model)
    provider = {"anthropic": "anthropic", "openai": "openai-api", "particle": "custom:particle", "openrouter": "openrouter", "google": "gemini", "xai": "xai"}[spec["provider"]]
    custom = {
        "custom_providers": [{"name": "particle", "base_url": "${OPENAI_BASE_URL}", "key_env": "OPENAI_API_KEY",
                              "extra_body": {"reasoning_effort": EFFORT, "max_completion_tokens": spec["max_output_tokens"]}}],
    } if spec["provider"] == "particle" else {}
    url = "${OPENAI_BASE_URL}" if custom else {"openrouter": "${OPENROUTER_BASE_URL}", "google": "${GEMINI_BASE_URL}"}.get(spec["provider"])
    return {
        "_config_version": 46,
        "model": {"provider": provider, "default": spec["name"], **({"base_url": url} if url else {}),
                  "context_length": spec["context_window"]},
        **custom,
        **({"plugins": {"enabled": [HERMES_OPENROUTER_PLUGIN["name"]]}} if spec["provider"] == "openrouter" else {}),
        "agent": {"reasoning_effort": EFFORT, "image_input_mode": "text", "disabled_toolsets": HERMES_XAI_DISABLED_TOOLSETS if spec["provider"] == "xai" else HERMES_DISABLED_TOOLSETS},
        "web": {"keyless_fallback": False},
        "terminal": {"backend": "local", "timeout": 180, "home_mode": "profile"},
        "display": {"streaming": False},
        "auto_update": False,
        "check_for_updates": False,
        "security": {"allow_lazy_installs": False},
    }


def hermes_openrouter_plugin_files(model: str) -> list[dict[str, str]]:
    """The he-openrouter-effort plugin's files for a Hermes cell on OpenRouter, each with its path under HERMES_HOME and its
    sha256, which must equal pin.json's (HE-FRONTIER-015); none on any other provider."""
    if model_spec(model)["provider"] != "openrouter":
        return []
    out = []
    for name, want in sorted(HERMES_OPENROUTER_PLUGIN["files"].items()):
        body = (REPO / HERMES_OPENROUTER_PLUGIN["dir"] / name).read_bytes()
        got = hashlib.sha256(body).hexdigest()
        if got != want:
            raise RuntimeError(f"HE-FRONTIER-015 {HERMES_OPENROUTER_PLUGIN['dir']}/{name} has sha256 {got}, not pin.json's {want}; the trial stops before the agent starts (docs/errors.md)")
        out.append({"path": f"plugins/{HERMES_OPENROUTER_PLUGIN['name']}/{name}", "sha256": got, "content": body.decode()})
    return out


def openclaw_config(model: str, url: str) -> dict[str, Any]:
    """Our OpenClaw config overlay for the cell: the provider over the trial's proxy route with the model's real limits,
    and the web tools off. agents.py appends tools.deny to the denies Harbor's class writes instead of replacing them."""
    spec = model_spec(model)
    tools = {"deny": list(OPENCLAW_WEB_DENY), "web": {"search": {"enabled": False}, "fetch": {"enabled": False}}}
    entry = {"id": spec["name"], "name": spec["name"], "reasoning": True, "input": ["text"],
             "contextWindow": spec["context_window"], "maxTokens": spec["max_output_tokens"]}
    if spec["provider"] == "anthropic":
        provider = {"baseUrl": url, "apiKey": "${ANTHROPIC_API_KEY}", "api": "anthropic-messages", "models": [entry]}
        defaults = {"model": {"primary": f"anthropic/{spec['name']}"}, "thinkingDefault": EFFORT, "skipBootstrap": True}
        return {"models": {"mode": "merge", "providers": {"anthropic": provider}}, "agents": {"defaults": defaults}, "tools": tools}
    name = openclaw_provider(model)
    if spec["provider"] == "google":
        provider = {"baseUrl": f"{url}/v1beta", "apiKey": "${GEMINI_API_KEY}", "api": "google-generative-ai", "models": [entry]}
        defaults = {"model": {"primary": f"google/{spec['name']}"}, "utilityModel": f"google/{spec['name']}", "thinkingDefault": EFFORT, "skipBootstrap": True}
        return {"models": {"mode": "merge", "providers": {"google": provider}}, "agents": {"defaults": defaults},
                "memory": {"search": {"provider": "none"}}, "tools": tools}
    if spec["provider"] in ("particle", "openrouter"):
        entry["compat"] = {"maxTokensField": "max_completion_tokens", "supportsUsageInStreaming": True}
    if spec["provider"] == "openrouter":
        entry["compat"]["thinkingFormat"] = "openrouter"
        tools["deny"] += OPENCLAW_OPENROUTER_DENY
    provider = {"baseUrl": f"{url}/v1", "apiKey": {"xai": "${XAI_API_KEY}", "openrouter": "${OPENROUTER_API_KEY}"}.get(name, "${OPENAI_API_KEY}"),
                "api": "openai-responses" if name in ("openai", "xai") else "openai-completions", "models": [entry]}
    defaults = {"model": {"primary": f"{name}/{spec['name']}"}, "utilityModel": f"{name}/{spec['name']}",
                "thinkingDefault": EFFORT, "skipBootstrap": True}
    return {"models": {"mode": "merge", "providers": {name: provider}}, "agents": {"defaults": defaults},
            "memory": {"search": {"provider": "none"}}, "tools": tools}


def openclaw_provider(model: str) -> str:
    """The OpenClaw provider id of a cell's model: the provider itself. On OpenRouter that is OpenClaw's bundled openrouter
    provider with its baseUrl at the proxy's OpenRouter route (amendment 1 of frontier-shootout-2026-11): a custom
    provider id there gets OpenClaw's unowned-provider replay policy, which rewrites tool call ids (call_N to callN). Google
    accepted the rewritten ids on the real route (s02 at 7c604eb, amendment 4), so the bundled provider is kept because it
    is what an OpenRouter user of OpenClaw runs, not because the custom one fails."""
    return model_spec(model)["provider"]


def pi_models_entry(model: str) -> dict[str, Any]:
    """The fields Pi's models.json gets beside Harbor's id and reasoning flag, so Pi uses the model's real limits. On Claude,
    compat.forceAdaptiveThinking makes Pi send thinking adaptive plus output_config.effort, as its own catalog does for
    these models; Harbor's custom provider skips the catalog, so Pi would otherwise send budget thinking (enabled)."""
    spec = model_spec(model)
    entry: dict[str, Any] = {"contextWindow": spec["context_window"], "maxTokens": spec["max_output_tokens"]}
    if spec["provider"] == "anthropic":
        entry["compat"] = {"forceAdaptiveThinking": True}
    return entry


# Pi 1.5.0's own catalog row for DeepSeek V4.1 Flash 1017 on its openrouter provider (pi-ai dist/providers/data/openrouter.json,
# "chat:deepseek/deepseek-v4.1-flash-1017"), the request shaping Pi applies there, plus sessionAffinityFormat openrouter, which
# pi-ai detects from the provider id openrouter (dist/api/openai-completions.js detectCompat). Harbor's custom provider has
# another id and the proxy's URL, so without these Pi would send reasoning_effort, a developer role and the OpenAI
# session headers instead.
PI_OPENROUTER_MODELS = {
    "deepseek/deepseek-v4.1-flash-1017": {
        "thinkingLevelMap": {"off": "none", "minimal": None, "low": "low", "medium": None, "high": "high", "xhigh": None, "max": "max"},
        "compat": {"supportsDeveloperRole": False, "thinkingFormat": "openrouter", "supportsStrictMode": True, "sendSessionAffinityHeaders": True,
                   "sessionAffinityFormat": "openrouter", "requiresReasoningContentOnAssistantMessages": True, "maxTokensField": "max_completion_tokens"},
    },
    "meta/muse-wonder": {
        "thinkingLevelMap": {"off": None, "minimal": "minimal", "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"},
        "compat": {"supportsDeveloperRole": False, "thinkingFormat": "openrouter", "supportsStrictMode": True, "sendSessionAffinityHeaders": True,
                   "sessionAffinityFormat": "openrouter", "maxTokensField": "max_completion_tokens"},
    },
    "moonshotai/kimi-k3.1-pro": {
        "thinkingLevelMap": {"off": "none", "minimal": None, "low": "low", "medium": None, "high": "high", "xhigh": None, "max": "max"},
        "compat": {"supportsDeveloperRole": False, "thinkingFormat": "openrouter", "supportsStrictMode": True, "sendSessionAffinityHeaders": True,
                   "sessionAffinityFormat": "openrouter", "maxTokensField": "max_completion_tokens"},
    },
    "z-ai/glm-5.3": {
        "thinkingLevelMap": {"off": None, "minimal": None, "low": "low", "medium": None, "high": "high", "xhigh": None, "max": "max"},
        "compat": {"supportsDeveloperRole": False, "thinkingFormat": "openrouter", "supportsStrictMode": True, "sendSessionAffinityHeaders": True,
                   "sessionAffinityFormat": "openrouter", "maxTokensField": "max_completion_tokens"},
    },
}
# Pi 1.5.0's catalog has no Gemini 4 Carbon or Hydrogen row; both take its Gemini 4 Argon row ("chat:google/gemini-4-argon"),
# the same family on the same Google endpoints.
PI_ARGON_ROW = {
    "thinkingLevelMap": {"off": None, "minimal": None, "low": "low", "medium": "medium", "high": "high", "xhigh": None, "max": None},
    "compat": {"supportsDeveloperRole": False, "thinkingFormat": "openrouter", "supportsStrictMode": True, "sendSessionAffinityHeaders": True,
               "sessionAffinityFormat": "openrouter", "maxTokensField": "max_completion_tokens"},
}
PI_OPENROUTER_MODELS["google/gemini-4-carbon"] = PI_ARGON_ROW
PI_OPENROUTER_MODELS["google/gemini-4-hydrogen"] = PI_ARGON_ROW
PI_CATALOG_ROW = {"google/gemini-4-carbon": "chat:google/gemini-4-argon", "google/gemini-4-hydrogen": "chat:google/gemini-4-argon"}
# Pi 1.5.0's google catalog (pi-ai dist/providers/data/google.json) has no Gemini 4 Carbon or Hydrogen row; both take its Gemini 4
# Argon row ("chat:gemini-4-argon", api google-generative-ai), the same family on the same API: its thinkingLevelMap, and no compat.
PI_GOOGLE_ARGON_ROW = {"thinkingLevelMap": {"off": None, "minimal": None, "low": "low", "medium": "medium", "high": "high", "xhigh": None, "max": None}}
PI_GOOGLE_MODELS = {"gemini-4-carbon": PI_GOOGLE_ARGON_ROW, "gemini-4-hydrogen": PI_GOOGLE_ARGON_ROW}
# Pi 1.5.0's own catalog row for Grok 4.7 on its xai provider (pi-ai dist/providers/data/xai.json, "chat:grok-4.7", api
# openai-responses): its thinkingLevelMap and compat. Harbor's custom provider skips the catalog, so the entry carries them.
PI_XAI_MODELS = {
    "grok-4.7": {
        "thinkingLevelMap": {"off": None, "minimal": None, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": None},
        "compat": {"supportsLongCacheRetention": False},
    },
}


def pi_chat_models_json(model: str, url: str) -> dict[str, Any]:
    """Pi's models.json on Particle, OpenRouter or xAI: Harbor's harbor-endpoint provider over the trial's route, api
    openai-completions (openai-responses on xAI, as Pi's own xai provider), the per-trial token read from OPENAI_API_KEY
    (XAI_API_KEY on xAI). agents.py writes it itself because Harbor resolves a custom endpoint only for providers it knows
    (it knows no Particle), and on OpenRouter it would point Pi at OPENROUTER_BASE_URL with OPENROUTER_API_KEY, names no
    container here holds. On OpenRouter and xAI the model also gets Pi's own catalog request shaping (PI_OPENROUTER_MODELS,
    PI_XAI_MODELS)."""
    spec = model_spec(model)
    entry = {"id": spec["name"], "reasoning": True, **pi_models_entry(model)}
    xai = spec["provider"] == "xai"
    if spec["provider"] == "google":
        entry.update(PI_GOOGLE_MODELS[spec["name"]])
        return {"providers": {"harbor-endpoint": {"baseUrl": f"{url}/v1beta", "apiKey": "$GEMINI_API_KEY", "api": "google-generative-ai", "models": [entry]}}}
    if spec["provider"] == "openrouter":
        entry.update(PI_OPENROUTER_MODELS[spec["name"]])
    if xai:
        entry.update(PI_XAI_MODELS[spec["name"]])
    return {"providers": {"harbor-endpoint": {"baseUrl": f"{url}/v1", "apiKey": "$XAI_API_KEY" if xai else "$OPENAI_API_KEY",
                                              "api": "openai-responses" if xai else "openai-completions", "models": [entry]}}}


def litellm_registry(model: str) -> dict[str, Any]:
    """A LiteLLM model registry entry for mini-swe-agent, so LiteLLM knows the model's window and keeps reasoning_effort."""
    spec = model_spec(model)
    return {f"{spec['provider']}/{spec['name']}": {
        "max_input_tokens": spec["context_window"], "max_output_tokens": spec["max_output_tokens"],
        "max_tokens": spec["max_output_tokens"], "litellm_provider": spec["provider"], "mode": "chat",
        "supports_reasoning": True, "supports_function_calling": True}}


def dsh_profile_patch(model: str, url: str) -> str:
    """The headless profile's user patch layer ($DSH_HOME/profiles/headless/cordis.patch.yml) for a dsh cell: our multi-user
    adapter's route rows for the cell's provider (harnesses/dsh/config/route.<route>.patch.yml, the route being the last
    segment of the trial's proxy URL, as adapter.sh reads it) and its base rows (base.patch.yml), with the model's real
    window added to the model entry and its output cap at most 128,000. The token is named by variable (apiKeyEnv
    HE_MODEL_API_KEY), so the text holds no credential."""
    spec = model_spec(model)
    route = spec["provider"]
    base = url.rstrip("/")
    if base.rsplit("/", 1)[-1] != route:
        raise ValueError(f"a dsh cell on {model} runs on the proxy's {route} route <proxy>/<slot>/{route}, not {url}")
    text = _pin_text(f"harnesses/dsh/config/route.{route}.patch.yml")
    for k, v in {"MODEL": spec["name"], "BASE_URL_V1": f"{base}/v1", "BASE_URL": base}.items():
        text = text.replace(f"@{k}@", json.dumps(v))
    cap = "            maxTokens: 128000\n"
    if text.count(cap) != 1:
        raise ValueError(f"harnesses/dsh/config/route.{route}.patch.yml no longer has one model entry with maxTokens 128000")
    text = text.replace(cap, "            contextWindow: %d\n            maxTokens: %d\n" % (spec["context_window"], min(spec["max_output_tokens"], 128000)))
    return (f"# Written by scripts/frontier-harbor/agents.py FrontierDsh (route {route}) from harnesses/dsh/config/route.{route}.patch.yml\n"
            "# and base.patch.yml, with the model's window added. Do not edit: the agent class rewrites it at setup.\n"
            + text + _pin_text("harnesses/dsh/config/base.patch.yml"))


def dsh_dump_checks(dump: str) -> dict[str, Any]:
    """What `dsh --profile headless --dump-config` composed, read from its text (the dump carries !!js tags, so it is not
    parsed as YAML): whether each DSH_OFF plugin is disabled, the session telemetry mode, and the default model's provider."""
    blocks: dict[str, str] = {}
    for part in re.split(r"(?m)^(?=- id: )", dump):
        m = re.match(r"- id: (\S+)\n", part)
        if m:
            blocks[m.group(1)] = part
    disabled = lambda i: i in blocks and re.search(r"(?m)^  disabled: true$", blocks[i]) is not None
    telemetry = re.search(r"(?m)^    mode: (\S+)$", blocks.get("session-telemetry-otel", ""))
    provider = re.search(r"(?m)^    provider: (\S+)$", blocks.get("agent-default-model", ""))
    off = {i: disabled(i) for i in DSH_OFF}
    return {"off": off, "all_off": all(off.values()), "telemetry_mode": telemetry.group(1) if telemetry else None,
            "default_provider": provider.group(1) if provider else None, "plugins": len(blocks)}


def harbor_kwargs(harness: str, model: str) -> dict[str, Any]:
    """The Harbor agent options each class sets (reasoning effort, web search, limits)."""
    spec = check_cell(harness, model)
    if harness == "claude-code":
        return {"reasoning_effort": EFFORT, "disallowed_tools": "WebSearch,WebFetch", "permission_mode": "bypassPermissions"}
    if harness == "codex":
        return {"reasoning_effort": EFFORT, "web_search": "disabled"}
    if harness == "hermes":
        return {}
    if harness == "openclaw":
        return {"thinking": EFFORT, "disable_web_search": True}
    if harness == "pi":
        return {"thinking": EFFORT, "model_api": {"anthropic": "anthropic-messages", "openai": "openai-responses", "particle": "openai-completions", "openrouter": "openai-completions", "google": "google-generative-ai", "xai": "openai-responses"}[spec["provider"]]}
    if harness == "mini-swe-agent":
        return {"reasoning_effort": EFFORT, "max_tokens": spec["max_output_tokens"], "litellm_model_registry": litellm_registry(model)}
    if harness == "dsh":
        return {}
    if harness == "cursor":
        return {}
    if harness in ("gemini-cli", "grok-build"):
        return {"reasoning_effort": EFFORT, "disable_web_search": True}
    if harness == "muse-code":
        return {"reasoning_effort": EFFORT}
    if harness == "qm":
        return {}
    raise ValueError(f"unknown harness {harness}")


def grok_config(model: str, url: str) -> dict[str, Any]:
    """Our overlay on Harbor's ~/.grok/config.toml for a Grok Build cell: a [model.<id>] block for the cell model on the
    proxy's xai route, the custom-endpoint block Harbor documents (grok_build.py). It names Grok Build's own wire for xAI
    models (Responses: its built-in catalog sets api_backend responses for every xAI model), the model's window and our
    output cap, and the effort menu the CLI otherwise reads from api.x.ai's /v1/models row, which the egress blocklist
    refuses; without a menu entry --reasoning-effort high sends no effort. A second block sends the CLI's session-title model
    (GROK_HOUSEKEEPING, its shipped default, whose built-in endpoint is api.x.ai) to the same route, on the wire its catalog
    names. The key is read from XAI_API_KEY."""
    spec = check_cell("grok-build", model)
    if url.rstrip("/").rsplit("/", 1)[-1] != "xai":
        raise ValueError(f"a Grok Build cell's endpoint must be the proxy's xai route <proxy>/<slot>/xai, not {url}")
    return {"model": {spec["name"]: {
        "name": spec["name"], "model": spec["name"], "base_url": f"{url.rstrip('/')}/v1", "env_key": "XAI_API_KEY",
        "api_backend": "responses", "context_window": spec["context_window"], "max_completion_tokens": spec["max_output_tokens"],
        "reasoning_efforts": [{"value": EFFORT, "default": True}],
    }, GROK_HOUSEKEEPING: {"base_url": f"{url.rstrip('/')}/v1", "env_key": "XAI_API_KEY", "api_backend": "responses"}}}


def gemini_cli_settings(model: str) -> dict[str, Any]:
    """Our overlay on the settings.json Harbor writes for Gemini CLI. Harbor's effort alias (harbor-<model>-high) reaches only
    the first request of a turn: the CLI then sets the bare model as its active model, whose config carries no thinking level,
    so every follow-up after a tool result asked for none (seen keyless with 0.68.0). A customOverrides entry matching the
    bare model puts thinkingLevel on every request for it, housekeeping models untouched. Usage statistics are off, as every
    other harness's telemetry is (they would go to play.googleapis.com, which the egress blocklist refuses anyway)."""
    name = check_cell("gemini-cli", model)["name"]
    return {"privacy": {"usageStatisticsEnabled": False}, "modelConfigs": {"customOverrides": [
        {"match": {"model": name}, "modelConfig": {"generateContentConfig": {"thinkingConfig": {"thinkingLevel": EFFORT.upper()}}}}]}}


def muse_settings(model: str, url: str) -> dict[str, Any]:
    """Our Muse Code settings.json for a cell: the endpoint on the proxy's OpenRouter route with the per-trial token as the
    bearer (a settings pin is the only way Muse sends its key to a base URL other than api.meta.ai; a --base-url flag alone
    withholds it), web search and web fetch off, telemetry off, and the model's window as the compaction limit."""
    spec = check_cell("muse-code", model)
    if url.rstrip("/").rsplit("/", 1)[-1] != "openrouter":
        raise ValueError(f"a Muse Code cell's endpoint must be the proxy's OpenRouter route <proxy>/<slot>/openrouter, not {url}")
    return {"schema_version": 1, "endpoint_transport": {"base_url": f"{url.rstrip('/')}/v1", "auth": "bearer"},
            "tools": {"web_search": {"mode": "off"}, "web_fetch": {"enabled": False}}, "telemetry": {"enabled": False},
            "context_compaction": {"provider_context_limit_tokens": spec["context_window"]}}


def muse_install_command(version: str | None = None) -> str:
    """Downloads the pinned Muse Code binary (pin.json binary_url) to ~/.local/bin/muse. Meta's install.sh would fetch a launcher
    that installs the newest stable release and updates itself, which Harbor's own class accepts and a pinned run cannot."""
    hp = harness_pin("muse-code", version)
    return ("set -euo pipefail; mkdir -p \"$HOME/.local/bin\" && "
            f"curl -fsSL {shlex.quote(hp['binary_url'])} -o \"$HOME/.local/bin/muse.part\" && chmod 755 \"$HOME/.local/bin/muse.part\" && "
            "mv \"$HOME/.local/bin/muse.part\" \"$HOME/.local/bin/muse\" && MUSE_NO_AUTO_UPDATE=1 \"$HOME/.local/bin/muse\" --version")


def binary_check_command(path: str) -> str:
    """The shell command that prints the sha256 of an installed harness binary (a link is followed to its file)."""
    return f'sha256sum "$(readlink -f "{path}")"'


def binary_check(harness: str, stdout: str | None, version: str | None = None) -> dict[str, Any]:
    """binary_check_command's output against pin.json's binary_sha256 for the harness, or HE-FRONTIER-014."""
    want = harness_pin(harness, version)["binary_sha256"]
    words = (stdout or "").split()
    got = words[0] if words and re.fullmatch(r"[0-9a-f]{64}", words[0]) else None
    if got != want:
        raise RuntimeError(f"HE-FRONTIER-014 the installed {harness} binary's sha256 is {got or 'unreadable'}, not pin.json's {want}; the trial stops before the agent starts (docs/errors.md)")
    return {"binary_sha256": got, "matches_pin": True}


def container_env(harness: str, model: str, url: str, token: str, gstack: dict[str, Any] | None = None) -> dict[str, str]:
    """Everything the task container's agent process gets in its environment for the model: the proxy route and the
    per-trial token under the names the harness reads, and the harness's own switches. No other credential. A gstack
    arm (its manifest, gstack_manifest()) adds gstack's eval markers (GSTACK_EVAL_DIR, EVALS_RUN_ID). A Cursor trial
    gets nothing here: it has no proxy route, and CURSOR_API_KEY reaches its CLI from a file (cursor_run_command)."""
    if harness == "cursor":
        check_cell(harness, model)
        return {}
    if harness == "qm":
        import qm_harbor
        route = check_cell(harness, model)["provider"]
        qm_harbor.route(model)
        if url.rstrip("/").rsplit("/", 1)[-1] != route:
            raise ValueError(f"a qm cell on {model} runs on the proxy's {route} route <proxy>/<slot>/{route}, not {url}")
        return {}
    spec = model_spec(model)
    anthropic = spec["provider"] == "anthropic"
    if harness == "muse-code":
        muse_settings(model, url)
        return {"META_API_KEY": token}
    if harness in ("gemini-cli", "grok-build"):
        route = check_cell(harness, model)["provider"]
        if url.rstrip("/").rsplit("/", 1)[-1] != route:
            raise ValueError(f"a {harness} cell on {model} runs on the proxy's {route} route <proxy>/<slot>/{route}, not {url}")
        return {"GEMINI_API_KEY": token, "GOOGLE_GEMINI_BASE_URL": url} if harness == "gemini-cli" else {"XAI_API_KEY": token}
    if harness == "dsh":
        if url.rstrip("/").rsplit("/", 1)[-1] != spec["provider"]:
            raise ValueError(f"a dsh cell on {model} runs on the proxy's {spec['provider']} route <proxy>/<slot>/{spec['provider']}, not {url}")
        return {"HE_MODEL_API_KEY": token, "DSH_HOME": f"{DSH_ROOT}/home", "DSH_AGENTS_HOME": f"{DSH_ROOT}/agents", "DSH_TELEMETRY_MODE": "DISABLED"}
    if spec["provider"] == "particle" and not url.rstrip("/").endswith("/particle"):
        raise ValueError(f"a Particle cell's endpoint must be the proxy's Particle route <proxy>/<slot>/particle, not {url}")
    if spec["provider"] == "openrouter" and not url.rstrip("/").endswith("/openrouter"):
        raise ValueError(f"an OpenRouter cell's endpoint must be the proxy's OpenRouter route <proxy>/<slot>/openrouter, not {url}")
    if spec["provider"] == "google":
        if not url.rstrip("/").endswith("/google"):
            raise ValueError(f"a Gemini cell's endpoint must be the proxy's google route <proxy>/<slot>/google, not {url}")
        return {"GEMINI_API_KEY": token, **({"GEMINI_BASE_URL": f"{url}/{HERMES_GEMINI_SEGMENT}/v1beta"} if harness == "hermes" else {}),
                **((gstack or {}).get("eval_env") or {})}
    if spec["provider"] == "xai":
        if not url.rstrip("/").endswith("/xai"):
            raise ValueError(f"an xAI cell's endpoint must be the proxy's xai route <proxy>/<slot>/xai, not {url}")
        return {"XAI_BASE_URL": f"{url}/v1", "XAI_API_KEY": token, **((gstack or {}).get("eval_env") or {})}
    env: dict[str, str] = (
        {"ANTHROPIC_BASE_URL": url, "ANTHROPIC_API_KEY": token} if anthropic
        else {"OPENROUTER_BASE_URL": f"{url}/v1", "OPENROUTER_API_KEY": token,
              **({"HE_OPENROUTER_MAX_OUTPUT_TOKENS": str(spec["max_output_tokens"])} if harness == "hermes" else {})} if spec["provider"] == "openrouter" and harness in ("hermes", "openclaw")
        else {"OPENAI_BASE_URL": f"{url}/v1", "OPENAI_API_KEY": token}
    )
    if harness == "claude-code":
        env.update({v: spec["name"] for v in CLAUDE_MODEL_VARS})
        env.update({
            "CLAUDE_CODE_SUBAGENT_MODEL_FORCE": "1", "CLAUDE_CODE_NO_MODEL_FALLBACK": "1",
            "CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK": "1", "CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK": "1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1",
            "DISABLE_ERROR_REPORTING": "1", "CLAUDE_CODE_MAX_RETRIES": "2",
            "CLAUDE_CODE_MAX_OUTPUT_TOKENS": str(spec["max_output_tokens"]),
            "CLAUDE_CODE_AUTO_COMPACT_WINDOW": str(spec["context_window"]),
            "CLAUDE_CODE_EFFORT_LEVEL": EFFORT,
        })
    if gstack:
        env.update(gstack.get("eval_env") or {})
    if harness == "mini-swe-agent":
        env["MSWEA_API_KEY"] = token
        if anthropic:
            env["ANTHROPIC_API_BASE"] = url
        else:
            env["OPENAI_API_BASE"] = f"{url}/v1"
    return env


def cursor_cli_config() -> dict[str, Any]:
    """Our clean-room cli-config.json (harnesses/cursor/config/cli-config.json), unchanged: permissions.deny WebFetch(*),
    autoAcceptWebSearch false, sandbox disabled. The Harbor cell writes it to $HOME/.cursor/cli-config.json, as adapter.sh does."""
    return json.loads(_pin_text("harnesses/cursor/config/cli-config.json"))


def cursor_hooks(hook: str, log: str) -> dict[str, Any]:
    """$HOME/.cursor/hooks.json: documented postToolUse and postToolUseFailure command hooks (https://cursor.com/docs/hooks:
    they fire for every tool, with tool_name), each appending the call's tool_name to log, the record
    harnesses/cursor/tool-audit-hook.cjs keeps. The Harbor cell's hook is cursor-tool-hook.sh beside this file, in POSIX
    sh, because a task image need not have node."""
    entry = [{"command": "sh " + shlex.quote(hook) + " " + shlex.quote(log)}]
    return {"version": 1, "hooks": {"postToolUse": entry, "postToolUseFailure": entry}}


def cursor_turn_model(model: str) -> str:
    check_cell("cursor", model)
    return CURSOR_PIN["model_cursor"]["turn_model"]


def cursor_flags(model: str, workspace: str = '"$PWD"') -> list[str]:
    """The CLI's flags, every one in agent --help (harnesses/cursor/cli-help.txt) except --disable-auto-update (CLI
    changelog, January 2026). adapter.sh's --approve-mcps is left out: a TB2.1 task has no MCP server."""
    return ["-p", "--output-format", "stream-json", "--force", "--trust", "--workspace", workspace,
            "--model", shlex.quote(cursor_turn_model(model)), "--disable-auto-update"]


def cursor_install_command(base: str = CURSOR_DIR) -> str:
    """Installs the pinned package in the task container (as root): the steps harnesses/cursor/Dockerfile runs, from
    harnesses/cursor/pin.json integrity, with both sha256 values and agent --version checked."""
    i, v = CURSOR_PIN["integrity"], CURSOR_PIN["version"]
    return "; ".join([
        "set -eu", f"d={shlex.quote(base)}", "tmp=$(mktemp -d)",
        f'curl -fsSL {shlex.quote(i["package_url"])} -o "$tmp/agent-cli-package.tar.gz"',
        f'echo "{i["package_sha256"]}  $tmp/agent-cli-package.tar.gz" | sha256sum -c -',
        'rm -rf "$d"', 'mkdir -p "$d/cursor-agent" "$d/bin"',
        'tar --strip-components=1 -xzf "$tmp/agent-cli-package.tar.gz" -C "$d/cursor-agent"', 'rm -rf "$tmp"',
        f'echo "{i["launcher_sha256"]}  $d/cursor-agent/cursor-agent" | sha256sum -c -',
        'ln -s ../cursor-agent/cursor-agent "$d/bin/agent"', 'chmod -R a+rX "$d"',
        'h=$(mktemp -d)', 'got=$(HOME="$h" "$d/bin/agent" --version)', 'rm -rf "$h"',
        f'[ "$got" = {shlex.quote(v)} ] || {{ echo "HE-FRONTIER-002 agent --version printed $got, not {v}" >&2; exit 1; }}',
        'echo "$got"',
    ])


def cursor_preflight_command(base: str = CURSOR_RUN_DIR, logs: str = CURSOR_LOG_DIR) -> str:
    """Lists every name Cursor's docs say the CLI loads on its own, under the task's working directory (recursive,
    node_modules and .git skipped) and the CLI's fresh HOME, before anything is written there. One line per hit,
    'workdir <path>' or 'home <path>', in <logs>/cursor-instruction-files.txt."""
    names = " -o ".join("-iname " + shlex.quote(n) for n in CURSOR_AUTOLOADED)
    home_names = " ".join(shlex.quote(n) for n in CURSOR_AUTOLOADED)
    return "; ".join([
        "set -u", f"d={shlex.quote(base)}", f"log={shlex.quote(logs)}", 'mkdir -p "$d/home" "$d/tmp" "$log"',
        f'{{ find "$PWD" \\( -name node_modules -o -name .git \\) -prune -o \\( {names} \\) -print 2>/dev/null | sed "s#^#workdir #"; '
        f'for n in {home_names}; do [ ! -e "$d/home/$n" ] || echo "home $d/home/$n"; done; }} > "$log/{CURSOR_INSTRUCTION_FILES}"',
        f'! grep -q "^home " "$log/{CURSOR_INSTRUCTION_FILES}" || {{ echo "HE-CURSOR-004 the CLI\'s fresh HOME already holds a file it loads on its own" >&2; exit 2; }}',
    ])


def cursor_run_command(model: str, base: str = CURSOR_RUN_DIR, logs: str = CURSOR_LOG_DIR, binary: str = CURSOR_BIN) -> str:
    """One headless turn on the task (the instruction in $HARBOR_INSTRUCTION). CURSOR_API_KEY comes from <base>/key, which
    the class uploads from the host and this command deletes before the CLI starts; it is never in argv or in Harbor's
    exec environment. The CLI's stdout (stream-json) and stderr reach <logs> only through a bash loop that replaces the
    key's literal value. Exit: the CLI's own code, or 2 when the key is missing."""
    flags = " ".join(cursor_flags(model))
    return "; ".join([
        "set -u", "umask 077", f"d={shlex.quote(base)}", f"log={shlex.quote(logs)}",
        'export HOME="$d/home" TMPDIR="$d/tmp"', "unset CURSOR_CONFIG_DIR XDG_CONFIG_HOME CURSOR_API_ENDPOINT",
        'mkdir -p "$TMPDIR"',
        '[ -s "$d/key" ] || { echo "HE-CURSOR-002 no CURSOR_API_KEY: the key file did not reach the task container" >&2; exit 2; }',
        'CURSOR_API_KEY=$(cat "$d/key")', 'rm -f "$d/key"', 'export CURSOR_API_KEY',
        '[ -n "$CURSOR_API_KEY" ] || { echo "HE-CURSOR-002 no CURSOR_API_KEY: the key file was empty" >&2; exit 2; }',
        'redact() { local l; while IFS= read -r l || [ -n "$l" ]; do printf "%s\\n" "${l//"$CURSOR_API_KEY"/[redacted:CURSOR_API_KEY]}"; done; }',
        f'{{ {{ {shlex.quote(binary)} {flags} -- "$HARBOR_INSTRUCTION" < /dev/null 3>&-; echo $? > "$d/exit"; }} 2>&1 1>&3 3>&- | redact > "$log/{CURSOR_STDERR}"; }} 3>&1 | redact > "$log/{CURSOR_STREAM}"',
        'code=$(cat "$d/exit" 2>/dev/null || echo 2)', 'rm -f "$d/exit"', 'exit "$code"',
    ])


def cursor_status(stream: str, stderr: str, exit_code: int | None, model: str) -> dict[str, Any]:
    """What one Cursor turn did, read from its documented stream-json records (https://cursor.com/docs/cli/reference/output-format:
    system init with the model's display name, tool_call started and completed, the terminal result). No token counts:
    the documented records carry none."""
    init = result = None
    started, unparsed = 0, 0
    tools: dict[str, int] = {}
    for line in stream.splitlines():
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            unparsed += 1
            continue
        if not isinstance(ev, dict):
            unparsed += 1
            continue
        if ev.get("type") == "system" and ev.get("subtype") == "init" and init is None:
            init = ev
        if ev.get("type") == "result":
            result = ev
        call = ev.get("tool_call")
        if ev.get("type") == "tool_call" and ev.get("subtype") == "started" and isinstance(call, dict):
            started += 1
            for k, v in call.items():
                name = "function:" + str((v or {}).get("name", "")) if k == "function" and isinstance(v, dict) else k
                tools[name] = tools.get(name, 0) + 1
    want = CURSOR_PIN["model_cursor"]["init_model_name"]
    got = init.get("model") if init else None
    ok = bool(result and result.get("subtype") == "success" and result.get("is_error") is False)
    return {
        "exit_code": exit_code, "init_model": got, "init_model_expected": want,
        "model_ok": None if init is None else str(got or "").strip().lower() == want.lower(),
        "session_id": (result or init or {}).get("session_id"), "api_key_source": init.get("apiKeySource") if init else None,
        "permission_mode": init.get("permissionMode") if init else None,
        "result_subtype": result.get("subtype") if result else None, "is_error": result.get("is_error") if result else None,
        "success": ok, "request_id": result.get("request_id") if result else None, "duration_ms": result.get("duration_ms") if result else None,
        "unreachable": result is None and CURSOR_UNREACHABLE in stderr, "tool_calls_started": started, "tool_calls": tools,
        "unparsed_lines": unparsed, "usage": None,
    }


def _record(harness: str, model: str, version: str | None = None, endpoint: dict[str, Any] | None = None, **fields: Any) -> dict[str, Any]:
    spec = model_spec(model)
    pin = harness_pin(harness, version)
    return {
        "schema": "frontier-harbor-harness-settings/1",
        "harness": harness,
        "harness_version": pin["version"],
        "harness_kind": pin["kind"],
        "harbor_class": pin["harbor_class"],
        "harbor_version": PIN["harbor"]["version"],
        "model": model,
        "model_limits": {"context_window": spec["context_window"], "max_output_tokens": spec["max_output_tokens"], "source": spec["source"]},
        "endpoint": endpoint or {
            "route": f"<metering proxy>/<trial slot>/{spec['provider']}" + ("" if spec["provider"] == "anthropic" else "/v1"),
            "credential": "per-trial dummy token trial-token:<trial>.<32 hex>, bound by broker.ts; no provider key in the container",
            "slot_models": slot_models(harness, model),
        },
        **fields,
    }


REPLAY_CHECK = ("keyless, tests/frontier-harbor-replay.test.ts (internal-task round 3): the real %s binary at the pinned version, on this "
                "config, through broker.ts and the metering proxy to a fake upstream that answers two shell tool calls with "
                "reasoning in the provider's shape and compares what comes back on each replayed tool-call turn byte for byte")
OPENROUTER_DEEPSEEK = "deepseek/deepseek-v4.1-flash-1017"
HERMES_REPLAY_RULE = ("Hermes v0.23.1's built-in openrouter provider replays reasoning_content, reasoning and reasoning_details on "
                      "every assistant message (agent/message_sanitization.py route_reasoning_carriers: provider openrouter carries all "
                      "three; agent/transports/chat_completions.py _wire_reasoning_carriers), whatever the base URL's host; the "
                      "v2026.9.24 custom provider kept reasoning_details only for openrouter.ai and nousresearch.com hosts")
OPENCLAW_REPLAY_RULE = ("OpenClaw's bundled openrouter provider (extensions/openrouter buildReplayPolicy, the passthrough Gemini policy) keeps "
                        "every tool call id as OpenRouter gave it; under a custom provider id the unowned-provider fallback "
                        "(src/agents/transcript-policy.ts buildUnownedProviderTransportReplayFallback, sanitizeToolCallIds strict) "
                        "rewrote them to letters and digits")


def openrouter_replay(harness: str, name: str) -> dict[str, Any]:
    """How a harness sends an OpenRouter model's earlier reasoning back on a replayed tool-call turn, as the real binary did
    keyless (tests/frontier-harbor-replay.test.ts), with the source that explains it. verdict is replays, partial or drops;
    a drop is the result, recorded as can't replay, never patched."""
    deepseek = name == OPENROUTER_DEEPSEEK
    gemini = name.startswith("google/")
    muse = name.startswith("meta/")
    checked = REPLAY_CHECK % harness
    if harness == "hermes":
        what = ("the Gemini signature entry (reasoning.encrypted, google-gemini-v1) byte for byte and still keyed to its unchanged call id" if gemini
                else "the encrypted entry (reasoning.encrypted, meta-responses-v1) byte for byte" if muse else "the reasoning text exact")
        return {"field": "reasoning_details, reasoning and reasoning_content", "verdict": "replays", "how": "%s. Seen: every replayed tool-call turn carried reasoning, reasoning_content and reasoning_details, %s%s" % (
            HERMES_REPLAY_RULE, what, "; DeepSeek thinking mode refuses a tool-call turn replayed without its reasoning" if deepseek else ""), "checked": checked}
    if harness == "openclaw":
        if gemini:
            return {"field": "reasoning_details", "verdict": "replays", "how": "%s. Seen: OpenClaw sends the Gemini thought signature back byte for byte as a reasoning.encrypted entry still keyed to its unchanged call id, with no reasoning text, which is what OpenRouter's Gemini endpoint matches" % OPENCLAW_REPLAY_RULE, "checked": checked}
        if muse:
            return {"field": "reasoning", "verdict": "partial", "how": "can't replay Muse Wonder's encrypted reasoning in OpenClaw: compat.thinkingFormat openrouter sends the earlier reasoning text back as the message's reasoning field, exact, but drops reasoning_details, so the reasoning.encrypted entry (format meta-responses-v1) never returns. Tool call ids are kept (%s)" % OPENCLAW_REPLAY_RULE, "checked": checked}
        return {"field": "reasoning", "verdict": "replays", "how": "compat.thinkingFormat openrouter: OpenClaw replays an earlier assistant turn's reasoning as the message's reasoning field, OpenRouter's own field, on every replayed tool-call turn; seen exact, tool call ids kept (%s)" % OPENCLAW_REPLAY_RULE + ("; DeepSeek thinking mode refuses a tool-call turn replayed without the reasoning" if deepseek else ""), "checked": checked}
    return {"field": "reasoning_details", "verdict": "replays", "how": "pi-ai 1.5.0 keeps the reasoning_details OpenRouter streams with each assistant message and sends them back on that message in every later request, the tool-call turn included (dist/api/openai-completions.js convertMessages); seen exact, " + ("the Gemini signature entry still keyed to its unchanged call id" if gemini else "the encrypted entry included" if muse else "the reasoning text included") + ("; compat.requiresReasoningContentOnAssistantMessages adds an empty reasoning_content beside them, as Pi's catalog row for the model asks; DeepSeek thinking mode refuses a tool-call turn replayed without its reasoning" if deepseek else ""), "checked": checked}


def direct_replay(harness: str, provider: str) -> dict[str, Any] | None:
    """The same record on the proxy's anthropic, openai and xai routes (Claude thinking signatures, OpenAI and xAI encrypted
    reasoning); None on Particle, which returns no reasoning to replay on a tool-call turn here."""
    checked = REPLAY_CHECK % harness
    if provider == "openai":
        how = {"pi": "Pi 1.5.0 (openai-responses)", "hermes": "Hermes (openai-api on the Responses API)", "openclaw": "OpenClaw (openai-responses)"}[harness]
        return {"field": "reasoning items with encrypted_content", "verdict": "replays", "how": how + " sends store false with include [reasoning.encrypted_content] and no previous_response_id, and replays each earlier reasoning item before its function_call; seen, encrypted_content byte for byte on every replayed turn", "checked": checked}
    if provider == "xai":
        how = {"pi": "Pi 1.5.0 (openai-responses)", "hermes": "Hermes (its xai provider, codex_responses)", "openclaw": "OpenClaw (its xai provider, openai-responses)"}[harness]
        return {"field": "reasoning items with encrypted_content", "verdict": "replays", "how": how + " sends include [reasoning.encrypted_content] and no previous_response_id, so it never relies on a response stored at xAI (the proxy refuses previous_response_id and forces store false on this route anyway, HE-PROXY-013), and replays each earlier reasoning item before its function_call; seen, encrypted_content byte for byte on every replayed turn", "checked": checked}
    if provider == "google":
        how = {"pi": "Pi 1.5.0 (google-generative-ai)", "hermes": "Hermes (its gemini provider's native generateContent client)", "openclaw": "OpenClaw (its bundled google provider, google-generative-ai)"}[harness]
        sent = "the signature only, with no thought text" if harness == "hermes" else "the thought parts too, text byte for byte"
        return {"field": "thoughtSignature on functionCall parts", "verdict": "replays", "how": how + " keeps each functionCall part's thoughtSignature and sends it back on that call in every later request, which the proxy forwards to Google unchanged; seen, every signature byte for byte on its own call, against a fake that answers 400 to a call sent back without its signature, as Google does (it sends %s)" % sent, "checked": checked}
    if provider != "anthropic":
        return None
    if harness == "hermes":
        return {"field": None, "verdict": "drops", "how": "can't replay Claude thinking in Hermes behind the proxy: seen, every replayed tool-use turn came back without its thinking block. Hermes strips all thinking blocks for a base URL it does not know as Anthropic's own or a signing platform, because signatures are Anthropic's own (v0.23.1: agent/anthropic_thinking_policy.py anthropic_thinking_route gives such a relay the third_party route, and agent/anthropic_message_convert.py _manage_thinking_signatures strips every block on it; _is_third_party_anthropic_endpoint in agent/anthropic_endpoints.py), and the proxy's route is such a URL. A declared per-harness property of Hermes, unchanged by amendment 1", "checked": checked}
    how = {"pi": "Pi 1.5.0 (anthropic-messages)", "openclaw": "OpenClaw (anthropic-messages)"}[harness]
    return {"field": "thinking blocks with signature", "verdict": "replays", "how": how + " sends each earlier thinking block back with its signature on the replayed tool-use turn; seen, thinking text and signature byte for byte", "checked": checked}


def harness_settings(harness: str, model: str, gstack: dict[str, Any] | None = None, version: str | None = None) -> dict[str, Any]:
    """The harness_settings.json record for one harness and cell model at the harness version the job names (pin.json's
    when none); with a gstack arm, plus what the arm installs."""
    record = _harness_settings(harness, model, version)
    if gstack is None:
        return record
    arm = gstack_arm(harness, gstack)
    host = arm["layout"]
    merged = claude_settings_merge(gstack) if harness == "claude-code" else None
    record["gstack"] = {
        "sha": arm["sha"], "version": arm["version"], "host": arm["host"], "tar_sha256": arm["tar_sha256"],
        "tar_roots": host["tar_roots"], "skills_dir": host["skills_dir"], "router": host["router"],
        "skills": len(arm["sidecar"]["skills"]), "setup": arm["sidecar"]["setup"],
        "read_by_harness": host["read_by_harness"],
        "settings_added": merged["added"] if merged else [], "settings_kept_ours": merged["kept_ours"] if merged else [],
        "bin_helpers_in_agent_image": arm["sidecar"]["bin_helpers"].get("in_agent_image"),
    }
    record["differences_from_pin"] = [*record["differences_from_pin"],
        "gstack %s (%s) installed from its release tar into the task container after our settings%s" % (
            arm["version"], arm["sha"][:12], "; its Claude settings merged into ours, ours kept on any conflict" if merged else "")]
    return record


GSTACK_HOSTS = {"claude-code": "claude", "codex": "codex"}
GSTACK_KEYS = ("sha", "version", "host", "tar", "tar_sha256")


def is_gstack_release(gstack: dict[str, Any]) -> bool:
    """Whether a cell's gstack option is a release arm ({sha, version, host, tar, tar_sha256}, checked by gstack_arm) and
    not a skill ablation arm ({arm, spec, lock, spec_sha256, manifest}, checked by gstack_manifest): an ablation arm
    names its arm."""
    return "arm" not in gstack


def arm_layout() -> dict[str, Any]:
    """scripts/canary/gstack/arm.json: the home layout a gstack arm is built for and installed into."""
    return json.loads((REPO / "scripts/canary/gstack/arm.json").read_text())


def gstack_arm(harness: str, gstack: dict[str, Any]) -> dict[str, Any]:
    """A cell's gstack option checked against its harness and the build sidecar beside its tar (<tar>.json), with the
    sidecar and the host's layout attached. A ValueError names what does not match."""
    if not isinstance(gstack, dict) or sorted(gstack) != sorted(GSTACK_KEYS):
        raise ValueError(f"gstack must be {{{', '.join(GSTACK_KEYS)}}}")
    host = GSTACK_HOSTS.get(harness)
    if host is None:
        raise ValueError(f"a gstack arm runs only on {', '.join(GSTACK_HOSTS)}, not {harness}")
    if gstack["host"] != host:
        raise ValueError(f"gstack.host is {gstack['host']!r}; {harness} reads the {host!r} install")
    if not re.fullmatch(r"[0-9a-f]{40}", str(gstack["sha"])) or not re.fullmatch(r"[0-9a-f]{64}", str(gstack["tar_sha256"])):
        raise ValueError("gstack.sha must be a 40-hex commit and gstack.tar_sha256 a 64-hex sha256")
    tar = Path(gstack["tar"])
    side_path = Path(str(tar) + ".json")
    if not tar.is_absolute() or not tar.is_file() or not side_path.is_file():
        raise ValueError(f"gstack.tar {tar} must be an absolute path to a built arm with its sidecar {side_path.name}")
    side = json.loads(side_path.read_text())
    for k in ("sha", "version", "host", "tar_sha256"):
        if side.get(k) != gstack[k]:
            raise ValueError(f"gstack.{k} is {gstack[k]!r}, but the arm's sidecar records {side.get(k)!r}")
    return {**gstack, "sidecar": side, "layout": arm_layout()["hosts"][host]}


def merge_settings(ours: Any, theirs: Any, path: str = "") -> tuple[Any, list[str], list[str]]:
    """theirs merged into ours: keys ours lacks are added, lists get the entries ours lacks appended, and on any other
    clash ours is kept. Returns the merged value, the paths added and the paths where ours was kept over theirs."""
    if isinstance(ours, dict) and isinstance(theirs, dict):
        out, added, kept = dict(ours), [], []
        for k, v in theirs.items():
            p = f"{path}.{k}" if path else k
            if k not in ours:
                out[k] = v
                added.append(p)
                continue
            out[k], a, c = merge_settings(ours[k], v, p)
            added += a
            kept += c
        return out, added, kept
    if isinstance(ours, list) and isinstance(theirs, list):
        extra = [x for x in theirs if x not in ours]
        return [*ours, *extra], [f"{path}[+{len(extra)}]"] if extra else [], []
    return ours, [], [] if ours == theirs else [path]


def keeps(ours: Any, merged: Any) -> bool:
    """Whether merged still holds every setting of ours unchanged (keys, list entries in order, values)."""
    if isinstance(ours, dict):
        return isinstance(merged, dict) and all(k in merged and keeps(v, merged[k]) for k, v in ours.items())
    if isinstance(ours, list):
        return isinstance(merged, list) and merged[: len(ours)] == ours
    return ours == merged


def claude_settings_merge(gstack: dict[str, Any] | None = None) -> dict[str, Any]:
    """Our harnesses/claude-code/config/settings.json, with a gstack arm's Claude settings (its hooks) merged in."""
    ours = json.loads(_pin_text("harnesses/claude-code/config/settings.json"))
    if gstack is None:
        return {"settings": ours, "added": [], "kept_ours": []}
    theirs = gstack_arm("claude-code", gstack)["sidecar"].get("claude_settings") or {}
    merged, added, kept = merge_settings(ours, theirs)
    return {"settings": merged, "added": added, "kept_ours": kept}


def gstack_install_command(gstack: dict[str, Any], remote_tar: str, root: str = "/") -> str:
    """The shell the task container runs to install an uploaded arm tar: the tar's sha256 checked, the agent's HOME the
    arm's, nothing of gstack there before, the tar extracted under root, then one GSTACK_INSTALL line of facts (router
    present, skills under the host's skills dir, VERSION, the checkout's HEAD). Exit 41-43 for a refused install."""
    arm = gstack_arm(next(h for h, v in GSTACK_HOSTS.items() if v == gstack["host"]), gstack)
    host, home = arm["layout"], arm_layout()["home"]
    r = root.rstrip("/")
    q = shlex.quote
    skills = q(r + host["skills_dir"])
    return " ".join([
        f"want={q(arm['tar_sha256'])}; got=$(sha256sum {q(remote_tar)} | cut -d' ' -f1);",
        '[ "$got" = "$want" ] || { echo "GSTACK_INSTALL refused tar_sha256 $got"; exit 41; };',
        f'[ "$HOME" = {q(home)} ] || {{ echo "GSTACK_INSTALL refused home $HOME"; exit 42; }};',
        *[f'[ ! -e {q(r + "/" + t)} ] || {{ echo "GSTACK_INSTALL refused present /{t}"; exit 43; }};' for t in host["tar_roots"] if t != "root/.claude"],
        f'[ ! -e {q(r + host["router"])} ] || {{ echo "GSTACK_INSTALL refused present {host["router"]}"; exit 43; }};',
        f"tar -xzf {q(remote_tar)} -C {q(root)} && {{ rm -f {q(remote_tar)} 2>/dev/null || true; }} &&",
        f"n=$(ls -d {skills}/*/SKILL.md 2>/dev/null | wc -l);",
        f"router=$([ -f {q(r + host['router'])} ] && echo yes || echo no);",
        f"version=$(cat {q(r + arm_layout()['source_dir'] + '/VERSION')} 2>/dev/null);",
        f"head=$(cat {q(r + arm_layout()['source_dir'] + '/.git/HEAD')} 2>/dev/null);",
        'echo "GSTACK_INSTALL ok router=$router skills=$n version=$version head=$head"',
    ])


def gstack_install_facts(stdout: str) -> dict[str, Any]:
    """The GSTACK_INSTALL line of gstack_install_command's output as data."""
    line = next((l for l in (stdout or "").splitlines() if l.startswith("GSTACK_INSTALL ")), "")
    words = line.split()
    facts: dict[str, Any] = {"status": words[1] if len(words) > 1 else None}
    if facts["status"] == "refused":
        facts["reason"] = " ".join(words[2:])
        return facts
    for w in words[2:]:
        k, _, v = w.partition("=")
        facts[k] = int(v) if k == "skills" and v.isdigit() else v
    return facts


SKILL_LINKS_DIR = "/logs/agent/sessions/skills"


def drops_skill_links(release: dict[str, Any] | None, manifest: dict[str, Any] | None) -> bool:
    """Whether a Claude Code run ends with drop_skill_links_command: a release arm, or a skill ablation arm whose built
    manifest has a layout (it installed skills, and gstack's setup links its router files into the checkout by absolute
    path, which Harbor's scrub then trips on). The none arm installs nothing and has no layout, so it skips the step."""
    return release is not None or bool(manifest and manifest.get("layout"))


def drop_skill_links_command(skills_dir: str = SKILL_LINKS_DIR) -> str:
    """The shell the task container runs when a Claude Code run with a gstack arm ends: every symbolic link under
    skills_dir (the trial's CLAUDE_CONFIG_DIR/skills, which Harbor's ClaudeCode fills with cp -r from ~/.claude/skills)
    deleted, and one SKILL_LINKS_DROPPED <n> line. gstack's setup links each skill to the checkout by absolute path
    (/root/gstack/...); the directory is bind-mounted, so on the VM host those links point into the host's own /root,
    and Harbor's end-of-trial scrub of the jobs directory stats them, gets EACCES and fails the job. It runs in the
    container because the files there are still the container user's until Harbor chowns the logs after the run."""
    d = shlex.quote(skills_dir)
    return f'n=$(find {d} -type l 2>/dev/null | wc -l); find {d} -type l -delete 2>/dev/null; echo "SKILL_LINKS_DROPPED $n"'


def _harness_settings(harness: str, model: str, version: str | None = None) -> dict[str, Any]:
    """The harness_settings.json record for one harness and cell model, without a gstack arm."""
    spec = model_spec(model)
    hp = harness_pin(harness, version)
    cw, mo = spec["context_window"], spec["max_output_tokens"]
    anthropic = spec["provider"] == "anthropic"
    particle = spec["provider"] == "particle"
    if harness == "claude-code":
        return _record(harness, model, version,
            context_window={"value": cw, "set_by": "the CLI's own model table for the cell model; CLAUDE_CODE_AUTO_COMPACT_WINDOW=%d also set (a name present in the %s binary)" % (cw, hp["version"])},
            max_output_tokens={"value": mo, "set_by": "CLAUDE_CODE_MAX_OUTPUT_TOKENS=%d" % mo},
            compaction={"threshold": "Claude Code %s default auto-compact point of the window (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE unset)" % hp["version"], "set_by": "shipped default"},
            tools={"hosted_web_search": "off: --disallowedTools WebSearch,WebFetch and settings permissions.deny [WebSearch, WebFetch], as our pin",
                   "disabled": ["WebSearch", "WebFetch"], "enabled": "every other built-in Claude Code tool; no MCP server"},
            effort={"requested": EFFORT, "setting": "--effort high (CLAUDE_CODE_EFFORT_LEVEL=high); on Opus 5.5 and Fable 5.1 thinking is adaptive and always on, so the canonical request is thinking adaptive plus output_config.effort high, checked on captured requests"},
            housekeeping_model={"model": model, "note": "every model variable the CLI reads (ANTHROPIC_SMALL_FAST_MODEL included) names the cell model, as our adapter.sh pins it; a declared deviation from the shipped housekeeping default (internal-task exception, 2026-11-01). On Fable cells the housekeeping calls go to Fable."},
            differences_from_pin=[
                "runs through Harbor's ClaudeCode class (claude --verbose --output-format=stream-json --print, Harbor's settings file and session dir), not adapter.sh",
                "installed with Harbor's bootstrap.sh route (native binary) instead of npm in our image; the binary's sha256 is checked against the pinned %s..." % hp["native_binary_sha256"][:8],
                "--effort high added (our pin runs the CLI's default effort)",
                "CLAUDE_CODE_MAX_OUTPUT_TOKENS and CLAUDE_CODE_AUTO_COMPACT_WINDOW set to the model's limits (our pin leaves CLI defaults)",
                "no world-MCP server, --mcp-config or --strict-mcp-config: TB2.1 tasks have no MCP server",
                "working directory is the task's, not /workspace",
            ])
    if harness == "codex":
        return _record(harness, model,
            context_window={"value": codex_window(model), "set_by": "config.toml model_context_window=%d, the model's %d capped by Codex 0.165.0's built-in max_context_window (codex-rs/models-manager/models.json, 872,000 for GPT-6.1 Sol and GPT-6 Astra; models-manager/src/model_info.rs with_config_overrides takes the smaller). Declared harness behaviour: only model_catalog_json lifts the cap, and a custom catalog also changes Codex's prompt (update_plan instructions, multi-agent and collaboration-mode hints)" % (codex_window(model), cw)},
            max_output_tokens={"value": mo, "set_by": "the metering proxy writes max_output_tokens %d into every /v1/responses request (Codex 0.165.0 sends none), as our pin's deviation says" % mo},
            compaction={"threshold": "Codex default (auto_compact_token_limit unset; remote compaction off)", "set_by": "shipped default"},
            tools={"hosted_web_search": "off: web_search = disabled, tools.web_search = false, capabilities.external_web_access = false, as our pin", "disabled": ["web_search"], "enabled": "Codex built-in tools; plugins off"},
            effort={"requested": EFFORT, "setting": "model_reasoning_effort, plan_mode_reasoning_effort and agents.default_subagent_reasoning_effort = high (and -c model_reasoning_effort=high); sent as reasoning.effort"},
            housekeeping_model={"model": model, "note": "every model-valued config key (review, realtime, subagent, memories) is the cell model, as our pin"},
            differences_from_pin=[
                "runs through Harbor's Codex class (codex exec --json with Harbor's flags and an auth.json holding the per-trial token), not adapter.sh; no --strict-config",
                "reasoning effort high (our pin: medium)",
                "model_context_window set to the window Codex allows for the model, 872,000 (our pin: Codex default 272,000)",
                "provider env_key OPENAI_API_KEY (our pin: HE_MODEL_API_KEY); the value is the per-trial token in both",
                "no world-MCP server; working directory is the task's",
            ])
    if harness == "hermes":
        compaction = {"threshold": "Hermes default: compression.threshold 0.50 with threshold_tokens 256,000, so compaction starts at 256,000 prompt tokens on these 1M windows", "set_by": "shipped default"}
        tools = {"hosted_web_search": "off: web.keyless_fallback false and agent.disabled_toolsets [web, browser]. Hermes's web_search and web_extract (v2026.9.24 and v0.23.1) need no key: with no backend configured they use a keyless ring of public free tiers (Exa, Parallel, Firecrawl, Keenable; plugins/web/keyless_mcp.py, web.keyless_fallback default true), which internal-task saw return a task's solve.sh and test file", "disabled": ["web_search", "web_extract", "browser toolset"], "enabled": "toolset hermes-cli (Hermes default) less the web and browser toolsets"}
        harbor_run = [
                    "runs Harbor's Hermes command (hermes --yolo chat -q <instruction> -Q --model --provider) instead of adapter.sh's hermes chat --query-file --oneshot",
                    "installed from the pinned commit's scripts/install.sh instead of our image's uv install of the source tree",
                    "the anthropic SDK (0.125.0, Hermes's own uv.lock extra) added to the environment Hermes's launcher runs on with hermes pm install --extra anthropic, under the same HERMES_HOME install.sh used (amendment 5): install.sh leaves it to a lazy install, which security.allow_lazy_installs false turns off",
        ]
        harbor_env = [
                    "terminal.cwd unset, so the task's working directory, not /workspace",
                    "web.keyless_fallback false and agent.disabled_toolsets [web, browser] (our multi-user pin leaves Hermes's keyless web search and its browser on)",
                    "its local-server probes of the base URL (agent/model_metadata.py detect_local_server_type: GET /api/v1/models, /api/tags, /v1/props, /props, /version, POST /api/show) are refused by the proxy; Hermes reads a non-200 as not a local server, the verdict it reaches on api.openai.com and api.anthropic.com, where it skips the probes, so nothing downstream changes",
        ]
        if spec["provider"] == "openrouter":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "config.yaml model.context_length=%d" % cw},
                max_output_tokens={"value": mo, "set_by": "the he-openrouter-effort plugin sets max_completion_tokens=%d (HE_OPENROUTER_MAX_OUTPUT_TOKENS) on every agent request, where Hermes's built-in openrouter provider states no cap behind the proxy; an auxiliary call (a compression summary) states none, so the proxy fills %d" % (mo, mo)},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "the he-openrouter-effort plugin (an llm_request middleware, pinned file by file in pin.json harnesses.hermes.openrouter_plugin) sets OpenRouter's reasoning {effort: high} in extra_body on every agent request, streamed or not; Hermes v0.23.1's built-in openrouter provider sends that field only when the base URL's host is openrouter.ai (run_agent.py _is_openrouter_url, agent/reasoning_params.py) and reads extra_body from config only for custom providers (agent/agent_init.py _custom_provider_extra_body_for_agent), so behind the proxy it would send no effort. agent.reasoning_effort = high is set too. No top-level reasoning_effort is sent (v2026.9.24's custom provider sent one). Declared: Hermes's auxiliary calls (compression summaries) do not pass through llm_request middleware and carry no effort; they are housekeeping, never agent-loop calls. A one-shot run makes no session-title call at v0.23.1 (agent/turn_context.py: agent_is_oneshot)"},
                reasoning_replay=openrouter_replay(harness, spec["name"]),
                housekeeping_model={"model": model, "note": "Hermes auxiliary calls (titles, compression summaries) use provider auto, which is the main model; the title call sends reasoning off"},
                differences_from_pin=[*harbor_run,
                    "provider openrouter, Hermes's built-in OpenRouter provider on Chat Completions, reading OPENROUTER_API_KEY and OPENROUTER_BASE_URL (the per-trial token and the proxy's OpenRouter route), with the he-openrouter-effort plugin enabled (plugins.enabled) for reasoning {effort: high} and max_completion_tokens %d, agent.reasoning_effort high and model.context_length %d (amendment 1 of frontier-shootout-2026-11; our OpenRouter pin, harnesses/hermes/pin.json model_openrouter and config.openrouter.yaml, uses provider custom:openrouter-proxy with extra_body, which at Hermes v2026.9.24 dropped every replayed turn's reasoning_details behind the proxy)" % (mo, cw),
                    "Hermes sends an OpenRouter session_id body field (its built-in provider's sticky-routing field); the proxy forwards it",
                    *harbor_env])
        if spec["provider"] == "google":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "config.yaml model.context_length=%d" % cw},
                max_output_tokens={"value": HERMES_GEMINI_MAX_OUTPUT, "set_by": "Hermes v0.23.1 sends maxOutputTokens 65,535 on every Gemini request (agent/gemini_native_adapter.py GEMINI_DEFAULT_MAX_OUTPUT_TOKENS, applied for the gemini provider in agent/agent_init.py), one under the cell's 65,536; it reads no output setting for Gemini (no model.max_tokens, no HERMES_MAX_TOKENS), and the larger long-decode budget it sends only at effort xhigh or max does not apply at high. The proxy's 65,536 cap leaves the value as sent. Declared (amendment 2)"},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "agent.reasoning_effort = high; the gemini provider sends generationConfig.thinkingConfig {includeThoughts: true, thinkingLevel: high} on every agent request, streamed or not (seen keyless). Hermes writes the level in lower case, as Google's own REST examples do; OpenClaw and Pi write HIGH"},
                reasoning_replay=direct_replay(harness, "google"),
                housekeeping_model={"model": model, "note": "Hermes auxiliary calls (titles, compression summaries) use provider auto, which is the main model; the title call sends reasoning off"},
                differences_from_pin=[*harbor_run,
                    "provider gemini, Hermes's own Gemini provider on its native generateContent client (agent/gemini_native_adapter.py), reading GEMINI_API_KEY (the per-trial token, sent as x-goog-api-key) and GEMINI_BASE_URL, the proxy's google route followed by /generativelanguage.googleapis.com/v1beta. Hermes v0.23.1 picks the native client only when the base URL contains generativelanguage.googleapis.com (is_native_gemini_base_url, lines 183-188, a substring test its docs do not promise), and the proxy drops exactly that one path segment on the google route (amendment 2 of frontier-shootout-2026-11); no Hermes pin of ours covers Gemini",
                    "maxOutputTokens 65,535, Hermes's own value, one under the cell's 65,536 (see max_output_tokens)",
                    "model.context_length set (our pin: Hermes's own table)",
                    *harbor_env[:2],
                    "no local-server probes of the base URL on this provider: every request Hermes sent was a generateContent call (seen keyless)"])
        if spec["provider"] == "xai":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "config.yaml model.context_length=%d" % cw},
                max_output_tokens={"value": mo, "set_by": "the metering proxy caps every /v1/responses request at %d and writes that cap into one that states none" % mo},
                compaction=compaction, tools={**tools, "hosted_web_search": tools["hosted_web_search"] + "; on xAI the x_search toolset (X search through xAI's built-in x_search tool, which Hermes turns on whenever xAI credentials are present) is disabled too (amendment 19)", "disabled": [*tools["disabled"], "x_search"], "enabled": tools["enabled"] + " and x_search"},
                effort={"requested": EFFORT, "unsent_default": EFFORT, "setting": "agent.reasoning_effort = high, but Hermes at the pinned commit sends reasoning.effort to xAI only for the Grok models on its allowlist (agent/model_metadata.py _GROK_EFFORT_CAPABLE_PREFIXES: grok-3-mini, grok-4.20-multi-agent, grok-4.3, grok-4.5, grok-4.6), so its agent requests on grok-4.7 carry no effort field (seen keyless) and xAI applies the model's default, high (docs.x.ai reasoning: \"If not specified, reasoning_effort defaults to high\"). The effort check counts an agent request with no effort field as high for this cell (effort.unsent_default). Declared: its session-title call sends reasoning {effort: none}, a level xAI does not list for grok-4.7 (low, medium, high, xhigh); it is housekeeping, never an agent-loop call, and whether xAI refuses it is not checked keyless"},
                reasoning_replay=direct_replay(harness, "xai"),
                housekeeping_model={"model": model, "note": "Hermes auxiliary calls (titles, compression summaries) use provider auto, which is the main model; the title call sends reasoning off"},
                differences_from_pin=[*harbor_run,
                    "provider xai, Hermes's own xAI provider on the Responses API (api_mode codex_responses, hermes_cli/runtime_provider.py), reading XAI_API_KEY and XAI_BASE_URL (the per-trial token and the proxy's xai route); no Hermes pin of ours covers xAI",
                    "no reasoning effort sent on grok-4.7, so xAI's default (high) applies; see effort",
                    "model.context_length set (our pin: Hermes's own table)",
                    *harbor_env])
        return _record(harness, model,
            context_window={"value": cw, "set_by": "config.yaml model.context_length=%d" % cw},
            max_output_tokens={"value": mo, "set_by": "Hermes v0.23.1's own output table (agent/anthropic_adapter.py _get_anthropic_max_output: claude-fable and claude-sonnet-5 at 128,000, claude-opus-5* at the 128,000 default)" if anthropic
                               else "custom_providers[particle].extra_body max_completion_tokens=%d on the agent's requests (Hermes states no cap on a custom endpoint); its title call states none, so the proxy fills %d" % (mo, mo) if particle
                               else "Hermes default on the openai-api provider (no output cap sent); the proxy caps at %d" % mo},
            compaction=compaction,
            tools=tools,
            **({"reasoning_replay": direct_replay(harness, spec["provider"])} if direct_replay(harness, spec["provider"]) else {}),
            effort={"requested": EFFORT, "setting": ("custom_providers[particle].extra_body reasoning_effort = high on every agent request (on a custom endpoint Hermes sends no reasoning field of its own; agent.reasoning_effort = high is set too). Declared: its session-title call carries no extra_body and sends reasoning_effort none, a shipped default; it is housekeeping, never an agent-loop call" if particle else "agent.reasoning_effort = high; Hermes sends thinking adaptive plus output_config.effort on Claude adaptive models and reasoning_effort on its OpenAI chat route. Declared: its session-title call (agent/title_generator.py generate_title: call_llm task title_generation, no tools, max_tokens 512, reasoning_config enabled false) asks for reasoning off (reasoning_effort none on OpenAI), a shipped default; it is housekeeping, never an agent-loop call")},
            housekeeping_model={"model": model, "note": "Hermes auxiliary calls (titles, compression summaries) use provider auto, which is the main model; the title call sends reasoning off"},
            differences_from_pin=[
                *harbor_run,
                *(["provider custom:particle, Hermes's custom-endpoint provider on Chat Completions, reading OPENAI_API_KEY and OPENAI_BASE_URL (the per-trial token and the proxy's Particle route), as our Particle pin (harnesses/hermes/pin.json model_particle, config.particle.yaml)"] if particle else []),
                "reasoning effort high through custom_providers[particle].extra_body (our Particle pin: medium; docs.particle.ai/reasoning serves medium and high at the same high effort)" if particle else "reasoning effort high (our pin: Anthropic default, OpenAI medium)",
                "model.context_length set, as our Particle pin sets it" if particle else "model.context_length set (our pin: Hermes's own table)",
                *harbor_env,
            ])
    if harness == "openclaw":
        compaction = {"threshold": "OpenClaw 2026.10.6 default compaction against the configured contextWindow", "set_by": "shipped default"}
        tools = {"hosted_web_search": "off: tools.deny group:web (web_search, x_search, web_fetch; also Harbor disable_web_search) and browser, tools.web.search.enabled and tools.web.fetch.enabled false, plus Harbor's headless deny of message", "disabled": ["group:web", "browser", "message"], "enabled": "OpenClaw default tools otherwise"}
        harbor_run = [
                    "runs through Harbor's OpenClaw class (openclaw agent --local --json after openclaw setup --baseline) instead of adapter.sh's openclaw agent exec",
                    "Node 24 through nvm in the task container (Harbor's class names Node 22, which openclaw 2026.10.6 refuses); our image uses node:24-bookworm-slim",
        ]
        harbor_env = [
                    "web tools denied: group:web and browser in tools.deny, tools.web.search and tools.web.fetch disabled (our pin relies on the internal network instead)",
                    "workspace is the task's working directory (Harbor's setup baseline), not /workspace",
        ]
        if spec["provider"] == "openrouter":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "models.providers.openrouter.models[0].contextWindow=%d" % cw},
                max_output_tokens={"value": mo, "set_by": "models.providers.openrouter.models[0].maxTokens=%d, sent as max_completion_tokens (compat.maxTokensField)" % mo},
                compaction=compaction, tools={**tools, "hosted_web_search": tools["hosted_web_search"] + "; music_generate and video_generate also denied on OpenRouter (amendment 1)", "disabled": [*tools["disabled"], *OPENCLAW_OPENROUTER_DENY]},
                effort={"requested": EFFORT, "setting": "--thinking high and agents.defaults.thinkingDefault = high; reasoning true with compat.thinkingFormat openrouter on the model, so api openai-completions sends OpenRouter's reasoning {effort: high}"},
                reasoning_replay=openrouter_replay(harness, spec["name"]),
                housekeeping_model={"model": model, "note": "utilityModel = the cell model (openrouter/<model>), as our OpenRouter pin's config sets it"},
                differences_from_pin=[*harbor_run,
                    "provider openrouter (OpenClaw's bundled OpenRouter provider id, amendment 1 of frontier-shootout-2026-11; our pin's id is openrouter-proxy) on api openai-completions over the proxy's OpenRouter route, apiKey ${OPENROUTER_API_KEY} (the per-trial token; our pin reads HE_MODEL_API_KEY), compat maxTokensField max_completion_tokens, supportsUsageInStreaming and thinkingFormat openrouter, contextWindow %d, maxTokens %d, thinkingDefault high, utilityModel the cell model and memory.search.provider none: the same settings as our OpenRouter pin (harnesses/openclaw/pin.json model_openrouter, config/openclaw.openrouter.json)" % (cw, mo),
                    "Harbor's --model is openrouter/<model> (agents.py FrontierOpenClaw), so OpenClaw's bundled openrouter provider owns the model's replay policy and keeps tool call ids as OpenRouter gave them; under our pin's custom id they were rewritten to letters and digits",
                    "music_generate and video_generate denied (tools.deny): the bundled provider would list them in the system prompt; with them denied the prompt differs from the custom id's only in the dropped openai-whisper-api skill line and openrouter/<model> in place of openrouter-proxy/<model>",
                    *harbor_env])
        if spec["provider"] == "google":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "models.providers.google.models[0].contextWindow=%d" % cw},
                max_output_tokens={"value": mo, "set_by": "models.providers.google.models[0].maxTokens=%d; OpenClaw 2026.10.6's google transport sends no maxOutputTokens (seen keyless), so the metering proxy writes maxOutputTokens %d into every request on the google route" % (mo, mo)},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "--thinking high and agents.defaults.thinkingDefault = high; reasoning true on the model, so api google-generative-ai sends thinkingConfig {includeThoughts: true, thinkingLevel: HIGH} (seen keyless)"},
                reasoning_replay=direct_replay(harness, "google"),
                housekeeping_model={"model": model, "note": "utilityModel = the cell model (google/<model>)"},
                differences_from_pin=[*harbor_run,
                    "provider google, OpenClaw's bundled Google provider id on api google-generative-ai, its baseUrl the proxy's google route followed by /v1beta and apiKey ${GEMINI_API_KEY} (the per-trial token, sent as x-goog-api-key); OpenClaw appends /v1beta itself only on Google's own host, and its key rotation and first-response retry run only there (amendment 2 of frontier-shootout-2026-11); no OpenClaw pin of ours covers Gemini",
                    "no explicit context cache: OpenClaw creates cachedContents only for gemini-2.5 and gemini-3 ids (isGooglePromptCacheEligible), so Gemini 4 gets only Google's implicit caching",
                    "contextWindow %d and maxTokens %d, the pin.json row; thinkingDefault high, utilityModel the cell model and memory.search.provider none" % (cw, mo),
                    *harbor_env])
        if spec["provider"] == "xai":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "models.providers.xai.models[0].contextWindow=%d" % cw},
                max_output_tokens={"value": mo, "set_by": "models.providers.xai.models[0].maxTokens=%d, sent as max_output_tokens" % mo},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "--thinking high and agents.defaults.thinkingDefault = high; reasoning true on the model, so api openai-responses sends reasoning {effort: high, summary: auto} (seen keyless)"},
                reasoning_replay=direct_replay(harness, "xai"),
                housekeeping_model={"model": model, "note": "utilityModel = the cell model (xai/grok-4.7)"},
                differences_from_pin=[*harbor_run,
                    "provider xai, OpenClaw's bundled xAI provider (its xai plugin adds include [reasoning.encrypted_content] for every reasoning model and sends tool_stream) on api openai-responses, its baseUrl the proxy's xai route and apiKey ${XAI_API_KEY} (the per-trial token); no OpenClaw pin of ours covers xAI",
                    "contextWindow %d and maxTokens %d, the pin.json row (OpenClaw's own catalog row for grok-4.7 has maxTokens 64,000)" % (cw, mo),
                    "thinkingDefault high, utilityModel the cell model and memory.search.provider none",
                    *harbor_env])
        return _record(harness, model,
            context_window={"value": cw, "set_by": "models.providers.%s.models[0].contextWindow=%d" % (spec["provider"], cw)},
            max_output_tokens={"value": mo, "set_by": "models.providers.%s.models[0].maxTokens=%d" % (spec["provider"], mo)},
            compaction=compaction,
            tools=tools,
            **({"reasoning_replay": direct_replay(harness, spec["provider"])} if direct_replay(harness, spec["provider"]) else {}),
            effort={"requested": EFFORT, "setting": "--thinking high and agents.defaults.thinkingDefault = high" + ("; reasoning true on the model, so api openai-completions sends reasoning_effort high" if particle else "")},
            housekeeping_model=(
                {"model": f"anthropic:{OPENCLAW_ANTHROPIC_HOUSEKEEPING}", "note": "OpenClaw's shipped utility model on an Anthropic provider, kept as our pin keeps it (utilityModel unset); metered as harness housekeeping, shipped default, never scored"}
                if anthropic else
                {"model": model, "note": "utilityModel = the cell model, as our pin's %s config sets it" % ("Particle" if particle else "OpenAI")}),
            differences_from_pin=[
                *harbor_run,
                *(["provider particle on api openai-completions (Chat Completions) over the proxy's Particle route, apiKey ${OPENAI_API_KEY} (the per-trial token), compat maxTokensField max_completion_tokens and supportsUsageInStreaming, utilityModel the cell model and memory.search.provider none, as our Particle pin (harnesses/openclaw/config/openclaw.particle.json)"] if particle else []),
                "contextWindow and maxTokens are the model's real limits, as our Particle pin" if particle else "contextWindow and maxTokens are the model's real limits (our Anthropic pin: 200,000 and 16,384 for Sonnet 5.5)",
                "thinkingDefault high (our Particle pin: medium; docs.particle.ai/reasoning serves medium and high at the same high effort)" if particle else "thinkingDefault high (our OpenAI pin: medium; our Anthropic pin: unset)",
                *harbor_env,
            ])
    if harness == "pi":
        compaction = {"threshold": "Pi 1.5.0 default auto-compaction against the configured contextWindow", "set_by": "shipped default"}
        tools = {"hosted_web_search": "none: Pi 1.5.0 ships no web tool (its built-in tools in dist/core/tools are read, bash, edit, write, grep, find, ls and powershell; the defaults are read, bash, edit and write), so there is nothing to turn off", "disabled": [], "enabled": "Pi defaults"}
        if spec["provider"] == "openrouter":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "models.json contextWindow=%d on the harbor-endpoint provider agents.py writes" % cw},
                max_output_tokens={"value": mo, "set_by": "models.json maxTokens=%d, sent as max_completion_tokens (compat.maxTokensField; pi-ai 1.5.0 openai-completions)" % mo},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "--thinking high with reasoning true, thinkingLevelMap high -> high and compat.thinkingFormat openrouter on the model, so pi-ai 1.5.0 sends OpenRouter's reasoning {effort: high} (dist/api/openai-completions.js)"},
                reasoning_replay=openrouter_replay(harness, spec["name"]),
                housekeeping_model={"model": None, "note": "Pi makes no calls on another model"},
                differences_from_pin=[
                    "Harbor 0.24.0's stock Pi class at the Pi release our pin runs (1.5.0)",
                    "provider harbor-endpoint, a custom provider agents.py writes (Harbor would point an openrouter model at OPENROUTER_BASE_URL with OPENROUTER_API_KEY, which no container holds), instead of our pin's built-in openrouter provider with its baseUrl and apiKey replaced; apiKey $OPENAI_API_KEY (the per-trial token), api openai-completions on the proxy's OpenRouter route",
                    *([
                    "the model entry carries what Pi's built-in provider applies to this model: its catalog row's thinkingLevelMap and compat (supportsDeveloperRole false, thinkingFormat openrouter, supportsStrictMode, sendSessionAffinityHeaders, requiresReasoningContentOnAssistantMessages; pi-ai dist/providers/data/openrouter.json) plus sessionAffinityFormat openrouter, which pi-ai detects from the provider id openrouter, and maxTokensField max_completion_tokens",
                    "contextWindow %d (the catalog row's) and maxTokens %d (our pin's modelOverrides value, below the catalog's 393,216)" % (cw, mo),
                    "--thinking high (our pin passes --thinking medium, which Pi clamps to high on this model, since its catalog maps medium to none)",
                    ] if spec["name"] == OPENROUTER_DEEPSEEK else [
                    "the model entry carries what Pi's built-in provider applies to the %s catalog row: its thinkingLevelMap and compat (supportsDeveloperRole false, thinkingFormat openrouter, supportsStrictMode, sendSessionAffinityHeaders; pi-ai dist/providers/data/openrouter.json) plus sessionAffinityFormat openrouter, which pi-ai detects from the provider id openrouter, and maxTokensField max_completion_tokens%s" % (PI_CATALOG_ROW.get(spec["name"], "chat:" + spec["name"]), "; Pi 1.5.0's catalog has no row for this model, so the entry takes the row of Gemini 4 Argon, the same family on the same Google endpoints" if spec["name"] in PI_CATALOG_ROW else ""),
                    "contextWindow %d and maxTokens %d (the pin.json model row); no Pi pin of ours covers this model" % (cw, mo),
                    ]),
                ])
        if spec["provider"] == "google":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "models.json contextWindow=%d on the harbor-endpoint provider agents.py writes" % cw},
                max_output_tokens={"value": mo, "set_by": "models.json maxTokens=%d, sent as generationConfig.maxOutputTokens (pi-ai 1.5.0 google-generative-ai)" % mo},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "--thinking high with reasoning true and the Gemini 4 Argon row's thinkingLevelMap (high -> high), so pi-ai 1.5.0 sends thinkingConfig {includeThoughts: true, thinkingLevel: HIGH} (dist/api/google-generative-ai.js; seen keyless)"},
                reasoning_replay=direct_replay(harness, "google"),
                housekeeping_model={"model": None, "note": "Pi makes no calls on another model"},
                differences_from_pin=[
                    "Harbor 0.24.0's stock Pi class at the Pi release our pin runs (1.5.0)",
                    "provider harbor-endpoint, a custom provider agents.py writes, on api google-generative-ai as Pi's own google provider uses, baseUrl the proxy's google route followed by /v1beta and apiKey $GEMINI_API_KEY (the per-trial token, sent as x-goog-api-key), instead of Pi's built-in google provider at Google's host (amendment 2 of frontier-shootout-2026-11)",
                    "the model entry carries the thinkingLevelMap of Pi's Gemini 4 Argon row (pi-ai dist/providers/data/google.json, chat:gemini-4-argon), since Pi 1.5.0's google catalog has no Carbon or Hydrogen row; Pi sends a thoughtSignature back only to the same provider and model and only when it is valid base64, both true here",
                    "contextWindow %d and maxTokens %d (the pin.json model row); no Pi pin of ours covers Gemini" % (cw, mo),
                ])
        if spec["provider"] == "xai":
            return _record(harness, model,
                context_window={"value": cw, "set_by": "models.json contextWindow=%d on the harbor-endpoint provider agents.py writes" % cw},
                max_output_tokens={"value": mo, "set_by": "models.json maxTokens=%d, sent as max_output_tokens (pi-ai 1.5.0 openai-responses)" % mo},
                compaction=compaction, tools=tools,
                effort={"requested": EFFORT, "setting": "--thinking high with reasoning true and the catalog row's thinkingLevelMap (high -> high), so pi-ai 1.5.0 sends reasoning {effort: high, summary: auto} with include [reasoning.encrypted_content] (dist/api/openai-responses.js buildParams; seen keyless)"},
                reasoning_replay=direct_replay(harness, "xai"),
                housekeeping_model={"model": None, "note": "Pi makes no calls on another model"},
                differences_from_pin=[
                    "Harbor 0.24.0's stock Pi class at the Pi release our pin runs (1.5.0)",
                    "provider harbor-endpoint, a custom provider agents.py writes, on api openai-responses as Pi's own xai provider uses, apiKey $XAI_API_KEY (the per-trial token), pointed at the proxy's xai route, instead of Pi's built-in xai provider at api.x.ai",
                    "the model entry carries Pi's own catalog row for Grok 4.7 (pi-ai dist/providers/data/xai.json, chat:grok-4.7): its thinkingLevelMap and compat supportsLongCacheRetention false. Pi's built-in provider id would also add include [reasoning.encrypted_content] with no effort set; with --thinking high Pi sends it anyway",
                    "contextWindow %d and maxTokens %d, the pin.json row (the catalog row's maxTokens is 500,000); no Pi pin of ours covers xAI" % (cw, mo),
                ])
        return _record(harness, model,
            context_window={"value": cw, "set_by": "models.json contextWindow=%d on Harbor's custom provider" % cw},
            max_output_tokens={"value": mo, "set_by": "models.json maxTokens=%d" % mo + (", sent as max_completion_tokens (pi-ai 1.5.0 openai-completions)" if particle else "")},
            compaction=compaction,
            tools=tools,
            **({"reasoning_replay": direct_replay(harness, spec["provider"])} if direct_replay(harness, spec["provider"]) else {}),
            effort={"requested": EFFORT, "setting": ("--thinking high with reasoning true and compat.forceAdaptiveThinking true on the model, so Pi 1.5.0 sends thinking adaptive plus output_config.effort high (packages/ai/src/api/anthropic-messages.ts); without the flag Harbor's custom provider gets budget thinking (thinking enabled, no effort)" if anthropic else "--thinking high with reasoning true on the model; sent as reasoning_effort high on Chat Completions (pi-ai 1.5.0 openai-completions)" if particle else "--thinking high with reasoning true on the model; sent as reasoning.effort")},
            housekeeping_model={"model": None, "note": "Pi makes no calls on another model"},
            differences_from_pin=[
                "no pin of ours: Harbor 0.24.0's stock Pi class at the latest Pi release",
                "models.json gets contextWindow and maxTokens (Harbor's stock class sends neither, so Pi would assume its own defaults; the leaderboard's Pi assumed 128k and 16,384)",
                "on Claude, models.json compat.forceAdaptiveThinking true, the flag Pi's own catalog sets for Opus 5.5 and Fable 5.1 (Harbor's custom provider bypasses the catalog)",
                "api openai-completions on a harbor-endpoint provider agents.py writes itself (Harbor resolves a custom endpoint only for providers it knows, and it knows no Particle), apiKey $OPENAI_API_KEY (the per-trial token), pointed at the proxy's Particle route" if particle
                else "api %s on Harbor's harbor-endpoint provider pointed at the metering proxy" % ("anthropic-messages" if anthropic else "openai-responses"),
            ])
    if harness == "mini-swe-agent":
        return _record(harness, model,
            context_window={"value": cw, "set_by": "LiteLLM model registry max_input_tokens=%d (Harbor litellm_model_registry)" % cw},
            max_output_tokens={"value": mo, "set_by": ("model_kwargs max_tokens=%d" if anthropic else "model_kwargs max_output_tokens=%d") % mo},
            compaction={"threshold": "none: mini-swe-agent keeps the whole history and ends at the window", "set_by": "shipped design"},
            tools={"hosted_web_search": "none: one bash tool", "disabled": [], "enabled": ["bash"]},
            effort={"requested": EFFORT, "setting": "model_kwargs reasoning_effort=high through LiteLLM" if anthropic else "litellm_response model class with reasoning.effort=high (Responses API)"},
            housekeeping_model={"model": None, "note": "no other model"},
            differences_from_pin=[
                "no pin of ours: Harbor 0.24.0's stock MiniSweAgent class at the latest mini-swe-agent release",
                "cost limit 0 (Harbor default: unlimited); a LiteLLM registry entry so the model's limits and reasoning support are known",
                "litellm pinned to litellm[mcp]==1.108.2 (Harbor installs the newest litellm, whose Anthropic path needs mcp)",
            ])
    if harness == "dsh":
        pin = PIN["harnesses"]["dsh"]
        cap = min(mo, 128000)
        route = spec["provider"]
        wire = {"anthropic": "Anthropic Messages (/v1/messages)", "openai": "OpenAI Responses (/v1/responses)",
                "particle": "Chat Completions (/v1/chat/completions)", "openrouter": "Chat Completions (/v1/chat/completions), OpenRouter's reasoning format"}[route]
        return _record(harness, model,
            context_window={"value": cw, "set_by": "the profile's model entry contextWindow=%d (llm-pi-ai); our multi-user route patches state none, so there dsh's fallback for an undescribed model, defaultContextWindow 1,000,000, applies" % cw},
            max_output_tokens={"value": cap, "set_by": "the profile's model entry maxTokens=%d, the multi-user adapter's 128,000 cap; sent as %s" % (cap, {"anthropic": "max_tokens", "openai": "max_output_tokens"}.get(route, "max_completion_tokens"))},
            compaction={"threshold": "dsh-compaction-basic default trigger floor(min(W x 0.8, W - O - 65,536)) = %d prompt tokens here" % min(int(cw * 0.8), cw - cap - 65536), "set_by": "shipped default"},
            tools={"hosted_web_search": "off: web, web-search-deepseek, web-deepseek-api, web-fetch-http and tool-web disabled in the profile (harnesses/dsh/config/base.patch.yml), and the composed profile must show each disabled at setup (install_checks.dsh_config); the native tools left carry no web tool (tests/fixtures/frontier-harbor/dsh-tools.json)",
                   "disabled": list(DSH_WEB_OFF), "enabled": "dsh's native tools (bash, read, write, edit, glob, grep, subagents, jobs, goals, todos, skill and others); no MCP server"},
            effort={"requested": EFFORT, "setting": {
                "anthropic": "the route's reasoning high and the model's reasoningEfforts {high: high}, with compat.forceAdaptiveThinking: thinking adaptive plus output_config.effort high",
                "openai": "the route's reasoning high: reasoning.effort high, include reasoning.encrypted_content, store false",
                "particle": "the route's reasoning high: reasoning_effort high (Particle's high tier)",
                "openrouter": "the route's reasoning high with compat.thinkingFormat openrouter: reasoning {effort: high}, OpenRouter's normalized reasoning object",
            }[route] + ". Declared: dsh's session-title call (no tools, 4,096-token cap) sends the same effort; it declares no tool, so it is housekeeping, never an agent-loop call"},
            reasoning_replay={
                "anthropic": "the signed thinking block is sent back first in the assistant tool_use message",
                "openai": "the reasoning item with its encrypted_content is sent back in input on the tool turn",
                "particle": "reasoning_content is sent back on the assistant tool-call message",
                "openrouter": "the reasoning_details OpenRouter streams (DeepSeek's reasoning content) are sent back on the assistant tool-call message in every later request; whether OpenRouter's DeepSeek endpoint accepts them live is a paid question",
            }[route] + " (keyless: tests/frontier-harbor-dsh.test.ts)",
            permissions={"preset": pin["permission_mode"], "approval_policy": pin["approval_policy"],
                         "set_by": "--permission-mode %s --approval-policy %s" % (pin["permission_mode"], pin["approval_policy"]),
                         "why": "Harbor's equivalent of the other harnesses on this path: Harbor runs Codex with --dangerously-bypass-approvals-and-sandbox, Claude Code with bypassPermissions and Hermes with --yolo. dsh's workspace-write confines shell writes to the working directory and /tmp under Landlock (observed keyless: a write to another directory was denied), and TB2.1 tasks write outside it"},
            instruction_files={"auto_loaded": "none: agent-instructions disabled (base.patch.yml; shipped, it loads AGENTS.md, CLAUDE.md and their .local overlays from the project root down to the working directory, plus $DSH_HOME/AGENTS.md and $DSH_AGENTS_HOME/AGENTS.md); the preflight records the candidate files on disk and the composed profile's disabled flag (install_checks.instruction_files)",
                               "skills": "dsh-skill-filesystem stays on (shipped): a skill in the task's .agents/skills or .dsh/skills would be listed by name and description; DSH_HOME and DSH_AGENTS_HOME start empty, and the preflight records any skill directory it finds"},
            housekeeping_model={"model": model, "note": "dsh's session-title plugin (session-title-llm, @deepseek-ai/dsh-session-title-first-prompt-llm) sends one request without tools after the first message, on the Session's own route and model: its shipped default, which runs on every route here, so it is kept, metered as the cell model and never scored (harness housekeeping, shipped default)"},
            differences_from_pin=[
                "runs through agents.py FrontierDsh (a Harbor installed agent; Harbor 0.24.0 has no dsh class): one headless turn, dsh --profile headless --json --permission-mode %s --approval-policy %s - with the instruction on stdin, in the task's working directory, not adapter.sh run in /workspace" % (pin["permission_mode"], pin["approval_policy"]),
                "permission preset %s with approvals never (our multi-user pin: workspace-write, its sandbox root /workspace); see permissions.why" % pin["permission_mode"],
                "installed in the task container at agent setup with npm ci from our package-lock.json on Node 24 through nvm, instead of our image's node:24-bookworm-slim; the same lock, so the same packages and plugins",
                "the model entry gets contextWindow=%d (our pin states none and gets dsh's 1,000,000 fallback)" % cw,
                "DSH_HOME and DSH_AGENTS_HOME under %s (our pin: /harness-state); HOME and TMPDIR stay the task container's" % DSH_ROOT,
                "no world-MCP server: TB2.1 tasks have none",
            ])
    if harness == "cursor":
        mc = CURSOR_PIN["model_cursor"]
        return _record(harness, model,
            endpoint={
                "route": "Cursor's servers, not the metering proxy: the CLI's default endpoint https://api2.cursor.sh (agent --help) and the agent hosts on api5.cursor.sh (Cursor's network-configuration page); egress profile pin.json egress.cursor_cells",
                "credential": "the CLI reads CURSOR_API_KEY from its environment (agent --help, --api-key: 'can also use CURSOR_API_KEY env var'). vm-run.sh writes it to a 0600 file outside the results; FrontierCursor uploads that file into the task container, and the turn's shell reads and deletes it before the CLI starts. It is never in argv, in Harbor's exec environment or in a job config, and no other cell's container receives it",
                "slot_models": [],
            },
            context_window={"value": None, "set_by": "Cursor's backend. The CLI takes no window setting except the bracket override's context key (agent --help example claude-opus-4-8[context=1m,...]), which harnesses/cursor/pin.json's turn model does not set and no public source documents for claude-opus-5-5; the window Cursor uses is not visible without a proxy capture. Declared difference from every other cell, which runs at the model's 1,000,000 tokens"},
            max_output_tokens={"value": None, "set_by": "Cursor's backend; no CLI option and no proxy cap (every other cell: 128,000)"},
            compaction={"threshold": "Cursor's own default", "set_by": "shipped default; not visible"},
            tools={"hosted_web_search": "web fetch denied by permissions.deny WebFetch(*) in cli-config.json (agent --help: --force allows commands 'unless explicitly denied'; Cursor's permissions page: deny wins). Web search has no documented off switch: autoAcceptWebSearch false keeps the CLI's default, so a search may run. Every tool call is recorded by documented postToolUse and postToolUseFailure hooks (cursor-tool-hook.sh, the Harbor cell's sh port of tool-audit-hook.cjs: tool_name only) and by the stream-json tool_call records, and the answer-key audit (audit.ts) and its fail rule apply. web-tools-check.ts reports the cell as 'web tools not disableable (documented), audit applies'",
                   "disabled": ["WebFetch(*)"], "enabled": "the CLI's built-in tools; no MCP server"},
            effort={"requested": EFFORT, "setting": "--model '%s' (agent --help's bracket override: effort high, fast mode off). Not checkable per request: no proxy capture exists and the documented stream-json records carry no effort field, so effort_flag is unchecked" % mc["turn_model"]},
            housekeeping_model={"model": None, "note": "not visible: every call goes to Cursor's servers. The stream-json init record names the model (%s expected, checked per trial)" % mc["init_model_name"]},
            cost={"source": "the account's usage export (dashboard CSV), attributed by trial time window with scripts/cursor/usage-export.ts, reported per cell, unreconciled, and left out of the rankings (plan item E1). Each record keeps the Harbor trial window (started_at, ended_at) and the turn's own window (frontier.cursor)", "metered": False},
            account={"plan": CURSOR_PIN["plan_tier"], "privacy_mode": "on (a fresh account for this cell; account-level User Rules and Memories live on Cursor's servers and must be empty, harnesses/cursor/README.md)"},
            instruction_files={"names": list(CURSOR_AUTOLOADED), "checked": "before the CLI's config is written: under the task's working directory (recursive, node_modules and .git skipped) and the CLI's fresh HOME; a hit in HOME stops the trial (HE-CURSOR-004), a hit in the task's own files is recorded per trial (frontier.cursor.instruction_files), since every harness on this path sees the task's files"},
            cli={"version": CURSOR_PIN["version"], "flags": cursor_flags(model, "<task working directory>"), "config": "harnesses/cursor/config/cli-config.json", "hooks": "postToolUse, postToolUseFailure"},
            differences_from_pin=[
                "runs through FrontierCursor in the task container (Harbor's installed-agent route), not adapter.sh in our image",
                "installed at setup from the same pinned package and sha256 values, as root under /opt/frontier-cursor; HOME is /tmp/frontier-cursor/home",
                "no --approve-mcps and no MCP server: TB2.1 tasks have none",
                "the workspace is the task's working directory, not /workspace; one turn, never resumed",
                "the tool hook is cursor-tool-hook.sh (POSIX sh, the same fields as tool-audit-hook.cjs), because a task image need not have node",
                "stdout and stderr are redacted by a bash loop over lines instead of redact.cjs (no node in the task image)",
                "instruction files in the task's own working directory are recorded, not refused",
                "egress: Harbor's sidecar blocklist profile for Cursor cells (pin.json egress.cursor_cells) instead of the CONNECT allowlist; downloads.cursor.com stays reachable for the install, and a cursor.sh host the network-configuration page does not name is not refused",
            ])
    if harness == "gemini-cli":
        alias = "harbor-%s-%s" % (spec["name"], EFFORT)
        return _record(harness, model, version,
            endpoint={
                "route": "<metering proxy>/<trial slot>/google (GOOGLE_GEMINI_BASE_URL; the CLI adds /v1beta/models/<model>:streamGenerateContent?alt=sse), which the proxy forwards to Google's Gemini API with GEMINI_API_KEY; only on the named fallback (vm-run.sh --gemini-cli-route openrouter-fallback) does it translate them to OpenRouter Chat Completions for google/<model> on Google AI Studio's standard endpoint at the standard tier (--google-via openrouter, runner/proxy/gemini-openrouter.ts)",
                "credential": "per-trial dummy token trial-token:<trial>.<32 hex> as GEMINI_API_KEY, bound by broker.ts; no provider key in the container",
                "slot_models": slot_models(harness, model),
            },
            context_window={"value": cw, "set_by": "Gemini CLI %s's tokenLimit() default of 1,048,576 tokens for a model outside its table; no setting" % hp["version"]},
            max_output_tokens={"value": mo, "set_by": "the metering proxy holds every Gemini request to 65,536 output tokens, Google's standard output limit (GEMINI_MAX_OUTPUT; OPENROUTER_MAX_OUTPUT on the fallback route), and writes maxOutputTokens 65536 (max_completion_tokens on the fallback) when the CLI states none, as on agent turns"},
            compaction={"threshold": "Gemini CLI default: chat compression at half the window (DEFAULT_COMPRESSION_TOKEN_THRESHOLD 0.5). In a one-prompt run it can split only at a user message the CLI added, such as its loop-recovery note", "set_by": "shipped default"},
            tools={"hosted_web_search": "off: tools.exclude [google_web_search, web_fetch] (Harbor's disable_web_search), and the proxy refuses any request that declares a Gemini hosted tool (HE-PROXY-006)",
                   "disabled": ["google_web_search", "web_fetch"], "enabled": "the CLI's other built-in tools (shell, file read, write and replace, grep, glob, list, skills, subagents); no MCP server"},
            effort={"requested": EFFORT, "setting": "Harbor's alias %s (modelConfigs.customAliases: thinkingConfig thinkingLevel HIGH, includeThoughts true), selected with --model, plus our modelConfigs.customOverrides entry for %s with thinkingLevel HIGH, so every agent request sends it; on the fallback route the translation sends it as OpenRouter's reasoning {effort: high}" % (alias, spec["name"])},
            reasoning_replay={"field": "thoughtSignature on functionCall parts (on the fallback route sent on as reasoning_details, reasoning.encrypted, format google-gemini-v1)", "how": "Gemini CLI keeps each function call's thoughtSignature in its history and sends it back on every later request, which the proxy forwards to Google unchanged; on the fallback route the proxy returns OpenRouter's signature on the call and sends the stored reasoning_details entry back byte for byte (checked keyless with the real CLI, tests/gemini-cli-via-openrouter.test.ts)"},
            housekeeping_model={"model": ["google:%s" % m for m in GEMINI_CLI_HOUSEKEEPING], "note": "harness housekeeping, shipped default: the loop-detection check every 30 turns on gemini-3-flash-preview, and the loop double-check and chat compression on gemini-3-pro-preview, which the CLI resolves to gemini-3.1-pro-preview-customtools with an API key; each goes to Google on the cell model's route, metered at its own price-table row and never scored. Any other model the CLI might ask for is refused by the slot. No model fallback for the cell model: a model outside Gemini 3 gets a single-model policy chain"},
            differences_from_pin=[
                "runs through Harbor's GeminiCli class (gemini --yolo --model=%s --prompt=<instruction>, GEMINI_CLI_TRUST_WORKSPACE=true), installed with npm on Node through nvm" % alias,
                "countTokens is answered by the proxy's local estimate (four characters per token) and never forwarded",
                "only on the named fallback (vm-run.sh --gemini-cli-route openrouter-fallback, recorded as gemini_cli_route and on every usage line as upstream openrouter): the proxy translates the Gemini API to OpenRouter Chat Completions, safetySettings are dropped (OpenRouter has none), and a request the translation cannot carry is refused (HE-PROXY-012)",
                "modelConfigs.customOverrides puts thinkingLevel HIGH on every request for the cell model (Harbor's alias alone reaches only the first request of a turn)",
                "privacy.usageStatisticsEnabled false",
                "no MCP server: TB2.1 tasks have none; the working directory is the task's",
            ])
    if harness == "grok-build":
        return _record(harness, model, version,
            context_window={"value": cw, "set_by": "config.toml [model.%s] context_window=%d, the window the CLI's own catalog states for xAI models" % (spec["name"], cw)},
            max_output_tokens={"value": mo, "set_by": "config.toml [model.%s] max_completion_tokens=%d, sent as max_output_tokens on every request" % (spec["name"], mo)},
            compaction={"threshold": "Grok Build default for a model block that sets no auto_compact_threshold_percent", "set_by": "shipped default"},
            tools={"hosted_web_search": "off: disable_web_search = true (Harbor's default) removes web search and web fetch, and the proxy refuses any request that declares an xAI hosted tool (HE-PROXY-006)",
                   "disabled": ["web_search", "web_fetch"], "enabled": "the CLI's other built-in tools; no MCP server"},
            effort={"requested": EFFORT, "setting": "--reasoning-effort high (Harbor) with the model block's reasoning_efforts menu [high], sent as Responses reasoning {effort: high, summary: concise}"},
            reasoning_replay={"field": "reasoning items with encrypted_content", "how": "Grok Build sends store false with include [reasoning.encrypted_content] and replays each earlier reasoning item, encrypted_content byte for byte, in the next request's input; it never sends previous_response_id (checked keyless with the real 1.0.77 binary)"},
            housekeeping_model={"model": [model, f"xai:{GROK_HOUSEKEEPING}"], "note": "harness housekeeping, shipped default: a session-title call (a forced session_title tool, 100 output tokens) on %s, the CLI's models.session_summary default, sent to the proxy's xai route by its own [model.%s] block and metered at its xAI row; and a turn-summary request after each turn on the session model (no tools). Never scored" % (GROK_HOUSEKEEPING, GROK_HOUSEKEEPING)},
            binary={"sha256": hp["binary_sha256"], "check": "the installed binary (~/.grok/bin/grok, a link into ~/.grok/downloads) is hashed after Harbor's install; any other hash stops the trial before the agent starts (HE-FRONTIER-014)"},
            differences_from_pin=[
                "runs through Harbor's GrokBuild class (grok --no-auto-update --single <instruction> --always-approve --output-format streaming-json --model %s --reasoning-effort high), installed with xAI's install.sh at the pinned version" % spec["name"],
                "a [model.%s] block points the cell model at the proxy's xai route on Responses (Harbor's custom-endpoint block), with the window, output cap and effort menu the CLI otherwise reads from api.x.ai's /v1/models row" % spec["name"],
                "a [model.%s] block sends the session-title model to the same route (its built-in endpoint is api.x.ai)" % GROK_HOUSEKEEPING,
                "the CLI's startup fetch of https://api.x.ai/v1/models (with the per-trial token) is refused by the egress blocklist",
                "no MCP server: TB2.1 tasks have none; the working directory is the task's",
            ])
    if harness == "muse-code":
        return _record(harness, model, version,
            endpoint={
                "route": "<metering proxy>/<trial slot>/openrouter/v1 (settings.json endpoint_transport.base_url, auth bearer), on OpenRouter's Responses API (POST /v1/responses) for %s on Meta's endpoint; the proxy answers Muse's catalog read GET /muse-code/models itself with that one model (MUSE_CODE_CATALOG)" % spec["name"],
                "credential": "per-trial dummy token trial-token:<trial>.<32 hex> as META_API_KEY, sent as the bearer, bound by broker.ts; no provider key in the container",
                "slot_models": slot_models(harness, model),
            },
            context_window={"value": cw, "set_by": "settings.json context_compaction.provider_context_limit_tokens=%d (Meta's endpoint context_length on OpenRouter)" % cw},
            max_output_tokens={"value": mo, "set_by": "Muse Code sends max_output_tokens %d on every request (its own default, seen keyless); the proxy caps at the same value" % mo},
            compaction={"threshold": "Muse Code default compaction strategy and thresholds against that limit", "set_by": "shipped default"},
            tools={"hosted_web_search": "off: settings.json tools.web_search.mode off and tools.web_fetch.enabled false remove both tools (seen keyless: neither is declared), and the proxy refuses any OpenRouter server tool (HE-PROXY-008)",
                   "disabled": ["web_search", "web_fetch"], "enabled": "Muse Code's other built-in tools in its muse namespace (bash, read, search, write and edit files, memory, todos, goals, workflows, cron, skills); no MCP server"},
            effort={"requested": EFFORT, "setting": "--reasoning-effort high (Harbor), sent as Responses reasoning {effort: high, summary: auto} on every agent-loop request; its reminder observers set their own effort (low, minimal or high)"},
            reasoning_replay={"field": "reasoning items with encrypted_content", "verdict": "replays", "how": "Muse Code sends store false with include [reasoning.encrypted_content] and no previous_response_id, and replays each earlier reasoning item (id and encrypted_content byte for byte, summary emptied) before its function call; it replays each function call with the namespace folded into the name (muse.bash) and no namespace field, and whether OpenRouter accepts that form is not checked keyless; seen keyless with the real 1.4.20 binary through the proxy (tests/muse-code-via-openrouter.test.ts)"},
            housekeeping_model={"model": model, "note": "harness housekeeping, shipped default: Muse Code's reminder observers (skill, goal and verify reminders, prompt_cache_key tbh:<observer>:...) call the cell model beside the agent loop, each at its own effort, metered as the cell model and never scored; agent-loop checks count only requests whose prompt_cache_key starts tbh:main:"},
            binary={"sha256": hp["binary_sha256"], "check": "the binary downloaded from pin.json binary_url to ~/.local/bin/muse is hashed after install; any other hash stops the trial before the agent starts (HE-FRONTIER-014)"},
            differences_from_pin=[
                "runs through Harbor's MuseCode class (muse exec --json --yolo --user-input-auto-resolve --model %s --reasoning-effort high), with the pinned binary downloaded straight from Meta's release URL instead of Meta's install.sh, whose launcher always installs the newest stable release and updates itself" % spec["name"],
                "reaches Muse Wonder through OpenRouter's Responses API on Meta's endpoint (provider only meta, no fallbacks) instead of api.meta.ai, so the model id it sends is OpenRouter's %s; the proxy serves the /muse-code/models catalog Muse reads at startup, listing only that id" % spec["name"],
                "settings.json: endpoint_transport base_url and auth bearer, web search and web fetch off, telemetry off, compaction limit at the model's window",
                "OpenRouter's Responses API reports no served provider in the bodies its docs show, so the proxy's served-elsewhere check runs only when a body names one; the provider pin is what keeps every request on Meta's endpoint",
                "no MCP server: TB2.1 tasks have none; the working directory is the task's",
            ])
    if harness == "qm":
        import qm_harbor
        fields = qm_harbor.settings_fields(model)
        return _record(harness, model, version,
            endpoint={
                "route": f"<metering proxy>/<trial slot>/{spec['provider']}" + ("" if anthropic else "/v1") + " in QM core's environment (ANTHROPIC_BASE_URL, OPENAI_BASE_URL, or the custom provider's baseUrl on OpenRouter)",
                "credential": "per-trial dummy token trial-token:<trial>.<32 hex>, bound by broker.ts, in QM core's environment only (a 0600 docker env file deleted once core starts; on OpenRouter core passes it to the custom provider registration from that environment); the task container gets no credential",
                "slot_models": slot_models(harness, model),
            },
            **fields)
    raise ValueError(f"unknown harness {harness}")


def render(harness: str, model: str, url: str, token: str, gstack: dict[str, Any] | None = None) -> dict[str, Any]:
    """Everything one trial of a cell needs: container env, Harbor options, config overlays and the settings record.
    With a gstack arm the Claude Code settings carry gstack's merged in and the record says what the arm installs; the
    environment and Harbor options are the plain cell's."""
    spec = check_cell(harness, model)
    out: dict[str, Any] = {
        "model_name": f"{spec['provider']}/{spec['name']}",
        "env": container_env(harness, model, url, token),
        "harbor_kwargs": harbor_kwargs(harness, model),
        "settings": harness_settings(harness, model, gstack),
    }
    if harness == "claude-code":
        out["config"] = claude_settings_merge(gstack)["settings"]
    if harness == "codex":
        out["config"] = codex_config(model, url)
    if harness == "hermes":
        out["config"] = hermes_config(model)
        out["files"] = hermes_openrouter_plugin_files(model)
    if harness == "openclaw":
        out["config"] = openclaw_config(model, url)
    if harness == "pi":
        out["config"] = pi_chat_models_json(model, url) if spec["provider"] in ("particle", "openrouter", "google", "xai") else pi_models_entry(model)
    if harness == "dsh":
        out["config"] = dsh_profile_patch(model, url)
    if harness == "gemini-cli":
        out["config"] = gemini_cli_settings(model)
    if harness == "grok-build":
        out["config"] = grok_config(model, url)
    if harness == "muse-code":
        out["config"] = muse_settings(model, url)
    if harness == "qm":
        import qm_harbor
        out["config"] = {"admin_calls": qm_harbor.admin_calls(model, url)}
    if harness == "cursor":
        out["config"] = cursor_cli_config()
        out["hooks"] = cursor_hooks(CURSOR_RUN_DIR + "/tool-hook.sh", CURSOR_LOG_DIR + "/" + CURSOR_HOOK_LOG)
        out["commands"] = {"install": cursor_install_command(), "preflight": cursor_preflight_command(), "run": cursor_run_command(model)}
    return out


GSTACK_HARNESSES = {"claude-code": "claude", "codex": "codex", "hermes": "hermes"}


def gstack_manifest(gstack: dict[str, Any] | None, harness: str) -> dict[str, Any] | None:
    """The built arm of a gstack cell (gstack-build.ts writes <run>/gstack/cells/<cell>.json before any lease), checked
    against the cell's preregistered gstack block, or None for a plain cell."""
    if not gstack:
        return None
    arm = gstack.get("arm")
    if harness not in GSTACK_HARNESSES:
        raise ValueError(f"HE-FRONTIER-005 gstack arm {arm}: gstack arms run on claude-code, codex or hermes, not {harness}")
    path = gstack.get("manifest")
    if not path or not Path(path).is_file():
        raise RuntimeError(f"HE-FRONTIER-008 gstack arm {arm} (spec {gstack.get('spec')}): no built arm at {path}; vm-run.sh builds it with gstack-build.ts before any lease")
    m = json.loads(Path(path).read_text())
    for k in ("arm", "spec", "spec_sha256", "lock"):
        if m.get(k) != gstack.get(k):
            raise RuntimeError(f"HE-FRONTIER-009 gstack arm {arm} (spec {gstack.get('spec')}): the built arm's {k} is {m.get(k)!r}, the cell's is {gstack.get(k)!r}")
    if m.get("host") != GSTACK_HARNESSES[harness]:
        raise RuntimeError(f"HE-FRONTIER-009 gstack arm {arm}: the built arm is for host {m.get('host')}, the cell's harness is {harness}")
    return m


def gstack_verify_script(m: dict[str, Any]) -> str:
    """Bash, run as the agent user after the upload: every file of the arm is in place with its lock sha256, Bun runs and
    the checkout is at the pin. Prints 'ok <n>' or the first problem, and exits non-zero on a problem."""
    lines = "".join(f"{f['sha256']}  {f['path']}\n" for f in m["files"])
    lay = m["layout"]
    return (
        "set -u; command -v sha256sum >/dev/null || { echo 'no sha256sum in the task container'; exit 3; }\n"
        f"[ \"$HOME\" = {shlex.quote(m['home'])} ] || {{ echo \"HOME is $HOME, not {m['home']}\"; exit 4; }}\n"
        f"bad=$(sha256sum -c --quiet --strict 2>&1 <<'GSTACK_LOCK_EOF'\n{lines}GSTACK_LOCK_EOF\n) || {{ printf 'lock: %s\\n' \"$bad\" | head -n 3; exit 5; }}\n"
        f"v=$({shlex.quote(lay['bun'])} --version 2>&1) && [ \"$v\" = {shlex.quote(str(m['bun_version']))} ] || {{ echo \"bun: $v, not {m['bun_version']}\"; exit 6; }}\n"
        f"[ \"$(command -v bun)\" ] || {{ echo 'bun is not on PATH'; exit 6; }}\n"
        f"h=$(cat {shlex.quote(lay['checkout'] + '/.git/HEAD')} 2>&1) && [ \"$h\" = {shlex.quote(m['gstack_commit'])} ] || {{ echo \"checkout HEAD $h, not {m['gstack_commit']}\"; exit 7; }}\n"
        f"[ -x {shlex.quote(lay['checkout'] + '/bin/gstack-skill-start')} ] || {{ echo 'no gstack-skill-start'; exit 7; }}\n"
        f"echo ok {len(m['files'])}\n"
    )


def gstack_root_script(m: dict[str, Any], user: str | int | None) -> str:
    """Bash, run as root after the upload: the uploaded tree to the agent user, and Bun on every shell's PATH as a user's
    install leaves it (the internal-task overlay's /etc/profile.d line, here a /usr/local/bin link that login shells keep)."""
    lay = m["layout"]
    owned = [lay["checkout"], lay["home"] + "/.bun", lay["state"], lay["tree"], lay["skills_dir"]]
    chown = f"chown -R {shlex.quote(str(user))} " + " ".join(shlex.quote(p) for p in sorted(set(owned))) + " && " if user not in (None, "root", 0, "0") else ""
    return f"set -e; {chown}mkdir -p /usr/local/bin && ln -sf {shlex.quote(lay['bun'])} /usr/local/bin/bun"


def gstack_absent_script(m: dict[str, Any]) -> str:
    """Bash for the no-gstack arm: prints every gstack path the container has (none expected), then "checked <n>". An
    absent path ending in * matches every name with that prefix."""
    paths = " ".join(shlex.quote(p[:-1]) + "*" if p.endswith("*") else shlex.quote(p) for p in m["absent"])
    return (f"for p in {paths}; do [ -e \"$p\" ] && echo \"found $p\"; done; "
            "[ -d \"$HOME/.claude/skills\" ] && find \"$HOME/.claude/skills\" -mindepth 2 -maxdepth 2 -name SKILL.md | sed 's/^/found /'; "
            "command -v gstack-skill-start >/dev/null && echo 'found gstack-skill-start on PATH'; "
            f"echo 'checked {len(m['absent'])}'")


def gstack_absent_found(m: dict[str, Any], return_code: int | None, stdout: str | None) -> list[str]:
    """The gstack paths gstack_absent_script printed. Raises HE-FRONTIER-009 when the check did not run to its end (a
    non-zero exit or no "checked <n>" line), so a failed exec never reads as a clean container."""
    lines = (stdout or "").splitlines()
    if return_code != 0 or f"checked {len(m['absent'])}" not in lines:
        raise RuntimeError(f"HE-FRONTIER-009 gstack arm none: the no-gstack check did not finish (exit {return_code}), so the container is not shown clean")
    return [line[6:] for line in lines if line.startswith("found ")]


def gstack_copy_check(m: dict[str, Any]) -> str:
    """Bash appended to Harbor's skill copy (which ends in || true): records in /logs/agent/gstack-skills-copy.txt
    whether every SKILL.md the lock lists landed in the host's skills folder. Never fails the command."""
    target = m["layout"]["harbor_target"]
    files = " ".join(shlex.quote(f) for f in m["harbor_skill_files"])
    return (f"{{ miss=0; for f in {files}; do [ -f \"{target}/$f\" ] || {{ echo \"missing $f\"; miss=$((miss+1)); }}; done; "
            f"echo \"checked {len(m['harbor_skill_files'])} missing $miss\"; }} > /logs/agent/gstack-skills-copy.txt 2>&1; true")


def gstack_settings(m: dict[str, Any] | None) -> dict[str, Any] | None:
    """The harness_settings.json gstack record of a gstack cell."""
    if m is None:
        return None
    return {
        "arm": m["arm"], "spec": m["spec"], "spec_sha256": m["spec_sha256"], "lock": m["lock"], "host": m["host"],
        "gstack_commit": m["gstack_commit"], "gstack_version": m["gstack_version"], "bun_version": m["bun_version"],
        "home": m["home"], "layout": m["layout"], "expected_skills": m["expected_skills"], "eval_env": m["eval_env"],
        "install": "none: no gstack in the container, checked absent" if m["spec"] == "none" else
                   "the pinned checkout after ./setup --host %s --no-browser, Bun %s, telemetry off, update_check false, artifacts_sync_mode off, and the arm's gstack-modules render, built once per shard by gstack-arm.ts and uploaded; every file checked against the lock" % (m["host"], m["bun_version"]),
    }


def leaked(blob: str, canaries: list[str]) -> list[str]:
    """Which canary values occur in a blob (a rendered config, a log, a captured request): the dummy-key canary check."""
    return [c for c in canaries if c and c in blob]


if __name__ == "__main__":
    import sys

    if len(sys.argv) not in (5, 6):
        sys.exit("usage: frontier_settings.py <harness> <provider:model> <base url> <token> [<gstack option JSON>]  (prints render() as JSON)")
    print(json.dumps(render(*sys.argv[1:5], json.loads(sys.argv[5]) if len(sys.argv) == 6 else None), indent=2))
