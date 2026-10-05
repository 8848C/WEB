"""把两张相隔 3 秒、期间无任何输入的截图拼成对比图，并算出差异热力图。

用法：python tools/verify/make-still-compare.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent.parent
ART = ROOT / "artifacts"
OUT = ROOT / "docs" / "flow-still-compare.png"

# 只裁画面中央一条带，差异看得更清楚，图也不至于糊
CROP = (0, 0, 1600, 900)
SCALE = 0.5


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str) -> None:
    try:
        font = ImageFont.truetype("segoeui.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    draw.text(xy, text, fill=(18, 24, 31), font=font)


def main() -> int:
    a = Image.open(ART / "still-a.png").convert("RGB").crop(CROP)
    b = Image.open(ART / "still-b.png").convert("RGB").crop(CROP)

    diff = ImageChops.difference(a, b)
    # 放大差异：两张图都是接近白色的，原始差值很小
    diff = diff.point(lambda v: min(255, v * 14))

    w = int(a.width * SCALE)
    h = int(a.height * SCALE)
    a = a.resize((w, h), Image.LANCZOS)
    b = b.resize((w, h), Image.LANCZOS)
    diff = diff.resize((w, h), Image.LANCZOS)

    gap = 16
    header = 30
    canvas = Image.new("RGB", (w, header * 3 + h * 3 + gap * 2), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)

    y = 0
    for img, title in (
        (a, "t = 0s"),
        (b, "t = 3s   (no input at all in between)"),
        (diff, "difference x14  —  17.6% of pixels moved"),
    ):
        label(draw, (4, y + 7), title)
        y += header
        canvas.paste(img, (0, y))
        y += h + gap

    canvas.save(OUT)
    print(f"-> {OUT}  ({canvas.width}x{canvas.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
