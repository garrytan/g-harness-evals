// Meeting export writers: a named-speaker transcript (gbrain's bold-name-no-time), a diarized one (speaker-letter-no-time),
// a Teams-style export (teams-export), an SRT caption file and an .ics invite (neither of which gbrain parses).

import type { Line, Rendered } from './types.ts';
import { h12, icsUtc, srtTime, usDate } from './time.ts';

export const boldName = (name: string, lines: Line[], title: string): Rendered => ({
  name, format: 'bold-name-no-time', known: true,
  text: [`# ${title}`, '', ...lines.map((l) => `**${l.label}:** ${l.text}`)].join('\n') + '\n',
});

export const speakerLetter = (name: string, lines: Line[], title: string): Rendered => ({
  name, format: 'speaker-letter-no-time', known: true,
  text: [`${title}`, '', ...lines.map((l) => `${l.label}: ${l.text}`)].join('\n') + '\n',
});

export const teamsExport = (name: string, lines: Line[]): Rendered => ({
  name, format: 'teams-export', known: true,
  text: lines.map((l) => `${l.label}, ${usDate(l.at, true)} ${h12(l.at)}: ${l.text}`).join('\n') + '\n',
});

export function srt(name: string, lines: Line[]): Rendered {
  const start = lines[0]!.at;
  const out: string[] = [];
  lines.forEach((l, i) => {
    const a = l.at - start;
    out.push(String(i + 1), `${srtTime(a)} --> ${srtTime(a + 4200)}`, `[${l.label}] ${l.text}`, '');
  });
  return { name, format: 'srt-captions', known: false, text: out.join('\n') };
}

export function ics(name: string, o: { uid: string; title: string; start: number; minutes: number; organizer: { name: string; email: string }; attendees: Array<{ name: string; email: string; self?: boolean }> }): Rendered {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Owner Identity World//Calendar 1.0//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${o.uid}`, `DTSTAMP:${icsUtc(o.start - 86_400_000)}`, `DTSTART:${icsUtc(o.start)}`, `DTEND:${icsUtc(o.start + o.minutes * 60_000)}`, `SUMMARY:${o.title}`,
    `ORGANIZER;CN=${o.organizer.name}:mailto:${o.organizer.email}`,
    ...o.attendees.map((a) => `ATTENDEE;CN=${a.name};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED${a.self ? ';X-SELF=TRUE' : ''}:mailto:${a.email}`),
    'END:VEVENT', 'END:VCALENDAR'];
  return { name, format: 'ics-invite', known: false, text: out.join('\r\n') + '\r\n' };
}

