"""Generate Bilingual Translator icon: two overlapping speech bubbles (English 'A' + Chinese '译')."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.join(os.path.dirname(__file__))
BLUE = (74, 144, 226, 255)        # primary
ORANGE = (242, 153, 74, 255)      # accent
WHITE = (255, 255, 255, 255)
SHADOW = (0, 0, 0, 40)


def find_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


LATIN_FONTS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]
CJK_FONTS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
]


def draw_bubble(draw, bbox, fill, tail_pts):
    x0, y0, x1, y1 = bbox
    r = (x1 - x0) // 4
    draw.rounded_rectangle(bbox, radius=r, fill=fill)
    draw.polygon(tail_pts, fill=fill)


def render(size: int, path: str):
    # Render at 4x for anti-aliasing, then downsample.
    scale = 4 if size >= 32 else 2
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Two overlapping rounded bubbles.
    # Back bubble (orange, with Chinese 译): lower-right
    # Front bubble (blue, with Latin A): upper-left, overlaps
    pad = int(s * 0.06)
    bubble_w = int(s * 0.62)
    bubble_h = int(s * 0.56)

    # Back bubble (orange): bottom-right
    bx0 = s - pad - bubble_w
    by0 = s - pad - bubble_h - int(s * 0.04)
    bx1 = bx0 + bubble_w
    by1 = by0 + bubble_h
    back_tail = [
        (bx1 - int(bubble_w * 0.42), by1 - int(s * 0.02)),
        (bx1 - int(bubble_w * 0.18), by1 + int(s * 0.10)),
        (bx1 - int(bubble_w * 0.22), by1 - int(s * 0.02)),
    ]
    draw_bubble(draw, (bx0, by0, bx1, by1), ORANGE, back_tail)

    # Front bubble (blue): top-left
    fx0 = pad
    fy0 = pad
    fx1 = fx0 + bubble_w
    fy1 = fy0 + bubble_h
    front_tail = [
        (fx0 + int(bubble_w * 0.20), fy1 - int(s * 0.02)),
        (fx0 + int(bubble_w * 0.10), fy1 + int(s * 0.10)),
        (fx0 + int(bubble_w * 0.36), fy1 - int(s * 0.02)),
    ]
    draw_bubble(draw, (fx0, fy0, fx1, fy1), BLUE, front_tail)

    # Letters
    latin_font_size = int(bubble_h * 0.72)
    cjk_font_size = int(bubble_h * 0.64)
    latin_font = find_font(LATIN_FONTS, latin_font_size)
    cjk_font = find_font(CJK_FONTS, cjk_font_size)

    # Draw "A" in front bubble
    a_text = "A"
    a_bbox = draw.textbbox((0, 0), a_text, font=latin_font)
    aw = a_bbox[2] - a_bbox[0]
    ah = a_bbox[3] - a_bbox[1]
    ax = fx0 + (bubble_w - aw) // 2 - a_bbox[0]
    ay = fy0 + (bubble_h - ah) // 2 - a_bbox[1]
    draw.text((ax, ay), a_text, font=latin_font, fill=WHITE)

    # Draw "译" in back bubble
    cn_text = "译"
    c_bbox = draw.textbbox((0, 0), cn_text, font=cjk_font)
    cw = c_bbox[2] - c_bbox[0]
    ch = c_bbox[3] - c_bbox[1]
    cx = bx0 + (bubble_w - cw) // 2 - c_bbox[0]
    cy = by0 + (bubble_h - ch) // 2 - c_bbox[1]
    draw.text((cx, cy), cn_text, font=cjk_font, fill=WHITE)

    # Downsample with high-quality filter
    if scale != 1:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(path, "PNG")
    print(f"wrote {path} ({size}x{size})")


for sz in (16, 48, 128):
    render(sz, os.path.join(OUT_DIR, f"icon-{sz}.png"))
