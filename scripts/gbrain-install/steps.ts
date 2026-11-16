// Step detection for the gbrain install eval (scripts/gbrain-install/README.md). New code, no Cat 41 counterpart: Cat 41 timed the whole
// run and its download, not each step.
//
// The five steps a run passes, in order: binary (gbrain on PATH), brain (a brain exists), wired (the harness config registers gbrain
// through MCP, instructions or a hook), saved (a gbrain call in the save turn) and recalled (a gbrain call in the recall turn of a
// new conversation). Install-step times come from the 1-second watcher (install-watch.ndjson, each line with its "at") or, where the
// watcher has no line, from the probe taken at the end of each turn. Transcripts carry no per-call times, so the save and recall times
// are the end of the turn that holds the first successful gbrain call.
import type { InstallTurn, Probe } from './classify.ts';
import { isGbrainCall, type NEvent } from './transcript.ts';

export type RunStep = 'binary' | 'brain' | 'wired' | 'saved' | 'recalled';
export const RUN_STEPS: readonly RunStep[] = ['binary', 'brain', 'wired', 'saved', 'recalled'];

/** The first install step the probe has not passed, or 'done' when it passes all three. No probe is the binary step. */
export function stepOf(probe: Probe | null): 'binary' | 'brain' | 'wired' | 'done' {
  if (!probe || !probe.binary) return 'binary';
  if (!probe.brain) return 'brain';
  if (!(probe.mcp || probe.instructions || probe.hook)) return 'wired';
  return 'done';
}

/** The step a turn is on: stepOf its probe, and once the install passes, saved for the arm, reply and save turns and recalled for
 *  the recall and hinted turns. */
export function turnStep(t: Pick<InstallTurn, 'probe' | 'role'>): RunStep {
  const s = stepOf(t.probe);
  if (s !== 'done') return s;
  return t.role === 'recall' || t.role === 'hinted' ? 'recalled' : 'saved';
}

/** A tool call that did not fail: no error flag and, for shell commands, exit 0 or no exit code. */
export const succeeded = (e: NEvent) => !e.is_error && (e.exit_code === null || e.exit_code === 0);

/** Milliseconds from started_at to each step, null when the run never reached it. With finish false, recalled is null. */
export function stepTimes(o: { turns: InstallTurn[]; watch: Probe[]; started_at: string; finish?: boolean }): { binary_ms: number | null; brain_ms: number | null; wired_ms: number | null; saved_ms: number | null; recalled_ms: number | null } {
  const t0 = Date.parse(o.started_at);
  const ms = (at: string) => { const t = Date.parse(at); return Number.isFinite(t) && Number.isFinite(t0) ? Math.max(0, t - t0) : null; };
  const first = (passed: (p: Probe) => boolean) => {
    const times = [...o.watch.filter(passed).map(p => ms(p.at)), ...o.turns.filter(t => t.probe && passed(t.probe)).map(t => ms(t.ended_at))].filter((x): x is number => x !== null);
    return times.length ? Math.min(...times) : null;
  };
  const gbrainTurnEnd = (role: InstallTurn['role']) => { const t = o.turns.find(x => x.role === role && x.events.some(e => isGbrainCall(e) && succeeded(e))); return t ? ms(t.ended_at) : null; };
  return {
    binary_ms: first(p => !!p.binary),
    brain_ms: first(p => p.brain),
    wired_ms: first(p => p.mcp || p.instructions || p.hook),
    saved_ms: gbrainTurnEnd('save'),
    recalled_ms: o.finish === false ? null : gbrainTurnEnd('recall'),
  };
}
