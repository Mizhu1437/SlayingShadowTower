"""
卡面插画生成器（全程序绘制，零外部素材）。

用途：为《東方戮影塔 〜 Formless Barrage》的每张卡生成 512×512 的卡面插画。
输出可直接裁进卡牌 UI 的 art 窗口，也可用于 README / 宣传图。

设计约束（来自 docs/SCOPE.md 2.2）：
  - 不引入外部素材，全部由代码绘制 → 版权合规成本为零
  - 配色与 src/render/gameRenderer.ts 的 COLORS 表严格一致
  - 输出与判定逻辑完全无关，纯视觉资源

运行：
    python tools/cardart.py
输出：
    docs/art/cards/<id>.png        单张 512×512
    docs/art/cards/_contact.png    全部卡面九宫格（带卡名）
"""

from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ─────────────────────────────────────────────
# 全局参数
# ─────────────────────────────────────────────
SIZE = 512          # 输出边长
SS = 3              # 超采样倍率（先画 3 倍大再缩，边缘才干净）
W = H = SIZE * SS

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "art", "cards")

# 与 gameRenderer.ts 的 COLORS 对齐
BG_DEEP = (5, 6, 13)
BG_MID = (16, 20, 38)
CYAN = (126, 200, 255)      # enemyBullet
CYAN_HI = (159, 227, 255)   # shot
VIOLET = (199, 155, 255)    # shotTalisman
MAGENTA = (255, 107, 138)   # enemy
PLAYER = (255, 95, 126)     # player
GOLD = (255, 212, 121)      # shotOrb
GOLD_HI = (255, 246, 207)
ORANGE = (255, 166, 61)     # fireMid
RED = (255, 77, 46)         # fireEdge
FIRE_CORE = (255, 242, 176) # fireCore
PAPER = (236, 232, 245)
PAPER_SHADE = (176, 170, 200)
INK = (34, 30, 56)
WHITE = (255, 255, 255)

FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"

# 符札在画面中的整体占比系数（1.0 = 按各卡传入的 scale 原样）
SPRITE_BOOST = 1.9


# ─────────────────────────────────────────────
# 画布
# ─────────────────────────────────────────────
class Canvas:
    """float32 RGB 累积画布，支持 normal / add 两种合成模式。"""

    def __init__(self):
        self.base = np.zeros((H, W, 3), np.float32)

    def layer(self):
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        return im, ImageDraw.Draw(im)

    def commit(self, im, mode="normal", blur=0.0, opacity=1.0):
        if blur > 0:
            im = im.filter(ImageFilter.GaussianBlur(blur))
        a = np.asarray(im, np.float32) / 255.0
        rgb = a[..., :3] * 255.0
        alpha = a[..., 3:4] * opacity
        if mode == "add":
            self.base = self.base + rgb * alpha
        else:
            self.base = self.base * (1 - alpha) + rgb * alpha

    def finish(self) -> Image.Image:
        out = np.clip(self.base, 0, 255).astype(np.uint8)
        return Image.fromarray(out).resize((SIZE, SIZE), Image.LANCZOS)


def P(x: float, y: float):
    """归一化坐标 → 像素坐标"""
    return (x * W, y * H)


def hexlify(rgb):
    return (int(rgb[0]), int(rgb[1]), int(rgb[2]))


def rgba(color, a=255):
    return hexlify(color) + (int(a),)


def mix(c1, c2, t):
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))


# ─────────────────────────────────────────────
# 基础图元
# ─────────────────────────────────────────────
def bez(p0, p1, p2, t):
    mt = 1 - t
    return (mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
            mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1])


def ribbon(draw, p0, p1, p2, w0, w1, color, steps=64, taper=True):
    """贝塞尔带状体：火焰羽毛 / 能量弧 / 光尾的通用笔刷。"""
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        x, y = bez(p0, p1, p2, t)
        tx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
        ty = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
        L = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / L, tx / L
        wd = w0 * (1 - t) + w1 * t
        if taper:
            wd *= math.sin(math.pi * (0.15 + 0.85 * t)) ** 0.6 * (1 - 0.55 * t) + 0.04
        left.append((x + nx * wd, y + ny * wd))
        right.append((x - nx * wd, y - ny * wd))
    draw.polygon(left + right[::-1], fill=color)


def soft_ring(draw, center, radius, width, color, a=200):
    d = int(width)
    draw.ellipse([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
                 outline=rgba(color, a), width=d)


def spark(draw, center, r, color, a=255):
    cx, cy = center
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(color, a))


# ─────────────────────────────────────────────
# 背景
# ─────────────────────────────────────────────
def background(canvas, seed=0, inner=(20, 26, 48), outer=(4, 5, 12), cx=0.5, cy=0.42):
    yy, xx = np.mgrid[0:H, 0:W]
    dx = (xx - cx * W) / (W * 1.15)
    dy = (yy - cy * H) / (H * 1.15)
    d = np.clip(np.sqrt(dx * dx + dy * dy), 0, 1)[..., None]
    grad = np.array(inner, np.float32) * (1 - d) ** 1.4 + np.array(outer, np.float32)
    canvas.base[:] = grad

    # 塔的立面：极淡的竖向条带 + 窗格
    rng = np.random.default_rng(seed)
    im, d_ = canvas.layer()
    for i in range(7):
        x = (-0.05 + 0.16 * i) * W
        wob = rng.integers(-20, 20)
        d_.polygon([(x + wob, 0), (x + 0.1 * W + wob, 0),
                    (x + 0.16 * W + wob, H), (x + wob, H)], fill=(70, 86, 140, 9))
    for i in range(60):
        wx = rng.integers(0, W)
        wy = rng.integers(int(0.55 * H), H)
        s = rng.integers(3, 7)
        d_.rectangle([wx, wy, wx + s, wy + s], fill=(120, 150, 220, 16))
    canvas.commit(im, "add")

    # 横向蜃景带
    im, d_ = canvas.layer()
    for i in range(5):
        y = (0.18 + 0.16 * i) * H
        d_.rectangle([0, y, W, y + H * 0.035], fill=(140, 170, 235, 6))
    im = im.filter(ImageFilter.GaussianBlur(14))
    canvas.commit(im, "add")

    # 尘埃
    dust(canvas, count=90, seed=seed + 1)


def dust(canvas, count=80, seed=0, region=(0, 0, 1, 1), col=CYAN, size=(1, 3), alpha=(30, 110)):
    rng = np.random.default_rng(seed)
    im, d_ = canvas.layer()
    for _ in range(count):
        x = rng.uniform(region[0], region[2]) * W
        y = rng.uniform(region[1], region[3]) * H
        r = rng.uniform(size[0], size[1]) * SS
        a = rng.uniform(alpha[0], alpha[1])
        spark(d_, (x, y), r, col, a)
    im = im.filter(ImageFilter.GaussianBlur(1.6 * SS))
    canvas.commit(im, "add")


def vignette(canvas, strength=0.75):
    yy, xx = np.mgrid[0:H, 0:W]
    nx = (xx - W / 2) / (W / 2)
    ny = (yy - H / 2) / (H / 2)
    d = np.clip(np.sqrt(nx ** 2 + ny ** 2) / 1.42, 0, 1) ** 2.1
    canvas.base *= (1 - strength * d)[..., None]


def grain(canvas, amount=5.0, seed=7):
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amount, (H, W, 1)).astype(np.float32)
    canvas.base = canvas.base + n


# ─────────────────────────────────────────────
# 符札
# ─────────────────────────────────────────────
def talisman_sprite(w=340, h=960, paper=PAPER, ink=INK, seal=PLAYER,
                    border=PAPER_SHADE, charm=True):
    """生成一张竖长符札 sprite（未旋转）。"""
    sprite = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(sprite)
    pad = w * 0.08
    d.rounded_rectangle([pad, pad, w - pad, h - pad], radius=w * 0.06, fill=rgba(paper),
                        outline=rgba(border), width=int(w * 0.022))
    d.rounded_rectangle([pad * 1.8, pad * 1.8, w - pad * 1.8, h - pad * 1.8], radius=w * 0.04,
                        outline=rgba(border, 120), width=int(w * 0.012))
    if charm:
        # 抽象笔触（不书写可读文字）
        rng = np.random.default_rng(int(w))
        for i in range(5):
            y0 = h * (0.18 + 0.14 * i)
            pts = []
            for k in range(9):
                tt = k / 8
                pts.append((w * (0.26 + 0.48 * tt) + rng.uniform(-w * 0.04, w * 0.04),
                            y0 + math.sin(tt * math.pi * 1.4) * h * 0.035))
            d.line(pts, fill=rgba(ink, 210), width=int(w * 0.035), joint="curve")
        d.line([(w * 0.5, h * 0.15), (w * 0.5, h * 0.86)], fill=rgba(ink, 130),
               width=int(w * 0.012))
    # 朱印
    cx, cy, r = w * 0.5, h * 0.12, w * 0.115
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(seal, 235))
    d.ellipse([cx - r * 0.62, cy - r * 0.62, cx + r * 0.62, cy + r * 0.62],
              fill=rgba(paper, 255))
    return sprite


