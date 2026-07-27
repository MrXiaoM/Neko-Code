"""Pure Pillow rendering for tray icons and numeric approval badges."""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont

ICON_SIZE = 32

# The Windows notification area commonly renders the supplied 32px icon at 16px.
# Keep the cat silhouette close to the canvas edges so it remains legible at that size.
_NORMAL_FILL = (128, 92, 220, 255)
_NORMAL_OUTLINE = (244, 240, 255, 255)
_HIGHLIGHT_FILL = (255, 190, 0, 255)
_HIGHLIGHT_OUTLINE = (56, 32, 0, 255)

def badge_number(count: int) -> int | None:
    """Map a pending count to the single digit displayed on the tray badge."""
    if count <= 0:
        return None
    return min(count, 9)


def render_tray_icon(count: int, *, highlighted: bool = False, size: int = ICON_SIZE) -> Image.Image:
    """Render a high-contrast cat-ear tray icon with an optional 1-9 badge."""
    if size < 16:
        raise ValueError("tray icon size must be at least 16 pixels")

    scale = size / ICON_SIZE
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def point(x: float, y: float) -> tuple[int, int]:
        return round(x * scale), round(y * scale)

    fill = _HIGHLIGHT_FILL if highlighted else _NORMAL_FILL
    outline = _HIGHLIGHT_OUTLINE if highlighted else _NORMAL_OUTLINE
    face = [
        point(2, 10),
        point(4, 1),
        point(12, 6),
        point(20, 6),
        point(28, 1),
        point(30, 10),
        point(28, 29),
        point(4, 29),
    ]
    outline_width = max(1, round(2 * scale))
    draw.polygon(face, fill=fill, outline=outline, width=outline_width)
    draw.ellipse((*point(9, 13), *point(13, 18)), fill=outline)
    draw.ellipse((*point(19, 13), *point(23, 18)), fill=outline)
    draw.arc((*point(12, 16), *point(20, 23)), start=15, end=165, fill=outline, width=max(1, round(2 * scale)))

    digit = badge_number(count)
    if digit is not None:
        badge_box = (*point(17, 17), *point(32, 32))
        draw.ellipse(
            badge_box,
            fill=(220, 45, 62, 255),
            outline=(255, 255, 255, 255),
            width=max(1, round(2 * scale)),
        )
        font = ImageFont.load_default(size=max(8, round(12 * scale)))
        text = str(digit)
        bounds = draw.textbbox((0, 0), text, font=font, stroke_width=0)
        text_width = bounds[2] - bounds[0]
        text_height = bounds[3] - bounds[1]
        center_x, center_y = point(24.5, 24.5)
        draw.text(
            (center_x - text_width / 2, center_y - text_height / 2 - bounds[1]),
            text,
            font=font,
            fill=(255, 255, 255, 255),
        )

    return image
