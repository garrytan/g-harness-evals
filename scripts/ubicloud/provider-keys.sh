# shellcheck shell=bash
# Provider key names (internal-task), sourced, never run: the one list scripts/ubicloud/run-shard.sh forwards to a shard VM,
# scripts/frontier-harbor/vm-run.sh hands to the metering proxy alone, and the keyless steps of vm-shard.sh and
# merge-pass.sh drop. runner/proxy/metering-proxy.ts KEY_ENV names the same keys, VOYAGE_API_KEY aside, which no shard
# forwards (tests/provider-keys.test.ts checks both). Names only: nothing here reads or prints a value.
provider_keys=(ANTHROPIC_API_KEY OPENAI_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY XAI_API_KEY)
# A keyless step drops every provider key, the Ubicloud key and the Cursor key: env "${keyless_unset[@]}" CMD...
keyless_keys=("${provider_keys[@]}" UBICLOUD_API_KEY CURSOR_API_KEY)
read -r -a keyless_unset <<< "$(printf -- '-u %s ' "${keyless_keys[@]}")"
# The provider keys one shard gets (internal-task), one name per line: shard_keys "<the shard's harnesses>" "<Gemini CLI route>".
# Only Gemini CLI on its direct route (native, the default) calls Google's Gemini API, so GEMINI_API_KEY goes only to a
# shard with a gemini-cli cell on that route; on the openrouter-fallback route its requests are keyed with
# OPENROUTER_API_KEY. Every other key in provider_keys goes to every shard.
shard_keys() {
  local k
  for k in "${provider_keys[@]}"; do
    if [ "$k" = GEMINI_API_KEY ]; then
      case " $1 " in *" gemini-cli "*) [ "${2:-native}" = native ] || continue ;; *) continue ;; esac
    fi
    printf '%s\n' "$k"
  done
}
