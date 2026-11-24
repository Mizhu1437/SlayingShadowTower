from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "vibe_images"
OUT = ROOT / "public" / "art"

# 只处理自机像素绘。
#
# 敌人不使用像素图 —— 战场上由代码用几何图形直接绘制，
# 这样体型与碰撞半径能严格对应，且颜色可随状态实时变化。
SPRITES = {
    "pixel_player": ("pixel_player_source_1794973783438_3977ae0b.png", 48),
}

# (源文件, 目标尺寸, 横向偏移, 是否镜像)
#
# 对话画面的站位是固定的：**自机在左、敌人在右**。
# 因此朝向也是固定的：
#   自机 —— 必须朝右，望向画面中央（敌人那边）
#   敌人 —— 必须朝左，望向画面中央（自机那边）
#
# 源图朝哪边，就用这个开关扳回来。判断以作者的肉眼为准，
# 不靠看图猜 —— 首版曾把三张全部读反，改完反而全错。
# 2026-11-24 实测复核：三张成品的朝向全部反了，全部镜像。
#
# 判断依据是**成品图**而不是源图 —— 上一版按源图判断，结果全错。
#   妹红：脸朝左  → 要朝右 → 翻转
#   千亦：脸朝右  → 要朝左 → 翻转
#   贝子：脸朝右  → 要朝左 → 翻转
PORTRAITS = {
    # 成品朝左 → 翻成朝右
    "chara/chara_mokou.png": ("chara_mokou_source_1794973709007_f34d94e4.png", (600, 900), 0, True),
    # 成品朝右 → 翻成朝左
    "enemy/enemy_chiyi.png": ("enemy_chiyi_source_1794973729294_547468c2.png", (700, 1000), 20, True),
    # 成品朝右 → 翻成朝左
    "enemy/enemy_beizi.png": ("enemy_beizi_source_1794973753571_bfe21cc3.png", (700, 1000), -20, False),
}


def white_background_alpha(im: Image.Image, soft: bool) -> Image.Image:
    rgba = np.asarray(im.convert("RGBA")).copy()
    rgb = rgba[..., :3].astype(np.int16)
    minimum = rgb.min(axis=2)
    maximum = rgb.max(axis=2)
    threshold = 245 if soft else 222
    spread = 24 if soft else 42
    candidate = (minimum > threshold) & ((maximum - minimum) < spread)
    seeds = np.zeros(candidate.shape, dtype=bool)
    seeds[0, :] = candidate[0, :]
    seeds[-1, :] = candidate[-1, :]
    seeds[:, 0] = candidate[:, 0]
    seeds[:, -1] = candidate[:, -1]
    background = ndimage.binary_propagation(seeds, mask=candidate)
    alpha = np.where(background, 0, 255).astype(np.uint8)
    if soft:
        edge = ndimage.binary_dilation(background, iterations=1) & ~background
        softness = np.clip((255 - minimum) * 255 / 45, 0, 255).astype(np.uint8)
        alpha[edge] = np.minimum(alpha[edge], softness[edge])
    rgba[..., 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def crop_alpha(im: Image.Image, threshold: int = 8) -> Image.Image:
    bbox = im.getchannel("A").point(lambda a: 255 if a > threshold else 0).getbbox()
    if not bbox:
        raise ValueError("No foreground found")
    return im.crop(bbox)


def process_sprite(source: Path, target: int) -> Image.Image:
    im = Image.open(source).convert("RGBA")
    w, h = im.size
    clear = Image.new("RGBA", im.size, (255, 255, 255, 255))
    mask = Image.new("L", im.size, 0)
    mask_arr = np.asarray(mask).copy()
    mask_arr[int(h * 0.89):, int(w * 0.84):] = 255
    im = Image.composite(clear, im, Image.fromarray(mask_arr, "L"))
    im = crop_alpha(white_background_alpha(im, soft=False), 128)
    base = target // 2
    im.thumbnail((base - 2, base - 2), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (base, base), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((base - im.width) // 2, (base - im.height) // 2))
    alpha = canvas.getchannel("A")
    quantized = canvas.convert("RGB").quantize(colors=15, method=Image.Quantize.MEDIANCUT).convert("RGBA")
    quantized.putalpha(alpha.point(lambda a: 255 if a >= 128 else 0))
    return quantized.resize((target, target), Image.Resampling.NEAREST)


def process_portrait(source: Path, size: tuple[int, int], x_shift: int,
                     flip: bool = False) -> Image.Image:
    im = crop_alpha(white_background_alpha(Image.open(source), soft=True))
    # 镜像放在裁切之后：alpha bbox 已经定好，翻过来尺寸不变。
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    im.thumbnail((size[0] - 24, size[1] - 24), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - im.width) // 2 + x_shift
    y = size[1] - im.height - 12
    canvas.alpha_composite(im, (x, y))
    return canvas


def process_title() -> Image.Image:
    im = Image.open(SOURCE / "title_bg_source_1794973770437_571e5b1d.png").convert("RGB")
    w, _ = im.size
    cropped = im.crop((0, 0, w, 960))
    target_ratio = 16 / 9
    crop_w = round(cropped.height * target_ratio)
    left = (cropped.width - crop_w) // 2
    cropped = cropped.crop((left, 0, left + crop_w, cropped.height))
    return cropped.resize((1920, 1080), Image.Resampling.LANCZOS)


def make_preview(images: dict[str, Image.Image]) -> None:
    tile = 192
    preview = Image.new("RGB", (tile * 4, tile * 2), (10, 12, 26))
    for index, (name, im) in enumerate(images.items()):
        enlarged = im.resize((160, 160), Image.Resampling.NEAREST)
        x = (index % 4) * tile + 16
        y = (index // 4) * tile + 16
        preview.paste(enlarged, (x, y), enlarged)
    preview.save(ROOT / "docs" / "art" / "_pixel_preview.png")


def main() -> None:
    for folder in ("pixel", "chara", "enemy", "ui"):
        (OUT / folder).mkdir(parents=True, exist_ok=True)
    processed = {}
    # 源图可能被作者移除（例如敌人像素绘改为自行处理）。
    # 缺源就跳过，保留 public/art 里已有的成品，不报错中断。
    for name, (filename, target) in SPRITES.items():
        source = SOURCE / filename
        if not source.exists():
            print(f"[skip] 缺少源图：{filename}")
            continue
        im = process_sprite(source, target)
        im.save(OUT / "pixel" / f"{name}.png")
        processed[name] = im
    for relative, (filename, size, shift, flip) in PORTRAITS.items():
        source = SOURCE / filename
        if not source.exists():
            print(f"[skip] 缺少源图：{filename}")
            continue
        process_portrait(source, size, shift, flip).save(OUT / relative)
    title_source = SOURCE / "title_bg_source_1794973770437_571e5b1d.png"
    if title_source.exists():
        process_title().save(OUT / "ui" / "title_bg.png")
    if processed:
        make_preview(processed)


if __name__ == "__main__":
    main()
