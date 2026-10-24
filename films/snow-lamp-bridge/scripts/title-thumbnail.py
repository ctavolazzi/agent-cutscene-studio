# Title thumbnail: a thumbnail candidate plus the title in pixel lettering drawn at 1/S scale, no antialiasing, with a
# 1 px outline and drop shadow at that scale, upscaled nearest so its pixels match the film's chunky grid.
# Needs Pillow. Usage (the published one):
#   python3 scripts/title-thumbnail.py out/thumbnails/thumb-A-moonrise.png packaging/thumbnail 4 124 10 26 2
# args: base image, output path without extension, scale S, text x and y and font size (all at 1/S), line gap.
# Writes <out>.png, <out>.jpg (quality 92) and <out>-320.png (the size it is judged at).
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
base_path, out_base, S, x0, y0 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
base = Image.open(base_path).convert('RGB')
W, H = base.size
w, h = W // S, H // S
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(sys.argv[6]))
lines = [('SNOW,', (232, 240, 255)), ('LAMP,', (255, 180, 107)), ('BRIDGE', (238, 228, 208))]
gap = int(sys.argv[7])
layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
mask = Image.new('L', (w, h), 0)
cols = []
y = y0
for text, col in lines:
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    d.fontmode = '1'  # no antialiasing: hard pixels
    d.text((x0, y), text, font=font, fill=255)
    bbox = d.textbbox((x0, y), text, font=font)
    cols.append((m, col))
    mask = ImageChops.lighter(mask, m)
    y = bbox[3] + gap
outline = mask.filter(ImageFilter.MaxFilter(3))
shadow = Image.new('L', (w, h), 0); shadow.paste(outline, (1, 1))
shadow = ImageChops.lighter(shadow, outline)
dark = Image.new('RGBA', (w, h), (5, 8, 15, 255))
layer.paste(dark, (0, 0), shadow)
for m, col in cols:
    layer.paste(Image.new('RGBA', (w, h), col + (255,)), (0, 0), m)
big = layer.resize((W, H), Image.NEAREST)
out = base.copy(); out.paste(big, (0, 0), big)
out.save(out_base + '.png')
out.save(out_base + '.jpg', quality=92)
out.resize((320, 180), Image.LANCZOS).save(out_base + '-320.png')
print('ok', out_base)