def stamp(canvas, sprite, center, angle=0.0, scale=1.0, mode="normal", glow=None,
          glow_blur=26, glow_gain=1.0):
    """把 sprite 旋转/缩放后贴到画布；glow=(color) 时同时叠一层外发光。

    SPRITE_BOOST 统一放大符札在画面里的占比——符札是本作的识别物，
    放小了在 512 的卡面里会糊成一个小白条。
    """
    scale *= SPRITE_BOOST
    w = int(sprite.width * scale)
    h = int(sprite.height * scale)
    sp = sprite.resize((max(1, w), max(1, h)), Image.LANCZOS)
    sp = sp.rotate(angle, resample=Image.BICUBIC, expand=True)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = int(center[0] - sp.width / 2)
    py = int(center[1] - sp.height / 2)
    layer.paste(sp, (px, py), sp)

    if glow is not None:
        a = np.asarray(layer, np.float32)[..., 3:4] / 255.0
        g = np.zeros((W, H, 3), np.float32) + np.array(glow, np.float32)
        gim = Image.fromarray(np.uint8(np.clip(g, 0, 255)))
        alpha_img = Image.fromarray(np.uint8(np.clip(a[..., 0] * 255 * glow_gain, 0, 255)))
        gim.putalpha(alpha_img)
        canvas.commit(gim, "add", blur=glow_blur)

    canvas.commit(layer, mode)


# ─────────────────────────────────────────────
# 弹幕 / 子弹 / 金币
# ─────────────────────────────────────────────
def bullet(canvas, center, r, core=CYAN, halo=None, ring=True):
    halo = halo or core
    im, d_ = canvas.layer()
    spark(d_, center, r * 2.6, halo, 90)
    canvas.commit(im, "add", blur=10 * SS)

    im, d_ = canvas.layer()
    spark(d_, center, r, mix(core, WHITE, 0.35), 255)
    spark(d_, center, r * 0.52, WHITE, 255)
    if ring:
        d_.ellipse([center[0] - r * 1.25, center[1] - r * 1.25,
                    center[0] + r * 1.25, center[1] + r * 1.25],
                   outline=rgba(core, 150), width=max(2, int(r * 0.16)))
    canvas.commit(im, "normal")


def coin(canvas, center, r, angle=0.0):
    im, d_ = canvas.layer()
    spark(d_, center, r * 2.2, GOLD, 70)
    canvas.commit(im, "add", blur=9 * SS)

    im, d_ = canvas.layer()
    # 币身（用椭圆宽度模拟金币旋转透视）
    w = r * abs(math.cos(angle)) * 0.85 + r * 0.15
    # 外圈
    d_.ellipse([center[0] - w, center[1] - r, center[0] + w, center[1] + r],
               fill=rgba(mix(GOLD, ORANGE, 0.35)), outline=rgba(GOLD_HI), width=max(2, int(r * 0.16)))
    # 内盘（压色，做出币面凹陷感）
    d_.ellipse([center[0] - w * 0.70, center[1] - r * 0.70,
                center[0] + w * 0.70, center[1] + r * 0.70],
               fill=rgba(mix(GOLD, ORANGE, 0.55)))
    d_.ellipse([center[0] - w * 0.70, center[1] - r * 0.70,
                center[0] + w * 0.70, center[1] + r * 0.70],
               outline=rgba(GOLD_HI, 200), width=max(2, int(r * 0.08)))
    # 内盘上的抽象蜃纹（三道弧）
    for k in range(3):
        rr = r * (0.22 + 0.16 * k)
        d_.arc([center[0] - w * (rr / r), center[1] - rr,
                center[0] + w * (rr / r), center[1] + rr],
               start=200, end=340, fill=rgba(mix(GOLD_HI, ORANGE, 0.4), 210),
               width=max(2, int(r * 0.07)))
    # 高光
    d_.arc([center[0] - w * 0.85, center[1] - r * 0.85,
            center[0] + w * 0.85, center[1] + r * 0.85],
           start=196, end=250, fill=rgba(WHITE, 160), width=max(1, int(r * 0.09)))
    canvas.commit(im, "normal")


def shock_ring(canvas, center, radius, color, width=6, a=180, blur=8):
    im, d_ = canvas.layer()
    soft_ring(d_, center, radius, width, color, a)
    canvas.commit(im, "add", blur=blur)
    im, d_ = canvas.layer()
    soft_ring(d_, center, radius, max(2, width // 3), mix(color, WHITE, 0.55), min(255, a + 60))
    canvas.commit(im, "normal")


def ray_burst(canvas, center, count, r0, r1, color, a=110, width=3, rot=0.0, blur=6):
    im, d_ = canvas.layer()
    for i in range(count):
        ang = rot + i * math.tau / count
        p0 = (center[0] + math.cos(ang) * r0, center[1] + math.sin(ang) * r0)
        p1 = (center[0] + math.cos(ang) * r1, center[1] + math.sin(ang) * r1)
        d_.line([p0, p1], fill=rgba(color, a), width=width)
    canvas.commit(im, "add", blur=blur)


def streak(draw, p0, p1, w0, w1, color, a=255):
    """一条锥形速度线。"""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L
    draw.polygon([(p0[0] + nx * w0, p0[1] + ny * w0), (p1[0] + nx * w1, p1[1] + ny * w1),
                  (p1[0] - nx * w1, p1[1] - ny * w1), (p0[0] - nx * w0, p0[1] - ny * w0)],
                 fill=rgba(color, a))


# ─────────────────────────────────────────────
# 各卡面
# ─────────────────────────────────────────────
def card_hougeki(c: Canvas):
    """符击：向前方连射三束符札。"""
    background(c, seed=11, cx=0.5, cy=0.5)
    ctr = P(0.5, 0.42)

    # 枪口灵力
    im, d_ = c.layer()
    spark(d_, P(0.5, 0.86), W * 0.085, VIOLET, 150)
    spark(d_, P(0.5, 0.86), W * 0.035, WHITE, 255)
    c.commit(im, "add", blur=22)

    # 三张符札
    sp = talisman_sprite(w=132, h=360, paper=PAPER, ink=(40, 34, 66), seal=PLAYER)
    for i, (ox, ang) in enumerate([(-0.155, 15), (0.0, 0), (0.155, -15)]):
        cx = ctr[0] + ox * W
        cy = ctr[1] + (0.03 if i != 1 else 0) * H
        stamp(c, sp, (cx, cy), angle=ang, scale=0.72, glow=CYAN, glow_blur=30, glow_gain=1.25)

    # 光尾
    im, d_ = c.layer()
    for ox in (-0.155, 0.0, 0.155):
        p0 = (ctr[0] + ox * W, ctr[1] + H * 0.19)
        p1 = (ctr[0] + ox * 1.35 * W, ctr[1] + H * 0.40)
        ribbon(d_, p0, ((p0[0] + p1[0]) / 2 + W * 0.02, (p0[1] + p1[1]) / 2), p1,
               W * 0.026, W * 0.004, rgba(CYAN_HI, 130))
    c.commit(im, "add", blur=9)

    dust(c, 70, seed=12, region=(0.2, 0.55, 0.8, 1.0), col=CYAN_HI, alpha=(40, 130))
    vignette(c, 0.8)
    grain(c)


def card_bougyo(c: Canvas):
    """防御：清除周围弹幕并短暂无敌。"""
    background(c, seed=21, inner=(18, 24, 50), cx=0.5, cy=0.5)
    ctr = P(0.5, 0.5)

    # 护罩
    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.30, ctr[1] - W * 0.30, ctr[0] + W * 0.30, ctr[1] + W * 0.30],
               fill=rgba(CYAN, 34))
    c.commit(im, "add", blur=30)

    shock_ring(c, ctr, W * 0.30, CYAN_HI, width=int(W * 0.008), a=210, blur=12)
    shock_ring(c, ctr, W * 0.335, CYAN, width=int(W * 0.004), a=110, blur=16)

    # 内层六边护罩
    im, d_ = c.layer()
    pts = []
    for i in range(6):
        ang = -math.pi / 2 + i * math.tau / 6
        pts.append((ctr[0] + math.cos(ang) * W * 0.20, ctr[1] + math.sin(ang) * W * 0.20))
    d_.polygon(pts, outline=rgba(CYAN_HI, 190), width=int(W * 0.005))
    c.commit(im, "normal")
    c.commit(Image.fromarray(np.zeros((H, W, 4), np.uint8)) if False else c.layer()[0], "normal")  # noqa

    # 核心
    bullet(c, ctr, W * 0.045, core=CYAN_HI, halo=CYAN)

    # 被弹开的子弹
    rng = np.random.default_rng(22)
    for i in range(9):
        ang = rng.uniform(0, math.tau)
        r = W * (0.40 + rng.uniform(0, 0.12))
        p = (ctr[0] + math.cos(ang) * r, ctr[1] + math.sin(ang) * r)
        bullet(c, p, W * 0.016, core=MAGENTA, halo=MAGENTA, ring=False)
        # 碎裂
        im, d_ = c.layer()
        for k in range(4):
            aa = ang + rng.uniform(-0.6, 0.6)
            d_.line([p, (p[0] + math.cos(aa) * W * 0.03, p[1] + math.sin(aa) * W * 0.03)],
                    fill=rgba(mix(MAGENTA, WHITE, 0.4), 190), width=int(2.2 * SS))
        c.commit(im, "add", blur=3)

    vignette(c, 0.78)
    grain(c)


