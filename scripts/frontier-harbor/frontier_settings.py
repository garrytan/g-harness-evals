"""Settings for the frontier Harbor path (internal-task), with no Harbor import, so keyless tests can render them.

agents.py turns these into Harbor installed-agent classes. For one harness, one cell model and one trial endpoint,
render() returns what the agent sets in the task container (environment, Harbor options, config overlays) and the
harness_settings.json record of the run: context window, max output, compaction threshold, tools, effort setting,
housekeeping model and every difference from our pins (harnesses/<h>/pin.json and adapter.sh). Values come from
pin.json beside this file and from our own harness config files. The per-trial token is passed in by the caller and
appears only in the returned environment, never in a config overlay or in the settings record.
"""

from __future__ import annotations

import json
import re
import shlex
import tomllib
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PIN = json.loads((HERE / "pin.json").read_text())
EFFORT = PIN["effort"]["level"]
HARNESSES = ("claude-code", "codex", "hermes", "openclaw", "pi", "mini-swe-agent")
CLAUDE_MODEL_VARS = (
    "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL", "CLAUDE_CODE_AUTO_MODE_MODEL",
    "CLAUDE_CODE_BG_CLASSIFIER_MODEL",
)
OPENCLAW_ANTHROPIC_HOUSEKEEPING = "claude-haiku-5-5"
PROVIDERS = {"claude-code": ("anthropic",), "codex": ("openai",)}


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
    spec = model_spec(model)
    if spec["provider"] not in PROVIDERS.get(harness, ("anthropic", "openai")):
        raise ValueError(f"{harness} runs only on {', '.join(PROVIDERS[harness])} models, not {model}")
    return spec


def housekeeping_models(harness: str, model: str) -> list[str]:
    """provider:model ids, beyond the cell model, that a harness may call on its own (metered, never scored)."""
    if harness == "openclaw" and model.startswith("anthropic:"):
        return [f"anthropic:{OPENCLAW_ANTHROPIC_HOUSEKEEPING}"]
    return []


def slot_models(harness: str, model: str) -> list[str]:
    return [model, *housekeeping_models(harness, model)]


def base_url(gateway: str, slot: str, provider: str) -> str:
    """The proxy route for one trial slot, without the API version suffix."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", slot):
        raise ValueError(f"slot {slot!r} must be letters, digits, dot, underscore or dash")
    if provider not in ("anthropic", "openai"):
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
    """Our Hermes config (config.yaml, or config.openai.yaml on OpenAI) as data, effort high, the model's real window."""
    spec = model_spec(model)
    return {
        "_config_version": 46,
        "model": {"provider": "anthropic" if spec["provider"] == "anthropic" else "openai-api", "default": spec["name"],
                  "context_length": spec["context_window"]},
        "agent": {"reasoning_effort": EFFORT, "image_input_mode": "text"},
        "terminal": {"backend": "local", "timeout": 180, "home_mode": "profile"},
        "display": {"streaming": False},
        "auto_update": False,
        "check_for_updates": False,
        "security": {"allow_lazy_installs": False},
    }


def openclaw_config(model: str, url: str) -> dict[str, Any]:
    """Our OpenClaw config overlay for the cell: the provider over the trial's proxy route with the model's real limits."""
    spec = model_spec(model)
    entry = {"id": spec["name"], "name": spec["name"], "reasoning": True, "input": ["text"],
             "contextWindow": spec["context_window"], "maxTokens": spec["max_output_tokens"]}
    if spec["provider"] == "anthropic":
        provider = {"baseUrl": url, "apiKey": "${ANTHROPIC_API_KEY}", "api": "anthropic-messages", "models": [entry]}
        defaults = {"model": {"primary": f"anthropic/{spec['name']}"}, "thinkingDefault": EFFORT, "skipBootstrap": True}
        return {"models": {"mode": "merge", "providers": {"anthropic": provider}}, "agents": {"defaults": defaults}}
    provider = {"baseUrl": f"{url}/v1", "apiKey": "${OPENAI_API_KEY}", "api": "openai-responses", "models": [entry]}
    defaults = {"model": {"primary": f"openai/{spec['name']}"}, "utilityModel": f"openai/{spec['name']}",
                "thinkingDefault": EFFORT, "skipBootstrap": True}
    return {"models": {"mode": "merge", "providers": {"openai": provider}}, "agents": {"defaults": defaults},
            "memory": {"search": {"provider": "none"}}}


