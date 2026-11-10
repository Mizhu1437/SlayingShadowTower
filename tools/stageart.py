"""
四幕场景背景生成器 —— 纵向无缝循环 + 多层视差。

为什么是「图层」而不是「一张图」：
    东方正作的背景会随推进滚动。做法是若干张可纵向无缝循环的贴图，
    各自以不同速度下滚（远层慢、近层快），叠出纵深。
    所以这里每幕产出 3 张 tile：far / mid / near。

无缝的关键：
    所有内容按 tile 高度「包裹」绘制（在 y、y-H、y+H 各画一份），
    先画在比 tile 高的画布上，模糊之后裁出中间段。
    只要 PAD > 最大模糊半径，裁出来的图上下就能直接对接。
    竖直方向的渐变也必须用周期函数（cyclic_gradient_rows），否则接缝会露。

配色对齐 src/render/gameRenderer.ts 的 COLORS 表。

运行：
    python tools/stageart.py
输出：
    docs/art/stages/act{N}_far|mid|near.png   384×512 无缝 tile
    docs/art/stages/_acts_preview.png         四幕实机合成（含弹幕可读性对照）
    docs/art/stages/_scroll_demo.png          滚动示意
"""

from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ─────────────────────────────────────────────
# 尺寸
# ─────────────────────────────────────────────
FIELD_W, FIELD_H = 384, 448         # 与 src/core/world.ts 一致
# tile 高度必须明显大于视窗（448），否则一滚动就见底、接缝立刻重复。
# 768 ≈ 1.7 倍视窗，滚动约 1.7 屏才循环一次，观感自然。
W_TILE, H_TILE = 384, 768
SS = 2                              # 超采样
RW, RH = W_TILE * SS, H_TILE * SS   # 渲染尺寸
PAD = 140                           # 包裹绘制用的上下留白（渲染像素）

# 所有「构图比例」按可见窗口计算，而不是 RH。
# 原因：tile 高 768，但游戏视窗只显示 448。
# 若按 RH 铺排，地平线、太阳这些大结构会落到视窗之外，画面上只剩一片空。
VIS_H = FIELD_H * SS


def V(t: float) -> float:
    """构图比例 → 可见窗口内的渲染像素 y（含 PAD 偏移）。"""
    return t * VIS_H + PAD

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_STAGE = os.path.join(ROOT, "docs", "art", "stages")

FONT_CN = r"C:\Windows\Fonts\msyh.ttc"
FONT_CN_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

# 与 renderer 对齐的基础色
CYAN = (126, 200, 255)
CYAN_HI = (159, 227, 255)
VIOLET = (199, 155, 255)
MAGENTA = (255, 107, 138)
GOLD = (255, 212, 121)
ORANGE = (255, 166, 61)
RED = (255, 77, 46)
FIRE_CORE = (255, 242, 176)
PAPER = (236, 232, 245)


# ─────────────────────────────────────────────
# 基础工具
# ─────────────────────────────────────────────
def C(rgb, a=255):
    return (int(rgb[0]), int(rgb[1]), int(rgb[2]), int(a))


def mix(c1, c2, t):
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))


def wraps(y: float):
    """返回某个 y 在画布上的三个包裹副本（含 PAD 偏移）。"""
    return (y - RH + PAD, y + PAD, y + RH + PAD)


def phase_of(y_padded: np.ndarray) -> np.ndarray:
    """画布某行（含 PAD 偏移）对应的周期相位 [0,1)。"""
    idx = y_padded - PAD
    return (idx % RH) / RH


