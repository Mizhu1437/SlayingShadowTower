"""
第四幕：塔顶 · 剥落
信息层 = 剥落（所有符文退去，只剩天与云；不是更花哨，而是「安静下来」）
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

from stageart import (
    Canvas, C, mix, wraps, fill_periodic_gradient, horizontal_vignette,
    ridge_polygon, soft_band, glow_dot, info_marks, particles,
    RW, RH, SS, VIS_H, V, PAD,
    CYAN, CYAN_HI, VIOLET, MAGENTA, GOLD, ORANGE, RED, FIRE_CORE, PAPER,
)


def act4_far():
    """
    远景：塔顶之上，脚下的云海。
    史诗感来自「尺度」与「地平线以下被照亮」，而不是整体提亮；
    战斗区（画面上半）仍在夜空里，紧张感保留。
    """
    cv = Canvas(opaque=True)
    fill_periodic_gradient(cv, [
        (0.00, (6, 10, 30)),       # 天顶：深夜
        (0.18, (10, 16, 44)),
        (0.34, (18, 24, 62)),
        (0.46, (34, 34, 82)),
        (0.54, (72, 52, 104)),     # 地平线
        (0.60, (158, 104, 128)),
        (0.66, (232, 172, 148)),
        (0.72, (255, 214, 172)),   # 云海受光面（最亮）
        (0.80, (214, 158, 150)),
        (0.88, (96, 76, 118)),
        (0.95, (34, 30, 62)),
        (1.00, (6, 10, 30)),
    ], noise=1.8, seed=1001)

    # 星河：沿着天顶的密集光点（大尺度感）
    im, d = cv.layer()
    rng = np.random.default_rng(1002)
    for _ in range(700):
        x = rng.uniform(0, RW)
        y = rng.uniform(0, V(0.36))
        rr = rng.uniform(0.4, 1.5) * SS
        a = rng.uniform(40, 190) * (1 - y / (V(0.44)))
        for y0 in wraps(y):
            d.ellipse([x - rr, y0 - rr, x + rr, y0 + rr], fill=C((230, 240, 255), a))
    cv.commit(im, "add", blur=1.2)

    # 远处地平线上的浮岛/塔尖（俯视感）
    im, d = cv.layer()
    for seed, yy, hh, col in [(1003, V(0.535), 30 * SS, (58, 50, 88)),
                              (1004, V(0.552), 20 * SS, (88, 68, 104))]:
        ridge_polygon(d, yy, hh, seed, col, 210)
    cv.commit(im, "normal", blur=1.6)

    # 云海：地平线以下的翻涌层（主要光源）
    im, d = cv.layer()
    rng = np.random.default_rng(1005)
    for band, (yy, hh, a) in enumerate([
        (V(0.62), 50 * SS, 165),
        (V(0.69), 58 * SS, 190),
        (V(0.77), 68 * SS, 210),
        (V(0.86), 78 * SS, 225),
        (V(0.95), 88 * SS, 235),
    ]):
        for k in range(11):
            x = (k / 10) * RW + rng.uniform(-28, 28) * SS
            w = rng.uniform(80, 170) * SS
            for y0 in wraps(yy + rng.uniform(-10, 10) * SS):
                d.ellipse([x - w / 2, y0 - hh / 2, x + w / 2, y0 + hh / 2],
                          fill=C(mix((110, 100, 158), (255, 228, 200), band / 5), a))
    cv.commit(im, "normal", blur=22)

    # 云海内部的高光（被下方照亮）
    soft_band(cv, V(0.70), 100 * SS, (255, 230, 190), 78, blur=48)
    soft_band(cv, V(0.82), 130 * SS, (255, 206, 164), 64, blur=60)

    # 远端的光柱：从云层下打上来（史诗感的关键道具）
    im, d = cv.layer()
    for x, w, a in [(0.24, 46 * SS, 30), (0.48, 74 * SS, 40), (0.74, 38 * SS, 26)]:
        for y0 in wraps(V(0.60)):
            d.polygon([(x * RW - w * 0.45, y0), (x * RW + w * 0.45, y0),
                       (x * RW + w * 1.0, y0 - 230 * SS), (x * RW - w * 0.25, y0 - 230 * SS)],
                      fill=C((255, 220, 184), a))
    cv.commit(im, "add", blur=30)

    # ── 信息剥落：只剩极少量残片（对比二、三幕的密集） ──
    info_marks(cv, 16, 1006, (255, 244, 226), alpha=(18, 52), size=(1.0, 2.2),
               y_range=(0, V(0.40)), blur=2.6)
    particles(cv, 130, 1007, (255, 240, 214), alpha=(40, 160), r=(0.6, 2.2),
              y_range=(0, V(0.50)), blur=1.8)

    out = cv.tile()
    return horizontal_vignette(out, 0.24)


def act4_mid():
    """
    中景：塔顶的檐角与被吹散的长带状云。
    注意：这里不画「下半部压暗」——压暗由静止覆盖层负责。
    """
    cv = Canvas(base=(0, 0, 0))

    # 塔顶的檐角剪影（从画面下方左右伸出，形成「你站在塔上」的框）
    im, d = cv.layer()
    for side in (-1, 1):
        for y0 in wraps(V(0.90)):
            bx = (0.5 + side * 0.56) * RW
            tip_x = bx - side * 160 * SS
            d.polygon([(bx, y0 + 60 * SS), (tip_x, y0 + 24 * SS),
                       (tip_x + side * 32 * SS, y0 + 44 * SS), (bx, y0 + 100 * SS)],
                      fill=C((14, 12, 28), 250))
            # 檐角上翘
            d.polygon([(tip_x, y0 + 24 * SS),
                       (tip_x - side * 20 * SS, y0 + 2 * SS),
                       (tip_x + side * 6 * SS, y0 + 28 * SS)],
                      fill=C((20, 18, 38), 250))
    cv.commit(im, "normal", blur=1.6)

    # 长带状云：横向拉伸，速度中等
    im, d = cv.layer()
    rng = np.random.default_rng(1102)
    for k in range(8):
        y = (0.20 + 0.095 * k) * RH + rng.uniform(-10, 10) * SS
        w = rng.uniform(220, 400) * SS
        h = rng.uniform(12, 30) * SS
        x = rng.uniform(-0.2, 1.0) * RW
        a = rng.uniform(70, 140)
        for y0 in wraps(y):
            d.ellipse([x - w / 2, y0 - h / 2, x + w / 2, y0 + h / 2],
                      fill=C(mix((150, 150, 200), (255, 232, 214), rng.random()), a))
    cv.commit(im, "add", blur=20)

    # 从云海反上来的一点暖光
    soft_band(cv, V(0.60), 110 * SS, (255, 216, 180), 34, blur=54)

    info_marks(cv, 30, 1103, (255, 240, 220), alpha=(16, 50), size=(1.0, 2.4), blur=2.6)
    out = cv.tile()
    return horizontal_vignette(out, 0.20)


def act4_near():
    """近景：飞掠的碎云 + 光尘。保持极低存在感，只做纵深。"""
    cv = Canvas(base=(0, 0, 0))
    im, d = cv.layer()
    rng = np.random.default_rng(1201)
    for k in range(9):
        y = rng.uniform(0, RH)
        w = rng.uniform(120, 260) * SS
        h = rng.uniform(6, 16) * SS
        x = rng.uniform(-0.1, 1.0) * RW
        a = rng.uniform(26, 60)
        for y0 in wraps(y):
            d.ellipse([x - w / 2, y0 - h / 2, x + w / 2, y0 + h / 2],
                      fill=C((220, 222, 240), a))
    cv.commit(im, "add", blur=26)

    particles(cv, 54, 1202, (255, 240, 220), alpha=(25, 95), r=(1.0, 3.0), blur=5)
    out = cv.tile()
    return horizontal_vignette(out, 0.14)
