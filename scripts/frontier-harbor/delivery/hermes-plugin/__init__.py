"""harness-evals delivery arm (HARN-61), the hook and placebo arms on Hermes: llm_request middleware. Hermes runs it on every
provider request of the tool loop (agent/turn_api_request.py:140-152 at f97608f) and sends the request it returns, so each
request, tool follow-ups included, carries one fresh copy of /tmp/he-delivery/card.md appended to its last message. The
copy is not written back into Hermes's history. One line per request goes to /logs/agent/he-delivery-fires.jsonl."""
import json
import time

CARD = "/tmp/he-delivery/card.md"
FIRES = "/logs/agent/he-delivery-fires.jsonl"


def _append(msg, card):
    if not isinstance(msg, dict):
        return None
    if "content" in msg:
        content = msg["content"]
        if isinstance(content, str):
            msg["content"] = content + "\n\n" + card if content else card
            return "content"
        if isinstance(content, list):
            typed = any(isinstance(b, dict) and b.get("type") in ("input_text", "output_text") for b in content)
            content.append({"type": "input_text" if typed else "text", "text": card})
            return "content_block"
    if msg.get("type") == "function_call_output" and isinstance(msg.get("output"), str):
        msg["output"] = msg["output"] + "\n\n" + card
        return "function_call_output"
    return None


def _inject(**kwargs):
    request = kwargs.get("request")
    if not isinstance(request, dict):
        return None
    with open(CARD, encoding="utf-8") as f:
        card = f.read()
    for key in ("messages", "input"):
        items = request.get(key)
        if isinstance(items, list) and items:
            where = _append(items[-1], card)
            if where:
                try:
                    with open(FIRES, "a", encoding="utf-8") as f:
                        f.write(json.dumps({"at": time.time(), "event": "llm_request", "api_call_count": kwargs.get("api_call_count"),
                                            "role": items[-1].get("role") or items[-1].get("type"), "where": where, "bytes": len(card.encode())}) + "\n")
                except OSError:
                    pass
                return {"request": request, "source": "he-steps-card"}
    return None


def register(ctx):
    ctx.register_middleware("llm_request", _inject)
