from manim import *

BG = "#1C1C1C"
PRIMARY = "#58C4DD"
SECONDARY = "#83C167"
ACCENT = "#FFFF00"
MONO = "Menlo"

NUMBERS = [3, 8, 12, 17, 21, 26, 30, 37, 41, 45, 52, 58, 63, 70, 77, 84]
TARGET = 63
STEPS = [(0, 15, 7), (8, 15, 11), (12, 15, 13), (12, 12, 12)]


class Scene1_Guessing(Scene):
    def construct(self):
        self.camera.background_color = BG
        title = Text("Guess my number", font_size=48, color=PRIMARY, weight=BOLD, font=MONO)
        self.play(Write(title), run_time=1.5, subcaption="I am thinking of a number from 1 to 100.")
        self.wait(1.0)
        self.play(title.animate.to_edge(UP, buff=0.5), run_time=0.8)
        line = NumberLine(x_range=[0, 100, 10], length=11, include_numbers=True, font_size=24)
        self.play(Create(line), run_time=1.5)
        self.add_subcaption("Every guess tells us higher or lower.", duration=2)
        span = Line(line.n2p(1), line.n2p(100), color=PRIMARY, stroke_width=10)
        self.play(Create(span), run_time=1.0)
        for lo, hi in [(51, 100), (51, 75), (51, 62)]:
            new = Line(line.n2p(lo), line.n2p(hi), color=PRIMARY, stroke_width=10)
            self.play(Transform(span, new), run_time=1.5, subcaption=f"Half the range is gone: {lo} to {hi}.")
            self.wait(1.0)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)


class Scene2_Search(Scene):
    def construct(self):
        self.camera.background_color = BG
        boxes = VGroup(*[
            VGroup(Square(0.62, color=SECONDARY), Text(str(n), font_size=24, font=MONO))
            for n in NUMBERS
        ]).arrange(RIGHT, buff=0.08)
        self.play(FadeIn(boxes, shift=UP * 0.3), run_time=1.5, subcaption="Sixteen numbers, already sorted. Find 63.")
        self.wait(1.0)
        for lo, hi, mid in STEPS:
            arrow = Arrow(UP, DOWN * 0.2, color=ACCENT).next_to(boxes[mid], UP)
            label = Text(f"low={lo} mid={mid} high={hi}", font_size=24, font=MONO).to_edge(DOWN, buff=0.5)
            self.play(GrowArrow(arrow), FadeIn(label), run_time=0.8,
                      subcaption=f"Look in the middle: {NUMBERS[mid]}.")
            self.wait(1.0)
            if NUMBERS[mid] == TARGET:
                self.play(boxes[mid][0].animate.set_fill(ACCENT, opacity=0.6), run_time=2.0,
                          subcaption="Found 63 in four looks.")
                self.wait(3.0)
            else:
                gone = range(lo, mid + 1) if NUMBERS[mid] < TARGET else range(mid, hi + 1)
                self.play(*[boxes[i].animate.set_opacity(0.15) for i in gone], run_time=1.5,
                          subcaption="Throw away the half that cannot hold 63.")
                self.wait(1.0)
            self.play(FadeOut(arrow), FadeOut(label), run_time=0.5)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)


class Scene3_WhyFast(Scene):
    def construct(self):
        self.camera.background_color = BG
        bars = VGroup(*[
            Rectangle(width=0.4 * n, height=0.5, color=ACCENT, fill_opacity=0.6) for n in [16, 8, 4, 2, 1]
        ]).arrange(DOWN, aligned_edge=LEFT, buff=0.25).to_edge(LEFT, buff=1.0)
        labels = VGroup(*[
            Text(str(n), font_size=24, font=MONO).next_to(b, RIGHT) for n, b in zip([16, 8, 4, 2, 1], bars)
        ])
        for bar, lab in zip(bars, labels):
            self.play(GrowFromCenter(bar), FadeIn(lab), run_time=0.8, subcaption="Each look halves what is left.")
            self.wait(0.5)
        punch = Text("1,000,000 items: about 20 looks", font_size=36, color=ACCENT, font=MONO).to_edge(DOWN, buff=0.5)
        self.play(Write(punch), run_time=2.5, subcaption="A million sorted items need only about 20 looks.")
        self.wait(3.0)
        self.play(FadeOut(Group(*self.mobjects)), run_time=0.5)
