// Audit 1 helper: the save turn's gbrain calls for every recalled trial, from the raw turn files.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTurn, isGbrainCall, hasToken } from '<controller-work>/run-wt/scripts/gbrain-install/transcript.ts';
const o = JSON.parse(readFileSync('<controller-work>/audits/scratch/recall-events.json', 'utf8'));
const out: any[] = [];
for (const t of o) {
  const turns = JSON.parse(readFileSync(join(t.dir, 'install-turns.json'), 'utf8'));
  const save = turns.filter((x: any) => x.role === 'save');
  const evs = save.flatMap((x: any) => parseTurn(t.harness, join(t.dir, 'logs'), x.turn, x.session));
  out.push({ trial_id: t.trial_id, calls: evs.filter(isGbrainCall).map((e: any) => ({ kind: e.kind, name: e.name, input_has_nonce: hasToken(e.input, t.nonce), is_error: e.is_error, input: e.input.slice(0, 600), output: e.output.slice(0, 1500) })) });
}
writeFileSync('<controller-work>/audits/scratch/save-events.json', JSON.stringify(out, null, 1));
