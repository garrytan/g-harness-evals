# internal-task hand-check labelling rules (blind)

You label the items in the labels template (sample.ts writes it as labels-template.jsonl). Do NOT open sample/sample.jsonl, labels.ndjson, rates.*, trials.ndjson, rows.ndjson or anything under scripts/tool-discipline/: they carry the classifier's answers, and this check must be blind.

For each item, set every field in "label" to true or false, or to "unknown" when the receipt cannot decide it. Set "labeller" to your model id. Use "notes" for one short reason whenever a label is true or unknown.

You may open the source receipt to check context. For source=events the locator is a path relative to the repository root plus #seq (the line or sequence in events.jsonl). For source=gsta135 the locator points into docs/tool-discipline/receipts/gsta-135/<run>/evidence/<trial>.txt (the labellers read the same files from the Captain drive copy). Native discovery stores are also in tests/fixtures/gsta-135. Read-only.

## Kinds (per call)
- **phantom_tool**: the model called a tool name that does not exist or was not offered (the harness answered "not found" / "unknown tool" for the tool itself, e.g. "Tool skills_read not found"). A missing file, channel or user is NOT a phantom tool.
- **malformed_args**: the call was rejected for its arguments (missing required, unknown property, wrong type, invalid_params, schema error), or the arguments plainly violate the tool's schema.
- **wrong_identifier**: arguments are well formed but name a channel, file, folder, user, page or recipient that does not exist (e.g. *_not_found, unknown_recipient, a handle used where a channel id is needed).
- **denied**: a permission or scope refusal for something that exists: forbidden, not_in_channel, permission_denied, scope_denied, fenced, an approval prompt that blocked the action. A "denied" outcome whose error is *_not_found or unknown_recipient is a wrong_identifier, NOT denied.
- **mangled_helper**: a gstack helper (gstack-skill-start, $GSTACK_ROOT/bin/*, /opt/gstack/bin/*, ~/.claude/skills/gstack/bin/*) invoked in a form that differs from the skill's documented command: piped (e.g. | head -40), with a redirect or wrapper that loses the helper's own exit code (|| true, ; echo, tee), wrong or missing flags, or a wrong path. Plain correct invocations are false. If the command text is clipped (ends with " ...") so the form cannot be seen, use "unknown".

## Trial items (item_type = trial), if present
- **skipped_start**: the trial opened a gstack SKILL.md (any read of a SKILL.md path under a gstack skill directory with an ok result) and made no gstack-skill-start call before its final answer. Late starts (after the first task action) count as attempted, not skipped; note "late". Unknown if the read result or the rest of the transcript is not visible.

Write all items, in the template's order, as JSON lines to the output path you were given. Do not edit the template.

## Disclosures

gstack is Garry Tan's own project.
