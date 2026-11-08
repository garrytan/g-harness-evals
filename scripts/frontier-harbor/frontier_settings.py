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


def container_env(harness: str, model: str, url: str, token: str) -> dict[str, str]:
    """Everything the task container's agent process gets in its environment for the model: the proxy route and the
    per-trial token under the names the harness reads, and the harness's own switches. No other credential."""
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
    if harness == "mini-swe-agent":
        env["MSWEA_API_KEY"] = token
        if anthropic:
            env["ANTHROPIC_API_BASE"] = url
        else:
            env["OPENAI_API_BASE"] = f"{url}/v1"
    return env


def _record(harness: str, model: str, **fields: Any) -> dict[str, Any]:
    spec = model_spec(model)
    pin = PIN["harnesses"][harness]
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


def harness_settings(harness: str, model: str) -> dict[str, Any]:
    """The harness_settings.json record for one harness and cell model."""
    spec = model_spec(model)
    cw, mo = spec["context_window"], spec["max_output_tokens"]
    anthropic = spec["provider"] == "anthropic"
    if harness == "claude-code":
        return _record(harness, model,
            context_window={"value": cw, "set_by": "the CLI's own model table for the cell model; CLAUDE_CODE_AUTO_COMPACT_WINDOW=%d also set (a name present in the 2.1.312 binary)" % cw},
            max_output_tokens={"value": mo, "set_by": "CLAUDE_CODE_MAX_OUTPUT_TOKENS=%d" % mo},
            compaction={"threshold": "Claude Code 2.1.312 default auto-compact point of the window (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE unset)", "set_by": "shipped default"},
            tools={"hosted_web_search": "off: --disallowedTools WebSearch,WebFetch and settings permissions.deny [WebSearch, WebFetch], as our pin",
                   "disabled": ["WebSearch", "WebFetch"], "enabled": "every other built-in Claude Code tool; no MCP server"},
            effort={"requested": EFFORT, "setting": "--effort high (CLAUDE_CODE_EFFORT_LEVEL=high); on Opus 5.5 and Fable 5.1 thinking is adaptive and always on, so the canonical request is thinking adaptive plus output_config.effort high, checked on captured requests"},
            housekeeping_model={"model": model, "note": "every model variable the CLI reads (ANTHROPIC_SMALL_FAST_MODEL included) names the cell model, as our adapter.sh pins it; a declared deviation from the shipped housekeeping default (internal-task exception, 2026-11-01). On Fable cells the housekeeping calls go to Fable."},
            differences_from_pin=[
                "runs through Harbor's ClaudeCode class (claude --verbose --output-format=stream-json --print, Harbor's settings file and session dir), not adapter.sh",
                "installed with Harbor's bootstrap.sh route (native binary) instead of npm in our image; the binary's sha256 is checked against the pinned 4f4178ce...",
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


def render(harness: str, model: str, url: str, token: str) -> dict[str, Any]:
    """Everything one trial of a cell needs: container env, Harbor options, config overlays and the settings record."""
    spec = check_cell(harness, model)
    out: dict[str, Any] = {
        "model_name": f"{spec['provider']}/{spec['name']}",
        "env": container_env(harness, model, url, token),
        "harbor_kwargs": harbor_kwargs(harness, model),
        "settings": harness_settings(harness, model),
    }
    if harness == "claude-code":
        out["config"] = json.loads(_pin_text("harnesses/claude-code/config/settings.json"))
    if harness == "codex":
        out["config"] = codex_config(model, url)
    if harness == "hermes":
        out["config"] = hermes_config(model)
    if harness == "openclaw":
        out["config"] = openclaw_config(model, url)
    if harness == "pi":
        out["config"] = pi_models_entry(model)
    return out


def leaked(blob: str, canaries: list[str]) -> list[str]:
    """Which canary values occur in a blob (a rendered config, a log, a captured request): the dummy-key canary check."""
    return [c for c in canaries if c and c in blob]


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 5:
        sys.exit("usage: frontier_settings.py <harness> <provider:model> <base url> <token>  (prints render() as JSON)")
    print(json.dumps(render(*sys.argv[1:5]), indent=2))
