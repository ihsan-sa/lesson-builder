"""A sweep that was rendered once and never embedded. No video in the lesson comes from it."""
from manim import Scene, Axes


class DispersionSweep(Scene):
    def construct(self):
        self.add(Axes(x_range=[0, 10, 1], y_range=[0, 4, 1]))