def cyclic_gradient_rows(n: int, stops) -> np.ndarray:
    """
    周期渐变：stops 是 [(相位, rgb), ...]，首尾自动闭合。

    注意：必须按 PAD 偏移计算相位，不能用 linspace(0,1,n)。
    用 linspace 会把一个周期铺满「画布高度（含留白）」，
    结果色带位置错位、并且 tile 上下接不上。
    """
    ps = np.array([s[0] for s in stops], np.float64)
    cs = np.array([s[1] for s in stops], np.float64)
    ps = np.append(ps, ps[0] + 1.0)
    cs = np.vstack([cs, cs[0][None, :]])

    t = phase_of(np.arange(n))
    out = np.zeros((n, 3), np.float64)
    for i in range(len(ps) - 1):
        m = (t >= ps[i]) & (t <= ps[i + 1])
        if not m.any():
            continue
        u = (t[m] - ps[i]) / max(1e-9, ps[i + 1] - ps[i])
        u = u * u * (3 - 2 * u)                      # smoothstep
        out[m] = cs[i] + (cs[i + 1] - cs[i]) * u[:, None]
    return out


class Canvas:
    """
    float32 RGB 累积画布 + 覆盖率（alpha）通道。

    为什么要单独记 cov：
        「深色剪影」和「发光」在合成时是两回事。
        深色剪影必须**遮挡**它后面的层（普通 alpha 合成），
        而光效是**叠加**（加色）。如果两者都用加色，
        深色的山林就会变成「不存在」。
    """

    def __init__(self, w: int = RW, h: int = RH + 2 * PAD, base=(0, 0, 0), opaque=False):
        self.w, self.h = w, h
        self.base = np.zeros((h, w, 3), np.float32)
        self.base[:] = np.array(base, np.float32)
        self.cov = np.ones((h, w, 1), np.float32) if opaque else np.zeros((h, w, 1), np.float32)

    def layer(self):
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        return im, ImageDraw.Draw(im)

    def commit(self, im, mode="normal", blur=0.0, opacity=1.0):
        if blur > 0:
            im = im.filter(ImageFilter.GaussianBlur(blur))
        a = np.asarray(im, np.float32) / 255.0
        rgb = a[..., :3] * 255.0
        alpha = a[..., 3:4] * opacity
        if mode == "add":
            # 加色：只提亮
            self.base = self.base + rgb * alpha
        else:
            # 普通合成：既改色也改色值
            self.base = self.base * (1 - alpha) + rgb * alpha
        # 关键：加色同样要累加覆盖度。
        # 否则「光效」在透明底的中/近景层上只会得到 alpha=0，
        # 后续 alpha 合成时整层光效全部消失（这是中景/近景发黑的真正原因）。
        self.cov = self.cov + alpha * (1 - self.cov)

    def tile(self) -> Image.Image:
        """裁出中间的无缝段，降采样，输出 RGBA。"""
        rgb = np.clip(self.base, 0, 255).astype(np.uint8)
        a = np.clip(self.cov * 255, 0, 255).astype(np.uint8)
        im = Image.fromarray(np.concatenate([rgb, a], axis=2), "RGBA")
        im = im.crop((0, PAD, RW, PAD + RH))
        return im.resize((W_TILE, H_TILE), Image.LANCZOS)


def fill_periodic_gradient(cv: Canvas, stops, noise=1.6, seed=0):
    """用周期渐变铺满整张（含 PAD），并加轻微噪点消除色带。"""
    rows = cyclic_gradient_rows(cv.h, stops)
    rng = np.random.default_rng(seed)
    rows = rows + rng.normal(0, noise, (cv.h, 1))
    cv.base[:] = np.clip(rows, 0, 255)[:, None, :]
    cv.cov[:] = 1.0


def horizontal_vignette(img: Image.Image, strength=0.30, power=2.4) -> Image.Image:
    """左右压暗——只沿 x 变化，不破坏纵向无缝。"""
    arr = np.asarray(img, np.float32).copy()
    x = np.linspace(-1, 1, arr.shape[1])
    k = (1.0 - strength * np.abs(x) ** power)[None, :, None]
    arr[..., :3] = arr[..., :3] * k
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), img.mode)


def grain(img: Image.Image, amount=3.0, seed=1) -> Image.Image:
    """加噪。只作用于 RGB，alpha 保持不变。"""
    rng = np.random.default_rng(seed)
    arr = np.asarray(img, np.float32).copy()
    n = rng.normal(0, amount, arr.shape[:2])[..., None]
    arr[..., :3] = np.clip(arr[..., :3] + n, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), img.mode)


