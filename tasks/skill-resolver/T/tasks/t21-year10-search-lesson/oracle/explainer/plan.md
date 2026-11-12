# Binary search explainer: plan

Narrative arc: guessing game, then the same idea on a sorted list, then why it is fast.
Aha moment: each look throws away half of what is left.
Palette: Classic 3B1B (background #1C1C1C, primary #58C4DD, secondary #83C167, accent #FFFF00). Monospace text throughout.

| Scene | Content | Dominant color | Entry |
|---|---|---|---|
| Scene1_Guessing | 1 to 100 number line, guesses 50, 25, 37 shrink the range | primary | Write |
| Scene2_Search | 16 boxes, low/mid/high arrows, discarded halves fade to 0.15 | secondary | FadeIn |
| Scene3_WhyFast | 16, 8, 4, 2, 1 bars shrinking; "a million items, about 20 looks" | accent | GrowFromCenter |

Subtitles on every animation (no voiceover; the teacher talks over it).
Render: `manim -ql script.py Scene1_Guessing Scene2_Search Scene3_WhyFast`, stitch with concat.txt.
