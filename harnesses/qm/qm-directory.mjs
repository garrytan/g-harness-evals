// Build the directory push QM core needs before a channel-scoped turn can use a sandbox (docs/qm-findings.md F5).
//
//   node qm-directory.mjs <slack-api-url> <bot-token>
//
// QM decides who may use a channel's sandbox from its directory store, which only its Slack worker or
// POST /v1/directory fills (src/resolution/scope-membership.ts at the pin). The rig runs core without the
// worker, so the adapter reads the bot's channels and their rosters from the world's Slack API (recorded in
// the trial's event log as the bot's reads, before turn 1) and prints the /v1/directory body on stdout:
// channels, channelMembers keyed by the members' Slack ids (the ids QM sees as actors), channelRosterIds
// naming every channel so core treats each roster as complete, channelsSyncedAt now. Members are not pushed:
// identity classification stays as it was. Exits 2 when the world refuses.
const [apiUrl, token] = process.argv.slice(2);
if (!apiUrl || !token) { console.error('usage: qm-directory.mjs <slack-api-url> <bot-token>'); process.exit(64); }

async function slack(method, params = {}) {
  const res = await fetch(apiUrl.replace(/\/+$/, '') + '/' + method, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!body.ok) { console.error(`qm-directory: ${method} failed: ${body.error ?? res.status}`); process.exit(2); }
  return body;
}

const listed = (await slack('users.conversations')).channels.filter((c) => c.is_channel && !c.is_im);
const channels = [];
const channelMembers = [];
for (const c of listed) {
  channels.push({ channelId: c.id, name: c.name, isPrivate: c.is_private === true });
  for (const principalId of (await slack('conversations.members', { channel: c.id })).members) channelMembers.push({ channelId: c.id, principalId });
}
process.stdout.write(JSON.stringify({ channels, channelMembers, channelRosterIds: channels.map((c) => c.channelId), channelsSyncedAt: Date.now() }) + '\n');
