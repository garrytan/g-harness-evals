# Fake harness

A shell adapter that follows the [adapter protocol](../../docs/adapters.md) with no model, so the protocol itself can be tested without a key or a network. `tests/adapter-conformance.test.ts` runs it both as a process and as a container.

Markers in `instruction.md` drive it: `[fake:harness_error]` exits 2, `[fake:model_error]` exits 3, `[fake:sleep N]` makes the turn take N seconds so the wall clock can be tested, and any instruction mentioning `hello.txt` writes `hello` to that file. State goes to `/harness-state/fake/session.json`.