def card_firebird(c: Canvas):
    """不死「火鸟 -凤翼天翔-」：穿透的凤凰。"""
    background(c, seed=31, inner=(40, 16, 26), outer=(6, 5, 12), cx=0.5, cy=0.52)
    ctr = P(0.5, 0.52)

    # 外焰光晕
    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.34, ctr[1] - W * 0.30,
                ctr[0] + W * 0.34, ctr[1] + W * 0.30], fill=rgba(RED, 62))
    d_.ellipse([ctr[0] - W * 0.18, ctr[1] - W * 0.16,
                ctr[0] + W * 0.18, ctr[1] + W * 0.16], fill=rgba(ORANGE, 95))
    c.commit(im, "add", blur=48)

    # ── 双翼：翼根贴身体，翼尖明显上扬，形成 V 形剪影 ──
    # k=0 是前缘（最高最外），k 越大越靠后缘（更低更收）
    layers = [(RED, 0.038, 34, 225), (ORANGE, 0.026, 22, 238), (FIRE_CORE, 0.012, 12, 250)]
    for color, ww, bl, al in layers:
        im, d_ = c.layer()
        for side in (-1, 1):
            for k in range(6):
                t = k / 5
                root = (ctr[0] + side * W * (0.045 + 0.012 * t),
                        ctr[1] + H * (0.020 + 0.060 * t))
                tip = (ctr[0] + side * W * (0.360 - 0.085 * t),
                       ctr[1] - H * (0.290 - 0.110 * t))
                ctrl = (ctr[0] + side * W * (0.215 - 0.030 * t),
                        ctr[1] - H * (0.215 - 0.020 * t))
                ribbon(d_, root, ctrl, tip, W * ww * (1 - 0.075 * k), W * ww * 0.14, rgba(color, al))
        c.commit(im, "add" if color is not RED else "normal", blur=bl)

    # 翼骨：沿前缘的一条亮线（让翼不只是一团火）
    im, d_ = c.layer()
    for side in (-1, 1):
        for k, ww in [(0, 0.0075), (2, 0.0055)]:
            t = k / 5
            ribbon(d_, (ctr[0] + side * W * (0.045 + 0.012 * t), ctr[1] + H * (0.020 + 0.060 * t)),
                   (ctr[0] + side * W * (0.215 - 0.030 * t), ctr[1] - H * (0.215 - 0.020 * t)),
                   (ctr[0] + side * W * (0.360 - 0.085 * t), ctr[1] - H * (0.290 - 0.110 * t)),
                   W * ww, W * 0.0015, rgba(FIRE_CORE, 225))
    c.commit(im, "add", blur=6)

    # 飞羽：从翼的下缘分离出几根，末端分叉（鸟翼的读法）
    im, d_ = c.layer()
    for side in (-1, 1):
        for k in range(4):
            t = 0.35 + 0.20 * k
            # 起点在翼体中部偏下
            sx = ctr[0] + side * W * (0.135 + 0.045 * t)
            sy = ctr[1] - H * (0.075 + 0.045 * t)
            # 末端向下外张开
            ex = sx + side * W * (0.135 - 0.015 * k)
            ey = sy + H * (0.100 + 0.022 * k)
            mx = (sx + ex) / 2 + side * W * 0.020
            my = (sy + ey) / 2 - H * 0.012
            ribbon(d_, (sx, sy), (mx, my), (ex, ey),
                   W * 0.017, W * 0.0015, rgba(mix(ORANGE, RED, 0.35), 215))
    c.commit(im, "add", blur=11)

    # ── 身体：短而收，向上收成颈 ──
    im, d_ = c.layer()
    body = [(ctr[0] - W * 0.068, ctr[1] + H * 0.090), (ctr[0] - W * 0.040, ctr[1] - H * 0.045),
            (ctr[0] + W * 0.040, ctr[1] - H * 0.045), (ctr[0] + W * 0.068, ctr[1] + H * 0.090),
            (ctr[0], ctr[1] + H * 0.140)]
    d_.polygon(body, fill=rgba(ORANGE, 245))
    c.commit(im, "normal", blur=8)
    im, d_ = c.layer()
    body2 = [(ctr[0] - W * 0.038, ctr[1] + H * 0.070), (ctr[0] - W * 0.022, ctr[1] - H * 0.032),
             (ctr[0] + W * 0.022, ctr[1] - H * 0.032), (ctr[0] + W * 0.038, ctr[1] + H * 0.070),
             (ctr[0], ctr[1] + H * 0.105)]
    d_.polygon(body2, fill=rgba(FIRE_CORE, 255))
    c.commit(im, "add", blur=5)

    # ── 颈与头 ──
    im, d_ = c.layer()
    ribbon(d_, (ctr[0], ctr[1] - H * 0.020), (ctr[0] + W * 0.020, ctr[1] - H * 0.095),
           (ctr[0] + W * 0.028, ctr[1] - H * 0.150), W * 0.020, W * 0.012, rgba(ORANGE, 245))
    c.commit(im, "normal", blur=5)
    im, d_ = c.layer()
    head = P(0.5 + 0.028, 0.52 - 0.165)
    spark(d_, head, W * 0.026, ORANGE, 255)
    spark(d_, (head[0] + W * 0.004, head[1] - W * 0.004), W * 0.014, FIRE_CORE, 255)
    c.commit(im, "add", blur=7)
    # 喙
    im, d_ = c.layer()
    d_.polygon([(head[0] + W * 0.020, head[1] - W * 0.004),
                (head[0] + W * 0.062, head[1] - W * 0.014),
                (head[0] + W * 0.020, head[1] + W * 0.012)], fill=rgba(FIRE_CORE, 250))
    c.commit(im, "add", blur=3)
    # 冠羽
    im, d_ = c.layer()
    for k in range(3):
        a = -0.55 + k * 0.55
        ribbon(d_, (head[0] - W * 0.006, head[1] - W * 0.016),
               (head[0] - W * 0.040 + W * a * 0.10, head[1] - H * 0.055),
               (head[0] - W * 0.055 + W * a * 0.22, head[1] - H * 0.085),
               W * 0.010, W * 0.001, rgba(mix(FIRE_CORE, ORANGE, 0.4), 235))
    c.commit(im, "add", blur=6)

    # ── 尾羽：向下拖三条 ──
    im, d_ = c.layer()
    for k in range(3):
        a = -0.75 + k * 0.75
        ribbon(d_, (ctr[0] + W * a * 0.02, ctr[1] + H * 0.085),
               (ctr[0] + W * a * 0.10, ctr[1] + H * 0.22),
               (ctr[0] + W * a * 0.20, ctr[1] + H * 0.36), W * 0.020, W * 0.002,
               rgba(mix(ORANGE, RED, 0.45), 225))
    c.commit(im, "add", blur=15)
    im, d_ = c.layer()
    ribbon(d_, (ctr[0], ctr[1] + H * 0.085), (ctr[0] + W * 0.015, ctr[1] + H * 0.24),
           (ctr[0] + W * 0.035, ctr[1] + H * 0.40), W * 0.009, W * 0.001,
           rgba(FIRE_CORE, 210))
    c.commit(im, "add", blur=8)

    # ── 被烧穿的符札碎屑 ──
    rng = np.random.default_rng(33)
    sp = talisman_sprite(w=300, h=760, paper=(252, 238, 218), ink=(84, 42, 30), seal=RED)
    for _ in range(5):
        p = (ctr[0] + rng.uniform(-0.34, 0.34) * W, ctr[1] + rng.uniform(-0.30, 0.34) * H)
        stamp(c, sp, p, angle=rng.uniform(-75, 75), scale=0.085, mode="normal",
              glow=ORANGE, glow_blur=18, glow_gain=1.0)

    # 火星
    rng2 = np.random.default_rng(35)
    for _ in range(46):
        ang = rng2.uniform(0, math.tau)
        rr = W * rng2.uniform(0.10, 0.50)
        p = (ctr[0] + math.cos(ang) * rr, ctr[1] + math.sin(ang) * rr * 0.85)
        im, d_ = c.layer()
        spark(d_, p, rng2.uniform(1.2, 3.6) * SS, mix(ORANGE, GOLD_HI, rng2.random()), 235)
        c.commit(im, "add", blur=3)

    dust(c, 120, seed=34, region=(0.06, 0.06, 0.94, 0.96), col=ORANGE, size=(1, 3.2), alpha=(45, 170))
    vignette(c, 0.84)
    grain(c, 6)


