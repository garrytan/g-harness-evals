# Pre-data note: cross-member recall rerun on harness-zero-h2h cr-01 to cr-04

Written 2026-11-09, before any trial of this rerun ran. It is not a preregistration of a new counted run. It is a small, dated, dev-only check of how much the cross-member recall defect cost the h2h gbrain readings. Its results will be reported next to the ceiling in [README.md](README.md#7-cross-member-gbrain-recall-in-member-sources-cells), and the h2h report stays as it is.

## What runs

- **Tasks:** harness-zero-h2h's cr-01, cr-02, cr-03 and cr-04 (v0.3 dev, as published), 3 repetitions each.
- **gbrain cells, changed in one setting only:** zero-lean-opus-gbrain, zero-lean-mcp-instructions-opus-gbrain and claude-code-opus-gbrain. These run with `gbrain.channel_remember: "conversation"`, so a remember in a shared channel is written to that channel's source and is recallable by every member whose grant covers it. Ingestion stays off, as published. Every other setting matches the published cells.
- **Baselines, unchanged:** zero-lean-opus and claude-code-opus with no brain, at the same 3 repetitions, so every reading is paired within this rerun.
- **Size:** 60 trials. That is about $11 at the published per-trial cost, under a ledger lease capped at $150 and run on Ubicloud.

## How it is read

- **Readings:** the same three gbrain readings as the h2h report: lean with MCP instructions minus lean, lean with gbrain minus lean, and Claude Code with gbrain minus Claude Code. Each is paired by task and repetition (12 pairs), with the h2h report's sign-flip method, seed 7 and 10,000 draws.
- **Exposure check first:** count the remember calls written to a channel source, and the later reads by another member that returned the saved text. If no read returned a saved fact, the fix did not reach the model, and the rerun says nothing about the ceiling.
- **Against the ceiling:** the published readings are +5.0, +1.7 and +3.3 points over 60 pairs, and the ceiling is +20.0, +16.7 and +10.0. The rerun's pass gain on these four tasks is reported against how much of that ceiling it reaches.

## What would change the FIX-METHOD verdict

The h2h verdict "gbrain, scoped and told: FIX-METHOD (dev)" changes only if both of these hold:

1. The exposure check shows saved facts being read back by another member.
2. A spliced reading has a 95% interval entirely above zero for at least one of the three readings. The spliced reading is the published 60 pairs with cr-01 to cr-04 replaced by this rerun's pairs, for both arms of that reading.

Then the verdict line gains a dated correction reading **KEEP (dev, after the recall fix)** for that arm, with the spliced numbers and the rerun's own 12-pair reading beside the original.

In every other case FIX-METHOD stands. If the pass gain is near zero with exposure confirmed, the correction says the defect was not what held gbrain back on these tasks. If exposure is missing, the correction says the rerun was uninformative and why.
