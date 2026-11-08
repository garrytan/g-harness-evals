import json, os, socket, ssl, urllib.request

BLOCKED = ["tbench.ai", "www.tbench.ai", "harborframework.com", "joelniklaus-harness-leaderboard.hf.space", "datasets-server.huggingface.co",
           "api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "us-central1-aiplatform.googleapis.com"]
OPEN = ["github.com", "pypi.org", "raw.githubusercontent.com", "huggingface.co"]


def https(host):
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=10) as s, ctx.wrap_socket(s, server_hostname=host) as t:
            t.sendall(f"HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
            return {"ok": bool(t.recv(64)), "error": None}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


def http(host):
    try:
        with socket.create_connection((host, 80), timeout=10) as s:
            s.sendall(f"HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
            return {"ok": s.recv(12).startswith(b"HTTP/"), "error": None}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


out = {"https": {h: https(h) for h in BLOCKED + OPEN}, "http": {h: http(h) for h in ["tbench.ai", "api.openai.com", "github.com"]}}
url = os.environ.get("PROBE_PROXY_STATUS_URL", "")
try:
    with urllib.request.urlopen(url, timeout=10) as r:
        out["proxy_status"] = {"ok": r.status == 200, "error": None}
except Exception as e:
    out["proxy_status"] = {"ok": False, "error": type(e).__name__}
out["docker_socket_in_task_container"] = os.path.exists("/var/run/docker.sock")
out["blocked_refused"] = all(not out["https"][h]["ok"] for h in BLOCKED) and not out["http"]["tbench.ai"]["ok"] and not out["http"]["api.openai.com"]["ok"]
out["open_reachable"] = all(out["https"][h]["ok"] for h in OPEN) and out["http"]["github.com"]["ok"]
out["pass"] = out["blocked_refused"] and out["open_reachable"] and out["proxy_status"]["ok"]
os.makedirs("/logs/verifier", exist_ok=True)
json.dump(out, open("/logs/verifier/probe.json", "w"), indent=2)
open("/logs/verifier/reward.txt", "w").write("1" if out["pass"] else "0")