def card_p_sharp(c: Canvas):
    """锋利符片：伤害 +。一张被斜切开的符札，切口正在渗出光。"""
    background(c, seed=41, inner=(16, 26, 46), cx=0.5, cy=0.45)
    ctr = P(0.5, 0.50)
    sp = talisman_sprite(w=150, h=430, paper=PAPER, ink=(30, 40, 66), seal=CYAN)
    cut = int(sp.height * 0.5)
    top = sp.crop((0, 0, sp.width, cut))
    bot = sp.crop((0, cut, sp.width, sp.height))

    # 斜切：上半向左上滑开，下半向右下滑开，露出中间的缝
    gap = W * 0.030
    sx, sy = gap * math.cos(math.radians(-28)), gap * math.sin(math.radians(-28))
    stamp(c, top, (ctr[0] - sx, ctr[1] - sy - H * 0.012), angle=-5, scale=0.44,
          glow=CYAN, glow_blur=22, glow_gain=0.9)
    stamp(c, bot, (ctr[0] + sx, ctr[1] + sy + H * 0.012), angle=-5, scale=0.44,
          glow=CYAN, glow_blur=22, glow_gain=0.9)

    # 刃口亮线：正好落在两半之间
    ang = math.radians(-28)
    dx, dy = math.cos(ang), math.sin(ang)
    hl = W * 0.21
    p0 = (ctr[0] - dx * hl, ctr[1] - dy * hl)
    p1 = (ctr[0] + dx * hl, ctr[1] + dy * hl)

    # 缝里的暗（让切口读得出来）
    im, d_ = c.layer()
    d_.line([p0, p1], fill=(6, 8, 18, 230), width=int(W * 0.014))
    c.commit(im, "normal", blur=3)

    im, d_ = c.layer()
    d_.line([p0, p1], fill=rgba(CYAN, 210), width=int(W * 0.012))
    c.commit(im, "add", blur=16)
    im, d_ = c.layer()
    d_.line([p0, p1], fill=rgba(mix(CYAN_HI, WHITE, 0.8), 255), width=int(W * 0.0042))
    c.commit(im, "add", blur=4)
    im, d_ = c.layer()
    d_.line([p0, p1], fill=rgba(WHITE, 255), width=int(W * 0.0016))
    c.commit(im, "add", blur=0.8)

    # 沿刃口飞出的碎屑
    rng = np.random.default_rng(42)
    nx, ny = -dy, dx
    for _ in range(30):
        t = rng.normal(0.5, 0.24)
        if not 0.05 < t < 0.95:
            continue
        bx = p0[0] + (p1[0] - p0[0]) * t
        by = p0[1] + (p1[1] - p0[1]) * t
        side = 1 if rng.random() > 0.5 else -1
        dist = rng.uniform(0.012, 0.080) * W
        px = bx + nx * dist * side
        py = by + ny * dist * side
        im, d_ = c.layer()
        s = rng.uniform(0.0025, 0.0085) * W
        d_.polygon([(px, py - s), (px + s * 0.55, py + s * 0.2),
                    (px, py + s * 0.9), (px - s * 0.4, py + s * 0.15)],
                   fill=rgba(mix(CYAN_HI, WHITE, rng.uniform(0.3, 0.95)), 235))
        c.commit(im, "add", blur=1.8)

    # 切口两侧的辉光溢出
    im, d_ = c.layer()
    for off in (-0.012, 0.012):
        d_.line([(p0[0] + nx * W * off, p0[1] + ny * W * off),
                 (p1[0] + nx * W * off, p1[1] + ny * W * off)],
                fill=rgba(CYAN_HI, 90), width=int(W * 0.003))
    c.commit(im, "add", blur=9)

    dust(c, 45, seed=43, region=(0.1, 0.1, 0.9, 0.9), col=CYAN_HI, alpha=(25, 100))
    vignette(c, 0.8)
    grain(c)


def card_p_heavy(c: Canvas):
    """重击符片：伤害 ×。一块厚重的符片被砸下，砸出冲击坑。"""
    background(c, seed=51, inner=(42, 18, 28), outer=(6, 4, 10), cx=0.5, cy=0.55)
    ctr = P(0.5, 0.42)
    ground = P(0.5, 0.78)

    # 冲击坑
    im, d_ = c.layer()
    d_.ellipse([ground[0] - W * 0.34, ground[1] - H * 0.11,
                ground[0] + W * 0.34, ground[1] + H * 0.11],
               fill=rgba(RED, 90))
    c.commit(im, "add", blur=32)
    for r, a, wd in [(0.30, 150, 0.004), (0.22, 110, 0.003)]:
        im, d_ = c.layer()
        d_.arc([ground[0] - W * r, ground[1] - H * r * 0.32,
                ground[0] + W * r, ground[1] + H * r * 0.32],
               start=10, end=170, fill=rgba(mix(ORANGE, WHITE, 0.4), a), width=int(W * wd))
        c.commit(im, "add", blur=7)

    # 地面裂纹
    im, d_ = c.layer()
    rng = np.random.default_rng(53)
    for k in range(7):
        ang = math.radians(200 + k * 24)
        px, py = ground[0], ground[1]
        pts = [(px, py)]
        for _ in range(4):
            px += math.cos(ang) * W * rng.uniform(0.05, 0.08)
            py += math.sin(ang) * W * rng.uniform(0.015, 0.04)
            pts.append((px, py))
        d_.line(pts, fill=rgba(mix(ORANGE, RED, 0.5), 200), width=int(W * 0.006))
    c.commit(im, "add", blur=3)

    # 厚重的符片方块（带厚度与投影）
    im, d_ = c.layer()
    hw, hh = W * 0.150, W * 0.150
    box = [(ctr[0] - hw, ctr[1] - hh), (ctr[0] + hw, ctr[1] - hh),
           (ctr[0] + hw, ctr[1] + hh), (ctr[0] - hw, ctr[1] + hh)]
    off = W * 0.030
    d_.polygon([(box[2][0], box[2][1]), (box[2][0] + off, box[2][1] + off),
                (box[3][0] + off, box[3][1] + off), (box[3][0], box[3][1])],
               fill=rgba((96, 44, 40), 255))
    d_.polygon([(box[1][0] + off, box[1][1]), (box[2][0] + off, box[2][1]),
                (box[2][0] + off, box[2][1] + off), (box[2][0], box[2][1] + off)],
               fill=rgba((116, 54, 46), 255))
    d_.polygon(box, fill=rgba(mix(PAPER, ORANGE, 0.30)), outline=rgba(ORANGE, 240),
               width=int(W * 0.007))

    # 方块上的笔触
    for i in range(3):
        y0 = ctr[1] - hh * 0.45 + i * hh * 0.45
        pts = [(ctr[0] - hw * 0.55 + k * hw * 0.14,
                y0 + math.sin(k * 0.9) * hh * 0.10) for k in range(8)]
        d_.line(pts, fill=rgba((92, 40, 34), 220), width=int(W * 0.014))
    # 朱印
    sr = W * 0.030
    d_.ellipse([ctr[0] - sr, ctr[1] - hh * 0.62 - sr, ctr[0] + sr, ctr[1] - hh * 0.62 + sr],
               fill=rgba(RED, 245))
    c.commit(im, "normal")

    # 下砸的速度线（在方块上方）
    im, d_ = c.layer()
    for x, ln, al in [(-0.20, 0.13, 90), (-0.10, 0.21, 130), (0.10, 0.19, 120), (0.20, 0.12, 85)]:
        streak(d_, (ctr[0] + x * W, ctr[1] - hh - H * (ln + 0.06)),
               (ctr[0] + x * W, ctr[1] - hh - H * 0.02), W * 0.004, W * 0.001, ORANGE, al)
    c.commit(im, "add", blur=7)

    # 冲击火花（从坑口向上偏外）
    rng = np.random.default_rng(54)
    for _ in range(22):
        ang = rng.uniform(math.pi * 1.08, math.pi * 1.92)
        dist = rng.uniform(0.12, 0.40) * W
        p = (ground[0] + math.cos(ang) * dist, ground[1] + math.sin(ang) * dist * 0.45)
        im, d_ = c.layer()
        spark(d_, p, rng.uniform(1.5, 4.0) * SS, mix(ORANGE, GOLD_HI, rng.uniform(0, 1)), 230)
        c.commit(im, "add", blur=3)

    vignette(c, 0.84)
    grain(c, 6)