def pi_models_entry(model: str) -> dict[str, Any]:
    """The fields Pi's models.json gets beside Harbor's id and reasoning flag, so Pi uses the model's real limits. On Claude,
    compat.forceAdaptiveThinking makes Pi send thinking adaptive plus output_config.effort, as its own catalog does for
    these models; Harbor's custom provider skips the catalog, so Pi would otherwise send budget thinking (enabled)."""
    spec = model_spec(model)
    entry: dict[str, Any] = {"contextWindow": spec["context_window"], "maxTokens": spec["max_output_tokens"]}
    if spec["provider"] == "anthropic":
        entry["compat"] = {"forceAdaptiveThinking": True}
    return entry


def litellm_registry(model: str) -> dict[str, Any]:
    """A LiteLLM model registry entry for mini-swe-agent, so LiteLLM knows the model's window and keeps reasoning_effort."""
    spec = model_spec(model)
    return {f"{spec['provider']}/{spec['name']}": {
        "max_input_tokens": spec["context_window"], "max_output_tokens": spec["max_output_tokens"],
        "max_tokens": spec["max_output_tokens"], "litellm_provider": spec["provider"], "mode": "chat",
        "supports_reasoning": True, "supports_function_calling": True}}


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
        return {"thinking": EFFORT, "model_api": "anthropic-messages" if spec["provider"] == "anthropic" else "openai-responses"}
    if harness == "mini-swe-agent":
        return {"reasoning_effort": EFFORT, "max_tokens": spec["max_output_tokens"], "litellm_model_registry": litellm_registry(model)}
    raise ValueError(f"unknown harness {harness}")


