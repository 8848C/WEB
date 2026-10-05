"""把 motion-strip 抓的三帧拼成一张动感条，附差异图。"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent.parent
ART = ROOT / "artifacts"
OUT = ROOT / "docs" / "flow-motion-strip.png"

SCALE = 0.46
HEADER = 28
GAP = 10


def load(name: str) -> Image.Image:
    return Image.open(ART / name).convert("RGB")


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str) -> None:
    try:
        font = ImageFont.truetype("segoeui.ttf", 14)
    except OSError:
        font = ImageFont.load_default()
    draw.text(xy, text, fill=(18, 24, 31), font=font)


def main() -> int:
    frames = [load(f"strip-{i}.png") for i in range(3)]
    w = int(frames[0].width * SCALE)
    h = int(frames[0].height * SCALE)
    frames = [f.resize((w, h), Image.LANCZOS) for f in frames]

    # 第一帧到第三帧的差异，放大 8 倍
    diff = ImageChops.difference(frames[0], frames[2]).point(lambda v: min(255, v * 8))
    if diff.width != w:
        diff = diff.resize((w, h), Image.LANCZOS)

    rows = [
        (frames[0], "t = 0.0s"),
        (frames[1], "t = 1.2s"),
        (frames[2], "t = 2.4s"),
        (diff, "difference  t0 vs t2  (x8)"),
    ]

    total_h = HEADER * len(rows) + h * len(rows) + GAP * (len(rows) - 1)
    canvas = Image.new("RGB", (w, total_h), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    y = 0
    for img, title in rows:
        label(draw, (6, y + 6), title)
        y += HEADER
        canvas.paste(img, (0, y))
        y += h + GAP

    canvas.save(OUT)
    print(f"-> {OUT}  ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
