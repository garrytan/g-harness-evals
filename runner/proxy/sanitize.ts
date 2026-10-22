/** Leak tripwire: markers (hidden facts, answer keys, task ids) that must never appear in a request body. */
export function findLeaks(text: string, markers: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of markers) if (m && text.includes(m) && !out.includes(m)) out.push(m);
  return out;
}
