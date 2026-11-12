from manim import *

NUMBERS = [3, 8, 12, 17, 21, 26, 30, 37, 41, 45, 52, 58, 63, 70, 77, 84]
TARGET = 63


class GuessingGame(Scene):
    def construct(self):
        title = Text("Guess my number (1 to 100)")
        self.play(Write(title))
        self.wait()
        self.play(title.animate.to_edge(UP))
        line = NumberLine(x_range=[0, 100, 10], length=11, include_numbers=True)
        self.play(Create(line))
        span = Line(line.n2p(1), line.n2p(100), color=BLUE, stroke_width=10)
        self.play(Create(span))
        for lo, hi in [(51, 100), (51, 75), (51, 62)]:
            self.play(Transform(span, Line(line.n2p(lo), line.n2p(hi), color=BLUE, stroke_width=10)))
            self.wait(0.5)
        self.wait()


class BinarySearch(Scene):
    def construct(self):
        cells = VGroup(*[
            VGroup(Square(0.62), Text(str(n), font_size=24)) for n in NUMBERS
        ]).arrange(RIGHT, buff=0.08)
        self.play(FadeIn(cells))
        caption = Text("Find 63", font_size=32).to_edge(UP)
        self.play(Write(caption))
        lo, hi = 0, len(NUMBERS) - 1
        while lo <= hi:
            mid = (lo + hi) // 2
            pointer = Arrow(UP, DOWN * 0.2, color=YELLOW).next_to(cells[mid], UP)
            info = Text(f"low={lo}  mid={mid}  high={hi}", font_size=24).to_edge(DOWN)
            self.play(GrowArrow(pointer), FadeIn(info))
            self.wait(0.5)
            if NUMBERS[mid] == TARGET:
                self.play(cells[mid][0].animate.set_fill(GREEN, opacity=0.7))
                self.play(Write(Text("Found it in 4 steps!", font_size=32).next_to(cells, DOWN)))
                self.wait(2)
                break
            if NUMBERS[mid] < TARGET:
                self.play(*[cells[i].animate.set_opacity(0.2) for i in range(lo, mid + 1)])
                lo = mid + 1
            else:
                self.play(*[cells[i].animate.set_opacity(0.2) for i in range(mid, hi + 1)])
                hi = mid - 1
            self.play(FadeOut(pointer), FadeOut(info))


class WhyItsFast(Scene):
    def construct(self):
        rows = VGroup(*[Text(f"{n} left", font_size=32) for n in [16, 8, 4, 2, 1]]).arrange(DOWN)
        for row in rows:
            self.play(FadeIn(row))
        self.play(Write(Text("1,000,000 items: about 20 looks", font_size=36, color=YELLOW).to_edge(DOWN)))
        self.wait(2)
