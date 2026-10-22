// A frozen simulation clock. It never reads wall time: now() is the reference instant plus whatever the runner
// has explicitly advanced. Every service timestamp (Slack ts, mail dates, event log sim_ts) comes from here.

export interface ClockState {
  reference: string;
  time_zone: string;
  offset_minutes: number;
  advanced_seconds: number;
}

export class SimClock {
  readonly referenceMs: number;
  readonly timeZone: string;
  readonly offsetMinutes: number;
  private advancedMs = 0;
  private tsCounter: number;

  constructor(opts: { reference: string; time_zone: string; offset_minutes: number; ts_counter_start?: number }) {
    const ms = Date.parse(opts.reference);
    if (Number.isNaN(ms)) throw new Error(`bad clock reference: ${opts.reference}`);
    this.referenceMs = ms;
    this.timeZone = opts.time_zone;
    this.offsetMinutes = opts.offset_minutes;
    this.tsCounter = opts.ts_counter_start ?? 0;
  }

  nowMs(): number {
    return this.referenceMs + this.advancedMs;
  }

  // ISO-8601 in the world's fixed offset, so "today" reads as the company's day, not UTC's.
  nowIso(): string {
    return formatOffset(this.nowMs(), this.offsetMinutes);
  }

  today(): string {
    return this.nowIso().slice(0, 10);
  }

  // Slack-style "seconds.counter". The counter is global and monotonic, so two messages in the same frozen
  // second still get distinct, ordered ts values.
  nextTs(): string {
    this.tsCounter += 1;
    return `${Math.floor(this.nowMs() / 1000)}.${String(this.tsCounter).padStart(6, '0')}`;
  }

  advanceSeconds(seconds: number): ClockState {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('advance takes a non-negative number of seconds');
    this.advancedMs += Math.round(seconds * 1000);
    return this.state();
  }

  advanceTo(instant: string): ClockState {
    const target = Date.parse(instant);
    if (Number.isNaN(target)) throw new Error(`bad instant: ${instant}`);
    if (target < this.nowMs()) throw new Error('the clock only moves forward');
    this.advancedMs = target - this.referenceMs;
    return this.state();
  }

  state(): ClockState {
    return {
      reference: formatOffset(this.referenceMs, this.offsetMinutes),
      time_zone: this.timeZone,
      offset_minutes: this.offsetMinutes,
      advanced_seconds: this.advancedMs / 1000,
    };
  }
}

export function formatOffset(ms: number, offsetMinutes: number): string {
  const shifted = new Date(ms + offsetMinutes * 60_000);
  const base = shifted.toISOString().slice(0, 19);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${base}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
