"""The packet animation. Manim names its output after the Scene, not this file, so the stem
`wave_animation` and the video `wave-packet.mp4` do not match — the pairing has to be re-verified."""
from manim import Scene, Axes, FunctionGraph, np


class WavePacket(Scene):
    def construct(self):
        axes = Axes(x_range=[-6, 6, 1], y_range=[-1.2, 1.2, 0.5])
        packet = FunctionGraph(lambda x: np.exp(-(x ** 2)) * np.cos(4 * x), x_range=[-6, 6])
        self.add(axes)
        self.play(axes.animate.set_opacity(1))
        self.play(packet.animate.shift(np.array([1.0, 0.0, 0.0])), run_time=3)
