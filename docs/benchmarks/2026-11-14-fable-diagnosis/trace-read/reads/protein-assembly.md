# protein-assembly

## 1. Task and whether task difficulty mattered
Design a codon-optimized DNA gBlock (≤ 3000 nt, 30–70% GC in every 50-nt window, no start/stop codons or N-terminal methionines) in `/app/gblock.txt` encoding a five-part fusion protein (`antibody binder - donor - dhfr - acceptor - molecule binder` separated by 5–20 aa GS linkers) matching PDB, FPbase (505 nm / 610 nm), `antibody.fasta`, and `plasmid.gb` specs. Task difficulty never mattered because all four tries were blocked by the `[bio]` safety classifier on the initial prompt with zero tool calls.

## 2. Per-try classification

### X-1 — Outcome: FAIL (verifier reward 0) | Category: ENV-SAFETY-FILTER
- `[0.0m]` First filter stop came after 0 tool calls and 0.0 minutes: `SYSTEM: [MODEL]'s safeguards stopped the response above · continuing once with that noted`.
- `[0.0m]` Second filter stop terminated the session (`"stop_reason":"refusal"`, `"safety_stops":2`, 0 output tokens): `API Error: [MODEL]'s safeguards flagged this message (https://www.anthropic.com/legal/aup)... Details: \`[bio]\``.
- Verifier failed with `AssertionError: File /app/gblock.txt does not exist.`

### X-2 — Outcome: FAIL (verifier reward 0) | Category: ENV-SAFETY-FILTER
- `[0.0m]` First filter stop came after 0 tool calls and 0.0 minutes: `SYSTEM: [MODEL]'s safeguards stopped the response above · continuing once with that noted`.
- `[0.1m]` Second filter stop terminated the session (`"stop_reason":"refusal"`, `"safety_stops":2`, 0 output tokens): `API Error: [MODEL]'s safeguards flagged this message (https://www.anthropic.com/legal/aup)... Details: \`[bio]\``.
- Verifier failed with `AssertionError: File /app/gblock.txt does not exist.`

### Y-1 — Outcome: FAIL (verifier reward 0) | Category: ENV-SAFETY-FILTER
- `[0.0m]` First filter stop came after 0 tool calls and 0.0 minutes: `SYSTEM: [MODEL]'s safeguards stopped the response above · continuing once with that noted`.
- `[0.1m]` Second filter stop terminated the session (`"stop_reason":"refusal"`, `"safety_stops":2`, 0 output tokens): `API Error: [MODEL] can't help with this. Start a new session to continue... Details: \`[bio]\``.
- Verifier failed with `AssertionError: File /app/gblock.txt does not exist.`

### Y-2 — Outcome: FAIL (verifier reward 0) | Category: ENV-SAFETY-FILTER
- `[0.0m]` First filter stop came after 0 tool calls and 0.0 minutes: `SYSTEM: [MODEL]'s safeguards stopped the response above · continuing once with that noted`.
- `[0.1m]` Second filter stop terminated the session (`"stop_reason":"refusal"`, `"safety_stops":2`, 0 output tokens): `API Error: [MODEL] can't help with this. Start a new session to continue... Details: \`[bio]\``.
- Verifier failed with `AssertionError: File /app/gblock.txt does not exist.`

## 3. X versus Y
**NONE** — Both X and Y were stopped at 0.0–0.1 minutes with 0 tool calls, 0 output tokens, and 2 safety stops in every try.

## 4. Environment vs model
Pure environment block: the API `[bio]` safety classifier rejected the prompt before either model produced any tokens or tool calls in all four tries.
