// internal-task (internal-task plan v3, M1): an OAuth 2.0 client-credentials issuer in front of the gbrain tap, for QM's memory
// provider (harnesses/qm/provider-preflight.ts). It exists only when the gbrain upstream carries a `provider` block;
// without one none of these routes exist and the world answers them 404 exactly as before (tests/oauth-issuer.test.ts).
//
// QM's MCP client (MCP TypeScript SDK 1.32.1, ClientCredentialsProvider) binds its client to the issuer
// new URL('/', <MCP URL>) and refuses to send the pair anywhere else, so the issuer here is the origin of the request
// as the client addressed it (the Host header), never the server's bind address. The SDK's flow, every step served here:
//   1. POST /gbrain without a token -> 401 from the tap (unchanged)
//   2. GET /.well-known/oauth-protected-resource[/gbrain] -> resource <origin>/gbrain, authorization_servers [<origin>]
//   3. GET /.well-known/oauth-authorization-server -> issuer <origin>, token_endpoint <origin>/oauth/token
//   4. POST /oauth/token, grant_type=client_credentials, client_secret_basic (or _post) -> a bearer token, which lands in
//      provider.tokens with the member the client acts as; the tap then accepts it like a world token. Tokens carry no
//      expiry (none is advertised); each client keeps its 32 newest, older ones stop working.
// Every token request is one event in the trial's log (via "oauth", tool "oauth.token") with the client id and outcome;
// the secret and the issued token are never logged.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { EventLog } from './events.ts';

export interface ProviderOAuth {
  /** client_id -> its secret and the world member the client acts as (the bot, for QM's memory provider). */
  clients: Record<string, { secret: string; member: string }>;
  /** Issued access token -> member id. Starts empty; every successful token request adds one. */
  tokens: Record<string, string>;
  /** client_id -> the tokens this issuer minted for it, oldest first. Created on the first issue; travels with the object. */
  issued?: Record<string, string[]>;
}

export const OAUTH_PATHS: ReadonlySet<string> = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/gbrain',
  '/.well-known/oauth-authorization-server',
  '/oauth/token',
  '/oauth/authorize',
]);

const MAX_TOKEN_REQUEST_BYTES = 8192;
const MAX_TOKENS_PER_CLIENT = 32;
const clip = (v: string | null) => (v === null ? null : v.length > 200 ? `${v.slice(0, 200)}...(${v.length} chars)` : v);
const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};
const oauthError = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  Response.json({ error, error_description: description }, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** The request body as text, or null once it passes max bytes (read no further than that). */
async function bodyUpTo(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(parts).toString('utf8');
    bytes += value.byteLength;
    if (bytes > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
}

/** The client id and secret a token request presents: HTTP Basic first (RFC 6749 2.3.1, form-urlencoded parts), else the body. */
export function clientCredentials(req: Request, form: URLSearchParams): { id: string; secret: string; method: 'client_secret_basic' | 'client_secret_post' } | null {
  const auth = req.headers.get('authorization') ?? '';
  if (/^basic /i.test(auth)) {
    const raw = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i < 0) return null;
    try {
      return { id: decodeURIComponent(raw.slice(0, i).replace(/\+/g, ' ')), secret: decodeURIComponent(raw.slice(i + 1).replace(/\+/g, ' ')), method: 'client_secret_basic' };
    } catch { return null; }
  }
  const id = form.get('client_id');
  const secret = form.get('client_secret');
  return id && secret ? { id, secret, method: 'client_secret_post' } : null;
}

/** Answer one of OAUTH_PATHS. The caller routes here only when the provider block is set. */
export async function handleOAuthRequest(req: Request, provider: ProviderOAuth, log: EventLog): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return Response.json({ resource: `${origin}/gbrain`, authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'world gbrain tap' });
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return Response.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      response_types_supported: [],
      grant_types_supported: ['client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    });
  }
  if (url.pathname === '/oauth/authorize') return oauthError(400, 'unsupported_response_type', 'this issuer serves the client_credentials grant only');
  if (req.method !== 'POST') return oauthError(405, 'invalid_request', 'POST only', { allow: 'POST' });
  const body = Buffer.byteLength(req.headers.get('authorization') ?? '') > MAX_TOKEN_REQUEST_BYTES ? null : await bodyUpTo(req, MAX_TOKEN_REQUEST_BYTES);
  if (body === null) {
    log.append({ actor: null, via: 'oauth', tool: 'oauth.token', kind: 'admin', args: { max_bytes: MAX_TOKEN_REQUEST_BYTES }, outcome: 'denied', error: 'invalid_request' });
    return oauthError(400, 'invalid_request', `token requests are at most ${MAX_TOKEN_REQUEST_BYTES} bytes`);
  }
  const form = new URLSearchParams(body);
  const grantType = form.get('grant_type');
  const presented = clientCredentials(req, form);
  const args = { grant_type: clip(grantType), client_id: clip(presented?.id ?? null), auth_method: presented?.method ?? null, ...(form.get('resource') ? { resource: clip(form.get('resource')) } : {}) };
  const client = presented && Object.hasOwn(provider.clients, presented.id) ? provider.clients[presented.id] : undefined;
  if (!presented || !client || !same(client.secret, presented.secret)) {
    log.append({ actor: null, via: 'oauth', tool: 'oauth.token', kind: 'admin', args, outcome: 'denied', error: 'invalid_client' });
    return oauthError(401, 'invalid_client', 'unknown client or wrong secret', { 'www-authenticate': 'Basic realm="world-oauth"' });
  }
  if (grantType !== 'client_credentials') {
    log.append({ actor: client.member, via: 'oauth', tool: 'oauth.token', kind: 'admin', args, outcome: 'denied', error: 'unsupported_grant_type' });
    return oauthError(400, 'unsupported_grant_type', 'only client_credentials is served');
  }
  const token = `wgat-${randomBytes(18).toString('base64url')}`;
  provider.tokens[token] = client.member;
  const issued = (provider.issued ??= Object.create(null) as Record<string, string[]>);
  const mine = (issued[presented.id] ??= []);
  mine.push(token);
  const evicted = mine.splice(0, Math.max(0, mine.length - MAX_TOKENS_PER_CLIENT));
  for (const old of evicted) delete provider.tokens[old];
  log.append({ actor: client.member, via: 'oauth', tool: 'oauth.token', kind: 'admin', args, outcome: 'ok', effect: { live: Object.keys(provider.tokens).length, evicted: evicted.length } });
  return Response.json({ access_token: token, token_type: 'Bearer' }, { headers: { 'cache-control': 'no-store' } });
}