def container_env(harness: str, model: str, url: str, token: str, gstack: dict[str, Any] | None = None) -> dict[str, str]:
    """Everything the task container's agent process gets in its environment for the model: the proxy route and the
    per-trial token under the names the harness reads, and the harness's own switches. No other credential. A gstack
    arm (its manifest, gstack_manifest()) adds gstack's eval markers (GSTACK_EVAL_DIR, EVALS_RUN_ID)."""
    spec = model_spec(model)
    anthropic = spec["provider"] == "anthropic"
    env: dict[str, str] = (
        {"ANTHROPIC_BASE_URL": url, "ANTHROPIC_API_KEY": token} if anthropic
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


def _record(harness: str, model: str, version: str | None = None, **fields: Any) -> dict[str, Any]:
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
        "endpoint": {
            "route": f"<metering proxy>/<trial slot>/{spec['provider']}" + ("" if spec["provider"] == "anthropic" else "/v1"),
            "credential": "per-trial dummy token trial-token:<trial>.<32 hex>, bound by broker.ts; no provider key in the container",
            "slot_models": slot_models(harness, model),
        },
        **fields,
    }


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
        return _record(harness, model,
            context_window={"value": cw, "set_by": "config.yaml model.context_length=%d" % cw},
            max_output_tokens={"value": mo, "set_by": "Hermes v2026.9.24's own output table (agent/anthropic_adapter.py: 128,000 for claude-opus-5* and claude-fable*)" if anthropic else "Hermes default on the openai-api provider (no output cap sent); the proxy caps at %d" % mo},
            compaction={"threshold": "Hermes default: compression.threshold 0.50 with threshold_tokens 256,000, so compaction starts at 256,000 prompt tokens on these 1M windows", "set_by": "shipped default"},
            tools={"hosted_web_search": "none: Hermes has no provider-hosted search tool; its client-side web_search and web_extract need a search backend key the container does not have", "disabled": [], "enabled": "toolset hermes-cli (Hermes default)"},
            effort={"requested": EFFORT, "setting": "agent.reasoning_effort = high; Hermes sends thinking adaptive plus output_config.effort on Claude adaptive models and reasoning_effort on its OpenAI chat route. Declared: its session-title call (agent/title_generator.py generate_title: call_llm task title_generation, no tools, max_tokens 512, reasoning_config enabled false) asks for reasoning off (reasoning_effort none on OpenAI), a shipped default; it is housekeeping, never an agent-loop call"},
            housekeeping_model={"model": model, "note": "Hermes auxiliary calls (titles, compression summaries) use provider auto, which is the main model; the title call sends reasoning off"},
            differences_from_pin=[
                "runs Harbor's Hermes command (hermes --yolo chat -q <instruction> -Q --model --provider) instead of adapter.sh's hermes chat --query-file --oneshot",
                "installed from the pinned commit's scripts/install.sh instead of our image's uv install of the source tree",
                "the anthropic SDK (0.87.0, Hermes's own uv.lock extra) added to Hermes's venv with uv sync --locked --extra all --extra anthropic: install.sh leaves it to a lazy install, which security.allow_lazy_installs false turns off",
                "reasoning effort high (our pin: Anthropic default, OpenAI medium)",
                "model.context_length set (our pin: Hermes's own table)",
                "terminal.cwd unset, so the task's working directory, not /workspace",
                "its local-server probes of the base URL (agent/model_metadata.py detect_local_server_type: GET /api/v1/models, /api/tags, /v1/props, /props, /version, POST /api/show) are refused by the proxy; Hermes reads a non-200 as not a local server, the verdict it reaches on api.openai.com and api.anthropic.com, where it skips the probes, so nothing downstream changes",
            ])
    if harness == "openclaw":
        return _record(harness, model,
            context_window={"value": cw, "set_by": "models.providers.%s.models[0].contextWindow=%d" % (spec["provider"], cw)},
            max_output_tokens={"value": mo, "set_by": "models.providers.%s.models[0].maxTokens=%d" % (spec["provider"], mo)},
            compaction={"threshold": "OpenClaw 2026.10.6 default compaction against the configured contextWindow", "set_by": "shipped default"},
            tools={"hosted_web_search": "off: tools.deny group:web (Harbor disable_web_search), plus Harbor's headless deny of message", "disabled": ["group:web", "message"], "enabled": "OpenClaw default tools otherwise"},
            effort={"requested": EFFORT, "setting": "--thinking high and agents.defaults.thinkingDefault = high"},
            housekeeping_model=(
                {"model": f"anthropic:{OPENCLAW_ANTHROPIC_HOUSEKEEPING}", "note": "OpenClaw's shipped utility model on an Anthropic provider, kept as our pin keeps it (utilityModel unset); metered as harness housekeeping, shipped default, never scored"}
                if anthropic else
                {"model": model, "note": "utilityModel = the cell model, as our pin's OpenAI config sets it"}),
            differences_from_pin=[
                "runs through Harbor's OpenClaw class (openclaw agent --local --json after openclaw setup --baseline) instead of adapter.sh's openclaw agent exec",
                "Node 24 through nvm in the task container (Harbor's class names Node 22, which openclaw 2026.10.6 refuses); our image uses node:24-bookworm-slim",
                "contextWindow and maxTokens are the model's real limits (our Anthropic pin: 200,000 and 16,384 for Sonnet 5.5)",
                "thinkingDefault high (our OpenAI pin: medium; our Anthropic pin: unset)",
                "web tools denied (our pin relies on the internal network instead)",
                "workspace is the task's working directory (Harbor's setup baseline), not /workspace",
            ])
    if harness == "pi":
        return _record(harness, model,
            context_window={"value": cw, "set_by": "models.json contextWindow=%d on Harbor's custom provider" % cw},
            max_output_tokens={"value": mo, "set_by": "models.json maxTokens=%d" % mo},
            compaction={"threshold": "Pi 1.5.0 default auto-compaction against the configured contextWindow", "set_by": "shipped default"},
            tools={"hosted_web_search": "none: Pi's default tools (read, bash, edit, write) have no web search", "disabled": [], "enabled": "Pi defaults"},
            effort={"requested": EFFORT, "setting": ("--thinking high with reasoning true and compat.forceAdaptiveThinking true on the model, so Pi 1.5.0 sends thinking adaptive plus output_config.effort high (packages/ai/src/api/anthropic-messages.ts); without the flag Harbor's custom provider gets budget thinking (thinking enabled, no effort)" if anthropic else "--thinking high with reasoning true on the model; sent as reasoning.effort")},
            housekeeping_model={"model": None, "note": "Pi makes no calls on another model"},
            differences_from_pin=[
                "no pin of ours: Harbor 0.24.0's stock Pi class at the latest Pi release",
                "models.json gets contextWindow and maxTokens (Harbor's stock class sends neither, so Pi would assume its own defaults; the leaderboard's Pi assumed 128k and 16,384)",
                "on Claude, models.json compat.forceAdaptiveThinking true, the flag Pi's own catalog sets for Opus 5.5 and Fable 5.1 (Harbor's custom provider bypasses the catalog)",
                "api %s on Harbor's harbor-endpoint provider pointed at the metering proxy" % ("anthropic-messages" if anthropic else "openai-responses"),
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
    if harness == "openclaw":
        out["config"] = openclaw_config(model, url)
    if harness == "pi":
        out["config"] = pi_models_entry(model)
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
