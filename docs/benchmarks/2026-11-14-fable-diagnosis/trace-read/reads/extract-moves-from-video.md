# extract-moves-from-video: blind trace read

## 1. What made the task hard

The video is a 190 s, 30 fps (5,703 frames) Zork speedrun in a fixed 80x25 DOS text grid. The player makes 262 moves and types 284 commands, including typos such as `drpo boat` that the grader's reference keeps. The grader wants 90% character-level Levenshtein similarity to that reference, so the transcription has to be close to exact and in order. Text scrolls faster than 1 fps sampling can catch, so frames must be dense and stitched by overlap. The box has 1 CPU and 2 GB RAM, and ffmpeg and tesseract have to be installed with apt (pip is missing). On that machine, Tesseract runs at about 1 s per frame, and running it in parallel thrashes. The 30-minute limit fits easily with a grid-aware decoder (about 9 minutes in both X tries) and does not fit Tesseract over hundreds of frames with no partial output written.

## 2. Tries

### X-1: PASS (11.6 min wall)
- Category: PASS
- [0.2m] apt installs ffmpeg and tesseract; [2.1m] dumps all frames as a 640x400 grayscale raw file; [2.7m] "the 80x25 character grid lets me classify each cell".
- [3.3m] builds templates from 3 hand-labelled frames; [5.4m] adds clustered unknown glyphs and reclassifies all 5,703 frames.
- [6.8m]-[7.8m] stitches clean frames by overlap and handles the two `**MORE**` breaks; [8.4m] cross-checks commands against the Moves counter.
- [9.1m] writes 284 lines to /app/solution.txt and also writes a full transcript.
- Time: about 7.5 min active, about 1.5 min waiting on apt and ffmpeg. Verified: Moves-counter cross-check, a read-through of the transcript, a character-set check of the solution.

### X-2: PASS (10.5 min wall)
- Category: PASS
- [0.2m] apt install; [2.0m] dumps all frames as raw grayscale; [2.6m] extracts the VGA 8x16 console font from a deb and decodes cells against it: "rather than using fuzzy OCR".
- [5.3m] 5,203 of 5,703 frames decode clean; [6.9m] stitching gives `warnings []`; [7.3m] Moves counter found for "284 of 284" prompts.
- [7.7m] writes 284 lines; [8.0m] visually checks one frame.
- Time: about 7 min active, about 1.5 min waiting on apt and ffmpeg. Verified: Moves-counter cross-check, a check of the transcript ends, a visual spot check.

### Y-1: FAIL (33.6 min wall, timeout)
- Category: MODEL-WRONG-APPROACH
- [2.1m] tries a cell-template approach on 1 fps frames, then drops it; [3.1m] extracts 951 frames at 5 fps, and one Tesseract call is timed.
- [4.1m] runs `xargs -P16` Tesseract over 951 frames on 1 CPU in the foreground; it is moved to the background at [14.2m] and only finishes at [20.0m] ("ocr-done").
- [22.5m] "Consecutive frames often fail to align"; [24.0m]-[29.1m] re-extracts and re-OCRs 321 "stable" frames (another 5 min).
- [31.4m] is reviewing 286 candidate command lines when it is stopped. /app/solution.txt was never written, so both tests fail with `does not exist`.
- Time: about 10 min active, about 21 min waiting on OCR and frame extraction. Verified: nothing reached the output file.

### Y-2: FAIL (33.3 min wall, timeout)
- Category: MODEL-WRONG-APPROACH
- [1.3m] runs a serial ffmpeg plus Tesseract loop over 190 frames at 1 fps, which takes until [9.7m]; [10.2m] "Moves scroll faster than 1 fps captures".
- [10.2m]-[14.1m] extracts 1,141 frames at 6 fps; [14.2m]-[24.2m] `xargs -P16` Tesseract thrashes ("19" files after 10 min).
- [25.7m] finds `cpu.max 100000 100000` (1 CPU) and OCRs about 420 gap frames until [30.2m]; [30.3m] the stitch still has "130 gaps".
- It never wrote /app/solution.txt, even though a 1 fps transcript existed from [10.1m]. Both tests fail with `does not exist`.
- Time: about 4 min active, about 26 min waiting on OCR and extraction. Verified: nothing reached the output file.

## 3. X versus Y

In both tries X used the fixed character grid to decode every frame with numpy template matching, which took about a minute of compute, and both wrote the solution by minute 9 with a Moves-counter cross-check. In both tries Y used Tesseract on hundreds of frames with 16-way parallelism on a 1-CPU box, spent most of the budget waiting, and never wrote even a partial solution.txt. **Rating: STRONG.**

## 4. Environment vs model

This measured the agents: both faced the same 1-CPU box, and the outcome followed approach choice and the failure to write early output.
