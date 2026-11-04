// internal-task (internal-task M1 step 3): the pure parts of harnesses/qm/provider-preflight.ts. The docker run itself is the receipt
// harnesses/qm/provider-preflight-b6786d67.json; these pin the config it gives QM, how a stored turn is read in both QM
// shapes (b6786d67, and f3577189's untrusted-data fence and memoryRecallOutcomes), the assertions and the secret scan.

import { expect, test } from 'bun:test';
import { evaluate, inspectTurn, providerConfig, providerOutcome, secretHits, SEED, type StoredTurn, type TurnView } from '../harnesses/qm/provider-preflight.ts';

const URL_ = 'http://127.0.0.1:41234/gbrain';
const ORIGIN = 'http://127.0.0.1:41234';
const turnB678: StoredTurn = { session_id: 's1', seq: 3, text: 'What is the gate code?', body: { payload: { text: 'What is the gate code?', environment: `<environment>\n## Memory\n### gbrain\n{"facts":[{"fact":"${SEED.fact}"}]}\n</environment>`, memoryRecall: { shown: [{ scope: 'personal:U1', hash: 'aff6' }] } } } };
const turnF357: StoredTurn = { session_id: 's2', seq: 1, text: 'What is the gate code?', body: { payload: { environment: `<environment>\n### gbrain\n<untrusted-data source="gbrain">\n${SEED.fact}\n</untrusted-data>\n</environment>`, memoryRecall: { shown: [] }, memoryRecallOutcomes: [{ provider: 'default', outcome: 'empty', ms: 2 }, { provider: 'gbrain', outcome: 'ok', ms: 31 }] } } };
const empty: StoredTurn = { session_id: 's3', seq: 1, text: 'Friday?', body: { payload: { environment: '<environment>\n### gbrain\n{"facts":[]}\n</environment>', memoryRecall: { shown: [] } } } };

test('the config gives QM one gbrain read route: recall, question, max_chars, failOpen false, after the default route', () => {
  const c = providerConfig(URL_);
  expect(c.providers).toEqual([{ id: 'gbrain', type: 'mcp', url: URL_, timeoutMs: 10000, read: { tool: 'recall', queryArg: 'question', maxCharsArg: 'max_chars', clientIdEnv: 'QM_PF_READ_CLIENT_ID', clientSecretEnv: 'QM_PF_READ_CLIENT_SECRET' } }]);
  expect(c.routes[0]).toEqual({ provider: 'default', scopes: ['personal', 'channel', 'group', 'team', 'org'], capture: 'automatic' });
  expect(c.routes[1]).toMatchObject({ provider: 'gbrain', scopes: ['personal'], capture: 'off', manage: false, failOpen: false });
  expect('write' in c.providers[0]!).toBe(false);
});

test('inspectTurn reads both QM shapes and a missing turn', () => {
  const a = inspectTurn(turnB678, SEED.marker);
  expect(a).toMatchObject({ stored: true, environment_has_fact: true, untrusted_fence: false, memory_recall_outcomes: null });
  expect(a.gbrain_section?.startsWith('### gbrain')).toBe(true);
  const b = inspectTurn(turnF357, SEED.marker);
  expect(b).toMatchObject({ stored: true, environment_has_fact: true, untrusted_fence: true });
  expect(providerOutcome(b.memory_recall_outcomes)).toBe('ok');
  expect(inspectTurn(empty, SEED.marker).environment_has_fact).toBe(false);
  expect(inspectTurn(undefined, SEED.marker)).toMatchObject({ stored: false, environment_has_fact: false, memory_recall: null });
});

test('providerOutcome takes a list or a map and returns null without outcomes', () => {
  expect(providerOutcome(null)).toBeNull();
  expect(providerOutcome({ gbrain: { provider: 'gbrain', outcome: 'denied' } })).toBe('denied');
  expect(providerOutcome([{ provider: 'default', outcome: 'ok' }])).toBeNull();
});

function observed(over: Partial<Parameters<typeof evaluate>[0]> = {}) {
  const view = (t: StoredTurn | undefined): TurnView => inspectTurn(t, SEED.marker);
  return evaluate({
    mcpUrl: URL_, prm: { resource: URL_, authorization_servers: [ORIGIN] }, asMeta: { issuer: ORIGIN },
    tokenEvents: [{ phase: 'right', outcome: 'ok', auth_method: 'client_secret_basic' }, { phase: 'wrong', outcome: 'denied', auth_method: 'client_secret_basic' }],
    config: providerConfig(URL_),
    positive: { status: 'ok', turn: view(turnB678), recalls: [{ outcome: 'ok', args: { question: 'q', max_chars: 6000 } }] },
    unrelated: { status: 'ok', turn: view(empty), recalls: [{ outcome: 'ok', args: { question: 'f' } }] },
    wrong: { status: null, http: 500, turn: view(undefined), recalls: [], errorText: '{"error":"internal_error"}' },
    seedOk: true,
    ...over,
  });
}
const failing = (a: ReturnType<typeof evaluate>) => a.filter((x) => !x.pass).map((x) => x.id);

