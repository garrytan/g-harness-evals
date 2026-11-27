// Notes page writer: a markdown page an agent wrote for the owner (a brainstorm, a recap, a news-alert digest), with no
// speaker labels. gbrain reads markdown pages natively, so the format is known to it.

import type { Rendered } from './types.ts';

export const notesPage = (name: string, title: string, blocks: string[]): Rendered => ({
  name, format: 'markdown-notes-page', known: true,
  text: [`# ${title}`, '', ...blocks.flatMap((b) => [b, ''])].join('\n'),
});
