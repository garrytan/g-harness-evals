# make-doom-for-mips: blind trace read

## 1. What made the task hard

The agent has to cross-compile all of doomgeneric into a bare-metal MIPS ELF for a supplied vm.js. The source expects a my_stdlib.h that is not there, so the agent must write a freestanding libc (stdio, malloc, printf and friends) on the VM's custom syscalls. The VM also has traps that only careful reading reveals, as found in the traces: no FPU (soft-float helpers needed), entry at the symbol `main`, only .text/.rodata/.data loaded, beq/bne comparing mixed JS number representations, broken swl, and an uninitialised $gp. The grader is the same as the MIPS-interpreter task: it polls for /tmp/frame.bmp (30 s cap), waits 1 s, kills the VM, and needs the I_InitGraphics line in stdout plus a title frame within 95% of the reference. So a /tmp/frame.bmp left by the agent's own test runs makes the 1 s window start immediately. The agent limit is 900 s against an expert estimate of 480 minutes. The fastest tries reached a working ELF at about 12.7 minutes, so the limit barely fits honest work.

## 2. Tries

**X-1: FAIL, MODEL-SLOW-PROGRESS** (working ELF, but killed mid-check with a stale frame on disk)
- 1.3m: installs clang/lld; 4.0m fetches compiler-rt soft-float sources; 5.6m to 8.3m writes my_stdlib.h/.c.
- 8.6m: plans an assembly post-processor because "the VM compares some branch operands inconsistently"; 10.3m to 12.0m fixes swl sequences and trap padding flagged by its own ELF checker.
- 12.7m to 14.7m: a `timeout 120 node vm.js` run blocks for 2 minutes. It reaches I_InitGraphics and writes /tmp/frame.bmp. 14.9m: "The title screen renders correctly."
- 15.0m: starts `timeout 900 node vm.js` in the background plus 30 s frame snapshots. The harness timeout then hits.
- Verifier: test_frame_bmp_exists and similarity PASS; "FAILED test_vm_execution - Expected text not found in output". The frame on disk was present before the grader's VM started, so the 1 s window ended before I_InitGraphics printed. The trace does not show how long a clean boot to the first frame takes under the provided vm.js, so it is not certain that deleting the file would have passed.
- Time: about 2.5 min blocked on commands (apt 0.5, the 120 s run 2.0), about 4 to 5 min in long turns (1.9-3.8, 6.0-8.3), the rest active. Verified the title frame visually, but never ran a grader-like check from a clean /tmp.

**X-2: FAIL, MODEL-SLOW-PROGRESS** (near-identical path and failure)
- 2.4m: installs gcc-mipsel; 3.5m to 4.0m fetches compiler-rt; 6.0m to 8.8m writes libc and crt0.
- 9.7m: fixasm.py works around the VM's BEQ/BNE representation bug; 12.4m: rewrites trap instructions.
- 12.7m to 14.8m: a `time timeout 120 node vm.js` run blocks for 2 minutes. 14.8m: "The title screen renders correctly."
- 14.9m: `(timeout 600 node vm.js ... &)` plus a 19 x 30 s snapshot loop. Killed by the timeout.
- Verifier: exists and similarity PASS; test_vm_execution FAILS with "Expected text not found". Same stale-frame mechanism.
- Time: about 2.5 min blocked on commands, about 3 min in long turns, the rest active. Verification was the same as X-1.

**Y-1: FAIL, MODEL-SLOW-PROGRESS**
- 1.3m to 1.4m: installs gcc-mipsel. Then a 5.3-minute gap to the next call at 6.7m.
- 10.0m: "Now writing the freestanding libc and build files". 10.5m: my_stdlib.h; 14.1m: my_stdlib.c (3.5-minute write turn).
- 14.5m: a small patch to my_stdlib.c is the last action. No Makefile, no compile, no ELF.
- Verifier: "TimeoutError: Timeout waiting for frame.bmp"; all 3 tests fail.
- Time: almost no command waiting. Roughly 11 of 15 minutes went to a few very long generation turns (11 tool calls, 103K output tokens in 10 requests). Nothing was verified.

**Y-2: FAIL, MODEL-SLOW-PROGRESS**
- 0.2m to 3.8m: reads vm.js, then a 3.6-minute gap. 4.0m: installs gcc-mipsel.
- 8.3m to 11.9m: writes the libc, syscalls.S and Makefile. 13.3m: "First compile pass succeeded for all DOOM sources", with soft-float link errors.
- 14.4m: writes softfloat.c and host-tests it ("0 failures after 4000000 iterations").
- 15.3m: links doomgeneric_mips; its verifier warns about swl/swr. 15.6m: inspecting swl sequences. It never ran the ELF in vm.js.
- Verifier: TimeoutError waiting for frame.bmp. The trace does not show why the linked ELF produced no frame in 30 s (unfixed swl, a crash, or speed).
- Time: almost no command waiting. Most of it went to long generation turns (16 tool calls, 97K output tokens). Verified soft-float on the host and the instruction mix statically, never a run.

## 3. X versus Y

Both X tries worked in many short steps (38 and 47 tool calls), reached a running ELF that rendered the correct title frame by about 12.7 minutes, and then lost the run to timing: a 2-minute fixed `timeout 120` run, then a long background validation started with no time left, which left /tmp/frame.bmp in place. Both Y tries spent long single turns reading and writing (3.5 to 5.3 minute gaps, about 100K output tokens in 10 to 13 requests) and never ran a binary. The pacing difference is consistent and decided how close each got (X passed 2 of 3 tests, Y passed 0), but not the reward, which was 0 for all four. **WEAK.**

## 4. Environment vs model

Mostly the environment and task design. A 15-minute limit for 8-hour expert work leaves no slack, and the grader's existence-poll lets a leftover test frame fail an otherwise correct build. The agents' pacing still separated "almost passed" from "never built".
