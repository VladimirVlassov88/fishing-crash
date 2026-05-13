"""
Доработка альфы для *_clean.png: снять остатки светлой/серой шахматки
(в т.ч. полосу между прутом и леской), RGB и размер кадра не меняются.

Вход/выход: rod_idle_clean.png / rod_tension_clean.png (перезапись).
При полном пересчёте маски: сначала py -3 rod_clean_bg.py, затем py -3 rod_alpha_refine.py

"""
from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image

ROOT = __file__.rsplit("\\", 1)[0] if "\\" in __file__ else __file__.rsplit("/", 1)[0]

# Пасс 1: нейтральные светлые клетки (как шахматка), хрома не выше — не лезем в окрашенный прут/катушку.
PASS1_LUM_MIN = 175
PASS1_CHROMA_MAX = 13

# Пасс 2: узкий BFS по слегка окрашенным светлым антиалиасным клеткам шахматки (после пасса 1).
PASS2_CHROMA_MIN = 14
PASS2_CHROMA_MAX = 17
PASS2_LUM_MIN = 188
PASS2_SEED_LUM_MIN = 228

# Пасс 3: остатки ch 18–21 у светлого антиалиаса (сиды только очень яркие — без затрагивания хроматики катушки).
PASS3_CHROMA_MIN = 14
PASS3_CHROMA_MAX = 21
PASS3_LUM_MIN = 188
PASS3_SEED_LUM_MIN = 236


def bfs_mask(h: int, w: int, a: np.ndarray, seed: np.ndarray, pass_through: np.ndarray) -> np.ndarray:
    vis = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    opaque = a > 0
    for y, x in zip(*np.where(seed & pass_through & opaque)):
        vis[y, x] = True
        q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ny, nx = y + dy, x + dx
            if ny < 0 or ny >= h or nx < 0 or nx >= w or vis[ny, nx]:
                continue
            if not pass_through[ny, nx] or not opaque[ny, nx]:
                continue
            vis[ny, nx] = True
            q.append((ny, nx))
    return vis


def refine_file(name: str) -> None:
    path = f"{ROOT}/{name}".replace("\\", "/")
    im = np.array(Image.open(path).convert("RGBA"))
    rgb = im[:, :, :3].astype(np.uint8)
    a = im[:, :, 3].astype(np.uint8).copy()
    h, w = a.shape
    lum = rgb.mean(axis=-1)
    ch = rgb.max(axis=-1) - rgb.min(axis=-1)

    opaque0 = a > 0
    remove1 = opaque0 & (ch <= PASS1_CHROMA_MAX) & (lum >= PASS1_LUM_MIN)
    a[remove1] = 0

    lum = rgb.mean(axis=-1)
    ch = rgb.max(axis=-1) - rgb.min(axis=-1)
    opaque = a > 0

    pass2 = opaque & (lum >= PASS2_LUM_MIN) & (ch >= PASS2_CHROMA_MIN) & (ch <= PASS2_CHROMA_MAX)
    seed2 = opaque & (lum >= PASS2_SEED_LUM_MIN) & (ch <= PASS2_CHROMA_MAX)
    vis2 = bfs_mask(h, w, a, seed2, pass2)
    a[vis2] = 0

    lum = rgb.mean(axis=-1)
    ch = rgb.max(axis=-1) - rgb.min(axis=-1)
    opaque = a > 0

    pass3 = opaque & (lum >= PASS3_LUM_MIN) & (ch >= PASS3_CHROMA_MIN) & (ch <= PASS3_CHROMA_MAX)
    seed3 = opaque & (lum >= PASS3_SEED_LUM_MIN) & (ch <= PASS3_CHROMA_MAX)
    vis3 = bfs_mask(h, w, a, seed3, pass3)
    a[vis3] = 0

    out = np.dstack([rgb, a])
    Image.fromarray(out, "RGBA").save(path, compress_level=6)
    print("Updated", path, "opaque before", int(opaque0.sum()), "after", int((a > 0).sum()))


def main() -> None:
    refine_file("rod_idle_clean.png")
    refine_file("rod_tension_clean.png")


if __name__ == "__main__":
    main()
