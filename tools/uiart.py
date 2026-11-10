"""
关卡 UI 素材生成器 —— 和风 × 信息感。

产出（docs/art/ui/）：
    frame_panel.png      通用面板框（9-slice，圆角 18 / 边框 36）
    energy_cell.png      能量格（满/空两态各一张）
    spell_slot.png       符卡槽（有/无 两态）
    progress_wave.png    波次进度条（底 / 填充 各一张）
    act_banner.png       幕次横幅（四幕各一张，配色不同）
    coin_icon.png        蜃銭图标
    _hud_mockup.png      全套 UI 装进实际布局的预览

设计约束：
  · 与四幕背景同一套调色板，避免 UI 和场景割裂
  · 和风元素：青海波、角饰、符札形（竖长圆角）
  · 信息感：极细的高光线 + 缓慢流动的纹样
  · 所有素材留 alpha，便于叠在任意背景上

运行：
    python tools/uiart.py
"""

from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "art", "ui")

FONT_CN = r"C:\Windows\Fonts\msyh.ttc"
FONT_CN_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"

# 与渲染层/四幕共用的色
CYAN = (126, 200, 255)
CYAN_HI = (159, 227, 255)
VIOLET = (199, 155, 255)
MAGENTA = (255, 107, 138)
GOLD = (255, 212, 121)
GOLD_HI = (255, 246, 207)
ORANGE = (255, 166, 61)
RED = (255, 77, 46)
INK = (10, 12, 24)

SS = 3          # 超采样


def C(rgb, a=255):
    return (int(rgb[0]), int(rgb[1]), int(rgb[2]), int(a))


def mix(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def canvas(w, h):
    im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im), w, h


