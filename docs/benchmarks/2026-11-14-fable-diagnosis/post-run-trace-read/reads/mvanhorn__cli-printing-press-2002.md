# mvanhorn__cli-printing-press-2002
Passes: X 2 of 2, Y 1 of 2
Fault named in the instruction: yes (the instruction names `InferEndpointTemplateVarsFromBaseURLs` in `internal/spec/spec.go` and says `Generator.New` must call it)
- Y-a1 FAIL: other. It wrote the inference in `spec.go` but then moved the call into `Validate()` and also added a new `resolveBaseURL` method to the generated client template, then hit the time limit while running the full test suite. The trace does not make clear whether `Generator.New` itself still calls the inference, so the exact cause is not visible.
Passing tries did differently: The passing tries (both X, and Y-a2) called the inference directly in `Generator.New` plus the three spec parsers, and left the client templates alone, noting that the existing `buildURL` resolver already turns on once the vars are filled.
Rating: WEAK, favours X. Y-a2 did the same thing as the X tries and passed, so the split comes down to one Y try that changed more than it needed and moved the call site.
