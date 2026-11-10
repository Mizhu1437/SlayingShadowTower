"""
四幕场景装配 + 预览。

产出：
  docs/art/stages/act{N}_far.png   远景层（最慢滚动）
  docs/art/stages/act{N}_mid.png   中景层
  docs/art/stages/act{N}_near.png  近景层（最快滚动）
  docs/art/stages/_acts_preview.png    四幕实机合成
  docs/art/stages/_seam_check.png      纵向无缝自检
  docs/art/stages/_scroll_demo.png     视差滚动示意

所有 tile 为 384×512，纵向无缝循环。
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stageart import (  # noqa: E402
    OUT_STAGE, W_TILE, H_TILE, FIELD_W, FIELD_H, grain,
    FONT_CN, FONT_CN_BOLD, CYAN, CYAN_HI, MAGENTA, GOLD, VIOLET, PAPER, C, mix,
)
import stage_acts as A  # noqa: E402
import stage_acts4 as A4  # noqa: E402

# tile 内构图的起点偏移（成品像素）
# = PAD / SS：构图从可见窗口顶端开始画，而窗口顶端比 tile 顶边低这么多
COMPOSE_OFF = 140 // 2


# ─────────────────────────────────────────────
# 四幕定义
# ─────────────────────────────────────────────
ACTS = {
    1: {
        "name": "第一幕 · 塔外",
        "sub": "妖怪之山 · 流言",
        # 远景 speed=0：天空与远山不随飞行移动（真实飞行里天空是静止的）
        "layers": [("far", A.act1_far, 0.0), ("mid", A.act1_mid, 0.30), ("near", A.act1_near, 0.75)],
        "tint": (255, 214, 180),
    },
    2: {
        "name": "第二幕 · 塔内",
        "sub": "影像",
        "layers": [("far", A.act2_far, 0.22), ("mid", A.act2_mid, 0.45), ("near", A.act2_near, 0.85)],
        "tint": (170, 200, 255),
    },
    3: {
        "name": "第三幕 · 塔内深处",
        "sub": "伪真",
        "layers": [("far", A.act3_far, 0.22), ("mid", A.act3_mid, 0.45), ("near", A.act3_near, 0.85)],
        "tint": (255, 170, 210),
    },
    4: {
        "name": "第四幕 · 塔顶",
        "sub": "剥落",
        # 星空与云海不动，只有近处的云在飞
        "layers": [("far", A4.act4_far, 0.0), ("mid", A4.act4_mid, 0.26), ("near", A4.act4_near, 0.72)],
        "tint": (255, 226, 200),
    },
}


def ensure_dirs():
    os.makedirs(OUT_STAGE, exist_ok=True)


# ─────────────────────────────────────────────
# 渲染
# ─────────────────────────────────────────────
def render_act(act_no: int):
    act = ACTS[act_no]
    outs = {}
    for layer_name, fn, _speed in act["layers"]:
        img = fn()
        img = grain(img, 2.6, seed=act_no * 100 + len(layer_name))
        path = os.path.join(OUT_STAGE, f"act{act_no}_{layer_name}.png")
        img.save(path)
        outs[layer_name] = img
        print(f"  ✓ {path}")
    return outs


def composite(tiles: dict, scroll_y: float = 0.0, view_w: int = FIELD_W,
              view_h: int = FIELD_H) -> Image.Image:
    """按视差速度把三层合成一帧画面（用于预览）。"""
    act_layers = tiles["_layers"]
    canvas = Image.new("RGB", (view_w, view_h), (0, 0, 0))
    for layer_name, img, speed in act_layers:
        off = int(scroll_y * speed) % H_TILE
        # 纵向平铺两张，取中间窗口
        strip = Image.new("RGB", (view_w, H_TILE * 2), (0, 0, 0))
        for k in range(2):
            strip.paste(img, (0, k * H_TILE))
        crop = strip.crop((0, off, view_w, off + view_h))
        canvas = Image.blend(canvas, crop, 0.0) if False else canvas
        canvas.paste(crop, (0, 0)) if layer_name == "far" else None
        if layer_name != "far":
            base = canvas.convert("RGBA")
            over = crop.convert("RGBA")
            # near/mid 层自带黑底，用正片叠底式的加亮合成
            base = Image.alpha_composite(base, over)
            canvas = base.convert("RGB")
    return canvas


def make_static_overlay(act_no: int, w: int = FIELD_W, h: int = FIELD_H):
    """
    静止覆盖层 —— 这是保证弹幕可读性的关键。

    为什么不把压暗画进滚动图层：
        图层会滚动，暗区会跟着跑走，压不住任何东西。
        玩家躲弹时不会因为「刚好滚到亮的地方」而看不清子弹。

    做法：从上到下一条渐变，画面顶部保留背景（看风景），
    中下部压到接近黑 —— 这才是东方正作"背景亮但不妨碍读弹"的实际手段。
    """
    import numpy as np

    # 各幕压暗强度：(起始位置, 结束位置, 最大不透明度)
    # 战斗区在下半屏，压暗从中上部起步、到底部最大。
    # 关键教训：这里只是「轻微把下半屏收暗」，不是「把画面变黑」。
    # 第一、四幕背景本身很亮才需要压；二、三幕本来就暗，压 0.3 以上就糊死了。
    cfg = {
        1: (0.36, 0.88, 0.62),
        2: (0.30, 0.88, 0.22),
        3: (0.30, 0.88, 0.24),
        4: (0.30, 0.88, 0.50),
    }[act_no]
    y0, y1, amax = cfg

    ys = np.arange(h, dtype=np.float32) / max(1, h - 1)
    t = np.clip((ys - y0) / max(1e-6, y1 - y0), 0, 1)
    t = t * t * (3 - 2 * t)                      # smoothstep
    alpha = (t * amax * 255).astype(np.uint8)[:, None]

    arr = np.zeros((h, w, 4), np.uint8)
    arr[..., 0] = 4
    arr[..., 1] = 5
    arr[..., 2] = 12
    arr[..., 3] = np.repeat(alpha, w, axis=1)
    return Image.fromarray(arr, "RGBA")


def composite_add(tiles: dict, scroll_y: float = 0.0,
                  view_w: int = FIELD_W, view_h: int = FIELD_H,
                  act_no: int = 1) -> Image.Image:
    """
    三层按视差滚动后做 **alpha 合成**（不是加色）。

    为什么改成 alpha：
        深色剪影（山、杉林、檐角）在加色模式下等于「不存在」——
        加色只能提亮，无法遮挡。而塔内/塔顶的暗部正是靠遮挡立起来的。
        发光内容本身已经在各层里用 add 模式累加好了，输出仍是带 alpha 的图。

    far 层是底（含天空渐变），mid/near 覆在其上。
    """
    import numpy as np
    act_layers = tiles["_layers"]

    # 底层：far（不透明）
    # 注意偏移：tile 内的构图是按「可见窗口起点」画的（stageart.V），
    # 这个起点比 tile 顶边低 COMPOSE_OFF。取窗口时要把这段补回去，
    # 否则预览会显示 tile 顶部那片空白。
    far_img = tiles["_raw"]["far"]
    speed_far = [s for n, _i, s in act_layers if n == "far"][0]
    off = (int(scroll_y * speed_far) + COMPOSE_OFF) % H_TILE
    strip = np.concatenate([np.asarray(far_img, np.float32)] * 2, axis=0)
    acc = strip[off:off + view_h, 0:view_w]
    acc[..., 3] = 255.0
    out = Image.fromarray(acc.astype("uint8"), "RGBA")

    # mid / near 用**加法叠加**（screen-like），不用 alpha 合成。
    #
    # 为什么：这两层是「黑底 + 光效」，本身没有深色剪影。
    # 用 alpha 合成时，大片中低 alpha 会把 far 层压暗（光晕边缘尤其明显），
    # 结果二、三幕整体糊成黑的。加法叠加只提亮、不减暗，才对。
    # 深色剪影（山脊、柱、檐角）都已经画在 far 层的 opaque 底上了。
    base = np.asarray(out.convert("RGB"), np.float32)

    for layer_name in ("mid", "near"):
        img = tiles["_raw"][layer_name]
        speed = [s for n, _i, s in act_layers if n == layer_name][0]
        off = (int(scroll_y * speed) + COMPOSE_OFF) % H_TILE
        arr = np.asarray(img, np.float32)
        strip = np.concatenate([arr] * 2, axis=0)
        crop = strip[off:off + view_h, 0:view_w]
        rgb = crop[..., :3]
        a = (crop[..., 3:4] / 255.0)
        base = base + rgb * a

    out = Image.fromarray(np.clip(base, 0, 255).astype("uint8"), "RGB").convert("RGBA")
    out = Image.alpha_composite(out, make_static_overlay(act_no, view_w, view_h))
    return out.convert("RGB")


def make_acts_preview(all_tiles: dict):
    """
    四幕并排 + 每幕两张：纯背景 / 叠了占位弹幕的可读性对照。
    后者才是决定成败的那张。
    """
    cols = 4
    pad, label_h, gap = 20, 54, 14
    sw, sh = FIELD_W, FIELD_H
    two = 2  # 每幕：背景 + 带弹幕
    cw = cols * (sw * two + gap) + (cols + 1) * pad
    ch = len([1]) * (sh + label_h) + pad * 2
    sheet = Image.new("RGB", (cw, ch), (10, 11, 20))
    d = ImageDraw.Draw(sheet)
    try:
        f_big = ImageFont.truetype(FONT_CN_BOLD, 22)
        f_small = ImageFont.truetype(FONT_CN, 16)
    except Exception:
        f_big = f_small = ImageFont.load_default()

    for i, act_no in enumerate(sorted(ACTS)):
        act = ACTS[act_no]
        x0 = pad + i * (sw * two + gap + pad)
        y0 = pad + 44

        # 左：纯背景
        bg = composite_add(all_tiles[act_no], scroll_y=0, act_no=act_no)
        sheet.paste(bg, (x0, y0))

        # 右：加占位弹幕
        bs = add_placeholder_bullets(bg, act_no)
        sheet.paste(bs, (x0 + sw + gap, y0))

        d.text((x0, pad + 8), f"{act['name']}", fill=(226, 236, 255), font=f_big)
        d.text((x0 + 200, pad + 14), f"信息层：{act['sub']}", fill=(130, 150, 190), font=f_small)
        d.text((x0, y0 + sh + 6), "纯背景", fill=(110, 128, 168), font=f_small)
        d.text((x0 + sw + gap, y0 + sh + 6), "叠弹幕（可读性对照）", fill=(110, 128, 168), font=f_small)

    path = os.path.join(OUT_STAGE, "_acts_preview.png")
    sheet.save(path)
    print(f"  ✓ {path}")


def add_placeholder_bullets(bg: Image.Image, act_no: int) -> Image.Image:
    """在背景上叠一层占位弹幕，检验亮背景下子弹是否还读得出来。"""
    import random
    im = bg.copy().convert("RGB")
    d = ImageDraw.Draw(im, "RGBA")
    rng = random.Random(act_no * 77)

    # 统一给子弹加深色描边 —— 这是让亮背景也能读的关键
    for _ in range(150):
        x = rng.uniform(10, FIELD_W - 10)
        y = rng.uniform(10, FIELD_H - 10)
        r = rng.uniform(2.6, 5.2)
        # 暗描边
        d.ellipse([x - r - 1.6, y - r - 1.6, x + r + 1.6, y + r + 1.6],
                  fill=(6, 8, 18, 190))
        # 亮核心
        d.ellipse([x - r, y - r, x + r, y + r], fill=C(CYAN_HI, 255))
        d.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45],
                  fill=(255, 255, 255, 255))
    # 少量红色弹（BOSS 弹）
    for _ in range(25):
        x = rng.uniform(10, FIELD_W - 10)
        y = rng.uniform(10, FIELD_H - 10)
        r = rng.uniform(3.4, 6.4)
        d.ellipse([x - r - 1.8, y - r - 1.8, x + r + 1.8, y + r + 1.8],
                  fill=(8, 4, 14, 200))
        d.ellipse([x - r, y - r, x + r, y + r], fill=C(MAGENTA, 250))
        d.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45],
                  fill=(255, 240, 245, 255))
    return im


def make_seam_check(all_tiles: dict):
    """
    无缝自检：把每张 tile 上下各拼一份，接缝是否可见。
    红线标出接缝位置。
    """
    rows = []
    for act_no in sorted(ACTS):
        row = []
        for layer_name, _fn, _sp in ACTS[act_no]["layers"]:
            img = all_tiles[act_no]["_raw"][layer_name]
            strip = Image.new("RGB", (W_TILE, H_TILE * 2), (0, 0, 0))
            strip.paste(img, (0, 0))
            strip.paste(img, (0, H_TILE))
            t = strip.resize((W_TILE // 2, H_TILE), Image.LANCZOS)
            d = ImageDraw.Draw(t)
            d.line([(0, H_TILE // 2), (t.width, H_TILE // 2)], fill=(255, 0, 0), width=1)
            row.append(t)
        rows.append((act_no, row))

    cell_w = W_TILE // 2
    pad = 12
    cw = pad + 3 * (cell_w + pad)
    ch = pad + len(rows) * (H_TILE + pad)
    sheet = Image.new("RGB", (cw, ch), (10, 11, 20))
    d = ImageDraw.Draw(sheet)
    try:
        f = ImageFont.truetype(FONT_CN, 15)
    except Exception:
        f = ImageFont.load_default()
    for r, (act_no, row) in enumerate(rows):
        for c, t in enumerate(row):
            x = pad + c * (cell_w + pad)
            y = pad + r * (H_TILE + pad)
            sheet.paste(t, (x, y))
        d.text((pad, pad - 2 + r * (H_TILE + pad)), str(act_no), fill=(200, 220, 255), font=f)
    path = os.path.join(OUT_STAGE, "_seam_check.png")
    sheet.save(path)
    print(f"  ✓ {path}")


def make_scroll_demo(all_tiles: dict):
    """视差滚动示意：同一幕的 4 个滚动位置并排。"""
    act_no = 1
    frames = [composite_add(all_tiles[act_no], scroll_y=y, act_no=act_no)
              for y in (0, 220, 440, 660)]
    pad = 12
    w = FIELD_W // 2
    h = FIELD_H // 2
    cw = pad + len(frames) * (w + pad)
    ch = pad + h + pad
    sheet = Image.new("RGB", (cw, ch), (10, 11, 20))
    for i, fr in enumerate(frames):
        sheet.paste(fr.resize((w, h), Image.LANCZOS), (pad + i * (w + pad), pad))
    path = os.path.join(OUT_STAGE, "_scroll_demo.png")
    sheet.save(path)
    print(f"  ✓ {path}")


# ─────────────────────────────────────────────
def main():
    ensure_dirs()
    print("渲染四幕背景 →", OUT_STAGE)
    all_tiles = {}
    for act_no in sorted(ACTS):
        tiles = render_act(act_no)
        layers = [(name, tiles[name], speed) for name, _fn, speed in ACTS[act_no]["layers"]]
        all_tiles[act_no] = {"_layers": layers, "_raw": tiles}

    print("生成预览…")
    make_acts_preview(all_tiles)
    make_seam_check(all_tiles)
    make_scroll_demo(all_tiles)
    print("完成。")


if __name__ == "__main__":
    main()
