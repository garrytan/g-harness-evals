# ivov__lisette-627
Passes: X 1 of 2, Y 2 of 2
Fault named in the instruction: partly (it explains the name clash and suggests type-position precedence, but names no file; all four tries changed resolve_type_with_arity in crates/semantics/src/checker/registration/convert.rs)
- X-a2 FAIL: other. It made the same kind of change as the passing tries (fall back to the prelude type when the name found is a value) and its own regression test passed; the one visible difference is that it still requires the prelude type's arity to match, where X-a1 does not check arity and Y-a1 skips the check for values. I cannot tell from the trace whether that is what the grader caught.
Passing tries did differently: same file and function with near-identical logic; Y-a1 also noted and covered pub fn signatures registered after the clashing constant, and Y-a2 also handled a Go constant named Unit.
Rating: NONE, favours neither. All four tries found the same spot and wrote similar fixes, so the single failure looks like a small detail rather than an agent-level difference.
