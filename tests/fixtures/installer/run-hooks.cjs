// The UserPromptSubmit hooks the real CLI runs before its model call, for the stand-in claude and codex under tests/fixtures/installer/bin:
// Claude Code runs every command in CLAUDE_CONFIG_DIR/settings.json; Codex runs a hooks.json group only when config.toml trusts it under
// [hooks.state."<CODEX_HOME>/hooks.json:user_prompt_submit:<group>:0"]. Returns each hook's additionalContext (null when none).
const fs = require("fs"), path = require("path"), cp = require("child_process");
function commands(harness) {
  if (harness === "claude-code") {
    const f = path.join(process.env.CLAUDE_CONFIG_DIR, "settings.json");
    if (!fs.existsSync(f)) return [];
    return (JSON.parse(fs.readFileSync(f, "utf8")).hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []).map((e) => e.command);
  }
  const home = process.env.CODEX_HOME, f = path.join(home, "hooks.json");
  if (!fs.existsSync(f)) return [];
  const config = fs.existsSync(path.join(home, "config.toml")) ? fs.readFileSync(path.join(home, "config.toml"), "utf8") : "";
  return (JSON.parse(fs.readFileSync(f, "utf8")).hooks?.UserPromptSubmit ?? [])
    .map((g, i) => (config.includes("[hooks.state." + JSON.stringify(f + ":user_prompt_submit:" + i + ":0") + "]") ? g.hooks[0].command : null)).filter(Boolean);
}
module.exports = function runHooks(harness, prompt) {
  return commands(harness).map((c) => {
    const out = cp.execSync(c, { input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }), env: process.env, encoding: "utf8" });
    try { return JSON.parse(out).hookSpecificOutput.additionalContext ?? null; } catch { return null; }
  });
};