def finish(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


def glow_layer(size, draw_fn, blur):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    draw_fn(d)
    return im.filter(ImageFilter.GaussianBlur(blur))


def composite_add(base: Image.Image, layer: Image.Image) -> Image.Image:
    """加法叠加（光效不应压暗底下）。"""
    b = np.asarray(base.convert("RGBA"), np.float32)
    l = np.asarray(layer, np.float32)
    a = l[..., 3:4] / 255.0
    b[..., :3] = np.clip(b[..., :3] + l[..., :3] * a, 0, 255)
    b[..., 3:4] = np.clip(b[..., 3:4] + l[..., 3:4] * (1 - b[..., 3:4] / 255.0), 0, 255)
    return Image.fromarray(b.astype(np.uint8), "RGBA")


# ─────────────────────────────────────────────
# 通用零件
# ─────────────────────────────────────────────
def seigaiha_band(d, x0, y0, x1, y1, r, color, alpha=60, width=1):
    """青海波横带 —— 用作面板的分隔装饰。"""
    step = r * 1.15
    x = x0 - step
    i = 0
    while x < x1 + step:
        cy = y0 if i % 2 == 0 else y0 + r * 0.55
        for k in range(2):
            kk = 1 - 0.3 * k
            d.arc([x - r * kk, cy - r * kk, x + r * kk, cy + r * kk],
                  start=180, end=360, fill=C(color, alpha - k * 18), width=width)
        x += step
        i += 1


def corner_ornament(d, cx, cy, size, color, alpha=210, rot=0):
    """
    角饰：两条内折的细线 + 一个小菱。
    和风框角的常见处理，比重描边廉价但有效。
    """
    ca, sa = math.cos(rot), math.sin(rot)

    def T(px, py):
        return (cx + px * ca - py * sa, cy + px * sa + py * ca)

    lw = max(1, int(size * 0.10))
    d.line([T(0, size), T(0, size * 0.34), T(size * 0.34, 0), T(size, 0)],
           fill=C(color, alpha), width=lw, joint="curve")
    d.line([T(size * 0.16, size * 0.5), T(size * 0.5, size * 0.16)],
           fill=C(color, int(alpha * 0.55)), width=max(1, lw // 2))
    # 小菱
    s = size * 0.12
    d.polygon([T(size * 0.34, size * 0.34 - s), T(size * 0.34 + s, size * 0.34),
               T(size * 0.34, size * 0.34 + s), T(size * 0.34 - s, size * 0.34)],
              fill=C(color, alpha))


# ─────────────────────────────────────────────
# 1. 通用面板框（9-slice）
# ─────────────────────────────────────────────
PANEL_W, PANEL_H = 320, 300
PANEL_INSET = 44          # 9-slice 的边框宽度
PANEL_RADIUS = 22


def make_frame_panel(accent=CYAN):
    im, d, w, h = canvas(PANEL_W, PANEL_H)
    W, H = PANEL_W * SS, PANEL_H * SS
    R = PANEL_RADIUS * SS
    inset = PANEL_INSET * SS

    # 底板：自上而下的深色渐变
    body = np.zeros((H, W, 4), np.float32)
    for y in range(H):
        t = y / H
        col = mix((22, 28, 48), (12, 15, 28), t)
        body[y, :, :3] = col
        body[y, :, 3] = 236
    body_im = Image.fromarray(body.astype(np.uint8), "RGBA")

    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=R, fill=255)
    body_im.putalpha(Image.composite(body_im.getchannel("A"), Image.new("L", (W, H), 0), mask))
    im = Image.alpha_composite(im, body_im)
    d = ImageDraw.Draw(im)

    # 内发光（顶部一道微光，模拟受光）
    d.rounded_rectangle([inset, inset, W - inset, H - inset], radius=R * 0.7,
                        outline=C(accent, 26), width=int(2 * SS))

    # 主边框
    d.rounded_rectangle([1, 1, W - 2, H - 2], radius=R,
                        outline=C(mix(accent, INK, 0.35), 235), width=int(2.2 * SS))
    # 内侧细线
    d.rounded_rectangle([7 * SS, 7 * SS, W - 7 * SS, H - 7 * SS], radius=R - 4 * SS,
                        outline=C(accent, 90), width=int(1.1 * SS))

    # 四角角饰：尺寸适中，四角都向内折
    for (cx, cy, rot) in [(inset, inset, 0),
                          (W - inset, inset, math.pi / 2),
                          (W - inset, H - inset, math.pi),
                          (inset, H - inset, -math.pi / 2)]:
        corner_ornament(d, cx, cy, 16 * SS, accent, 205, rot)

    # 顶部装饰带（青海波）
    # 放在内框上方、贴着主边框，避开内容区
    seigaiha_band(d, inset, inset - 16 * SS, W - inset, inset - 16 * SS,
                  5 * SS, accent, 40, max(1, int(0.9 * SS)))

    # 外发光
    gl = glow_layer((W, H), lambda g: (
        g.rounded_rectangle([1, 1, W - 2, H - 2], radius=R,
                            outline=C(accent, 150), width=int(2 * SS))), 7 * SS)
    im = composite_add(im, gl)

    return finish(im, PANEL_W, PANEL_H)


# ─────────────────────────────────────────────
# 2. 能量格
# ─────────────────────────────────────────────
def make_energy_cell(filled: bool, accent=CYAN):
    S = 34
    im, d, w, h = canvas(S, S)
    W = H = S * SS
    cx, cy, r = W / 2, H / 2, W * 0.40

    # 外框：菱形（符片意象）
    def diamond(rr):
        return [(cx, cy - rr), (cx + rr, cy), (cx, cy + rr), (cx - rr, cy)]

    d.polygon(diamond(r), fill=C((16, 22, 40), 230),
              outline=C(mix(accent, INK, 0.25), 240) if filled else C((70, 82, 110), 200),
              width=int(2.0 * SS))

    if filled:
        # 内发光 + 亮心
        gl = glow_layer((W, H), lambda g: g.polygon(diamond(r * 0.62), fill=C(accent, 200)), 5 * SS)
        im = composite_add(im, gl)
        d = ImageDraw.Draw(im)
        d.polygon(diamond(r * 0.55), fill=C(mix(accent, (255, 255, 255), 0.35), 235))
        d.polygon(diamond(r * 0.28), fill=C((255, 255, 255), 245))
    else:
        d.polygon(diamond(r * 0.30), fill=C((42, 52, 76), 190))

    return finish(im, S, S)


# ─────────────────────────────────────────────
# 3. 符卡槽
# ─────────────────────────────────────────────
def make_spell_slot(filled: bool):
    W_, H_ = 46, 46
    im, d, w, h = canvas(W_, H_)
    W, H = W_ * SS, H_ * SS
    cx, cy = W / 2, H / 2
    accent = VIOLET if filled else (78, 88, 116)

    # 圆底
    r = W * 0.42
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C((16, 20, 38), 232),
              outline=C(mix(accent, INK, 0.2), 240), width=int(2.0 * SS))

    # 中心符札形
    tw, th = W * 0.11, H * 0.24
    if filled:
        gl = glow_layer((W, H), lambda g: g.rounded_rectangle(
            [cx - tw, cy - th, cx + tw, cy + th], radius=3 * SS, fill=C(accent, 210)), 5 * SS)
        im = composite_add(im, gl)
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([cx - tw, cy - th, cx + tw, cy + th], radius=3 * SS,
                            fill=C(mix(accent, (255, 255, 255), 0.55), 250))
        # 札上的三道笔触
        for k in range(3):
            yy = cy - th * 0.45 + k * th * 0.42
            d.line([(cx - tw * 0.45, yy), (cx + tw * 0.45, yy)],
                   fill=C(VIOLET, 200), width=max(1, int(1.1 * SS)))
    else:
        d.rounded_rectangle([cx - tw, cy - th, cx + tw, cy + th], radius=3 * SS,
                            outline=C(accent, 190), width=max(1, int(1.3 * SS)))

    return finish(im, W_, H_)


# ─────────────────────────────────────────────
# 4. 波次进度条
# ─────────────────────────────────────────────
BAR_W, BAR_H = 260, 12


def make_progress_bar(fill: bool, accent=CYAN):
    im, d, w, h = canvas(BAR_W, BAR_H)
    W, H = BAR_W * SS, BAR_H * SS
    r = H / 2

    if not fill:
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=r,
                            fill=C((14, 18, 34), 220),
                            outline=C(mix(accent, INK, 0.45), 220), width=int(1.2 * SS))
        # 内层的斜纹（未填充时的底纹）
        for x in range(0, W, int(10 * SS)):
            d.line([(x, H), (x + H, 0)], fill=C(accent, 26), width=int(1.0 * SS))
    else:
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=r,
                            fill=C(mix(accent, (255, 255, 255), 0.25), 245))
        # 顶部高光
        d.rounded_rectangle([int(2 * SS), int(1.5 * SS), W - int(2 * SS), int(H * 0.45)],
                            radius=r * 0.6, fill=C((255, 255, 255), 90))

    return finish(im, BAR_W, BAR_H)


