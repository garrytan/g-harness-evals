// Chat export writers for 1:1 chats, group chats and iMessage. Line shapes follow gbrain's conversation-parser patterns
// (src/core/conversation-parser/builtins.ts: whatsapp-us, whatsapp-iso, telegram-text-export, signal-export, discord-export,
// imessage-slack) where gbrain has one; the CSV, Slack export JSON, Messenger JSON and the alternate iMessage layout are ours.

import type { Line, Rendered } from './types.ts';
import { euDate, h12, hm, hms, isoLocal, monDate, usDate, usDatePadded, utc, ymd } from './time.ts';

export const whatsappUs = (name: string, lines: Line[]): Rendered => ({
  name, format: 'whatsapp-us', known: true,
  text: lines.map((l) => `${usDate(l.at)}, ${h12(l.at)} - ${l.label}: ${l.text}`).join('\n') + '\n',
});

export const whatsappIso = (name: string, lines: Line[]): Rendered => ({
  name, format: 'whatsapp-iso', known: true,
  text: lines.map((l) => `[${euDate(l.at)}, ${hms(l.at)}] ${l.label}: ${l.text}`).join('\n') + '\n',
});

export function telegramText(name: string, lines: Line[], title: string): Rendered {
  const out = [title, ''];
  for (const l of lines) {
    out.push(`${l.label}, [${monDate(l.at)} at ${h12(l.at, true)}]`);
    if (l.forwardedFrom) out.push(`[Forwarded from ${l.forwardedFrom}]`);
    out.push(l.text, '');
  }
  return { name, format: 'telegram-text-export', known: true, text: out.join('\n') };
}

export const signalExport = (name: string, lines: Line[]): Rendered => ({
  name, format: 'signal-export', known: true,
  text: lines.map((l) => `${l.label} (${ymd(utc(l.at))} ${hms(utc(l.at))} UTC): ${l.text}`).join('\n') + '\n',
});

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export const csvExport = (name: string, lines: Line[]): Rendered => ({
  name, format: 'sms-backup-csv', known: false,
  text: ['date,time,from,body', ...lines.map((l) => [ymd(l.at), hms(l.at), l.label, l.text].map(csvCell).join(','))].join('\n') + '\n',
});

export function slackExportJson(lines: Line[], users: Array<{ id: string; name: string; real_name: string; display_name: string }>, day: string): Rendered[] {
  const byLabel = new Map(users.map((u) => [u.display_name, u]));
  const msgs = lines.map((l, i) => {
    const u = byLabel.get(l.label)!;
    return { type: 'message', user: u.id, text: l.text, ts: `${(utc(l.at) / 1000).toFixed(0)}.${String(100100 + i * 37).padStart(6, '0')}`, user_profile: { real_name: u.real_name, display_name: u.display_name, name: u.name } };
  });
  return [
    { name: 'users.json', format: 'slack-export-users-json', known: false, text: JSON.stringify(users.map((u) => ({ id: u.id, name: u.name, real_name: u.real_name, profile: { real_name: u.real_name, display_name: u.display_name } })), null, 2) + '\n' },
    { name: `${day}.json`, format: 'slack-export-channel-json', known: false, text: JSON.stringify(msgs, null, 2) + '\n' },
  ];
}

export function discordExport(name: string, lines: Line[], guild: string, channel: string): Rendered {
  const out = ['='.repeat(62), `Guild: ${guild}`, `Channel: General / ${channel}`, '='.repeat(62), ''];
  for (const l of lines) out.push(`[${usDatePadded(l.at)} ${h12(l.at)}] ${l.label}`, l.text, '');
  return { name, format: 'discord-export', known: true, text: out.join('\n') };
}

export function messengerJson(name: string, lines: Line[], title: string, participants: string[]): Rendered {
  const messages = [...lines].reverse().map((l) => ({
    sender_name: l.label, timestamp_ms: utc(l.at), ...(l.forwardedFrom ? { share: { share_text: `Forwarded from ${l.forwardedFrom}` } } : {}), content: l.text, is_geoblocked_for_viewer: false,
  }));
  return { name, format: 'messenger-json', known: false, text: JSON.stringify({ participants: participants.map((p) => ({ name: p })), messages, title, thread_path: `inbox/${title.toLowerCase().replace(/[^a-z0-9]+/g, '')}_1` }, null, 2) + '\n' };
}

export const imessageSlack = (name: string, lines: Line[]): Rendered => ({
  name, format: 'imessage-slack', known: true,
  text: lines.map((l) => `**${l.label}** (${ymd(l.at)} ${h12(l.at)}): ${l.text}`).join('\n') + '\n',
});

export function imessageAlt(name: string, lines: Line[], chat: string): Rendered {
  const out = [`Chat: ${chat}`, `Exported: ${isoLocal(lines.at(-1)!.at)}`, ''];
  for (const l of lines) out.push(`${ymd(l.at)} ${hm(l.at)} | From: ${l.label} | ${l.text}`);
  return { name, format: 'imessage-pipe-export', known: false, text: out.join('\n') + '\n' };
}
