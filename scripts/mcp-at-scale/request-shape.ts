// What one captured model request shows the model: the tools it declares (with their schemas) and all of its text.
// Shared by listing-map.ts, search-script.ts and search-effort.ts.

/** Every tool the request declares to the model, with its schema: Anthropic, Responses (namespaces and Codex's
 *  additional_tools input items included), Chat Completions and Gemini function declarations. */
export function declaredWithSchemas(body: Record<string, any>): Array<{ name: string; schema: any }> {
  const out: Array<{ name: string; schema: any }> = [];
  const add = (ts: any[], prefix = '') => {
    for (const t of ts ?? []) {
      if (!t || typeof t !== 'object') continue;
      if (t.type === 'namespace' && Array.isArray(t.tools)) { add(t.tools, (t.name ?? '') + '__'); continue; }
      if (Array.isArray(t.functionDeclarations)) { for (const f of t.functionDeclarations) out.push({ name: prefix + f.name, schema: f.parametersJsonSchema ?? f.parameters ?? null }); continue; }
      const name = t.name ?? t.function?.name;
      if (name) out.push({ name: prefix + name, schema: t.input_schema ?? t.parameters ?? t.function?.parameters ?? t.inputSchema ?? null });
    }
  };
  add(Array.isArray(body.tools) ? body.tools : []);
  for (const it of Array.isArray(body.input) ? body.input : []) if (it?.type === 'additional_tools' && Array.isArray(it.tools)) add(it.tools);
  return out;
}

/** Every string in the body, joined: system prompts, messages, tool descriptions, schemas. */
export function bodyText(v: unknown, acc: string[] = []): string[] {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) for (const x of v) bodyText(x, acc);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { acc.push(k); bodyText(x, acc); }
  return acc;
}