def card_p_rapid(c: Canvas):
    """疾射符片：出牌更快。"""
    background(c, seed=61, inner=(14, 30, 46), cx=0.42, cy=0.5)
    ctr = P(0.42, 0.5)

    # 速度线
    im, d_ = c.layer()
    for i in range(10):
        yy = ctr[1] + (i - 4.5) * H * 0.052
        lens = W * (0.16 + 0.02 * (i % 3))
        streak(d_, (ctr[0] + W * 0.16, yy), (ctr[0] + W * 0.16 + lens, yy),
               W * 0.004, W * 0.0008, CYAN_HI, 150)
    c.commit(im, "add", blur=8)

    sp = talisman_sprite(w=140, h=400, paper=PAPER, ink=(24, 44, 66), seal=CYAN)
    stamp(c, sp, (ctr[0], ctr[1]), angle=18, scale=0.68, glow=CYAN, glow_blur=26, glow_gain=1.15)

    # 三发小弹
    for i, (yy, sc) in enumerate([(-0.10, 1.0), (0.0, 1.2), (0.10, 0.85)]):
        p = (ctr[0] + W * 0.30, ctr[1] + yy * H)
        bullet(c, p, W * 0.023 * sc, core=CYAN_HI, halo=CYAN)

    dust(c, 60, seed=62, region=(0.15, 0.1, 0.95, 0.9), col=CYAN_HI, alpha=(40, 120))
    vignette(c, 0.78)
    grain(c)


def card_p_wide(c: Canvas):
    """广域符卡：符卡无敌时间 +。同一张符札被复制成多层。"""
    background(c, seed=71, inner=(16, 26, 52), cx=0.5, cy=0.5)
    ctr = P(0.5, 0.5)

    # 底部大光圈，撑满画面
    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.40, ctr[1] - W * 0.40,
                ctr[0] + W * 0.40, ctr[1] + W * 0.40], fill=rgba(CYAN, 45))
    c.commit(im, "add", blur=48)

    ray_burst(c, ctr, 28, W * 0.06, W * 0.50, CYAN, a=34, width=int(1.4 * SS), blur=12)

    # 三层同心符札（由外到内逐层放大透明度）
    sp = talisman_sprite(w=150, h=430, paper=PAPER, ink=(28, 36, 70), seal=VIOLET)
    for scale, al, gl in [(0.34, 0.55, 0.5), (0.50, 0.75, 0.8), (0.72, 1.0, 1.1)]:
        stamp(c, sp, ctr, angle=0, scale=scale, glow=VIOLET, glow_blur=26, glow_gain=gl)

    # 三层护罩环
    for r, wd, a, bl in [(0.455, 0.004, 100, 14), (0.375, 0.005, 130, 10), (0.30, 0.004, 90, 10)]:
        shock_ring(c, ctr, W * r, CYAN, width=int(W * wd), a=a, blur=bl)
    shock_ring(c, ctr, W * 0.26, CYAN_HI, width=int(W * 0.0028), a=210, blur=5)

    # 四角符札（展开的护罩节点）
    for i in range(4):
        ang = -math.pi / 2 + i * math.tau / 4 + math.pi / 4
        px = ctr[0] + math.cos(ang) * W * 0.375
        py = ctr[1] + math.sin(ang) * W * 0.375
        stamp(c, sp, (px, py), angle=math.degrees(ang) + 90, scale=0.15,
              glow=CYAN_HI, glow_blur=14, glow_gain=0.9)

    dust(c, 90, seed=72, col=CYAN_HI, alpha=(40, 150))
    vignette(c, 0.78)
    grain(c)


def card_p_bane(c: Canvas):
    """破邪符卡：符卡释放时全体伤害。"""
    background(c, seed=81, inner=(30, 16, 44), outer=(4, 3, 10), cx=0.5, cy=0.5)
    ctr = P(0.5, 0.5)

    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.30, ctr[1] - W * 0.30, ctr[0] + W * 0.30, ctr[1] + W * 0.30],
               fill=rgba(VIOLET, 70))
    c.commit(im, "add", blur=40)

    sp = talisman_sprite(w=140, h=400, paper=(44, 34, 62), ink=(150, 130, 210), seal=(255, 210, 120),
                         border=(110, 90, 150))
    stamp(c, sp, ctr, angle=-6, scale=0.66, glow=VIOLET, glow_blur=30, glow_gain=1.0)

    # 斩击（十字）
    im, d_ = c.layer()
    for ang, ln in [(-42, 0.42), (48, 0.40)]:
        a = math.radians(ang)
        p0 = (ctr[0] - math.cos(a) * W * ln, ctr[1] - math.sin(a) * W * ln)
        p1 = (ctr[0] + math.cos(a) * W * ln, ctr[1] + math.sin(a) * W * ln)
        d_.line([p0, p1], fill=rgba(mix(WHITE, VIOLET, 0.35), 255), width=int(W * 0.005))
    c.commit(im, "add", blur=7)

    ray_burst(c, ctr, 20, W * 0.05, W * 0.46, mix(VIOLET, WHITE, 0.3), a=55,
              width=int(1.6 * SS), blur=9, rot=0.2)

    dust(c, 100, seed=82, col=VIOLET, alpha=(50, 160))
    vignette(c, 0.85)
    grain(c, 6)


def card_meteor(c: Canvas):
    """流星符：对全体敌人造成伤害。"""
    background(c, seed=91, inner=(16, 22, 50), outer=(4, 4, 12), cx=0.3, cy=0.3)

    rng = np.random.default_rng(92)
    for i in range(5):
        t = i / 4
        start = (W * (0.02 + 0.02 * i) + rng.uniform(-0.03, 0.03) * W, H * (-0.05 + 0.12 * i))
        end = (W * (0.42 + 0.10 * t), H * (0.50 + 0.10 * t))
        im, d_ = c.layer()
        streak(d_, start, end, W * 0.016, W * 0.004, rgba(mix(GOLD, RED, 0.4), 150))
        c.commit(im, "add", blur=16)
        im, d_ = c.layer()
        streak(d_, start, end, W * 0.006, W * 0.0015, rgba(FIRE_CORE, 235))
        c.commit(im, "add", blur=4)
        # 头部
        im, d_ = c.layer()
        spark(d_, end, W * 0.020, mix(GOLD_HI, ORANGE, 0.4), 255)
        spark(d_, end, W * 0.010, WHITE, 255)
        c.commit(im, "add", blur=9)
        # 落点冲击
        shock_ring(c, end, W * 0.05, ORANGE, width=int(W * 0.004), a=140, blur=10)

    dust(c, 110, seed=93, col=ORANGE, alpha=(40, 150))
    vignette(c, 0.82)
    grain(c)