test('evaluate passes the run the plan asks for, in either QM shape', () => {
  expect(failing(observed())).toEqual([]);
  expect(failing(observed({ positive: { status: 'ok', turn: inspectTurn(turnF357, SEED.marker), recalls: [{ outcome: 'ok', args: {} }] } }))).toEqual([]);
});

test('evaluate fails each check on its own evidence', () => {
  expect(failing(observed({ asMeta: { issuer: 'http://issuer.elsewhere.internal' } }))).toEqual(['oauth_issuer_matches_mcp_origin']);
  expect(failing(observed({ tokenEvents: [{ phase: 'wrong', outcome: 'denied' }] }))).toEqual(['oauth_client_credentials_token']);
  const open = providerConfig(URL_); open.routes[1]!.failOpen = true;
  expect(failing(observed({ config: open }))).toEqual(['fail_open_false']);
  expect(failing(observed({ positive: { status: 'ok', turn: inspectTurn(empty, SEED.marker), recalls: [{ outcome: 'ok', args: {} }] } }))).toEqual(['stored_turn_shows_fact']);
  expect(failing(observed({ positive: { status: 'ok', turn: inspectTurn(turnB678, SEED.marker), recalls: [] } }))).toEqual(['recall_event_logged']);
  expect(failing(observed({ unrelated: { status: 'ok', turn: inspectTurn(turnB678, SEED.marker), recalls: [{ outcome: 'ok', args: {} }] } }))).toEqual(['negative_unrelated_query']);
  expect(failing(observed({ wrong: { status: 'ok', http: 200, turn: inspectTurn(turnB678, SEED.marker), recalls: [{ outcome: 'ok', args: {} }], errorText: '' }, tokenEvents: [{ phase: 'right', outcome: 'ok', auth_method: 'client_secret_basic' }, { phase: 'wrong', outcome: 'ok', auth_method: 'client_secret_basic' }] }))).toEqual(['negative_wrong_credentials', 'fail_closed_visible']);
  const deniedOutcome = { ...turnF357, body: { payload: { ...(turnF357.body.payload as object), environment: '', memoryRecallOutcomes: [{ provider: 'gbrain', outcome: 'ok' }] } } };
  expect(failing(observed({ wrong: { status: 'failed', http: 200, turn: inspectTurn(deniedOutcome, SEED.marker), recalls: [], errorText: '' } }))).toEqual(['fail_closed_visible']);
  expect(failing(observed({ wrong: { status: null, http: null, turn: inspectTurn(undefined, SEED.marker), recalls: [], errorText: '' } }))).toEqual(['fail_closed_visible']);
  expect(failing(observed({ wrong: { status: 'silent', http: 200, turn: inspectTurn(undefined, SEED.marker), recalls: [], errorText: '' } }))).toEqual(['fail_closed_visible']);
  expect(failing(observed({ wrong: { status: 'failed', http: 200, turn: inspectTurn(undefined, SEED.marker), recalls: [], errorText: '' } }))).toEqual([]);
  expect(failing(observed({ unrelated: { status: 'failed', turn: inspectTurn(empty, SEED.marker), recalls: [{ outcome: 'ok', args: {} }] } }))).toEqual(['negative_unrelated_query']);
  expect(failing(observed({ unrelated: { status: 'ok', turn: inspectTurn(empty, SEED.marker), recalls: [{ outcome: 'error', args: {} }] } }))).toEqual(['negative_unrelated_query']);
});

test('secretHits flags token shapes and run secrets, and passes the placeholders the receipt uses', () => {
  expect(secretHits('{"key":"' + 'sk-ant-' + 'api03-abcdefghijkl"}')).not.toEqual([]);
  expect(secretHits('Bearer ' + 'wgat-' + 'abcdefghijklmnop')).not.toEqual([]);
  expect(secretHits('xoxb-' + 'trial-12345678')).not.toEqual([]);
  expect(secretHits('the run secret is here', ['run secret'])).toEqual(['run secret']);
  expect(secretHits('{"QM_PF_READ_CLIENT_SECRET":"<random per run, never written>","key":"a dummy with the fake\'s required prefix"}')).toEqual([]);
});