def ridge_polygon(draw, y_base, amp, seed, color, alpha=255, steps=26, width=RW):
    """
    一条横贯整幅的山脊剪影，按包裹位置画三份。

    两个易错点：
      1. 填充深度只到**本周期末尾**，不能超（否则包裹副本互相覆盖，天空被吃掉）。
      2. 端点要向上收口并左右略微溢出画布，否则山脊两端会出现直角切边。
    """
    rng = np.random.default_rng(seed)
    pts = []
    for i in range(steps + 1):
        x = width * i / steps
        y = (y_base
             + math.sin(i * 0.62 + seed * 0.7) * amp * 0.55
             + math.sin(i * 1.9 + seed * 1.3) * amp * 0.22
             + rng.uniform(-amp * 0.16, amp * 0.16))
        pts.append((x, y))

    local = (y_base - PAD) % RH        # 脊线在周期内的位置
    depth = RH - local                 # 填到本周期结束
    # 两端各向外溢出一点，避免竖直直角边露出来
    over = width * 0.05

    for y0 in wraps(y_base):
        dy = y0 - y_base
        bottom = y0 + depth
        seq = [(p[0], p[1] + dy) for p in pts]
        poly = ([(-over, seq[0][1] - amp * 0.35)] + seq +
                [(width + over, seq[-1][1] - amp * 0.35),
                 (width + over, bottom), (-over, bottom)])
        draw.polygon(poly, fill=C(color, alpha))


def soft_band(cv: Canvas, y, height, color, alpha=40, blur=40):
    """一条柔和的横向雾带（周期包裹）。"""
    im, d = cv.layer()
    for y0 in wraps(y):
        d.rectangle([0, y0 - height / 2, RW, y0 + height / 2], fill=C(color, alpha))
    cv.commit(im, "add", blur=blur)


def glow_dot(cv: Canvas, x, y, r, color, alpha=140, blur=18, mode="add"):
    im, d = cv.layer()
    for y0 in wraps(y):
        d.ellipse([x - r, y0 - r, x + r, y0 + r], fill=C(color, alpha))
    cv.commit(im, mode, blur=blur)


def info_marks(cv: Canvas, count, seed, color, alpha=(40, 120),
               size=(1.2, 4.0), y_range=(0, RH), blur=3, add=True):
    """
    「信息」碎屑：断开的短线、小方块、括号碎片。
    不写可读文字——只保留文字的骨架感。
    """
    rng = np.random.default_rng(seed)
    im, d = cv.layer()
    for _ in range(count):
        x = rng.uniform(0, RW)
        y = rng.uniform(y_range[0], y_range[1])
        a = rng.uniform(alpha[0], alpha[1])
        w = rng.uniform(size[0], size[1]) * SS
        kind = rng.integers(0, 3)
        for y0 in wraps(y):
            if kind == 0:                      # 横线
                d.line([(x, y0), (x + w * 3, y0)], fill=C(color, a), width=int(w))
            elif kind == 1:                    # 小方块
                d.rectangle([x, y0, x + w * 1.6, y0 + w * 1.6], fill=C(color, a))
            else:                              # 竖笔
                d.line([(x, y0), (x, y0 + w * 3)], fill=C(color, a), width=int(max(1, w * 0.8)))
    cv.commit(im, "add" if add else "normal", blur=blur)


def particles(cv: Canvas, count, seed, color, alpha=(60, 200), r=(0.8, 2.4),
              y_range=(0, RH), blur=2):
    rng = np.random.default_rng(seed)
    im, d = cv.layer()
    for _ in range(count):
        x = rng.uniform(0, RW)
        y = rng.uniform(y_range[0], y_range[1])
        rr = rng.uniform(r[0], r[1]) * SS
        a = rng.uniform(alpha[0], alpha[1])
        for y0 in wraps(y):
            d.ellipse([x - rr, y0 - rr, x + rr, y0 + rr], fill=C(color, a))
    cv.commit(im, "add", blur=blur)
