# install-windows-3.11: blind trace read

## 1. What made the task hard

The container has no QEMU at all; apt gives 8.2.2 while the spec says the image is "known to be compatible with QEMU 5.2.0", so an honest try either builds 5.2.0 from source (7 to 8 minutes of compile on this box) or gambles on 8.2.2. The guest image is picky about emulated hardware: it stops at a "No RTL8029 adapter" prompt without `ne2k_pci`, and on some configs Windows aborts or hangs without a Sound Blaster (`-device sb16`). Every try also hit a display problem: the image's Cirrus driver draws no text on QEMU's Cirrus card (both 8.2.2 and stock 5.2.0); the X tries traced this to a blit check in `cirrus_vga.c` and patched QEMU, the Y tries accepted it. The hidden trap is the last grader test: it sends F1, Alt+Tab, F10, Alt+F4 and Ctrl+Esc through the monitor and needs at least one to change at least 10% of the VNC screenshot within 2 seconds. That is much stronger than "the VM accepts programmatic keyboard input", and no try checked it. A second small trap: the shipped `/etc/nginx/nginx.conf` ignores sites-enabled and already proxies port 80 to 127.0.0.1:8080; all four tries found this and ran websockify on 8080. The limit is 60 minutes; honest work took 10 to 29 minutes, so time was never the constraint.

## 2. Per try

### X-1: PASS (4/4 tests), category PASS
- 0.3m to 2.2m: installed apt QEMU 8.2.2; found the RTL8029 prompt and added `ne2k_pci`.
- 3.9m: "building QEMU 5.2.0 from source, the version the image is known to work with"; the build ran in the background while it set up nginx/noVNC, then it waited 5.4m to 11.8m in an until-loop on the build log.
- 13.5m: added SB16 and AdLib, reached Program Manager with no text; 15.4m to 21.0m: ran parallel variant VMs, then traced the Cirrus blitter ("QEMU's blit check rejects the zero source pitch").
- 21.3m to 22.9m: three-line patch to `cirrus_vga.c`, rebuilt; "Program Manager now renders fully". 24.5m: `sendkey alt-f` opened the File menu.
- Time: about 25 minutes of session, about 8 of them waiting on compiles. Verified: desktop with text, VNC, nginx websocket upgrade (101), and a monitor keystroke that changes the screen. It did not test the grader's five keys or the 10% threshold.

### X-2: PASS (4/4 tests), category PASS
- 1.1m: its own `pkill -f` killed its shell; recovered.
- 3.4m: "Windows is crashing during enhanced-mode startup on QEMU 8.2.2"; downloaded 5.2.0 source in the background while testing six variants on 8.2.2.
- 4.9m: "its boot hangs intermittently" on 8.2.2, so it built 5.2.0 (foreground compile 5.6m to 12.8m).
- 14.9m to 22.9m: parallel RAM/VRAM variants, then `-d unimp` tracing, then the same diagnosis as X-1 ("QEMU rejects blits with a zero source pitch"); patched and rebuilt by 25.2m.
- 26.5m: `sendkey alt-f` changed a bbox (34,50,233,229); two `esc` presses restored the original desktop (diff None).
- Time: about 27 minutes, about 8 of them blocked on the compile. Verified the same things as X-1, plus removing apt 8.2.2 and making the start script idempotent. It did not test the grader's key set.

### Y-1: FAIL (3/4 tests), category MODEL-WRONG-APPROACH (low confidence)
- 0.3m: installed apt QEMU 8.2.2 and never tried 5.2.0, though the spec names it.
- 1.3m to 3.9m: added `ne2k_pci`; on `-cpu pentium` the guest sat in a halt loop; it disassembled the loop and read guest memory.
- 5.3m: parallel variants showed "missing Sound Blaster driver was the fix"; restarted the main VM on 8.2.2 with `-cpu 486 -device sb16`.
- 6.8m: `sendkey alt-f` opened the File menu; 7.0m: checked QMP, nginx 200, websocket 101 and the RFB banner; finished at 7.2m, noting that window titles were blank.
- Verifier: "No key caused >=10% image difference" on test_windows_keys_with_visual_feedback; the other three tests passed.
- Time: about 7 minutes, almost all active, with roughly 2 minutes of boot waits. Verified that one small keystroke reached the guest; it did not test the grader's keys. The trace does not show why none of F1, Alt+Tab, F10, Alt+F4 or Ctrl+Esc moved 10% of the screen. The one setup choice that separates this try from the three passes is stock QEMU 8.2.2 instead of 5.2.0; X-2 reported that 8.2.2 "hung intermittently during Windows startup". If the guest was healthy at grading time, this would instead be GRADER-REJECTED-CORRECT.

### Y-2: PASS (4/4 tests), category PASS
- 0.2m: "I'll try [8.2] first... and only fall back to building 5.2.0 if it doesn't work"; 0.8m: found the 8080 nginx proxy.
- 2.4m to 3.1m: on 8.2.2 with `ne2k_pci` it saw a dialog with no text, and `sendkey ret` reached Program Manager.
- 3.3m to 11.9m: built 5.2.0 in a foreground `make` (about 8 minutes blocked). 13.0m: "same rendering, so the emulator version isn't the cause"; it switched to the default CPU with 64 MB and no SB16.
- 14.0m to 14.5m: dismissed the startup dialog with `sendkey ret`; `sendkey right` moved the icon selection (diff bbox 153,287,263,302); checked QMP, nginx and the image timestamp.
- Time: about 15 minutes, about 8 of them blocked on the compile. It accepted a desktop with no text and stated that plainly in its summary. It did not test the grader's key set.

## 3. X versus Y on this task

Both X tries built QEMU 5.2.0, found the root cause of the missing text and patched QEMU's Cirrus code, then finished at 25 to 27 minutes. Both Y tries stopped at "keys reach the guest" and accepted a textless desktop, finishing at 7 and 15 minutes; one of them never left the apt 8.2.2 build. So X consistently dug to the root cause and Y consistently settled for the first state that met the checklist. That did not clearly decide the outcome: Y-2 passed with no text at all, and no try checked the grader's 10% screen-change test. **Rating: WEAK.** The depth difference is consistent, but the only link to the one failure is the QEMU version choice, and the trace shows that link only as a correlation.

## 4. Environment vs model

Mostly the model, with grader noise. Choices about QEMU version and hardware drove the result, but the decisive check (a 10% screen change within 2 seconds of one of five keys) is unstated in the spec and no try verified it, so 3 of 4 passing partly reflects the guest's behaviour under the grader.