# ─────────────────────────────────────────────
# 5. 幕次横幅
# ─────────────────────────────────────────────
BANNER_W, BANNER_H = 420, 96

ACT_STYLE = {
    1: ("第一幕", "妖怪之山 · 流言", (255, 186, 140)),
    2: ("第二幕", "塔内 · 影像", (150, 196, 255)),
    3: ("第三幕", "塔内深处 · 伪真", (255, 150, 200)),
    4: ("第四幕", "塔顶 · 剥落", (255, 226, 190)),
}


def make_act_banner(act_no: int):
    accent = ACT_STYLE[act_no][2]
    im, d, w, h = canvas(BANNER_W, BANNER_H)
    W, H = BANNER_W * SS, BANNER_H * SS
    cy = H / 2

    # 左右两条渐隐的长线，中央留空给文字用
    line_y = cy
    for side, x_end in ((-1, 0), (1, W)):
        x_far = x_end
        # 中央留出 150px 空白给幕名文字
        x_near = W / 2 + side * 78 * SS
        N = 56
        for i in range(N):
            t0 = i / N
            t1 = (i + 1) / N
            x0 = x_far + (x_near - x_far) * t0
            x1 = x_far + (x_near - x_far) * t1
            a = int(255 * (t0 ** 0.9))
            d.line([(x0, line_y), (x1, line_y)], fill=C(accent, a), width=int(3.0 * SS))
            d.line([(x0, line_y), (x1, line_y)], fill=C(accent, a // 4),
                   width=int(9.0 * SS))
        # 线尾的小菱（指向中央）
        tip = W / 2 + side * 74 * SS
        r = 6 * SS
        d.polygon([(tip, cy - r), (tip + side * r * 1.5, cy),
                   (tip, cy + r), (tip - side * r * 1.5, cy)],
                  fill=C(accent, 250))

    gl = glow_layer((W, H), lambda g: g.rectangle(
        [0, cy - 3 * SS, W, cy + 3 * SS], fill=C(accent, 90)), 13 * SS)
    im = composite_add(im, gl)

    return finish(im, BANNER_W, BANNER_H)


# ─────────────────────────────────────────────
# 6. 蜃銭图标
# ─────────────────────────────────────────────
def make_coin_icon():
    S = 30
    im, d, w, h = canvas(S, S)
    W = H = S * SS
    cx, cy, r = W / 2, H / 2, W * 0.36

    gl = glow_layer((W, H), lambda g: g.ellipse(
        [cx - r * 1.4, cy - r * 1.4, cx + r * 1.4, cy + r * 1.4], fill=C(GOLD, 150)), 5 * SS)
    im = composite_add(im, gl)
    d = ImageDraw.Draw(im)

    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=C(mix(GOLD, ORANGE, 0.30)),
              outline=C(GOLD_HI, 245), width=int(1.8 * SS))
    d.ellipse([cx - r * 0.66, cy - r * 0.66, cx + r * 0.66, cy + r * 0.66],
              outline=C(GOLD_HI, 200), width=int(1.0 * SS))
    # 方孔（和风铜钱）
    s = r * 0.30
    d.rectangle([cx - s, cy - s, cx + s, cy + s], fill=C((12, 14, 28), 200),
                outline=C(GOLD_HI, 210), width=max(1, int(1.1 * SS)))
    # 高光
    d.arc([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86],
          start=196, end=252, fill=C((255, 255, 255), 160), width=max(1, int(1.3 * SS)))

    return finish(im, S, S)


