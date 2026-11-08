/**
 * Request-body capture (internal-task): the bodies a lease proxy forwards for a slot bound with `capture`, for the contamination
 * audit (scripts/frontier-harbor/audit.ts readCapture), which scans what every harness sent the model the same way.
 *
 * One file per capture directory, `proxy-requests.ndjson`, written by the proxy on the host, outside the task container. One
 * line per request the proxy sends upstream, written just before it is sent:
 *   {"seq": n, "prev": "<first 16 hex of the sha256 of the previous line>", "route": "/v1/messages", "body": {...}}
 * seq counts lines from 0 and prev is "" on the first line, so a dropped, edited or reordered line breaks the chain. The body
 * is the JSON the proxy forwarded (after the output cap and any ablation), or null for a request with no body (a GET model
 * listing), so the file has one line for every request counted in the slot's usage.requests. No header is written, so neither the proxy's key
 * nor the slot's token reaches the file, and the route carries no query string (where a `key=` parameter would sit).
 * When the next line would pass the size cap the proxy writes {"seq": n, "prev": "...", "truncated": true} and nothing more.
 * A file that already exists (a slot bound again for the same trial) is continued, chain and cap included.
 */
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const CAPTURE_FILE = 'proxy-requests.ndjson';
export const DEFAULT_CAPTURE_MAX_BYTES = 256 * 1024 * 1024;

const chainKey = (line: string) => createHash('sha256').update(line, 'utf8').digest('hex').slice(0, 16);

interface CaptureState { seq: number; prev: string; bytes: number; truncated: boolean; keys: Set<string> }

export class BodyCapture {
  private open = new Map<string, CaptureState>();
  constructor(private maxBytes = DEFAULT_CAPTURE_MAX_BYTES) {}

  /** Append one forwarded request body to `file` for the trial `key`. Throws when the file cannot be read or written. */
  write(file: string, key: string, route: string, body: unknown) {
    let s = this.open.get(file);
    if (!s) { s = resume(file); this.open.set(file, s); }
    s.keys.add(key);
    if (s.truncated) return;
    let line = JSON.stringify({ seq: s.seq, prev: s.prev, route, body });
    if (s.bytes + Buffer.byteLength(line) + 1 > this.maxBytes) {
      line = JSON.stringify({ seq: s.seq, prev: s.prev, truncated: true });
      s.truncated = true;
    }
    appendFileSync(file, line + '\n');
    s.seq++;
    s.prev = chainKey(line);
    s.bytes += Buffer.byteLength(line) + 1;
  }

  /** Close every capture file `key` wrote to (its slot was finalized); a later write reopens the file where it ended. */
  close(key: string) {
    for (const [file, s] of this.open) if (s.keys.has(key)) this.open.delete(file);
  }
}

function resume(file: string): CaptureState {
  const state: CaptureState = { seq: 0, prev: '', bytes: 0, truncated: false, keys: new Set() };
  if (!existsSync(file)) return state;
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
  state.seq = lines.length;
  state.bytes = statSync(file).size;
  const last = lines.at(-1);
  if (last !== undefined) {
    state.prev = chainKey(last);
    try { state.truncated = (JSON.parse(last) as { truncated?: unknown }).truncated === true; } catch { state.truncated = true; }
  }
  return state;
}
