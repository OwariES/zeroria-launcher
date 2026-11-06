"""
Arte del launcher (python3 tools/genarte.py desde la carpeta del launcher; usa el hipogrifo de ZeroriaStats):
  renderer/img/fondo.jpg     paisaje de noche por defecto (si el repositorio de datos no trae fondos/)
  renderer/img/hipogrifo.png el hipogrifo grande (pixel art ×4)
  build/icon.png / icon.ico  icono del programa
"""
import math, os, sys, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.environ.get('ZERORIA_STATS', '/home/claude/stats'))
import hipogrifo
import genastro

W, H = 1920, 1080
rng = np.random.default_rng(7)

def smooth_noise(n, scale, octaves=5, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros(n)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        step = max(2, int(scale / (2 ** o)))
        pts = r.random(n // step + 3)
        xs = np.arange(n) / step
        i = xs.astype(int); f = xs - i
        f = f * f * (3 - 2 * f)
        out += amp * (pts[i] * (1 - f) + pts[i + 1] * f)
        tot += amp; amp *= 0.5
    return out / tot

def lerp(a, b, t): return a + (b - a) * t

def background():
    y = np.linspace(0, 1, H)[:, None]
    top = np.array([12, 10, 34]); mid = np.array([52, 30, 92]); low = np.array([150, 80, 110])
    sky = np.where(y < 0.55, lerp(top, mid, (y / 0.55)[..., None] if False else (y / 0.55)), lerp(mid, low, ((y - 0.55) / 0.45)))
    sky = np.repeat(sky[:, None, :] if sky.ndim == 2 else sky, 1, axis=1)
    img = np.ones((H, W, 3)) * 0
    t = np.linspace(0, 1, H)
    for c in range(3):
        col = np.interp(t, [0, 0.45, 0.72, 1], [top[c], mid[c], low[c], 200 if c == 0 else 120 if c == 1 else 110])
        img[:, :, c] = col[:, None]
    # resplandor de la luna
    mx, my = int(W * 0.72), int(H * 0.24)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx - mx, (yy - my) * 1.05)
    glow = np.exp(-d / 260) * 0.55 + np.exp(-d / 70) * 0.5
    img += glow[..., None] * np.array([220, 200, 255]) * 0.45
    # estrellas
    n = 1400
    sx = rng.integers(0, W, n); sy = (rng.random(n) ** 1.6 * H * 0.7).astype(int)
    br = rng.random(n)
    for x, y_, b in zip(sx, sy, br):
        v = 120 + 135 * b
        img[y_, x] = np.maximum(img[y_, x], [v, v, v * 0.95])
        if b > 0.97:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= x + dx < W and 0 <= y_ + dy < H: img[y_ + dy, x + dx] = np.maximum(img[y_ + dy, x + dx], [v * 0.6] * 3)
    # luna
    md = np.hypot(xx - mx, yy - my)
    moon = md < 46
    shade = np.clip(1 - np.hypot(xx - mx + 14, yy - my - 10) / 70, 0, 1)
    img[moon] = (np.array([250, 244, 230]) * (0.82 + 0.18 * shade[moon, None]))
    # montañas en capas con niebla
    layers = [
        (0.52, 0.16, 900, (70, 44, 104), 1),
        (0.60, 0.15, 600, (52, 32, 80), 2),
        (0.70, 0.13, 420, (34, 22, 56), 3),
        (0.80, 0.10, 300, (20, 14, 34), 4),
        (0.90, 0.07, 160, (12, 9, 20), 5),
    ]
    for base, amp, scale, col, seed in layers:
        ridge = (base - amp * (smooth_noise(W, scale, 6, seed) * 1.2 - 0.1)) * H
        fog_ridge = ridge.copy()
        if seed == 2:   # un castillo en la segunda capa: muralla almenada, torres y tejados en punta
            cx = int(W * 0.3)
            wall = H * base - H * 0.07
            for x in range(cx - 80, cx + 80):
                ridge[x] = min(ridge[x], wall - (6 if (x // 8) % 2 == 0 else 0))
            for tx, th, tw in ((cx - 66, 60, 13), (cx - 22, 104, 16), (cx + 22, 84, 14), (cx + 66, 54, 12)):
                top_ = wall - th
                for x in range(tx - tw, tx + tw): ridge[x] = min(ridge[x], top_)
                for x in range(tx - tw - 3, tx + tw + 3):
                    ridge[x] = min(ridge[x], top_ - max(0, (tw + 3 - abs(x - tx))) * 2.0)
                for x in range(tx - 1, tx + 1): ridge[x] = min(ridge[x], top_ - (tw + 3) * 2.0 - 12)   # mástil
            fog_ridge = np.minimum(fog_ridge, wall)
        mask = yy >= ridge[None, :]
        # niebla encima de cada capa
        fog = np.clip(1 - (fog_ridge[None, :] - yy) / 90, 0, 1) * (yy < ridge[None, :]) * 0.18
        img = img * (1 - fog[..., None]) + np.array([170, 120, 170]) * fog[..., None]
        shade_v = np.clip((yy - ridge[None, :]) / (H * 0.3), 0, 1)
        layer = np.array(col)[None, None, :] * (1 - 0.35 * shade_v[..., None])
        img = np.where(mask[..., None], layer, img)
    # pinos delante
    pil = Image.fromarray(np.clip(img, 0, 255).astype('uint8'))
    dr = ImageDraw.Draw(pil)
    r = random.Random(3)
    for i in range(60):
        x = r.randint(-40, W + 40); base_y = H - r.randint(0, 60); hgt = r.randint(140, 320)
        if W * 0.35 < x < W * 0.62 and r.random() < 0.7: continue
        w_ = hgt * 0.32
        pts = []
        for k in range(7):
            yk = base_y - hgt * k / 7
            wk = w_ * (1 - k / 7)
            pts += [(x - wk, yk), (x - wk * 0.45, yk - hgt / 14)]
        pts.append((x, base_y - hgt))
        for k in range(6, -1, -1):
            yk = base_y - hgt * k / 7
            wk = w_ * (1 - k / 7)
            pts += [(x + wk * 0.45, yk - hgt / 14), (x + wk, yk)]
        dr.polygon(pts, fill=(8, 6, 12))
    pil = pil.filter(ImageFilter.GaussianBlur(0.6))
    # viñeta
    a = np.array(pil).astype(float)
    v = np.clip(1 - (np.hypot((xx - W / 2) / W, (yy - H / 2) / H) * 1.25) ** 2.2, 0.35, 1)
    a *= v[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype('uint8'))

def main():
    os.makedirs(os.path.join(ROOT, 'renderer/img'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
    background().save(os.path.join(ROOT, 'renderer/img/fondo.jpg'), quality=88)
    hp = hipogrifo.render(1.0)
    hp.resize((hp.width * 4, hp.height * 4), Image.NEAREST).save(os.path.join(ROOT, 'renderer/img/hipogrifo.png'))
    # icono: medallón morado con el hipogrifo (64 px de dibujo, ampliado sin suavizar)
    G = genastro
    G.ICONS = G.icons()
    med = G.medallion(64, 'morado', None, hole=0)
    big = hipogrifo.render(0.82)
    med.alpha_composite(big, ((64 - big.width) // 2, (64 - big.height) // 2 + 1))
    icon = med.resize((512, 512), Image.NEAREST)
    icon.save(os.path.join(ROOT, 'build/icon.png'))
    icon.save(os.path.join(ROOT, 'renderer/img/icono.png'))
    icon.save(os.path.join(ROOT, 'build/icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print('ok')

if __name__ == '__main__':
    main()
