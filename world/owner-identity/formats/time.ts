// Clock helpers for the owner-identity export writers. A time is a local wall-clock instant stored as epoch milliseconds
// read in UTC, so formatting never depends on the machine's time zone; utc() shifts it by the world's fixed offset.

export const OFFSET_MIN = -420;
export const ZONE = 'America/Los_Angeles';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function parts(at: number) {
  const d = new Date(at);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
}

export const utc = (at: number) => at - OFFSET_MIN * 60_000;
export const localAt = (iso: string) => Date.parse(iso + 'Z');
export const ymd = (at: number) => { const p = parts(at); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
export const hms = (at: number) => { const p = parts(at); return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`; };
export const hm = (at: number) => { const p = parts(at); return `${pad(p.h)}:${pad(p.mi)}`; };
export const h12 = (at: number, seconds = false) => {
  const p = parts(at);
  const h = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h}:${pad(p.mi)}${seconds ? ':' + pad(p.s) : ''} ${p.h < 12 ? 'AM' : 'PM'}`;
};
export const isoUtc = (at: number) => new Date(utc(at)).toISOString();
export const isoLocal = (at: number) => `${ymd(at)}T${hms(at)}-07:00`;
export const usDate = (at: number, fullYear = false) => { const p = parts(at); return `${p.mo}/${p.d}/${fullYear ? p.y : pad(p.y % 100)}`; };
export const usDatePadded = (at: number) => { const p = parts(at); return `${pad(p.mo)}/${pad(p.d)}/${p.y}`; };
export const euDate = (at: number) => { const p = parts(at); return `${pad(p.d)}/${pad(p.mo)}/${pad(p.y % 100)}`; };
export const monDate = (at: number) => { const p = parts(at); return `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}`; };
export const rfc2822 = (at: number) => { const p = parts(at); return `${DAYS[p.dow]}, ${pad(p.d)} ${MONTHS[p.mo - 1]} ${p.y} ${hms(at)} -0700`; };
export const mboxDate = (at: number) => { const u = utc(at); const p = parts(u); return `${DAYS[p.dow]} ${MONTHS[p.mo - 1]} ${pad(p.d)} ${hms(u)} ${p.y}`; };
export const longDate = (at: number) => { const p = parts(at); return `${DAYS_LONG[p.dow]}, ${MONTHS_LONG[p.mo - 1]} ${p.d}, ${p.y} ${h12(at)}`; };
export const icsUtc = (at: number) => isoUtc(at).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export const srtTime = (ms: number) => `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
