// Family C, session capture (internal-task plan, "Setups (C)"): the owner types two sessions to the harness, then a third asking it to
// start four headless workers; the harness, as a real headless orchestrator, runs the launcher (CAPTURE_LAUNCHER, a copy in each of
// harnesses/claude-code and harnesses/codex under capture/), which starts each worker as a child `claude -p` or `codex exec` with
// the orchestrator's brief on stdin. Two workers carry GBRAIN_SESSION_AGENT=<CAPTURE_AGENT>; two are left to gbrain's detection
// (a headless claude or codex with a claude or codex ancestor, gbrain src/core/context/session-speaker.ts). gbrain's SessionEnd
// capture hook banks all seven sessions. The briefs say "The user prefers ...": an agent's words in the user's seat, so their facts
// are agent:orchestrator's, never the owner's. The owner's own session facts are owner_recall.

import type { Rng } from '../brain/names.ts';
import { THEY, type Fact, type FactLedger } from './facts.ts';
import type { Cast, Person } from './people.ts';

/** The GBRAIN_SESSION_AGENT label the launcher sets on the env workers (gbrain's seat-label charset; not off or owner). */
export const CAPTURE_AGENT = 'orchestrator';
/** The launcher's path in both harness images (harnesses/<harness>/capture/launch-workers.sh, Dockerfile COPY). */
export const CAPTURE_LAUNCHER = '/opt/harness/capture/launch-workers.sh';
/** The harnesses whose adapters implement HE_OI_CAPTURE_B64 (runner/trial/oi-capture.ts). */
export const CAPTURE_HARNESSES = ['claude-code', 'codex'] as const;
/** Worker launch modes per variant; each variant has two of each. */
const LAUNCHES: Array<Array<'env' | 'detected'>> = [['env', 'detected', 'env', 'detected'], ['detected', 'env', 'detected', 'env'], ['env', 'env', 'detected', 'detected']];
const PROJECTS = ['garden-planner', 'invoice-tool', 'trail-log', 'recipe-box', 'budget-sheet', 'photo-sorter'];
const TASKS = ['confirm in one short sentence that you have this context', 'reply with one short sentence saying you are ready', 'acknowledge this brief in one short sentence'];

export type SessionKind = 'owner' | 'orchestrator' | 'worker';
export interface CaptureSession { n: number; kind: SessionKind; launch: 'typed' | 'env' | 'detected'; turn: number | null; worker: number | null; agent: string | null }
export interface CaptureWorker { n: number; session: number; launch: 'env' | 'detected'; agent: string | null; brief: string }
/** capture.json beside task.toml: what the runner hands the adapter (HE_OI_CAPTURE_B64) and what the pilot check reads. */
export interface CapturePlan { schema_version: 1; task: string; launcher: string; agent_label: string; orchestrator_turn: number; sessions: CaptureSession[]; workers: CaptureWorker[] }

export interface CaptureTurn { actor: string; channel: 'dm'; text: string; thread: 'new'; advance_clock_s?: number }

const theyRelay = (name: string) => (third: (w: { s: string; p: string }) => string) => `${name} told me ${third(THEY)}.`;

/** One family C task: three owner turns (two sessions of facts, one asking for the workers) and four worker briefs. */
export function captureTask(r: Rng, cast: Cast, L: FactLedger, taskId: string, k: number): { turns: CaptureTurn[]; plan: CapturePlan } {
  const o = cast.owner;
  const q = r.pick(cast.contacts) as Person;
  const proj = r.pick(PROJECTS);
  const mark = (from: number, session: number, launch: Fact['launch']) => { for (const f of L.facts.slice(from)) { f.where = { session }; f.launch = launch; } };
  const quote = () => L.relay(o, q, 'owner_quotes_other', theyRelay(q.first));
  let at = L.facts.length;
  const s1 = `Some context before I hand work to my agents later today. ${L.own(o, 'control')}${k % 2 ? ` ${quote()}` : ''} No action needed, just reply ok.`;
  mark(at, 1, 'typed');
  at = L.facts.length;
  const s2 = `Another note for my records. ${L.own(o, 'control')} ${L.own(o, 'control')}${k % 2 ? '' : ` ${quote()}`} Just confirm you saw this.`;
  mark(at, 2, 'typed');
  const orchestrator = `Please start my four worker agents for the ${proj} repo now: run \`bash ${CAPTURE_LAUNCHER}\` in your shell and wait for it to finish; it takes a minute or two and prints one line per worker, then a DONE line. Reply with the DONE line only.`;
  const launches = LAUNCHES[k % LAUNCHES.length]!;
  const workers: CaptureWorker[] = launches.map((launch, i) => {
    at = L.facts.length;
    const brief = `You are working for ${o.name} on the ${proj} repo. ${L.agent('agent:orchestrator', 'agent_brief_in_user_seat', o.id, 'prefers')} Task: ${r.pick(TASKS)}. Do not run any tools or change any files.`;
    mark(at, 4 + i, launch);
    return { n: i + 1, session: 4 + i, launch, agent: launch === 'env' ? CAPTURE_AGENT : null, brief };
  });
  const sessions: CaptureSession[] = [
    { n: 1, kind: 'owner', launch: 'typed', turn: 1, worker: null, agent: null },
    { n: 2, kind: 'owner', launch: 'typed', turn: 2, worker: null, agent: null },
    { n: 3, kind: 'orchestrator', launch: 'typed', turn: 3, worker: null, agent: null },
    ...workers.map((w): CaptureSession => ({ n: w.session, kind: 'worker', launch: w.launch, turn: null, worker: w.n, agent: w.agent })),
  ];
  const turns: CaptureTurn[] = [
    { actor: o.id, channel: 'dm', text: s1, thread: 'new' },
    { actor: o.id, channel: 'dm', text: s2, thread: 'new', advance_clock_s: 600 },
    { actor: o.id, channel: 'dm', text: orchestrator, thread: 'new', advance_clock_s: 600 },
  ];
  return { turns, plan: { schema_version: 1, task: taskId, launcher: CAPTURE_LAUNCHER, agent_label: CAPTURE_AGENT, orchestrator_turn: 3, sessions, workers } };
}
