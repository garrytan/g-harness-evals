// Timers an agent sets for itself on the simulation clock (TODOS eng-r2-native-5 and eng-r2-outside-4). No harness's own
// scheduler follows the frozen clock, so the world keeps the timers and the runner fires each one as a turn when the clock
// passes its due time (runner/trial/turns.ts). The store lives in the world process, outside the harness, so a timer and
// whether it already fired survive a harness restart; firing is idempotent, so a repeated clock tick never fires one twice.

export interface Timer {
  id: string;
  /** Due instant, ISO-8601 in the world's offset. */
  due: string;
  due_ms: number;
  reason: string;
  note: string | null;
  set_by: string;
  set_at: string;
  status: 'pending' | 'fired' | 'cancelled';
  /** The runner's delivery number of the timer turn that fired it. */
  fired_turn?: number;
  fired_at?: string;
}

export class TimerStore {
  private readonly timers: Timer[] = [];
  private seq = 0;

  constructor(private readonly trialId: string) {}

  add(t: Omit<Timer, 'id' | 'status'>): Timer {
    this.seq += 1;
    const timer: Timer = { id: `timer-${this.trialId}-${this.seq}`, status: 'pending', ...t };
    this.timers.push(timer);
    return timer;
  }

  get(id: string): Timer | undefined {
    return this.timers.find((t) => t.id === id);
  }

  byOwner(member: string): Timer[] {
    return this.timers.filter((t) => t.set_by === member);
  }

  all(): Timer[] {
    return this.timers.map((t) => ({ ...t }));
  }

  /** Pending timers due at or before the instant, earliest first, ties in the order they were set. */
  dueBy(ms: number): Timer[] {
    return this.timers.filter((t) => t.status === 'pending' && t.due_ms <= ms).sort((a, b) => a.due_ms - b.due_ms || this.timers.indexOf(a) - this.timers.indexOf(b)).map((t) => ({ ...t }));
  }
}
