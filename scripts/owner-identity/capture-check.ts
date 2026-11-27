// The family C pilot check (internal-task, docs/owner-identity.md "Family C"): for each trial, did gbrain's SessionEnd hook bank every gold
// session with the decision source it should carry (runner/trial/oi-capture.ts checkCapture)? Prints one PASS or FAIL line per
// session and a verdict per trial; exits 1 when any trial fails or has no check.
//
//   bun scripts/owner-identity/capture-check.ts --trial <trial dir>... [--task <task dir>] [--json]
//
// By default it reads the check the runner wrote at <trial dir>/owner-identity/capture.json. With --task it runs the check again from
// the trial's state/ and logs/ directories against that task's capture.json and gold.json (and rewrites the file).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureLines, checkCapture, type CaptureCheck } from '../../runner/trial/oi-capture.ts';

const argv = process.argv.slice(2);
const trials: string[] = [];
let task: string | null = null;
let json = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--trial') { while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) trials.push(argv[++i]!); }
  else if (a === '--task') task = argv[++i] ?? null;
  else if (a === '--json') json = true;
  else { console.error(`capture-check: unknown argument ${a}`); process.exit(2); }
}
if (!trials.length) { console.error('usage: bun scripts/owner-identity/capture-check.ts --trial <trial dir>... [--task <task dir>] [--json]'); process.exit(2); }

let failed = false;
const out: Record<string, CaptureCheck | null> = {};
for (const t of trials) {
  const file = join(t, 'owner-identity', 'capture.json');
  const check = task ? checkCapture({ taskDir: task, stateDir: join(t, 'state'), logsDir: join(t, 'logs'), out: file })
    : existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as CaptureCheck : null;
  out[t] = check;
  if (!check?.pass) failed = true;
  if (json) continue;
  if (!check) { console.log(`FAIL ${t}: no ${file}; the trial ran no family C check (pass --task to run it)`); continue; }
  for (const line of captureLines(check)) console.log(`${line}`);
  const workers = check.launch ? `${check.launch.workers.filter((w) => w.exit === 0).length} of ${check.launch.workers.length} workers exited 0, harness among the launcher's ancestors: ${check.launch.harness_ancestor ? 'yes' : 'no'}` : 'no launch.jsonl (the launcher never ran)';
  const hb = check.heartbeat ? Object.entries(check.heartbeat.session_end).map(([k, v]) => `${k} ${v}`).join(', ') || 'none' : 'no heartbeat file';
  console.log(`${check.pass ? 'PASS' : 'FAIL'} ${t} (${check.task}): ${check.corpus_sessions} banked session(s); ${workers}; session-end heartbeats: ${hb}`);
}
if (json) console.log(JSON.stringify(out, null, 1));
process.exit(failed ? 1 : 0);
