// internal-task (internal-task plan v3, M1 step 5): the QM config pi-memory-provider, gbrain as QM's per-turn memory provider.
//
// In this config gbrain reaches QM only through MEMORY_PROVIDER_CONFIG: QM core recalls from gbrain for personal scope on
// every DM turn and puts the reply in the turn's environment block. No gbrain MCP server is registered (plan v3, decision 1),
// but the model can still search gbrain through QM's own memory tool (action search): that call goes out on the provider's
// credential, whole-brain whatever the cell's scope, and the tap tags it provider_op query. Off unless a cell names config
// "pi-memory-provider"; every other QM config builds what it built before (tests/qm-memory-provider.test.ts).
//
// Per trial the runner (runner/trial/trial.ts):
//   - mints one OAuth client pair (CLIENT_ID and a random secret) for QM core's provider client;
//   - gives core MEMORY_PROVIDER_CONFIG and the pair through the compose stack's environment, never the task container and
//     never a file: the override names the variables and compose fills them from the runner's process;
//   - sets the gbrain upstream's provider block (QmProviderBlock), which the world's OAuth issuer (#159) and the tap's
//     caller split (#152) read;
//   - leaves HE_GBRAIN_MCP_URL and HE_GBRAIN_MCP_TOKEN out of the adapter's environment, so adapter.sh registers no gbrain server.
//
// providerConfig is the builder of #159's harnesses/qm/provider-preflight.ts with the counted cell's two differences:
// failOpen true (plan v3's Q1b recipe) and the QM_GBRAIN_READ_* client variables.

import { randomBytes } from 'node:crypto';

export const MEMORY_PROVIDER_CONFIG_NAME = 'pi-memory-provider';
export const CLIENT_ID = 'qm-memory-read';
export const CLIENT_ID_ENV = 'QM_GBRAIN_READ_CLIENT_ID';
export const CLIENT_SECRET_ENV = 'QM_GBRAIN_READ_CLIENT_SECRET';
/** The provider's maxCharsArg. A provider call carrying it is QM's per-turn recall (the tap's provider_op recall). */
export const MAX_CHARS_ARG = 'max_chars';
/** QM's per-turn recall cap at b6786d67 (RECALL_MAX_CHARS, src/memory/notebook.ts). */
export const RECALL_MAX_CHARS = 6000;
export const TIMEOUT_MS = 10000;
/** The tool argument QM's provider client names the member with (its default actorArg). */
export const ACTOR_ARG = 'acting_user';

/** A QM cell that routes gbrain through the memory provider. */
export const isQmMemoryProvider = (cell: { harness: string; config?: string }): boolean => cell.harness === 'qm' && cell.config === MEMORY_PROVIDER_CONFIG_NAME;

/** The exact MEMORY_PROVIDER_CONFIG of the cell; mcpUrl is the world's /gbrain tap as core reaches it. */
export function providerConfig(mcpUrl: string) {
  return {
    providers: [{
      id: 'gbrain',
      type: 'mcp',
      url: mcpUrl,
      timeoutMs: TIMEOUT_MS,
      read: { tool: 'recall', queryArg: 'question', maxCharsArg: MAX_CHARS_ARG, clientIdEnv: CLIENT_ID_ENV, clientSecretEnv: CLIENT_SECRET_ENV },
    }],
    routes: [
      { provider: 'default', scopes: ['personal', 'channel', 'group', 'team', 'org'], capture: 'automatic' },
      { provider: 'gbrain', scopes: ['personal'], capture: 'off', manage: false, label: 'gbrain', failOpen: true },
    ],
  };
}

/** The gbrain upstream's provider block. clients and tokens are the OAuth issuer's (#159): the pair it accepts, and the
 *  access tokens it issues, each mapped to the member its client acts as (empty until core asks for one). actor,
 *  max_chars_arg, max_chars, timeout_ms and actor_arg are the tap's caller split (#152), which tells a provider call by its
 *  bearer, one of the issued tokens. */
export interface QmProviderBlock {
  clients: Record<string, { secret: string; member: string }>;
  tokens: Record<string, string>;
  actor: string;
  max_chars_arg: string;
  max_chars: number;
  timeout_ms: number;
  actor_arg: string;
}

export interface QmProviderWiring {
  /** The core service's environment: MEMORY_PROVIDER_CONFIG and the client pair. Holds the secret; never written to disk. */
  coreEnv: Record<string, string>;
  provider: QmProviderBlock;
  /** MEMORY_PROVIDER_CONFIG as an object, for the plan and the trial log (it holds no secret). */
  config: ReturnType<typeof providerConfig>;
}

/** One trial's wiring: a fresh client secret, the config naming the tap, and the provider block acting as the bot. */
export function memoryProviderWiring(o: { mcpUrl: string; actor: string; secret?: string }): QmProviderWiring {
  const secret = o.secret ?? randomBytes(24).toString('hex');
  const config = providerConfig(o.mcpUrl);
  return {
    coreEnv: { MEMORY_PROVIDER_CONFIG: JSON.stringify(config), [CLIENT_ID_ENV]: CLIENT_ID, [CLIENT_SECRET_ENV]: secret },
    provider: { clients: { [CLIENT_ID]: { secret, member: o.actor } }, tokens: {}, actor: o.actor, max_chars_arg: MAX_CHARS_ARG, max_chars: RECALL_MAX_CHARS, timeout_ms: TIMEOUT_MS, actor_arg: ACTOR_ARG },
    config,
  };
}
