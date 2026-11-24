"""
自机像素图「背面化」应急补丁。

背景：
    战斗是俯视视角，自机朝上飞，玩家只能看到她的背面。
    生图模型给出的是**正面**（头部有脸、胸口有 V 领），
    正面无法靠镜像变成背面 —— 镜像只改左右，不改朝向。

做法：
    按 24×24 逻辑分辨率逐像素改写，不动轮廓、不动配色体系：
      1. 头部区域的肤色 → 发色（用亮度映射到同一套银白发色阶）
      2. 胸口中央的肤色 → 衬衫白（背面看到的是衬衫背片）
      3. 两侧的肤色（手）保留 —— 从背后也能看到手
      4. 腰以下（红裤、腿、火焰）原样保留

为什么放在 24×24 动手：
    成品是 48×48，但它是 24×24 的整数 2 倍放大。
    在逻辑分辨率上改，改完再放大，边缘才是硬的（不产生半透明脏边）。

用法：
    python tools/player_back_view.py            # 生成候选到 .tmp_view，不覆盖正式文件
    python tools/player_back_view.py --apply    # 覆盖 public/art/pixel/pixel_player.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "art" / "pixel" / "pixel_player.png"
OUT_DIR = ROOT / ".tmp_view"

LOGICAL = 24          # 逻辑分辨率（成品 48 是其 2 倍）
SCALE = 2             # 输出倍率

# 银白发色阶（从原图白发区域采样得到，暗→亮）
HAIR_RAMP = [(148, 143, 176), (176, 171, 201), (203, 199, 222), (232, 229, 243)]
# 衬衫白（略高于头发的亮度，且更中性）
SHIRT_RAMP = [(196, 194, 205), (222, 221, 229), (243, 242, 247)]


def is_skin(rgb: np.ndarray) -> np.ndarray:
    """暖色且明显偏红 —— 区分肤色与银白发（发是冷色、蓝份高）。"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    warm = (r > b + 18) & (r > g + 8) & (r > 120)
    light = r > 140
    return warm & light


def ramp_color(ramp, t: float):
    t = min(max(t, 0.0), 1.0) * (len(ramp) - 1)
    i = int(t)
    f = t - i
    if i >= len(ramp) - 1:
        return ramp[-1]
    a, b = ramp[i], ramp[i + 1]
    return tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(3))


def main(apply: bool) -> None:
    im = Image.open(SRC).convert("RGBA")
    small = im.resize((LOGICAL, LOGICAL), Image.NEAREST)
    a = np.asarray(small).astype(np.int16)

    rgb = a[..., :3]
    alpha = a[..., 3]
    skin = is_skin(rgb) & (alpha > 40)

    # 亮度归一化后映射到目标色阶
    lum = (rgb[..., 0] * 0.30 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11)
    lo, hi = float(lum[skin].min()), float(lum[skin].max())
    span = max(hi - lo, 1.0)

    head_rows = slice(0, 12)      # 头 + 肩
    for y in range(LOGICAL):
        if y >= 12:
            continue                   # 腰以下不动
        for x in range(LOGICAL):
            if not skin[y, x]:
                continue
            # 两侧（手）保留原肤色：手在画面左右两端
            is_hand = x <= 7 or x >= 17
            if is_hand and y >= 8:
                continue
            t = (float(lum[y, x]) - lo) / span
            if y <= 8:
                # 头部：肤色 → 发色。背面看到的是整片头发。
                a[y, x, :3] = ramp_color(HAIR_RAMP, 0.35 + 0.55 * t)
            else:
                # 胸口/肩背：肤色 → 衬衫白。背面看到的是衬衫背片。
                a[y, x, :3] = ramp_color(SHIRT_RAMP, 0.45 + 0.5 * t)

    out = Image.fromarray(a.astype(np.uint8), "RGBA")
    big = out.resize((LOGICAL * SCALE, LOGICAL * SCALE), Image.NEAREST)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    before_big = im.resize((LOGICAL * 12, LOGICAL * 12), Image.NEAREST)
    after_big = big.resize((LOGICAL * 12, LOGICAL * 12), Image.NEAREST)

    sheet = Image.new("RGB", (before_big.width * 2 + 24, before_big.height), (12, 14, 26))
    sheet.paste(before_big.convert("RGB"), (0, 0))
    sheet.paste(after_big.convert("RGB"), (before_big.width + 24, 0))
    sheet.save(OUT_DIR / "player_back_compare.png")
    print("对比图 →", OUT_DIR / "player_back_compare.png", "（左=原正面，右=背面候选）")

    if apply:
        big.save(SRC)
        print("已覆盖", SRC)
    else:
        big.save(OUT_DIR / "pixel_player_back.png")
        print("候选 →", OUT_DIR / "pixel_player_back.png", "（未覆盖正式文件，加 --apply 才写入）")


if __name__ == "__main__":
    main("--apply" in sys.argv)