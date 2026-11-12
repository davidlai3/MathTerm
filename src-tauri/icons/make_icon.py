# App icon: python3 src-tauri/icons/make_icon.py src-tauri/icons/icon.png ui/vendor/fonts  (needs Pillow)
# Writes the PNG and an .icns next to it (via macOS's iconutil).
import os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
out, fonts = sys.argv[1], sys.argv[2]
N = 1024
# macOS icon grid: 824px rounded square centered on a 1024 canvas, radius ~185
x0, y0, side, rad = 100, 100, 824, 185
bg = Image.new('RGBA', (N, N))
grad = Image.new('RGBA', (N, N))
g = ImageDraw.Draw(grad)
top, bot = (49, 50, 68), (24, 24, 37)
for y in range(N):
    t = min(1, max(0, (y - y0) / side))
    g.line([(0, y), (N, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bot)) + (255,))
mask = Image.new('L', (N, N))
ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x0 + side, y0 + side], rad, fill=255)
bg.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(bg)
d.rounded_rectangle([x0, y0, x0 + side, y0 + side], rad, outline=(255, 255, 255, 28), width=4)
# A typeset integral, centered. Glyph sizes come from measured ink boxes.
fg = (205, 214, 244, 255)
def fit(path, ch, height):
    f = ImageFont.truetype(path, 100)
    l, t, r, b = f.getbbox(ch)
    return ImageFont.truetype(path, round(100 * height / (b - t)))
cy = y0 + side / 2
integ = fit(f'{fonts}/KaTeX_Size2-Regular.ttf', '∫', 520)
xf = fit(f'{fonts}/KaTeX_Math-Italic.ttf', 'x', 185)
gap = 12                                        # after the integral
width = lambda f, c: f.getbbox(c)[2] - f.getbbox(c)[0]
x = x0 + (side - (width(integ, '∫') + gap + width(xf, 'x'))) / 2
def put(x, c, font, dy=0):
    l, t, r, b = font.getbbox(c)
    d.text((x - l, cy + dy - (t + b) / 2), c, font=font, fill=fg)
    return x + (r - l)
x = put(x, '∫', integ) + gap
put(x, 'x', xf, dy=12)
bg.save(out)

iconset = os.path.join(tempfile.mkdtemp(), 'icon.iconset')
os.mkdir(iconset)
for px in (16, 32, 128, 256, 512):
    for k in (1, 2):
        bg.resize((px * k, px * k), Image.LANCZOS).save(f'{iconset}/icon_{px}x{px}{"@2x" if k == 2 else ""}.png')
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.splitext(out)[0] + '.icns'], check=True)
