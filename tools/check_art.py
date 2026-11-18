#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
素材验收脚本。

生图模型交付素材后，运行本脚本一次性检查「能不能直接放进项目用」。
所有检查项都对应真实代码约束 —— 不是审美建议，是技术门禁。

**注意**：卡牌插画（cards/*.png）不在本批次范围内，
由项目作者自行设计，因此脚本不检查卡面。

用法：
    python tools/check_art.py                    # 检查 public/art
    python tools/check_art.py path/to/incoming   # 检查别的目录

退出码 0 = 全部通过，1 = 有问题（会列出具体条目）。
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("需要 Pillow：pip install Pillow")
    sys.exit(2)


# ── 规格表：相对路径 → (宽, 高, 是否需要 alpha) ──

STAGES_W, STAGES_H = 384, 768
OVERLAY_W, OVERLAY_H = 384, 448

SPEC: dict[str, tuple[int, int, bool]] = {}

# 关卡背景（far/near，纵向无缝）
for _act in range(1, 5):
    # far 是天空底，不透明；near 是叠加的雾/光尘，需要透明
    SPEC[f"stages/act{_act}_far.png"] = (STAGES_W, STAGES_H, False)
    SPEC[f"stages/act{_act}_near.png"] = (STAGES_W, STAGES_H, True)
    SPEC[f"stages/act{_act}_overlay.png"] = (OVERLAY_W, OVERLAY_H, True)

# UI 元素（必须透明）
SPEC["ui/coin_icon.png"] = (30, 30, True)
SPEC["ui/energy_full.png"] = (34, 34, True)
SPEC["ui/energy_empty.png"] = (34, 34, True)
SPEC["ui/spell_full.png"] = (46, 46, True)
SPEC["ui/spell_empty.png"] = (46, 46, True)
for _act in range(1, 5):
    SPEC[f"ui/act_banner_{_act}.png"] = (420, 96, True)

# 战斗像素绘（自机 + 7 种敌人）
SPEC["pixel/pixel_player.png"] = (48, 48, True)
SPEC["pixel/pixel_grunt.png"] = (32, 32, True)
SPEC["pixel/pixel_fan.png"] = (40, 40, True)
SPEC["pixel/pixel_ring.png"] = (48, 48, True)
SPEC["pixel/pixel_elite_spiral.png"] = (56, 56, True)
SPEC["pixel/pixel_elite_burst.png"] = (60, 60, True)
SPEC["pixel/pixel_midboss.png"] = (80, 80, True)
SPEC["pixel/pixel_boss.png"] = (96, 96, True)

# 标题背景
SPEC["ui/title_bg.png"] = (1920, 1080, False)

# 机体立绘
SPEC["chara/chara_mokou.png"] = (600, 900, True)

# 纵向无缝检查的目标（只有这些需要能上下拼接）
SEAMLESS = [
    f"stages/act{a}_{layer}.png"
    for a in range(1, 5) for layer in ("far", "near")
]


def check_seamless(im: Image.Image, tol: float = 8.0) -> tuple[bool, str]:
    """
    纵向无缝：第一行与最后一行在平均色上应当接近。

    为什么用平均差而不是逐像素：生成式素材很难做到像素级完全一致，
    只要平均色差足够小，滚动时的接缝就看不出来。
    """
    w, h = im.size
    rgb = im.convert("RGB")
    top = [0.0, 0.0, 0.0]
    bot = [0.0, 0.0, 0.0]
    for x in range(w):
        tp = rgb.getpixel((x, 0))
        bp = rgb.getpixel((x, h - 1))
        for i in range(3):
            top[i] += tp[i]
            bot[i] += bp[i]
    diff = sum(abs(top[i] - bot[i]) / w for i in range(3)) / 3
    return diff <= tol, f"上下边缘平均色差 {diff:.1f}（阈值 {tol}）"


def check_center_subject(im: Image.Image) -> tuple[bool, str]:
    """
    主体不应压在最上/最下 160px —— 那里要留给循环拼接。

    判断方式：边缘带的亮度方差应明显低于中部。
    方差大说明边缘有明显的物体轮廓。
    """
    gray = im.convert("L")
    w, h = gray.size
    band = 160

    def variance(y0: int, y1: int) -> float:
        vals = [
            gray.getpixel((x, y))
            for y in range(y0, max(y0 + 1, y1), 8)
            for x in range(0, w, 8)
        ]
        if not vals:
            return 0.0
        mean = sum(vals) / len(vals)
        return sum((v - mean) ** 2 for v in vals) / len(vals)

    edge = max(variance(0, band), variance(h - band, h))
    mid = variance(h // 3, h * 2 // 3)
    ok = edge <= mid * 1.8 + 60
    return ok, f"边缘方差 {edge:.0f} / 中部方差 {mid:.0f}"


def check_pixel_art(im: Image.Image) -> tuple[bool, str]:
    """
    像素画专项：检查颜色数是否够少、边缘是否够硬。

    判断「是不是真像素画」的两个可量化特征：
      1. 颜色数少（<=24 含透明）—— 插画缩放过来的图会有成百上千种颜色
      2. 相邻像素存在大量完全相同或完全不同的跳变（硬边），
         而抗锯齿图会有大量中间过渡色

    这里只做颜色数检查 —— 它最稳定，能可靠区分"真像素画"与"插画缩小图"。
    """
    rgba = im.convert("RGBA")
    colors = rgba.getcolors(maxcolors=100000)
    if colors is None:
        return False, "颜色数超过 10 万，明显不是像素画"

    n = len(colors)
    if n > 64:
        return False, f"颜色数 {n}，像素画应 ≤64（含透明与半透明）"

    return True, f"颜色数 {n}"


def check_alpha(im: Image.Image) -> tuple[bool, str]:
    """必须有真透明区域（不是整张不透明）。"""
    if im.mode != "RGBA":
        return False, f"模式是 {im.mode}，需要 RGBA"

    alpha = im.getchannel("A")
    lo, _hi = alpha.getextrema()
    if lo > 250:
        return False, "alpha 全为不透明（没有镂空）"
    return True, f"alpha 最低 {lo}"


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/art")

    if not root.exists():
        print(f"目录不存在：{root}")
        return 2

    missing: list[str] = []
    invalid: list[str] = []
    ok_count = 0

    for rel, (ew, eh, need_alpha) in SPEC.items():
        f = root / rel
        if not f.exists():
            missing.append(rel)
            continue

        try:
            im = Image.open(f)
        except Exception as e:  # noqa: BLE001
            invalid.append(f"{rel}（无法读取：{e}）")
            continue

        problems: list[str] = []

        if im.size != (ew, eh):
            problems.append(f"尺寸 {im.size[0]}×{im.size[1]}，应为 {ew}×{eh}")

        if need_alpha:
            good, msg = check_alpha(im)
            if not good:
                problems.append(f"透明通道：{msg}")

        if rel.startswith("pixel/"):
            good, msg = check_pixel_art(im)
            if not good:
                problems.append(f"像素画：{msg}")

        if rel in SEAMLESS:
            good, msg = check_seamless(im)
            if not good:
                problems.append(f"纵向无缝：{msg}")

            good, msg = check_center_subject(im)
            if not good:
                problems.append(f"主体位置：{msg}")

        if problems:
            invalid.append(f"{rel}：{'；'.join(problems)}")
        else:
            ok_count += 1

    # ── 报告 ──
    print("=" * 66)
    print("  素材验收报告")
    print(f"  目录：{root}")
    print("  （卡牌插画不在本批次范围内，未检查）")
    print("=" * 66)

    if missing:
        print(f"\n缺失 {len(missing)} 个：")
        for m in missing:
            print(f"  x {m}")

    if invalid:
        print(f"\n不合规 {len(invalid)} 个：")
        for m in invalid:
            print(f"  x {m}")

    total = len(SPEC)
    print(f"\n通过 {ok_count} / {total}")

    if ok_count == total:
        print("\n[OK] 全部通过，可以直接放进 public/art/")
        return 0

    print("\n按上面的条目修正后重新检查。")
    return 1


if __name__ == "__main__":
    sys.exit(main())