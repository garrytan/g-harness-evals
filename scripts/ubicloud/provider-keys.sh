# shellcheck shell=bash
# Provider key names (internal-task), sourced, never run: the one list scripts/ubicloud/run-shard.sh forwards to a shard VM,
# scripts/frontier-harbor/vm-run.sh hands to the metering proxy alone, and the keyless steps of vm-shard.sh and
# merge-pass.sh drop. runner/proxy/metering-proxy.ts KEY_ENV names the same keys, VOYAGE_API_KEY aside, which no shard
# forwards (tests/provider-keys.test.ts checks both). Names only: nothing here reads or prints a value.
provider_keys=(ANTHROPIC_API_KEY OPENAI_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY XAI_API_KEY)
# A keyless step drops every provider key, the Ubicloud key and the Cursor key: env "${keyless_unset[@]}" CMD...
keyless_keys=("${provider_keys[@]}" UBICLOUD_API_KEY CURSOR_API_KEY)
read -r -a keyless_unset <<< "$(printf -- '-u %s ' "${keyless_keys[@]}")"
