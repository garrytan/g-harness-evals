# PerryTS__perry-3982
Passes: X 2 of 2, Y 1 of 2
Fault named in the instruction: yes (the issue names the gate in `crates/perry-hir/src/lower/expr_member.rs`)
- Y-a1 FAIL: other. It changed the right gate, letting plain reads through on Node built-ins and re-applying it at call, `new` and tagged-template sites, and its own checks passed; the trace does not show why the verifier failed it. One visible difference is that both X tries also kept read-through uses like `ns.absent.x` strict and rewrote the module sweep test to use that form, while Y-a1 made the sweep expect bare reads to compile and did not mention read-through.
Passing tries did differently: The X tries tracked which member expressions sit in a strict position (callee, constructor, receiver of another member, tag) and kept all of those rejected; Y-a2 reached a similar outcome after probing many access shapes, though it ran into the time limit.
Rating: WEAK, favours X. All four tries took nearly the same approach in the same file, and the read-through difference is a plausible but unconfirmed reason for the one failure.
