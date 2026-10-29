// A keyless stand-in for the model in tests/v03-gen-world.test.ts. It answers each page brief with canned text that
// carries the brief's required strings, except that it leaves out a ticket number on the first try (the retry path)
// and always leaves out customer contact names (the templated fallback path). Every page carries PLANTED_MARKER so the
// test can prove that page text never reaches stdout or stderr.

import { createHash } from 'node:crypto';
import type { Transport } from '../../scripts/v03/llm.ts';

export const PLANTED_MARKER = 'PLANTED-MARKER-QX7731';

export const fakeTransport: Transport = async (req) => {
  const h = createHash('sha256').update(req.prompt).digest('hex').slice(0, 8);
  const retry = req.prompt.includes('Your previous draft left out');
  const contactNames = [...req.prompt.matchAll(/^- "([^"]+)": \1 \(/gm)].map((m) => m[1]!);
  const values = [...req.prompt.matchAll(/^- "([^"]+)": /gm)].map((m) => m[1]!)
    .filter((v) => !(v.startsWith('PD-') && !retry))
    .filter((v) => !contactNames.includes(v));
  if (req.prompt.includes('Output: JSON only')) {
    const handle = req.prompt.match(/Authors must be handles from this list: (\S+) \(/)?.[1] ?? 'nobody';
    const messages = [{ author: handle, time: '09:00', text: 'Morning all, ' + PLANTED_MARKER + ' check-in ' + h + '.' },
      ...values.map((v, i) => ({ author: handle, time: '09:' + String(10 + i).padStart(2, '0'), text: 'Noting this for the team: ' + v + '.' }))];
    return JSON.stringify({ messages });
  }
  return 'Canned page ' + h + '. ' + PLANTED_MARKER + '\n\n' + values.map((v) => '- Recorded: ' + v).join('\n') + '\n';
};
