#!/usr/bin/env python3
import zlib, struct, os

def write_png(path, w, h, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))
    comp = zlib.compress(bytes(raw), 9)
    def chunk(typ, data):
        return (struct.pack('>I', len(data)) + typ + data +
                struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', comp) + chunk(b'IEND', b''))

def draw(n, maskable):
    bg = (79, 70, 229, 255)        # 品牌色 #4f46e5
    white = (255, 255, 255, 255)
    accent = (226, 232, 240, 255)  # 浅灰线条
    px = [[bg] * n for _ in range(n)]
    # 卡片矩形（居中外，maskable 时缩小到安全区）
    if maskable:
        cx0, cx1 = int(n*0.30), int(n*0.70)
        cy0, cy1 = int(n*0.34), int(n*0.66)
    else:
        cx0, cx1 = int(n*0.22), int(n*0.78)
        cy0, cy1 = int(n*0.32), int(n*0.68)
    for y in range(cy0, cy1):
        for x in range(cx0, cx1):
            px[y][x] = white
    # 卡片内一条装饰线
    ly = int((cy0 + cy1) / 2)
    for x in range(cx0 + int((cx1-cx0)*0.15), cx1 - int((cx1-cx0)*0.15)):
        px[ly][x] = accent
    return px

out = os.path.join(os.path.dirname(__file__), 'public')
os.makedirs(out, exist_ok=True)
for n in (192, 512):
    write_png(os.path.join(out, f'icon-{n}.png'), n, n, draw(n, False))
    write_png(os.path.join(out, f'icon-maskable-{n}.png'), n, n, draw(n, True))
print('icons generated')
