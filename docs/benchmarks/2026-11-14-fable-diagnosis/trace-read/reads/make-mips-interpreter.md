# make-mips-interpreter: blind trace read

## 1. What made the task hard

The agent must write a MIPS32r2 little-endian user-mode emulator in JavaScript (delay slots, unaligned loads and stores, a few FPU ops, a 1 GB .bss) and work out the binary's home-grown syscall layer from my_stdlib.c (x86-64 syscall numbers in $v0). The binary writes /tmp/frame.bmp itself. The instruction never names that path or the check, but the grader starts `node /app/vm.js`, polls until /tmp/frame.bmp exists (30 s cap), waits 1 s, kills the VM, and then requires the "I_InitGraphics: DOOM screen size" line in stdout and at least 95% similarity to a reference title frame. The hidden trap is that a /tmp/frame.bmp left over from the agent's own testing short-circuits the wait. That is harmless only if a fresh VM boots and overwrites it within that 1 s window. The limit is 1800 s (expert estimate 480 min). Honest work produced a passing VM in 6 to 8 minutes for both Y tries, and in about 6.5 minutes for both X tries before they kept going.

## 2. Tries

**X-1: FAIL, MODEL-SLOW-PROGRESS** (timed out during unrequested hardening; the core VM already worked)
- 6.4m: "the title screen loads in about 0.5 s and the 640x400 DOOM title frame is correct". The required work was done here.
- 12.8m: "I'm adding a block compiler to speed up later frames". Then threshold tuning, CPU profiles, V8 deopt checks, memory-limit fallbacks, and a hand-built MIPS instruction self-test (29.9m, "116/116 passed").
- 21.4m and 23.8m: background runs `--max-frames 3000` and `--interp --max-frames 240 --save-frames /tmp/fi` overlap on a 1-CPU box. A contended boot took "1.81s" (23.5m). At 30.1m /tmp/fi held 231 of 240 frames, so that run was probably still going when the 1800 s limit hit.
- Verifier: "FAILED test_vm_execution - Expected text not found" and "Score: 0.7739, req: 0.95". The frame check passing while the stdout check fails means /tmp/frame.bmp already existed (a later demo frame from its own runs) and the fresh VM did not reach I_InitGraphics within the 1 s window. Whether the agent's background processes were still alive during grading is not shown in the trace.
- Time: about 9 min blocked on foreground runs (6.5-9.2, 17.0-18.9, 19.2-20.2, 21.5-23.5, and others), plus about 6 min in long thinking or write turns (0.8-3.6, 3.7-5.9, 9.4-12.8). The rest was active editing. It never sent a final message, never removed /tmp/frame.bmp, and never ran a grader-like check.

**X-2: PASS**
- 6.6m: first frame is the correct title screen. 10.1m: "Frame 1 matches an independent Python decode pixel-for-pixel".
- 11.1m to 17.2m: cross-compiled C instruction tests at O0/O1/O2/Os against native output. 19.9m: finds and rewrites a broken low-memory fallback and switches console output to "unbuffered pass-through".
- 23.2m and 26.8m: simulates the grader (wait for frame, sleep 1 s, kill, check text): "first frame after 0.67s ... True". Then `rm -rf ... /tmp/frame.bmp /app/.savegame`.
- 27.0m: final message, about 3 minutes before the limit. All 3 tests pass.
- Time: about 5 min blocked on runs (6.7-9.0, 12.3-14.3), about 6 min in long turns, the rest active. Verified exactly what the grader checks, from a clean state.

**Y-1: PASS**
- 2.1m to 3.9m: writes a basic-block-to-JS translator VM in one pass. 4.0m: "Boots and renders first frames in ~2s".
- 4.3m: views the title frame. 4.4m to 5.5m: checks demo frames 60/90/120; "the attract demo holds sync across 1,200 frames".
- 5.7m: runs from /tmp with a 5 s timeout and checks the console log. 5.9m: cleans up scratch files but leaves that run's /tmp/frame.bmp.
- Time: about 1.1 min waiting on the 120-frame run, about 3 min in thinking or write turns, done at 6.1m. Verified title and gameplay frames and boot output. It never ran the exact grader sequence. The leftover frame was harmless because a fresh boot overwrites it in under a second.

**Y-2: PASS**
- 1.5m to 3.1m: writes a plain interpreter. 3.3m: "runs at about 230 MIPS, and it got three frames in under 2 seconds".
- 3.6m: correctly diagnoses garbage console bytes as the guest's own puts bug. 3.7m: title frame correct. 4.7m: frames 40/80 show demo gameplay.
- 4.8m: a 20 s run confirms the I_InitGraphics line and leaves /tmp/frame.bmp. 5.2m: syntax check. 5.4m: done.
- Time: about 0.9 min waiting, the rest active. Verification was the same depth as Y-1.

## 3. X versus Y

Both X tries had a correct VM by about 6.5 minutes. Both then spent 20 or more extra minutes on unrequested work: a JIT or speed work, cross-compiled instruction test suites, memory-limit fallbacks, and pipe and closed-stdout edge cases. They ran at 179K and 189K peak context, against 72K and 68K for Y. Both Y tries checked the title frame and a few demo frames, then stopped at 5 to 6 minutes. That scope expansion cost X-1 the run (timeout with a stale frame and overlapping background runs). X-2 survived only because its last step was a grader-style check plus cleanup, with 3 minutes to spare. **STRONG** for the scope and pace difference.

## 4. Environment vs model

This measured the agents. The environment was clean, and 30 minutes is ample (Y finished in about 6), so the one failure came from the agent's own time management and leftover state.
