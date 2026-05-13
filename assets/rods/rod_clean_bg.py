"""
Очистка шахматного фона удочки → RGBA (мягко: лучше ореол, чем «съесть» прут).

Источники: rod_idle.png / rod_tension.png (не *_clean.png).
Запуск из папки rods: py -3 rod_clean_bg.py
"""
from __future__ import annotations

from collections import deque

import numpy as np
from PIL import Image

ROOT = __file__.rsplit("\\", 1)[0] if "\\" in __file__ else __file__.rsplit("/", 1)[0]

# Выше — не считаем фоном (перчатка, синеватая катушка, тёмный прут с лёгким тинтом).
CHROMA_NEVER_BG = 13

# Фаза 1: только светлые клетки шахматки (заливка с краёв).
LIGHT_LUM_MIN = 188.0
LIGHT_CHROMA_MAX = 28

# Фаза 2: только очень тёмные почти нейтральные квадраты, примыкающие к уже снятому светлому фону.
# Узкие пороги = тёмные детали удочки/лески не попадают; возможен небольшой «ореол» тёмных клеток.
DARK_LUM_MAX = 16.5
DARK_CHROMA_MAX = 8
DARK_MAX_RGB = 22


def chroma_of(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def lum_of(r: int, g: int, b: int) -> float:
    return (r + g + b) / 3.0


def is_protected_content(r: int, g: int, b: int) -> bool:
    return chroma_of(r, g, b) > CHROMA_NEVER_BG


def is_light_checker(r: int, g: int, b: int) -> bool:
    if is_protected_content(r, g, b):
        return False
    return lum_of(r, g, b) >= LIGHT_LUM_MIN and chroma_of(r, g, b) <= LIGHT_CHROMA_MAX


def is_ultra_dark_checker(r: int, g: int, b: int) -> bool:
    if is_protected_content(r, g, b):
        return False
    c = chroma_of(r, g, b)
    mx = max(r, g, b)
    if c > DARK_CHROMA_MAX or mx > DARK_MAX_RGB:
        return False
    return lum_of(r, g, b) <= DARK_LUM_MAX


def flood_background(rgb: np.ndarray) -> np.ndarray:
    """Сначала только светлый фон с краёв, затем BFS по ультра-тёмным нейтральным клеткам.

    Сиды по контуру: сверху и слева — светлый + ультра-тёмный (шахматка).
    Снизу и справа — только светлые клетки, чтобы не «вставать» на тёмный прут у кромки.
    Углы — явно и ультра-тёмные (карман за перчаткой у нижнего правого угла).
    """
    h, w, _ = rgb.shape
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def try_seed(y: int, x: int, allow_ultra: bool) -> None:
        if bg[y, x]:
            return
        r, g, b = (int(v) for v in rgb[y, x])
        if is_light_checker(r, g, b) or (allow_ultra and is_ultra_dark_checker(r, g, b)):
            bg[y, x] = True
            q.append((y, x))

    for x in range(w):
        try_seed(0, x, allow_ultra=True)
        try_seed(h - 1, x, allow_ultra=False)

    for y in range(h):
        try_seed(y, 0, allow_ultra=True)
        try_seed(y, w - 1, allow_ultra=False)

    for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        r, g, b = (int(v) for v in rgb[y, x])
        if is_ultra_dark_checker(r, g, b):
            if not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        rr, gg, bb = (int(v) for v in rgb[y, x])
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ny, nx = y + dy, x + dx
            if ny < 0 or ny >= h or nx < 0 or nx >= w or bg[ny, nx]:
                continue
            r, g, b = (int(v) for v in rgb[ny, nx])
            if is_protected_content(r, g, b):
                continue
            if is_light_checker(r, g, b):
                bg[ny, nx] = True
                q.append((ny, nx))
            elif is_ultra_dark_checker(r, g, b):
                bg[ny, nx] = True
                q.append((ny, nx))

    return bg


def process(src_name: str, dst_name: str) -> None:
    src = f"{ROOT}/{src_name}".replace("\\", "/")
    dst = f"{ROOT}/{dst_name}".replace("\\", "/")
    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im)
    bg = flood_background(rgb)
    rgba = np.dstack([rgb, np.full((rgb.shape[0], rgb.shape[1]), 255, dtype=np.uint8)])
    rgba[:, :, 3] = np.where(bg, 0, 255).astype(np.uint8)

    Image.fromarray(rgba, "RGBA").save(dst, compress_level=6)
    print("Wrote", dst)


def main() -> None:
    process("rod_idle.png", "rod_idle_clean.png")
    process("rod_tension.png", "rod_tension_clean.png")


if __name__ == "__main__":
    main()
