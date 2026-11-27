// Email export writers: a Gmail-style mbox (X-Gmail-Labels), gbrain's email-thread-heading Markdown and a plain-text
// Outlook-style export. gbrain parses only the Markdown thread as a conversation.

import { createHash } from 'node:crypto';
import type { Email, Rendered } from './types.ts';
import { longDate, mboxDate, rfc2822, ymd, hm } from './time.ts';

export function mbox(name: string, emails: Email[]): Rendered {
  const out: string[] = [];
  const thread = emails[0]!.id;
  for (const e of emails) {
    out.push(`From ${e.fromAddr} ${mboxDate(e.at)}`, `X-GM-THRID: ${BigInt('0x' + createHash('sha256').update(thread).digest('hex').slice(0, 15)).toString().padStart(19, '1')}`, `X-Gmail-Labels: ${e.labels.join(',')}`,
      `Message-ID: <${e.id}@mail.example.com>`, `Date: ${rfc2822(e.at)}`, `From: ${e.fromName} <${e.fromAddr}>`, ...(e.sender ? [`Sender: ${e.sender}`] : []),
      `To: ${e.to.join(', ')}`, ...(e.cc?.length ? [`Cc: ${e.cc.join(', ')}`] : []), `Subject: ${e.subject}`, 'Content-Type: text/plain; charset="UTF-8"', '',
      ...e.body.split('\n').map((l) => (l.startsWith('From ') ? '>' + l : l)), '');
  }
  return { name, format: 'gmail-mbox', known: false, text: out.join('\n') };
}

export function emailThreadMd(name: string, emails: Email[], subject: string): Rendered {
  const out = [`# ${subject}`, ''];
  for (const e of emails) out.push(`## ${e.fromName} <${e.fromAddr}> · ${ymd(e.at)} ${hm(e.at)}`, '', e.body, '');
  return { name, format: 'email-thread-heading', known: true, text: out.join('\n') };
}

export function outlookTxt(name: string, emails: Email[]): Rendered {
  const out: string[] = [];
  for (const e of emails) {
    out.push(`From:\t${e.fromName} <${e.fromAddr}>`, `Sent:\t${longDate(e.at)}`, `To:\t${e.to.join('; ')}`, ...(e.cc?.length ? [`Cc:\t${e.cc.join('; ')}`] : []), `Subject:\t${e.subject}`, '', e.body, '', '_'.repeat(32), '');
  }
  return { name, format: 'outlook-text-export', known: false, text: out.join('\n') };
}
