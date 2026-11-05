/** Leak tripwire: markers (hidden facts, answer keys, task ids) that must never appear in a request body. JSON may write any character of a
 *  marker as a \u escape, so the text is read as sent and again with every \u escape decoded, whatever number of backslashes precedes it:
 *  a marker inside a string that was JSON-encoded once or several times is found with no parsing and no depth limit. The match starts at
 *  the first backslash of a run, so a long run of backslashes costs linear time. */
export function findLeaks(text: string, markers: readonly string[]): string[] {
  const decoded = text.includes('\\') ? text.replace(/(?<!\\)\\+u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : text;
  const out: string[] = [];
  for (const m of markers) if (m && (text.includes(m) || decoded.includes(m)) && !out.includes(m)) out.push(m);
  return out;
}
