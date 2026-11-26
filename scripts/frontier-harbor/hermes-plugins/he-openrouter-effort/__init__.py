"""harness-evals frontier-shootout-2026-11, amendment 1: OpenRouter's reasoning {effort: high} and the cell's output cap on
every model request Hermes's built-in openrouter provider sends through the metering proxy.

Hermes sends an OpenRouter reasoning field only when the base URL's host is openrouter.ai (run_agent.py
_is_openrouter_url, agent/reasoning_params.py _supports_reasoning_extra_body, as of v0.23.1), and it reads extra_body
from config only for custom providers (agent/agent_init.py _custom_provider_extra_body_for_agent). Behind the proxy the
built-in provider therefore sends neither, so this llm_request middleware adds them. It changes nothing else, and
nothing on any other provider. HE_OPENROUTER_MAX_OUTPUT_TOKENS is the cell's cap (scripts/frontier-harbor/pin.json).
"""

import os

EFFORT = "high"


def openrouter_request(**kw):
    if str(kw.get("provider") or "").strip().lower() != "openrouter":
        return None
    request = dict(kw.get("request") or {})
    extra = dict(request.get("extra_body") or {})
    extra["reasoning"] = {**(extra.get("reasoning") or {}), "effort": EFFORT}
    request["extra_body"] = extra
    cap = os.environ.get("HE_OPENROUTER_MAX_OUTPUT_TOKENS", "")
    if cap.isdigit() and not any(k in request or k in extra for k in ("max_tokens", "max_completion_tokens")):
        request["max_completion_tokens"] = int(cap)
    return {"request": request, "source": "harness-evals", "name": "he-openrouter-effort", "reason": "effort high and the output cap behind the metering proxy"}


def register(ctx):
    ctx.register_middleware("llm_request", openrouter_request)
