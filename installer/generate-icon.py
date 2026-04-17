from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SQUARE = "#6ea8fe"
TEXT = "#f8fafc"
SIZES = [16, 24, 32, 48, 64, 128, 256]


def resolve_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/segoeuib.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/seguisb.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def build_icon(size: int = 256) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    padding = int(size * 0.14)
    radius = int(size * 0.18)
    draw.rounded_rectangle(
        (padding, padding, size - padding, size - padding),
        radius=radius,
        fill=SQUARE,
    )
    font = resolve_font(int(size * 0.46))
    text = "K"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    text_width = right - left
    text_height = bottom - top
    position = (
        (size - text_width) / 2 - left,
        (size - text_height) / 2 - top - (size * 0.01),
    )
    draw.text(position, text, fill=TEXT, font=font)
    return image


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generate-icon.py <output.ico>")
    output = Path(sys.argv[1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    icon = build_icon()
    icon.save(output, format="ICO", sizes=[(size, size) for size in SIZES])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