def card_focus(c: Canvas):
    """心念符：抽牌 + 回能。"""
    background(c, seed=101, inner=(16, 30, 52), cx=0.5, cy=0.5)
    ctr = P(0.5, 0.5)

    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.22, ctr[1] - W * 0.22, ctr[0] + W * 0.22, ctr[1] + W * 0.22],
               fill=rgba(CYAN, 80))
    c.commit(im, "add", blur=38)

    # 两条轨道
    im, d_ = c.layer()
    for ang, rr in [(0, 0.30), (58, 0.25)]:
        bbox = [ctr[0] - W * rr, ctr[1] - W * rr * 0.42, ctr[0] + W * rr, ctr[1] + W * rr * 0.42]
        d_.ellipse(bbox, outline=rgba(CYAN_HI, 150), width=int(W * 0.004))
    c.commit(im, "normal")

    # 轨道上的小卡
    sp = talisman_sprite(w=90, h=130, paper=PAPER, ink=(30, 44, 70), seal=CYAN)
    stamp(c, sp, (ctr[0] + W * 0.30, ctr[1] + H * 0.02), angle=-18, scale=0.18,
          glow=CYAN, glow_blur=12, glow_gain=1.0)
    stamp(c, sp, (ctr[0] - W * 0.26, ctr[1] - H * 0.07), angle=16, scale=0.14,
          glow=CYAN, glow_blur=12, glow_gain=0.8)

    # 核心球
    bullet(c, ctr, W * 0.075, core=CYAN_HI, halo=CYAN)
    ray_burst(c, ctr, 12, W * 0.09, W * 0.135, CYAN_HI, a=130, width=int(2.2 * SS), blur=5)

    # 能量加点
    im, d_ = c.layer()
    d_.line([(ctr[0] + W * 0.10, ctr[1] + H * 0.12), (ctr[0] + W * 0.16, ctr[1] + H * 0.12)],
            fill=rgba(VIOLET, 235), width=int(W * 0.010))
    d_.line([(ctr[0] + W * 0.13, ctr[1] + H * 0.09), (ctr[0] + W * 0.13, ctr[1] + H * 0.15)],
            fill=rgba(VIOLET, 235), width=int(W * 0.010))
    c.commit(im, "add", blur=4)

    dust(c, 70, seed=102, col=CYAN_HI, alpha=(40, 130))
    vignette(c, 0.78)
    grain(c)


def card_cleanse(c: Canvas):
    """净域符：清除全屏敌弹。一道向上的弧形波纹把子弹推平。"""
    background(c, seed=111, inner=(14, 28, 50), cx=0.5, cy=0.58)

    big = P(0.5, 0.62)
    im, d_ = c.layer()
    d_.ellipse([big[0] - W * 0.44, big[1] - W * 0.44,
                big[0] + W * 0.44, big[1] + W * 0.44], fill=rgba(CYAN, 48))
    c.commit(im, "add", blur=40)

    # 多层波纹（近密远疏，读作"扫荡"）
    for r, wd, a, bl in [(0.455, 0.006, 200, 10), (0.395, 0.004, 140, 9),
                         (0.345, 0.003, 100, 8), (0.30, 0.003, 70, 8)]:
        im, d_ = c.layer()
        d_.arc([big[0] - W * r, big[1] - W * r, big[0] + W * r, big[1] + W * r],
               start=188, end=352, fill=rgba(CYAN_HI, a), width=int(W * wd))
        c.commit(im, "add", blur=bl)
    im, d_ = c.layer()
    d_.arc([big[0] - W * 0.455, big[1] - W * 0.455, big[0] + W * 0.455, big[1] + W * 0.455],
           start=188, end=352, fill=rgba(WHITE, 230), width=int(W * 0.002))
    c.commit(im, "add", blur=3)

    ray_burst(c, big, 16, W * 0.10, W * 0.46, CYAN, a=34, width=int(1.5 * SS), blur=12)

    # 中央符札
    sp = talisman_sprite(w=300, h=850, paper=PAPER, ink=(28, 40, 70), seal=CYAN_HI)
    stamp(c, sp, (big[0], big[1] - H * 0.04), angle=0, scale=0.40,
          glow=CYAN_HI, glow_blur=30, glow_gain=1.25)

    # 外侧被推开的子弹 + 拖尾消散
    rng = np.random.default_rng(112)
    for i in range(13):
        ang = rng.uniform(math.pi * 0.04, math.pi * 0.96)
        r = W * (0.30 + rng.uniform(0, 0.10))
        p = (big[0] + math.cos(ang) * r, big[1] - math.sin(ang) * r * 0.92)
        im, d_ = c.layer()
        for k in range(5):
            t0 = k / 5
            q0 = (p[0] + math.cos(ang) * W * 0.012 * k, p[1] - math.sin(ang) * W * 0.012 * k)
            q1 = (p[0] + math.cos(ang) * W * 0.012 * (k + 1),
                  p[1] - math.sin(ang) * W * 0.012 * (k + 1))
            d_.line([q0, q1], fill=rgba(mix(MAGENTA, CYAN_HI, t0), int(170 - 30 * k)),
                    width=int(W * 0.008 * (1 - t0 * 0.7)))
        c.commit(im, "add", blur=5)
        bullet(c, p, W * 0.015, core=MAGENTA, halo=MAGENTA, ring=False)

    # 波前的碎屑
    rng2 = np.random.default_rng(114)
    for _ in range(44):
        ang = rng2.uniform(math.pi * 1.02, math.pi * 1.98)
        r = W * (0.30 + rng2.uniform(0, 0.16))
        p = (big[0] + math.cos(ang) * r, big[1] + math.sin(ang) * r * 0.9)
        im, d_ = c.layer()
        spark(d_, p, rng2.uniform(1.2, 3.4) * SS, mix(CYAN_HI, WHITE, rng2.random()), 220)
        c.commit(im, "add", blur=3)

    dust(c, 90, seed=113, col=CYAN_HI, alpha=(40, 140))
    vignette(c, 0.8)
    grain(c)


def card_bounty(c: Canvas):
    """丰收符：获得蜃銭。金币纯竖直下落。"""
    background(c, seed=121, inner=(38, 30, 16), outer=(6, 5, 8), cx=0.5, cy=0.35)

    im, d_ = c.layer()
    d_.ellipse([W * 0.20, H * 0.06, W * 0.80, H * 0.60], fill=rgba(GOLD, 55))
    c.commit(im, "add", blur=42)

    rng = np.random.default_rng(122)
    coins = []
    for i in range(20):
        x = W * rng.uniform(0.16, 0.84)
        y = H * rng.uniform(0.02, 0.96)
        r = W * rng.uniform(0.022, 0.048)
        coins.append((y, x, r))
    # 自上而下绘制，形成层次
    for y, x, r in sorted(coins):
        # 下落拖尾：等宽细光痕，留在金币上方（金币下落，尾迹在上）
        im, d_ = c.layer()
        d_.line([(x, y - r * 2.6), (x, y - r * 0.9)], fill=rgba(GOLD, 70),
                width=max(2, int(r * 0.10)))
        c.commit(im, "add", blur=7)
        coin(c, (x, y), r, angle=rng.uniform(0, math.pi))

    # 底部堆积
    im, d_ = c.layer()
    d_.ellipse([W * 0.20, H * 0.90, W * 0.80, H * 1.02], fill=rgba(GOLD, 55))
    c.commit(im, "add", blur=27)

    dust(c, 90, seed=123, col=GOLD, alpha=(40, 150))
    vignette(c, 0.82)
    grain(c)


