# shellcheck shell=bash
# Provider key names (internal-task), sourced, never run: the one list scripts/ubicloud/run-shard.sh forwards to a shard VM,
# scripts/frontier-harbor/vm-run.sh hands to the metering proxy alone, and the keyless steps of vm-shard.sh and
# merge-pass.sh drop. runner/proxy/metering-proxy.ts KEY_ENV names the same keys, VOYAGE_API_KEY aside, which no shard
# forwards (tests/provider-keys.test.ts checks both). Names only: nothing here reads or prints a value.
provider_keys=(ANTHROPIC_API_KEY OPENAI_API_KEY PARTICLE_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY XAI_API_KEY)
# A keyless step drops every provider key, the Ubicloud key and the Cursor key: env "${keyless_unset[@]}" CMD...
keyless_keys=("${provider_keys[@]}" UBICLOUD_API_KEY CURSOR_API_KEY)
read -r -a keyless_unset <<< "$(printf -- '-u %s ' "${keyless_keys[@]}")"
# The provider keys one shard gets (internal-task), one name per line: shard_keys "<the shard's models>" "<google route>", the models as
# provider:model ids separated by spaces or commas. Only a google: model calls Google's Gemini API (Gemini CLI's cells and, since
# amendment 2 of frontier-shootout-2026-11, Gemini 4 Carbon and Hydrogen in Hermes, OpenClaw and Pi), and only on the direct
# route (vm-run.sh --gemini-cli-route native, the default); on the openrouter-fallback route those requests are keyed with
# OPENROUTER_API_KEY. So GEMINI_API_KEY goes only to a shard with a google: model on the native route. Every other key in
# provider_keys goes to every shard.
shard_keys() {
  local k
  for k in "${provider_keys[@]}"; do
    if [ "$k" = GEMINI_API_KEY ]; then
      case " ${1//,/ } " in *" google:"*) [ "${2:-native}" = native ] || continue ;; *) continue ;; esac
    fi
    printf '%s\n' "$k"
  done
}