# ─────────────────────────────────────────────
# 7. HUD 整装预览
# ─────────────────────────────────────────────
def make_hud_mockup():
    """
    把 UI 素材装进实际布局：
    左侧信息面板 + 顶部幕次横幅 + 底部能量/符卡/手牌 + 波次进度。
    背景直接用第一幕的实机合成，检验 UI 在真实场景上是否清楚。
    """
    VW, VH = 1180, 760
    bg_path = os.path.join(ROOT, "docs", "art", "stages", "_hud_bg.png")

    # 用第一幕背景铺底
    try:
        bg = Image.open(bg_path).convert("RGB").resize((VW, VH), Image.LANCZOS)
    except Exception:
        bg = Image.new("RGB", (VW, VH), (8, 10, 18))
    base = bg.convert("RGBA")

    def paste(im, xy):
        nonlocal base
        base.alpha_composite(im, xy) if im.mode == "RGBA" else base.paste(im, xy)

    # ── 左侧信息面板 ──
    panel = make_frame_panel(CYAN).resize((250, 330), Image.LANCZOS)
    paste(panel, (26, 84))

    d0 = ImageDraw.Draw(base)
    try:
        f_k = ImageFont.truetype(FONT_CN, 15)
        f_v = ImageFont.truetype(FONT_CN_BOLD, 17)
        f_title = ImageFont.truetype(FONT_CN_BOLD, 20)
        f_small = ImageFont.truetype(FONT_CN, 13)
    except Exception:
        f_k = f_v = f_title = f_small = ImageFont.load_default()

    # 内容从面板内框内侧开始，避开角饰
    x0 = 26 + 52
    y = 84 + 56
    d0.text((x0, y), "戦 況", fill=C(CYAN_HI, 235), font=f_title, anchor="lm")
    rows = [("残机", "3"), ("符卡", "3 / 3"), ("击破", "47"), ("得分", "128,400"),
            ("蜃銭", "215"), ("幕次", "一"), ("波次", "6 / 12")]
    for k, v in rows:
        y += 34
        d0.text((x0, y), k, fill=C((125, 140, 175), 230), font=f_k, anchor="lm")
        d0.text((x0 + 128, y), v, fill=C((214, 230, 255), 245), font=f_v, anchor="rm")

    # 幕次横幅：线在下方，文字在上方（不与中央菱形打架）
    banner = make_act_banner(1)
    paste(banner, (VW // 2 - BANNER_W // 2, 26))
    d0.text((VW // 2, 26 + 26), ACT_STYLE[1][0] + "　" + ACT_STYLE[1][1],
            fill=C((255, 246, 236), 252), font=f_title, anchor="mm")

    # ── 右上：蜃銭图标 ──
    coin = make_coin_icon()
    paste(coin, (VW - 190, 104))
    d0.text((VW - 152, 119), "215", fill=C(GOLD_HI, 250), font=f_v, anchor="lm")

    # ── 右下：波次进度 ──
    bar_bg = make_progress_bar(False, CYAN).resize((250, 11), Image.LANCZOS)
    paste(bar_bg, (VW - 290, 148))
    fw = int(250 * 0.46)
    bar_fg = make_progress_bar(True, CYAN).resize((fw, 11), Image.LANCZOS)
    paste(bar_fg, (VW - 290, 148))
    d0.text((VW - 290, 172), "WAVE 6 / 12", fill=C((150, 170, 205), 235), font=f_small, anchor="lm")

    # ── 底部：能量 + 符卡 + 手牌 ──
    # 手牌区宽度 = 4 张 * (108 + 8) ≈ 464，从 x=560 起放不下（560+464 > 1180）。
    # 改为：能量/符卡靠左，手牌居中偏右但保证右边缘留 30px。 
    bottom = base.height
    hx = 300

    # 能量格
    filled = 3
    for i in range(5):
        cell = make_energy_cell(i < filled, CYAN)
        paste(cell, (hx + i * 40, bottom - 176))
    d0.text((hx, bottom - 196), "灵力", fill=C((140, 160, 200), 235), font=f_small, anchor="lm")

    # 符卡槽
    for i in range(3):
        slot = make_spell_slot(i < 3)
        paste(slot, (hx + 226 + i * 50, bottom - 186))
    d0.text((hx + 226, bottom - 200), "符卡  X", fill=C((140, 160, 200), 235), font=f_small, anchor="lm")

    # 手牌（复用卡面）
    card_dir = os.path.join(ROOT, "docs", "art", "cards")
    names = ["hougeki", "hougeki", "bougyo", "houyokutenshou"]
    costs = ["1", "1", "1", "2"]
    card_w, card_gap = 104, 8
    total_w = len(names) * card_w + (len(names) - 1) * card_gap
    card_x0 = VW - 26 - total_w          # 右对齐，留 26px 边距
    card_y = bottom - 150

    for i, (cid, cost) in enumerate(zip(names, costs)):
        p = os.path.join(card_dir, f"{cid}.png")
        if not os.path.exists(p):
            continue
        art = Image.open(p).convert("RGB").resize((card_w - 4, card_w - 4), Image.LANCZOS)
        card = Image.new("RGBA", (card_w, card_w + 46), (0, 0, 0, 0))
        dcard = ImageDraw.Draw(card)
        dcard.rounded_rectangle([0, 0, card_w - 1, card_w + 45], radius=7,
                                fill=C((20, 26, 42), 245),
                                outline=C((86, 116, 168), 235), width=2)
        card.paste(art, (2, 2))
        # 费珠
        dcard.ellipse([-3, -3, 21, 21], fill=C((42, 63, 102), 255),
                      outline=C(CYAN_HI, 255), width=2)
        dcard.text((9, 9), cost, fill=C(CYAN_HI, 255), font=f_k, anchor="mm")
        paste(card, (card_x0 + i * (card_w + card_gap), card_y))

    out = base.convert("RGB")
    path = os.path.join(OUT, "_hud_mockup.png")
    out.save(path)
    print("  ✓", path)
    return out


# ─────────────────────────────────────────────
def main():
    os.makedirs(OUT, exist_ok=True)
    print("渲染 UI 素材 →", OUT)

    jobs = [
        ("frame_panel.png", lambda: make_frame_panel(CYAN)),
        ("energy_full.png", lambda: make_energy_cell(True)),
        ("energy_empty.png", lambda: make_energy_cell(False)),
        ("spell_full.png", lambda: make_spell_slot(True)),
        ("spell_empty.png", lambda: make_spell_slot(False)),
        ("progress_bg.png", lambda: make_progress_bar(False)),
        ("progress_fill.png", lambda: make_progress_bar(True)),
        ("coin_icon.png", make_coin_icon),
    ]
    for name, fn in jobs:
        p = os.path.join(OUT, name)
        fn().save(p)
        print("  ✓", p)

    for a in (1, 2, 3, 4):
        p = os.path.join(OUT, f"act_banner_{a}.png")
        make_act_banner(a).save(p)
        print("  ✓", p)

    print("生成整装预览…")
    make_hud_mockup()
    print("完成。")


if __name__ == "__main__":
    main()
