#!/usr/bin/env python3
"""A fake model endpoint for the rules-file probe. It records every request body and answers "ok" in the dialect the path
implies (OpenAI Responses, Anthropic Messages, Chat Completions, Gemini), so a harness finishes one turn without a real key.

usage: fake_server.py PORT RECORD_DIR

Each request is written to RECORD_DIR/NNN-METHOD-path.json with its method, path, content encoding, sizes and decoded JSON
body. Request headers are not recorded, so the dummy key a harness sends never reaches the file."""
import gzip, json, os, sys, threading, time, zlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = int(sys.argv[1])
RECORD = sys.argv[2]
LOCK = threading.Lock()
SEQ = [0]
USAGE_OAI = {"input_tokens": 10, "input_tokens_details": {"cached_tokens": 0}, "output_tokens": 1,
             "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 11}


def sse(handler, events):
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "close")
    handler.end_headers()
    for ev, data in events:
        chunk = (f"event: {ev}\n" if ev else "") + f"data: {data if isinstance(data, str) else json.dumps(data)}\n\n"
        handler.wfile.write(chunk.encode())
        handler.wfile.flush()
    handler.close_connection = True


def send_json(handler, obj, code=200):
    b = json.dumps(obj).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(b)))
    handler.end_headers()
    handler.wfile.write(b)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def record(self, raw):
        enc = (self.headers.get("Content-Encoding") or "").lower()
        data = raw
        try:
            if enc == "gzip":
                data = gzip.decompress(raw)
            elif enc == "deflate":
                data = zlib.decompress(raw)
            elif enc == "zstd":
                import zstandard
                data = zstandard.ZstdDecompressor().decompressobj().decompress(raw)
        except Exception as e:
            enc = f"{enc} (decode failed: {type(e).__name__})"
        try:
            body = json.loads(data) if data else None
        except Exception:
            body = {"_raw_text": data.decode("utf-8", "replace")}
        with LOCK:
            SEQ[0] += 1
            seq = SEQ[0]
        os.makedirs(RECORD, exist_ok=True)
        slug = urlparse(self.path).path.strip("/").replace("/", "_").replace(":", "_")[:60] or "root"
        rec = {"seq": seq, "ts": time.time(), "method": self.command, "path": urlparse(self.path).path,
               "content_encoding": enc, "body_bytes_on_wire": len(raw), "body_bytes_decoded": len(data), "body": body}
        with open(os.path.join(RECORD, f"{seq:03d}-{self.command}-{slug}.json"), "w") as f:
            json.dump(rec, f, indent=1)
        return body

    def do_GET(self):
        self.record(b"")
        if urlparse(self.path).path.endswith("/models"):
            return send_json(self, {"object": "list", "data": [], "models": []})
        return send_json(self, {})

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = b""
        if n:
            raw = self.rfile.read(n)
        elif "chunked" in (self.headers.get("Transfer-Encoding") or ""):
            while True:
                size = int(self.rfile.readline().strip() or b"0", 16)
                if size == 0:
                    self.rfile.readline()
                    break
                raw += self.rfile.read(size)
                self.rfile.readline()
        body = self.record(raw)
        body = body if isinstance(body, dict) else {}
        p = urlparse(self.path).path
        stream = bool(body.get("stream"))
        model = body.get("model", "fake")
        if p.endswith("/responses"):
            item = {"type": "message", "role": "assistant", "id": "msg_1", "status": "completed",
                    "content": [{"type": "output_text", "text": "ok", "annotations": []}]}
            resp = {"id": "resp_1", "object": "response", "status": "completed", "model": model, "output": [item], "usage": USAGE_OAI}
            if not stream:
                return send_json(self, resp)
            return sse(self, [
                ("response.created", {"type": "response.created", "response": {**resp, "status": "in_progress", "output": []}}),
                ("response.output_item.added", {"type": "response.output_item.added", "output_index": 0, "item": {**item, "status": "in_progress", "content": []}}),
                ("response.output_text.delta", {"type": "response.output_text.delta", "item_id": "msg_1", "output_index": 0, "content_index": 0, "delta": "ok"}),
                ("response.output_item.done", {"type": "response.output_item.done", "output_index": 0, "item": item}),
                ("response.completed", {"type": "response.completed", "response": resp}),
            ])
        if p.endswith("/messages/count_tokens"):
            return send_json(self, {"input_tokens": 10})
        if p.endswith("/messages"):
            msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": model, "content": [{"type": "text", "text": "ok"}],
                   "stop_reason": "end_turn", "stop_sequence": None,
                   "usage": {"input_tokens": 10, "output_tokens": 1, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}}
            if not stream:
                return send_json(self, msg)
            return sse(self, [
                ("message_start", {"type": "message_start", "message": {**msg, "content": [], "stop_reason": None}}),
                ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
                ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "ok"}}),
                ("content_block_stop", {"type": "content_block_stop", "index": 0}),
                ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 1}}),
                ("message_stop", {"type": "message_stop"}),
            ])
        if p.endswith("/chat/completions"):
            if not stream:
                return send_json(self, {"id": "cc_1", "object": "chat.completion", "created": 0, "model": model,
                                        "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
                                        "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11}})
            base = {"id": "cc_1", "object": "chat.completion.chunk", "created": 0, "model": model}
            return sse(self, [
                (None, {**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "ok"}, "finish_reason": None}]}),
                (None, {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11}}),
                (None, "[DONE]"),
            ])
        if ":countTokens" in p:
            return send_json(self, {"totalTokens": 10})
        if ":generateContent" in p or ":streamGenerateContent" in p:
            chunk = {"candidates": [{"content": {"role": "model", "parts": [{"text": "ok"}]}, "finishReason": "STOP", "index": 0}],
                     "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 1, "totalTokenCount": 11}, "modelVersion": "fake"}
            return sse(self, [(None, chunk)]) if ":streamGenerateContent" in p else send_json(self, chunk)
        if ":embedContent" in p or ":batchEmbedContents" in p:
            return send_json(self, {"embedding": {"values": [0.0] * 8}})
        return send_json(self, {})


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
