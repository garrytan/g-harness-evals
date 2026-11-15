// harness-evals delivery arm (HARN-61): the before-ready check of the OpenClaw hook. Reads the JSON of
// `openclaw plugins inspect he-steps-card --runtime --json` on stdin and prints "loaded he-steps-card" only when the runtime
// inspection loaded the plugin, it is enabled, and it registered before_prompt_build and its tool-result middleware.
// Otherwise it prints what is missing.
let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(raw.slice(raw.indexOf('{'))); } catch { console.log('unparsed inspect output'); return; }
  const p = j.plugin ?? j;
  const text = JSON.stringify(j);
  const status = p.status ?? p.state ?? null;
  const missing = [];
  if (!(status === 'loaded' || p.imported === true)) missing.push('status ' + status);
  if (p.enabled === false) missing.push('disabled');
  if (!text.includes('before_prompt_build')) missing.push('before_prompt_build');
  if (!/[Tt]ool[-_ ]?[Rr]esult[-_ ]?[Mm]iddleware|agentToolResultMiddleware/.test(text)) missing.push('tool-result middleware');
  console.log(missing.length ? 'not-loaded he-steps-card: ' + missing.join(', ') : 'loaded he-steps-card');
});
