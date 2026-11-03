# gsta-135 discovery stores

Twelve captured session stores, one per trial directory. Each `known.json` says which fields come from the discovery report and which come from running `scripts/gsta-135/evidence.ts` on the store.

**Redaction, 2026-11-02.** Four stores held the operator's git author line (name and personal email) inside captured `git log` output: `gsta135-hermes-t1-none`, `gsta135-hermes-t2-gstack`, `gsta135-hermes-t2-none` and `gsta135-openclaw-t1-gstack`.
- The author was replaced in place with `Example Author <author@example.invalid>`. Regenerating the stores would have needed paid calls.
- Hermes: sqlite UPDATE of the message text, both full-text indexes rebuilt and integrity-checked, then VACUUM. OpenClaw: the same text in two runtime events and one zstd-compressed transcript event (re-compressed, byte count updated), then VACUUM.
- `store.sha256` and `store.bytes` in those four `known.json` files were re-derived. Every other derived field still reproduces unchanged.
- The published receipts under `docs/tool-discipline/receipts/gsta-135/` keep the original store hashes.