def card_slow(c: Canvas):
    """缓时符：敌弹减速。钟面里嵌着被拖慢的子弹轨迹。"""
    background(c, seed=131, inner=(14, 30, 54), cx=0.5, cy=0.5)
    ctr = P(0.5, 0.5)

    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.30, ctr[1] - W * 0.30,
                ctr[0] + W * 0.30, ctr[1] + W * 0.30], fill=rgba(CYAN, 62))
    c.commit(im, "add", blur=44)

    # 钟面
    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.335, ctr[1] - W * 0.335,
                ctr[0] + W * 0.335, ctr[1] + W * 0.335],
               fill=rgba(mix(CYAN, BG_DEEP, 0.75), 170),
               outline=rgba(CYAN_HI, 200), width=int(W * 0.0055))
    c.commit(im, "normal")
    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.335, ctr[1] - W * 0.335,
                ctr[0] + W * 0.335, ctr[1] + W * 0.335],
               outline=rgba(CYAN_HI, 160), width=int(W * 0.004))
    c.commit(im, "add", blur=8)

    # 刻度（三点加粗）
    im, d_ = c.layer()
    for i in range(12):
        ang = -math.pi / 2 + i * math.tau / 12
        long = i % 3 == 0
        r0, r1 = W * (0.285 if long else 0.302), W * 0.325
        d_.line([(ctr[0] + math.cos(ang) * r0, ctr[1] + math.sin(ang) * r0),
                 (ctr[0] + math.cos(ang) * r1, ctr[1] + math.sin(ang) * r1)],
                fill=rgba(CYAN_HI if long else CYAN, 220 if long else 150),
                width=int(W * (0.0055 if long else 0.0035)))
    c.commit(im, "add", blur=2.5)

    # 三圈逆时针拖慢的弧
    for i, (r, st, en, a) in enumerate([(0.245, -100, 40, 200), (0.195, -70, 62, 150),
                                        (0.145, -40, 85, 110)]):
        im, d_ = c.layer()
        d_.arc([ctr[0] - W * r, ctr[1] - W * r, ctr[0] + W * r, ctr[1] + W * r],
               start=st, end=en, fill=rgba(CYAN_HI, a), width=int(W * 0.006))
        c.commit(im, "add", blur=4)

    # 中央符札
    sp = talisman_sprite(w=280, h=800, paper=PAPER, ink=(30, 44, 74), seal=CYAN_HI)
    stamp(c, sp, ctr, angle=0, scale=0.34, glow=CYAN_HI, glow_blur=28, glow_gain=1.2)

    # 敌弹：轨迹很短（被拖住读作慢）
    rng = np.random.default_rng(132)
    for i in range(10):
        ang = rng.uniform(math.pi * 1.05, math.pi * 1.95)
        r = W * rng.uniform(0.22, 0.30)
        p = (ctr[0] + math.cos(ang) * r, ctr[1] + math.sin(ang) * r)
        nxt = (ctr[0] + math.cos(ang) * (r + W * 0.016),
               ctr[1] + math.sin(ang) * (r + W * 0.016))
        im, d_ = c.layer()
        streak(d_, p, nxt, W * 0.009, W * 0.004, rgba(MAGENTA, 140))
        c.commit(im, "add", blur=5)
        bullet(c, p, W * 0.014, core=MAGENTA, halo=MAGENTA, ring=False)

    # 冻结点
    for _ in range(18):
        ang = rng.uniform(0, math.tau)
        r = W * rng.uniform(0.05, 0.33)
        p = (ctr[0] + math.cos(ang) * r, ctr[1] + math.sin(ang) * r)
        im, d_ = c.layer()
        spark(d_, p, rng.uniform(1.0, 2.6) * SS, CYAN_HI, 180)
        c.commit(im, "add", blur=3)

    dust(c, 60, seed=133, col=CYAN_HI, alpha=(35, 120))
    vignette(c, 0.8)
    grain(c)


def card_restore(c: Canvas):
    """复符：恢复一张符卡。碎裂的符札正被重新拼合。"""
    background(c, seed=141, inner=(36, 26, 46), outer=(5, 4, 11), cx=0.5, cy=0.5)
    ctr = P(0.5, 0.5)

    im, d_ = c.layer()
    d_.ellipse([ctr[0] - W * 0.26, ctr[1] - W * 0.26,
                ctr[0] + W * 0.26, ctr[1] + W * 0.26], fill=rgba(GOLD, 62))
    c.commit(im, "add", blur=44)

    # 主体符札（较暗，像还没复原）
    sp = talisman_sprite(w=150, h=430, paper=mix(PAPER, GOLD, 0.10), ink=(52, 40, 30), seal=GOLD)
    stamp(c, sp, ctr, angle=0, scale=0.62, glow=GOLD, glow_blur=26, glow_gain=0.85)

    # 符札碎片：竖长的纸条，沿半径方向排列，正在被吸回中心
    rng = np.random.default_rng(142)
    for i in range(8):
        ang = i * math.tau / 8 + rng.uniform(-0.22, 0.22)
        r = W * (0.29 + 0.10 * rng.random())
        px = ctr[0] + math.cos(ang) * r
        py = ctr[1] + math.sin(ang) * r

        # 朝心的方向作为碎片长轴
        ca, sa = -math.cos(ang), -math.sin(ang)
        pw = W * rng.uniform(0.016, 0.026)   # 半宽
        ph = W * rng.uniform(0.045, 0.080)   # 半长

        im, d_ = c.layer()
        corners = []
        # 略带不规则的撕裂边
        for sx, sy, j in [(-1, -1, 0.15), (1, -1, -0.1), (1, 1, 0.12), (-1, 1, -0.14)]:
            lx = sx * pw
            ly = sy * ph * (1 + j)
            corners.append((px + lx * ca - ly * sa, py + lx * sa + ly * ca))
        d_.polygon(corners, fill=rgba(mix(PAPER, GOLD, 0.14), 240),
                   outline=rgba(GOLD_HI, 225), width=int(W * 0.0025))
        # 碎片上的一道笔触
        lx0, ly0 = 0, -ph * 0.45
        lx1, ly1 = 0, ph * 0.45
        d_.line([(px + lx0 * ca - ly0 * sa, py + lx0 * sa + ly0 * ca),
                 (px + lx1 * ca - ly1 * sa, py + lx1 * sa + ly1 * ca)],
                fill=rgba((96, 74, 44), 190), width=int(W * 0.0035))
        c.commit(im, "normal")

        # 指向中心的牵引光
        im, d_ = c.layer()
        inner = (ctr[0] + math.cos(ang) * W * 0.19, ctr[1] + math.sin(ang) * W * 0.19)
        streak(d_, inner, (px, py), W * 0.0018, W * 0.0075, rgba(GOLD, 125))
        c.commit(im, "add", blur=5)

        # 碎片自身微光
        im, d_ = c.layer()
        spark(d_, (px, py), pw * 1.1, GOLD, 70)
        c.commit(im, "add", blur=9)

    # 中央封印环（正在闭合）
    shock_ring(c, ctr, W * 0.235, GOLD_HI, width=int(W * 0.005), a=185, blur=8)
    shock_ring(c, ctr, W * 0.265, GOLD, width=int(W * 0.002), a=100, blur=14)
    ray_burst(c, ctr, 20, W * 0.24, W * 0.285, GOLD, a=70, width=int(1.8 * SS), blur=6)

    dust(c, 100, seed=143, col=GOLD, alpha=(40, 160))
    vignette(c, 0.84)
    grain(c, 6)


# ─────────────────────────────────────────────
# 注册表
# ─────────────────────────────────────────────
CARD_ART = {
    "hougeki":          ("符击", card_hougeki, "starter"),
    "bougyo":           ("防御", card_bougyo, "starter"),
    "houyokutenshou":   ("不死「火鸟 -凤翼天翔-」", card_firebird, "starter"),
    "p_sharp":          ("锋利符片", card_p_sharp, "passive"),
    "p_heavy":          ("重击符片", card_p_heavy, "passive"),
    "p_rapid":          ("疾射符片", card_p_rapid, "passive"),
    "p_spell_wide":     ("广域符卡", card_p_wide, "passive"),
    "p_spell_bane":     ("破邪符卡", card_p_bane, "passive"),
    "a_meteor":         ("流星符", card_meteor, "active"),
    "a_focus":          ("心念符", card_focus, "active"),
    "a_cleanse":        ("净域符", card_cleanse, "active"),
    "a_bounty":         ("丰收符", card_bounty, "active"),
    "a_slow":           ("缓时符", card_slow, "active"),
    "a_restore":        ("复符", card_restore, "active"),
}


