// The trust Codex 0.165.0 needs before it runs a hooks.json command hook, shared by adapter.sh's gbrain-installer check and its
// instruction routes. Codex runs a non-managed hook only when config.toml holds
// [hooks.state."<CODEX_HOME>/hooks.json:<event>:<group>:<handler>"] with trusted_hash equal to the hook's current hash: sha256
// over the JSON of the normalized identity {event_name, matcher (absent here), hooks: [the one handler]} with every object's keys
// sorted (codex-rs hooks/src/engine/discovery.rs hook_hash and hook_key, config/src/fingerprint.rs version_for_toml, at tag
// rust-v0.165.0). The handler is {type: "command", command, timeout, async: false}.
//   node trust-hash.cjs <hooks.json path> <group index> <command> <timeout s>   prints the [hooks.state] table for that hook
const crypto = require("crypto");
const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
const trustedHash = (command, timeout) => "sha256:" + crypto.createHash("sha256").update(canonical({ event_name: "user_prompt_submit", hooks: [{ type: "command", command, timeout, async: false }] })).digest("hex");
const trustKey = (hooksJson, group) => hooksJson + ":user_prompt_submit:" + group + ":0";
const trustTable = (hooksJson, group, command, timeout) => "[hooks.state." + JSON.stringify(trustKey(hooksJson, group)) + "]\ntrusted_hash = " + JSON.stringify(trustedHash(command, timeout)) + "\n";
module.exports = { trustedHash, trustKey, trustTable };
if (require.main === module) {
  const [hooksJson, group, command, timeout] = process.argv.slice(2);
  process.stdout.write(trustTable(hooksJson, Number(group), command, Number(timeout)));
}
