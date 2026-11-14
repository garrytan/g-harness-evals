# raman-fitting: blind trace read

## 1. What made the task hard

The physics is easy: the file uses decimal commas, the x column is absolute wavenumber, so Raman shift is 1e7/x, and each peak is one Lorentzian plus a flat offset. Every try found this within about a minute. The trap is in the grader: it checks the fitted **offset** to within 10% and **gamma** to within 1 cm-1 of one reference fit, but those two numbers depend on which fit window you pick, and the instruction names no window and no baseline model. Under the 2D peak the offset moves from about 125 to 1530 as the window changes (the tries' own scans show this), so a correct Lorentzian fit can fail on window choice alone. The reference values match a fit over 1500-1700 cm-1 for G and 2500-2900 cm-1 for 2D to four or more significant figures (X-1 and X-2 both print 9.061 / 8382.69 / 5561.03 and 17.52 / 12314.4 / 1239.09). The limit is 15 minutes and honest work took about 3 minutes, so time was never a factor.

## 2. Tries

### X-1: PASS (3.0 min wall)
- Category: PASS
- [0.4m] installs numpy and scipy, samples the spectrum; [0.9m] converts with `shift = 1e7 / d[:, 0]` and fits 11 windows (G and 2D).
- [1.0m] tries 6 more G windows; (1500,1700) gives `[1580.297 9.061 8382.693 5561.035]`.
- [1.1m] writes results.json with G (1500,1700) and 2D (2500,2900).
- Time: about 1.2 min of active work, no long commands. Verified: printed the JSON, reported how much gamma and offset move with the window. The trace does not show why it picked these two windows over the others it scanned.

### X-2: PASS (3.1 min wall)
- Category: PASS
- [0.8m] confirms 1e7/x by finding Si at 522 cm-1; [1.0m] fits 5 windows per peak, each with a flat and a sloped baseline.
- [1.1m] writes results.json with G (1500,1700) and 2D (2500,2900), the same windows as X-1.
- Time: about 1.2 min active, no waits. Verified: printed the JSON, reported 2D offset ranging "from about 125 to 1,530 as the window narrows".

### Y-1: PASS (2.9 min wall)
- Category: PASS
- [0.5m] tests x, 1/x and log(x) for linearity against the index, then plots with matplotlib.
- [1.0m] fits G over 1500-1680 and 2D over 2550-2800: 2D offset 1131.7, 8.7% under the reference, inside the 10% band.
- [1.1m] reads the fit plot and stops. It did one window per peak, no sensitivity scan.
- Time: about 1.2 min active. Verified: visual fit plot only.

### Y-2: FAIL (2.8 min wall)
- Category: GRADER-REJECTED-CORRECT
- [0.9m] fits windows centre +/-60 (G) and 2680 +/-100 (2D): 2D `gamma 18.41, offset 953.2`.
- [0.9m] refits 4 other windows and sees the 2D offset move from 630 to 1204; the final message says "2D offset: this is the least certain number".
- Verifier: G passes; 2D fails only on offset (`assert (True and True and True and False)`, 953 vs 1239, 23% off).
- Time: about 1.1 min active. Verified: a sensitivity scan, and it reported the offset uncertainty. Nothing in the instruction pins the window, so this is a valid fit that the hidden tolerance rejects.

## 3. X versus Y

Both X tries scanned many windows and settled on the wider 2D window (2500-2900), which matches the reference. Both Y tries used narrower 2D windows (2550-2800 and 2580-2780), and one of them fell outside the offset band. The behaviour is consistent within each agent, but the instruction gives no reason to prefer one window, and Y-1 passed with a narrow window anyway. **Rating: WEAK.**

## 4. Environment vs model

This mostly measured the grader: one of four tries failed on an unstated fit-window convention, not on fitting skill.