def render_all():
    os.makedirs(OUT_DIR, exist_ok=True)
    imgs = []
    for cid, (name, fn, kind) in CARD_ART.items():
        c = Canvas()
        fn(c)
        im = c.finish()
        path = os.path.join(OUT_DIR, f"{cid}.png")
        im.save(path)
        imgs.append((cid, name, im))
        print("  ✓", path)
    make_contact(imgs)
    return imgs


def make_contact(imgs):
    cols, pad, label_h = 5, 18, 46
    tw = 300
    rows = math.ceil(len(imgs) / cols)
    cw = cols * tw + (cols + 1) * pad
    ch = rows * (tw + label_h) + (rows + 1) * pad
    sheet = Image.new("RGB", (cw, ch), (8, 9, 18))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(FONT_PATH, 22)
    except Exception:
        font = ImageFont.load_default()

    for i, (cid, name, im) in enumerate(imgs):
        r, col = divmod(i, cols)
        x = pad + col * (tw + pad)
        y = pad + r * (tw + label_h + pad)
        sheet.paste(im.resize((tw, tw), Image.LANCZOS), (x, y))
        d.rectangle([x, y, x + tw - 1, y + tw - 1], outline=(42, 52, 86), width=1)
        d.text((x + 2, y + tw + 10), name, fill=(206, 226, 255), font=font)
    path = os.path.join(OUT_DIR, "_contact.png")
    sheet.save(path)
    print("  ✓", path)


# ─────────────────────────────────────────────
# 卡牌 UI 预览（把插画塞进真实的卡框，用来判断"进游戏后好不好看"）
# ─────────────────────────────────────────────
KIND_COLOR = {
    "starter": (111, 211, 255),
    "passive": (150, 118, 214),
    "active": (111, 211, 255),
}


def _rgb(c):
    """mix() 返回 float 三元组，PIL 只吃 int——统一在卡框绘制处取整。"""
    return tuple(int(round(v)) for v in c[:3])


def render_card_frame(im: Image.Image, name: str, cost, kind: str, text: str,
                      size=(360, 500)) -> Image.Image:
    """按 index.html 的 .card 样式重绘一张完整卡牌。"""
    cw, ch = size
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    accent = KIND_COLOR.get(kind, (111, 211, 255))

    # 卡身渐变
    for y in range(ch):
        t = y / ch
        col = _rgb(mix((20, 26, 43), (14, 19, 32), t))
        d.line([(0, y), (cw, y)], fill=col + (255,))
    # 圆角遮罩
    mask = Image.new("L", (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=16, fill=255)
    card.putalpha(mask)

    # 插画窗口
    art_pad = 16
    art_h = int(cw * 0.78)
    art = im.resize((cw - art_pad * 2, art_h), Image.LANCZOS)
    amask = Image.new("L", art.size, 0)
    ImageDraw.Draw(amask).rounded_rectangle([0, 0, art.size[0] - 1, art.size[1] - 1],
                                            radius=10, fill=255)
    card.paste(art, (art_pad, art_pad), amask)

    d = ImageDraw.Draw(card)
    # 插画描边
    d.rounded_rectangle([art_pad, art_pad, art_pad + art.size[0] - 1, art_pad + art_h - 1],
                        radius=10, outline=_rgb(mix(accent, (0, 0, 0), 0.55)) + (255,), width=1)
    # 外框
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], radius=16,
                        outline=_rgb(mix(accent, (0, 0, 0), 0.62)) + (255,), width=2)

    # 费用珠
    cx, cy, r = 30, 30, 24
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(42, 63, 102, 255), outline=accent + (255,), width=2)
    try:
        f_cost = ImageFont.truetype(FONT_PATH, 26)
        f_name = ImageFont.truetype(FONT_PATH, 21)
        f_text = ImageFont.truetype(FONT_PATH, 16)
        f_tag = ImageFont.truetype(FONT_PATH, 14)
    except Exception:
        f_cost = f_name = f_text = f_tag = ImageFont.load_default()

    if cost is not None:
        t = str(cost)
        bb = d.textbbox((0, 0), t, font=f_cost)
        d.text((cx - (bb[2] - bb[0]) / 2, cy - (bb[3] - bb[1]) / 2 - 3), t,
               fill=(159, 227, 255, 255), font=f_cost)

    # 名字（居中，超长自动缩）
    y_name = art_pad + art_h + 16
    fs = 21
    while fs > 11:
        f_name = ImageFont.truetype(FONT_PATH, fs)
        bb = d.textbbox((0, 0), name, font=f_name)
        if bb[2] - bb[0] <= cw - 40:
            break
        fs -= 1
    bb = d.textbbox((0, 0), name, font=f_name)
    d.text(((cw - (bb[2] - bb[0])) / 2, y_name), name, fill=(207, 228, 255, 255), font=f_name)

    # 描述（自动换行）
    y = y_name + fs + 12
    maxw = cw - art_pad * 2
    line = ""
    for chx in text:
        if d.textlength(line + chx, font=f_text) > maxw:
            d.text((art_pad, y), line, fill=(125, 138, 168, 255), font=f_text)
            y += 22
            line = chx
        else:
            line += chx
    if line:
        d.text((art_pad, y), line, fill=(125, 138, 168, 255), font=f_text)

    # 类型标签
    tag = {"starter": "初始", "passive": "被动", "active": "主动"}.get(kind, kind)
    tw_ = d.textlength(tag, font=f_tag)
    d.rounded_rectangle([art_pad, ch - 34, art_pad + tw_ + 16, ch - 14], radius=9,
                        fill=_rgb(mix(accent, (0, 0, 0), 0.78)) + (255,))
    d.text((art_pad + 8, ch - 32), tag, fill=accent + (255,), font=f_tag)
    return card


def make_ui_preview(imgs):
    """把全部卡做成"手里抓着的一排"，看真实观感。"""
    cols, pad = 5, 22
    cw, chh = 300, 417
    rows = math.ceil(len(imgs) / cols)
    Wc = cols * cw + (cols + 1) * pad
    Hc = rows * chh + (rows + 1) * pad
    sheet = Image.new("RGB", (Wc, Hc), (10, 12, 22))
    for i, (cid, name, im) in enumerate(imgs):
        r, col = divmod(i, cols)
        x = pad + col * (cw + pad)
        y = pad + r * (chh + pad)
        card = render_card_frame(im, name, COSTS.get(cid), KINDS.get(cid, "active"),
                                 TEXTS.get(cid, ""), (cw, chh))
        sheet.paste(card, (x, y), card)
    path = os.path.join(OUT_DIR, "_ui_preview.png")
    sheet.save(path)
    print("  ✓", path)


COSTS = {
    "hougeki": 1, "bougyo": 1, "houyokutenshou": 2,
    "a_meteor": 2, "a_focus": 0, "a_cleanse": 1, "a_bounty": 1, "a_slow": 2, "a_restore": 2,
    "p_sharp": None, "p_heavy": None, "p_rapid": None, "p_spell_wide": None, "p_spell_bane": None,
}
KINDS = {cid: kind for cid, (_, _, kind) in CARD_ART.items()}
TEXTS = {
    "hougeki": "5 秒内向前方持续发射 3 束符札。",
    "bougyo": "清除周围弹幕，获得 2.5 秒无敌。",
    "houyokutenshou": "发射穿透的凤凰造成高额伤害，命中者虚弱并燃烧 10 秒。",
    "p_sharp": "卡牌伤害 +3。",
    "p_heavy": "卡牌伤害 ×1.6。",
    "p_rapid": "打出卡牌所需间隔 ×0.85。",
    "p_spell_wide": "符卡的无敌时间 +1 秒。",
    "p_spell_bane": "符卡释放时对全体敌人造成 400 伤害。",
    "a_meteor": "对全体敌人造成 250 点伤害。",
    "a_focus": "抽 1 张牌，回复 1 点能量。",
    "a_cleanse": "清除全屏敌弹。",
    "a_bounty": "获得 30 蜃銭。",
    "a_slow": "敌弹速度降为一半，持续 3 秒。",
    "a_restore": "恢复 1 张符卡。",
}


if __name__ == "__main__":
    print("渲染卡面 →", OUT_DIR)
    imgs = render_all()
    make_ui_preview(imgs)
