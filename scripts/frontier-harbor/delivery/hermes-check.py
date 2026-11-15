"""harness-evals delivery arm (HARN-61): the before-ready check of the Hermes hook. Runs Hermes's own plugin discovery
with the trial's HERMES_HOME and config, and prints "loaded he-steps-card llm_request" only when the plugin is loaded,
enabled and its llm_request middleware is registered."""
import sys

from hermes_cli import plugins as p

p.discover_plugins(force=True)
manager = p.get_plugin_manager()
ours = [v for k, v in getattr(manager, "_plugins", {}).items() if k == "he-steps-card" or getattr(getattr(v, "manifest", None), "name", None) == "he-steps-card"]
for v in ours:
    if getattr(v, "error", None):
        print("plugin error: %s" % v.error, file=sys.stderr)
loaded = any(getattr(v, "enabled", False) and not getattr(v, "error", None) for v in ours)
middleware = p.has_middleware("llm_request")
print(("loaded" if loaded else "not-loaded") + " he-steps-card" + (" llm_request" if middleware else " no-middleware"))
