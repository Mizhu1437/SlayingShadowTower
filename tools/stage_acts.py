"""
四幕场景 —— 各幕的 far / mid / near 三层。

设计原则（来自与用户的讨论）：
  · 明亮只放在「上部 / 远处」；战斗区（画面下半）始终压暗，保证弹幕可读。
  · 科技感来自「信息」而非「机械」：用和风纹样（青海波/七宝/麻叶）承载信息流。
  · 每一幕的信息层不同：流言 → 影像 → 伪真 → 剥落。
    这是四幕之间的质变点，而不是单纯的「更暗一点」。
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

from stageart import (
    Canvas, C, mix, wraps, cyclic_gradient_rows, fill_periodic_gradient,
    horizontal_vignette, grain, ridge_polygon, soft_band, glow_dot, info_marks,
    particles, RW, RH, PAD, SS, VIS_H, V, W_TILE, H_TILE,
    CYAN, CYAN_HI, VIOLET, MAGENTA, GOLD, ORANGE, RED, FIRE_CORE, PAPER,
)


# ─────────────────────────────────────────────
# 和风纹样（程序生成）
# ─────────────────────────────────────────────
def seigaiha(cv: Canvas, y, r, color, alpha=60, rows=3, cols=7, blur=2, width_scale=1.0):
    """青海波：同心半圆连成的鳞浪。天空/水面的和风底纹。"""
    im, d = cv.layer()
    step = r * 2
    for j in range(rows):
        for i in range(cols + 1):
            cx = i * step + (step / 2 if j % 2 else 0)
            cy = y + j * r * 0.62
            for y0 in wraps(cy):
                for k in range(3):
                    kk = 1 - 0.26 * k
                    d.arc([cx - r * kk, y0 - r * kk, cx + r * kk, y0 + r * kk],
                          start=180, end=360,
                          fill=C(color, max(8, alpha - k * 16)),
                          width=max(1, int(r * 0.085 * width_scale)))
    cv.commit(im, "add", blur=blur)


def shippo(cv: Canvas, y, r, color, alpha=45, rows=3, cols=5, blur=2):
    """七宝：四圆相交的连续纹。塔内壁的底纹。"""
    im, d = cv.layer()
    step = r * 1.42
    for j in range(rows):
        for i in range(cols + 1):
            cx = i * step
            cy = y + j * step
            for y0 in wraps(cy):
                d.ellipse([cx - r, y0 - r, cx + r, y0 + r],
                          outline=C(color, alpha), width=max(1, int(r * 0.07)))
    cv.commit(im, "add", blur=blur)


def asanoha(cv: Canvas, y, s, color, alpha=38, rows=3, cols=6, blur=2):
    """麻叶：六角星格。"""
    im, d = cv.layer()
    for j in range(rows):
        for i in range(cols + 1):
            cx = i * s * 1.5
            cy = y + j * s * 1.32
            for y0 in wraps(cy):
                for k in range(6):
                    a = math.pi / 3 * k
                    d.line([(cx, y0),
                            (cx + math.cos(a) * s * 0.58, y0 + math.sin(a) * s * 0.58)],
                           fill=C(color, alpha), width=max(1, int(s * 0.05)))
    cv.commit(im, "add", blur=blur)


def mirror_ghost(cv: Canvas, src_layer_fn, ox, alpha=90, blur=6):
    """把一层内容做镜像重影 —— 第三幕「伪真」的核心手法。"""
    im, d = cv.layer()
    src_layer_fn(d)
    # 水平镜像
    flipped = im.transpose(Image.FLIP_LEFT_RIGHT)
    cv.commit(flipped, "add", blur=blur, opacity=alpha / 255)


# ─────────────────────────────────────────────
# 第一幕：塔外 · 妖怪之山
# 信息层 = 流言（零散、互不相连的碎片）
# ─────────────────────────────────────────────
def act1_far():
    """
    第一幕远景：黄昏的天空 + 远山。

    这里是**静止层**（天空不该跟着飞）——滚动速度设为 0。
    构图按可见窗口 VIS_H 铺排，保证玩家真的看得到地平线与夕阳。
    """
    cv = Canvas(opaque=True)

    # 天空：黄昏色带。上冷下暖，最亮处落在地平线略上方。
    fill_periodic_gradient(cv, [
        (0.00, (22, 26, 62)),
        (0.16, (38, 40, 92)),
        (0.34, (78, 62, 118)),
        (0.50, (146, 92, 122)),
        (0.62, (212, 132, 116)),
        (0.70, (250, 178, 122)),
        (0.76, (255, 208, 148)),
        (0.84, (226, 156, 116)),
        (0.92, (120, 82, 108)),
        (1.00, (22, 26, 62)),
    ], noise=1.2, seed=101)

    # 太阳：压在地平线上方。
    # 光晕要克制——过大的光晕会把塔和山脊一起吞掉，反而丢掉构图。
    sun = (0.52 * RW, V(0.695))
    for r, a, bl in [(150 * SS, 54, 88), (72 * SS, 86, 42), (34 * SS, 170, 16)]:
        glow_dot(cv, sun[0], sun[1], r, (255, 200, 146), a, bl)
    im, d = cv.layer()
    d.ellipse([sun[0] - 22 * SS, sun[1] - 22 * SS,
               sun[0] + 22 * SS, sun[1] + 22 * SS], fill=C((255, 248, 224), 255))
    cv.commit(im, "add", blur=9)

    # 远山：越近越深，逐层压向观众
    im, d = cv.layer()
    ridge_polygon(d, V(0.715), 46 * SS, 11, (188, 138, 142), 225)
    ridge_polygon(d, V(0.775), 40 * SS, 12, (128, 88, 110), 245)
    ridge_polygon(d, V(0.840), 48 * SS, 13, (62, 46, 78), 255)
    ridge_polygon(d, V(0.905), 56 * SS, 14, (28, 22, 46), 255)
    cv.commit(im, "normal")

    # 青海波：天际线上方的和风纹样
    seigaiha(cv, V(0.56), 24 * SS, (255, 228, 200), alpha=26, rows=2, cols=9, blur=2.2)

    # ── 塔之蜃景 ──
    tx, ty = 0.67 * RW, V(0.52)
    th, tw = 190 * SS, 38 * SS
    for k in range(4):
        glow_dot(cv, tx, ty - th * 0.05, tw * (1.5 + k * 0.8),
                 (208, 168, 255), 50 - k * 10, 48 + k * 18)

    im, d = cv.layer()
    body = [(tx - tw * 0.54, ty + th * 0.52), (tx - tw * 0.30, ty - th * 0.46),
            (tx + tw * 0.30, ty - th * 0.46), (tx + tw * 0.54, ty + th * 0.52)]
    d.polygon(body, fill=C((136, 108, 196), 165))
    for k in range(7):
        yy = ty + th * (0.44 - k * 0.135)
        ww = tw * (0.46 - 0.015 * k)
        d.rectangle([tx - ww * 0.34, yy, tx + ww * 0.34, yy + 5 * SS],
                    fill=C((232, 210, 255), 205))
    for k in range(3):
        yy = ty - th * (0.40 - k * 0.19)
        ww = tw * (1.00 - k * 0.18)
        d.polygon([(tx - ww, yy), (tx + ww, yy),
                   (tx + ww * 0.70, yy - 10 * SS), (tx - ww * 0.70, yy - 10 * SS)],
                  fill=C((240, 220, 255), 215))
    d.polygon([(tx, ty - th * 0.50 - 22 * SS),
               (tx + tw * 0.27, ty - th * 0.46),
               (tx - tw * 0.27, ty - th * 0.46)],
              fill=C((252, 240, 255), 240))
    cv.commit(im, "add", blur=3)

    # 流言碎屑（零散、不相连）
    info_marks(cv, 40, 103, (255, 238, 214), alpha=(24, 74), size=(1.0, 2.4), blur=2.4,
               y_range=(PAD, PAD + VIS_H * 0.60))
    particles(cv, 60, 104, (255, 240, 208), alpha=(36, 120), r=(0.6, 1.8), blur=1.6,
              y_range=(PAD, PAD + VIS_H * 0.64))

    out = cv.tile()
    return horizontal_vignette(out, 0.16)


def act1_mid():
    """
    中景：山脚的杉林 + 从塔方向涌出的混乱气流。
    注意：这里**不画**「下半部压暗」——压暗必须由静止覆盖层做（见 stage_build 的 vignette），
    否则图层一滚动，暗区就跟着跑了，压不住任何东西。
    """
    cv = Canvas(base=(0, 0, 0))

    # 杉林剪影（多排，越近越暗越密）
    im, d = cv.layer()
    for row, (yy, hh, col, al) in enumerate([
        (V(0.74), 76 * SS, (56, 46, 88), 145),
        (V(0.84), 94 * SS, (36, 30, 64), 185),
        (V(0.94), 120 * SS, (18, 16, 36), 230),
    ]):
        x = -40 * SS
        i = 0
        while x < RW + 40 * SS:
            th = hh * (0.72 + 0.42 * abs(math.sin(i * 1.7 + row)))
            w = th * 0.30
            for y0 in wraps(yy):
                d.polygon([(x, y0), (x + w * 0.5, y0 - th), (x + w, y0)], fill=C(col, al))
                d.rectangle([x + w * 0.44, y0, x + w * 0.56, y0 + 14 * SS], fill=C(col, al))
            x += w * 0.86
            i += 1
    cv.commit(im, "normal", blur=1.2)

    # 从塔的方向涌出的乱流（斜向的涡线）
    im, d = cv.layer()
    for k in range(11):
        y0 = V(0.20) + k * 24 * SS
        pts = []
        for t in range(0, 21):
            u = t / 20
            x = (0.66 - 0.58 * u) * RW + math.sin(u * 6.4 + k * 1.3) * 24 * SS
            y = y0 + u * 150 * SS
            pts.append((x, y))
        d.line(pts, fill=C(VIOLET, 58), width=int(2.4 * SS))
    cv.commit(im, "add", blur=7)

    # 混乱的碎屑（比远景更大更密，暗示「涌出」）
    info_marks(cv, 120, 203, (232, 206, 255), alpha=(50, 140), size=(1.4, 4.2), blur=3.2)

    # 流言正文：更亮的窄条，像被吹散的纸
    im, d = cv.layer()
    rng = np.random.default_rng(205)
    for _ in range(34):
        x = rng.uniform(0, RW)
        y = rng.uniform(0, RH)
        w = rng.uniform(5, 18) * SS
        h = rng.uniform(2, 6) * SS
        a = rng.uniform(60, 150)
        for y0 in wraps(y):
            d.rectangle([x, y0, x + w, y0 + h], fill=C((252, 240, 226), a))
    cv.commit(im, "add", blur=2.6)

    out = cv.tile()
    return horizontal_vignette(out, 0.16)


def act1_near():
    """近景：低垂的雾 + 飘落的光尘。只负责纵深，几乎不占明度。"""
    cv = Canvas(base=(0, 0, 0))
    for i, (y, a) in enumerate([(V(0.34), 26), (V(0.66), 24), (V(0.92), 20)]):
        soft_band(cv, y, 160 * SS, (255, 230, 200), a, blur=58)
    particles(cv, 40, 301, (255, 244, 220), alpha=(35, 110), r=(1.2, 3.4), blur=4)
    out = cv.tile()
    return horizontal_vignette(out, 0.10)


# ─────────────────────────────────────────────
# 第二幕：塔内 · 影像
# 信息层 = 影像（半透明重影、投影、错位的副本）
# ─────────────────────────────────────────────
def act2_far():
    """
    远景：塔内深处。青紫为主的冷调，光源是塔自身的「信息」而非自然光。
    """
    cv = Canvas(opaque=True)
    fill_periodic_gradient(cv, [
        (0.00, (16, 18, 48)),
        (0.26, (30, 28, 74)),
        (0.50, (44, 36, 92)),
        (0.74, (26, 26, 66)),
        (1.00, (16, 18, 48)),
    ], noise=2.0, seed=401)

    # 塔内的巨大竖井结构：两侧的柱与拱
    im, d = cv.layer()
    for y0 in wraps(V(0.5)):
        for side in (-1, 1):
            cx = (0.5 + side * 0.40) * RW
            w = 26 * SS
            d.rectangle([cx - w / 2, y0 - RH, cx + w / 2, y0 + RH], fill=C((34, 34, 72), 225))
            # 柱上的横向刻线
            for k in range(9):
                yy = y0 - RH + k * RH / 8
                d.line([(cx - w / 2, yy), (cx + w / 2, yy)], fill=C(VIOLET, 40),
                       width=int(1.4 * SS))
    cv.commit(im, "normal", blur=1.4)

    # 垂落的拱（一排尖拱，读作塔内的走廊）
    im, d = cv.layer()
    for k in range(4):
        cy = V(0.12) + k * V(0.24)
        for y0 in wraps(cy):
            d.arc([0.18 * RW, y0 - 70 * SS, 0.82 * RW, y0 + 70 * SS],
                  start=180, end=360, fill=C((62, 54, 116), 210), width=int(8 * SS))
    cv.commit(im, "normal", blur=3)

    # 七宝纹：塔内壁
    shippo(cv, V(0.16), 34 * SS, VIOLET, alpha=40, rows=3, cols=5, blur=3)

    # 唯一的光源：深处的信息核心
    glow_dot(cv, 0.50 * RW, V(0.46), 130 * SS, VIOLET, 78, 84)
    glow_dot(cv, 0.50 * RW, V(0.46), 58 * SS, CYAN_HI, 105, 46)

    # 影像重影：横向错位的半透明副本（第二幕的核心视觉）
    for ox, a in [(-26 * SS, 70), (26 * SS, 54)]:
        im, d = cv.layer()
        for y0 in wraps(V(0.50)):
            d.ellipse([0.50 * RW - 46 * SS + ox, y0 - 60 * SS,
                       0.50 * RW + 46 * SS + ox, y0 + 60 * SS],
                      outline=C(CYAN, 60), width=int(2.6 * SS))
        cv.commit(im, "add", blur=8, opacity=a / 255)

    info_marks(cv, 90, 403, (170, 210, 255), alpha=(30, 100), size=(1.0, 3.0), blur=3)
    particles(cv, 110, 404, CYAN_HI, alpha=(40, 150), r=(0.7, 2.2), blur=2)

    out = cv.tile()
    return horizontal_vignette(out, 0.40)


def act2_mid():
    """中景：悬浮的符札残片 + 流动的信息带。"""
    cv = Canvas(base=(0, 0, 0))
    fill_periodic_gradient(cv, [
        (0.00, (0, 0, 0)), (0.50, (6, 6, 16)), (0.86, (12, 10, 26)), (1.00, (0, 0, 0)),
    ], noise=0.8, seed=501)

    im, d = cv.layer()
    rng = np.random.default_rng(502)
    for _ in range(11):
        x = rng.uniform(0.06, 0.94) * RW
        y = rng.uniform(0, RH)
        w = rng.uniform(5, 10) * SS
        h = w * rng.uniform(2.4, 3.6)
        ang = rng.uniform(-22, 22)
        for y0 in wraps(y):
            ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
            pts = []
            for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                lx, ly = sx * w, sy * h
                pts.append((x + lx * ca - ly * sa, y0 + lx * sa + ly * ca))
            d.polygon(pts, fill=C(mix(PAPER, VIOLET, 0.30), 96),
                      outline=C(VIOLET, 130), width=int(1.2 * SS))
    cv.commit(im, "normal", blur=3)
    # 残片自发光
    im, d = cv.layer()
    for _ in range(7):
        x = rng.uniform(0.1, 0.9) * RW
        y = rng.uniform(0, RH)
        for y0 in wraps(y):
            d.ellipse([x - 22 * SS, y0 - 22 * SS, x + 22 * SS, y0 + 22 * SS],
                      fill=C(VIOLET, 34))
    cv.commit(im, "add", blur=22)

    # 横向流动的信息带
    im, d = cv.layer()
    for k in range(6):
        y = (0.08 + 0.16 * k) * RH + 14 * SS
        for y0 in wraps(y):
            d.rectangle([0, y0, RW, y0 + 2.2 * SS], fill=C(CYAN, 46))
    cv.commit(im, "add", blur=5)

    info_marks(cv, 150, 503, (200, 220, 255), alpha=(40, 120), size=(1.2, 3.6), blur=3)
    out = cv.tile()
    return horizontal_vignette(out, 0.32)


def act2_near():
    """近景：飘动的暗雾，把战斗区下部继续压暗。"""
    cv = Canvas(base=(0, 0, 0))
    for y, a in [(V(0.55), 30), (V(0.80), 24), (V(0.98), 20)]:
        soft_band(cv, y, 170 * SS, (90, 110, 170), a, blur=64)
    particles(cv, 60, 601, (170, 220, 255), alpha=(30, 110), r=(1.0, 3.0), blur=5)
    out = cv.tile()
    return horizontal_vignette(out, 0.26)


# ─────────────────────────────────────────────
# 第三幕：塔内 · 伪真
# 信息层 = 伪真（几乎一样，但镜像反转、比例错误）
# ─────────────────────────────────────────────
def act3_far():
    """
    远景：和第二幕同一个地方，但「不对劲」——
    镜像反转的拱、错位的柱、过大的核心。玩家会觉得熟悉又说不出哪里错。
    """
    cv = Canvas(opaque=True)
    fill_periodic_gradient(cv, [
        (0.00, (20, 14, 44)),
        (0.26, (44, 24, 68)),
        (0.50, (62, 30, 82)),
        (0.74, (34, 18, 56)),
        (1.00, (20, 14, 44)),
    ], noise=2.0, seed=701)

    # 错位的柱：左右不对称，右侧柱明显更近更粗（比例错误）
    im, d = cv.layer()
    for y0 in wraps(V(0.5)):
        for side, w, off in [(-1, 22 * SS, 0.36), (1, 34 * SS, 0.44)]:
            cx = (0.5 + side * off) * RW
            d.rectangle([cx - w / 2, y0 - RH, cx + w / 2, y0 + RH], fill=C((46, 26, 62), 228))
            for k in range(9):
                yy = y0 - RH + k * RH / 8
                d.line([(cx - w / 2, yy), (cx + w / 2, yy)], fill=C(MAGENTA, 34),
                       width=int(1.4 * SS))
    cv.commit(im, "normal", blur=1.6)

    # 镜像反转的拱（与二幕同形，但左右反了）
    im, d = cv.layer()
    for k in range(4):
        cy = V(0.20) + k * V(0.24)
        for y0 in wraps(cy):
            d.arc([0.30 * RW, y0 - 66 * SS, 0.92 * RW, y0 + 66 * SS],
                  start=180, end=360, fill=C((84, 42, 104), 210), width=int(8 * SS))
    cv.commit(im, "normal", blur=3)

    # 塔内壁换个纹样：麻叶（和二幕的七宝区分）
    asanoha(cv, V(0.18), 30 * SS, MAGENTA, alpha=34, rows=3, cols=6, blur=3)

    # 核心：比二幕更大、更偏红（不祥）
    glow_dot(cv, 0.46 * RW, V(0.44), 150 * SS, (190, 66, 128), 88, 88)
    glow_dot(cv, 0.46 * RW, V(0.44), 64 * SS, (255, 190, 220), 110, 46)

    # 镜像重影：这一层做得更明显，读作「复制品」
    for ox, a in [(-40 * SS, 92), (40 * SS, 76), (-70 * SS, 54)]:
        im, d = cv.layer()
        for y0 in wraps(V(0.44)):
            d.ellipse([0.46 * RW - 52 * SS + ox, y0 - 68 * SS,
                       0.46 * RW + 52 * SS + ox, y0 + 68 * SS],
                      outline=C(MAGENTA, 66), width=int(3.0 * SS))
        cv.commit(im, "add", blur=9, opacity=a / 255)

    info_marks(cv, 120, 703, (255, 180, 220), alpha=(35, 110), size=(1.0, 3.2), blur=3)
    particles(cv, 130, 704, (255, 190, 225), alpha=(40, 160), r=(0.7, 2.4), blur=2)

    out = cv.tile()
    return horizontal_vignette(out, 0.44)


def act3_mid():
    """中景：成对的残片（每一片都有一个错位的孪生）。"""
    cv = Canvas(base=(0, 0, 0))
    fill_periodic_gradient(cv, [
        (0.00, (0, 0, 0)), (0.48, (10, 6, 18)), (0.86, (18, 8, 26)), (1.00, (0, 0, 0)),
    ], noise=0.9, seed=801)

    im, d = cv.layer()
    rng = np.random.default_rng(802)
    for _ in range(8):
        x = rng.uniform(0.08, 0.88) * RW
        y = rng.uniform(0, RH)
        w = rng.uniform(5, 9) * SS
        h = w * rng.uniform(2.4, 3.4)
        ang = rng.uniform(-20, 20)
        # 错位的孪生：偏移 + 缩小（比例错误）
        for ox, sc, a in [(0, 1.0, 110), (rng.uniform(14, 26) * SS, 0.72, 70)]:
            for y0 in wraps(y):
                ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
                pts = []
                for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                    lx, ly = sx * w * sc, sy * h * sc
                    pts.append((x + ox + lx * ca - ly * sa, y0 + lx * sa + ly * ca))
                d.polygon(pts, fill=C(mix(PAPER, MAGENTA, 0.32), a // 2),
                          outline=C(MAGENTA, a), width=int(1.2 * SS))
    cv.commit(im, "normal", blur=3)

    im, d = cv.layer()
    for k in range(6):
        y = (0.10 + 0.16 * k) * RH + 20 * SS
        for y0 in wraps(y):
            d.rectangle([0, y0, RW, y0 + 2.0 * SS], fill=C(MAGENTA, 40))
    cv.commit(im, "add", blur=6)

    info_marks(cv, 170, 803, (255, 200, 230), alpha=(40, 125), size=(1.2, 3.4), blur=3)
    out = cv.tile()
    return horizontal_vignette(out, 0.34)


def act3_near():
    """近景：更重的暗雾 + 从下方渗上来的暗红。"""
    cv = Canvas(base=(0, 0, 0))
    for y, a, col in [(V(0.50), 26, (120, 60, 110)), (V(0.78), 30, (90, 40, 80)),
                      (V(0.98), 34, (140, 50, 70))]:
        soft_band(cv, y, 180 * SS, col, a, blur=66)
    particles(cv, 70, 901, (255, 180, 210), alpha=(30, 110), r=(1.0, 3.2), blur=5)
    out = cv.tile()
    return horizontal_vignette(out, 0.30)
