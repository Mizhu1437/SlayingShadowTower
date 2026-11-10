/**
 * 四幕背景与静止遮罩。
 *
 * 结构（自下而上）：
 *   far   TilingSprite  速度 0.00   ← 天空在真实飞行中不动
 *   mid   TilingSprite  速度 0.30
 *   near  TilingSprite  速度 0.75
 *   overlay Sprite      不滚动      ← 保证弹幕可读性，硬约束
 *   ──── 以下为战场内容（由 GameRenderer 添加）────
 *
 * 三条不能破的约束（见 docs/ART-STAGE.md 第三、六节）：
 *   1. 静止遮罩必须有，且不能省。它是保证亮背景下弹幕可读的唯一手段。
 *      遮罩不能画进滚动图层 —— 图层一滚，暗区就跑走了，压不住任何东西。
 *   2. 远景速度必须为 0。真实飞行里天空不动，动了会晕。
 *   3. 切幕只换纹理，不销毁重建 TilingSprite。
 *      重建会瞬间闪白，且丢掉 tilePosition 造成跳变。
 */

import { Assets, Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { FIELD_W, FIELD_H } from '../core/world';

/** 三层视差的速度倍率（像素/秒，乘以基准速度） */
const LAYER_SPEED = [0, 0.30, 0.75] as const;

/** 基准滚动速度（px/s）。近景按 0.75 算，约 135 px/s。 */
const BASE_SCROLL = 180;

const ACT_COUNT = 4;

export class StageBackdrop {
  readonly root: Container;

  private far!: TilingSprite;
  private mid!: TilingSprite;
  private near!: TilingSprite;
  private overlay!: Sprite;

  /** 当前幕（1 起），0 表示尚未设置 */
  private currentAct = 0;

  /** 纹理缓存：act → [far, mid, near, overlay] */
  private readonly cache = new Map<number, Texture[]>();

  constructor() {
    this.root = new Container();
    this.root.label = 'backdrop';
  }

  /**
   * 预加载全部四幕纹理。
   *
   * 一次性全部加载而不是切幕时按需加载：
   * 四幕共 16 张图，总量很小；按需加载会在切幕时卡顿一下。
   */
  async preload(): Promise<void> {
    const base = import.meta.env.BASE_URL ?? '/';
    console.log('[backdrop] preload 开始, base =', base);

    for (let act = 1; act <= ACT_COUNT; act++) {
      const names = [
        `act${act}_far.png`,
        `act${act}_mid.png`,
        `act${act}_near.png`,
        `act${act}_overlay.png`,
      ];
      const urls = names.map((n) => `${base}art/stages/${n}`.replace('//', '/'));
      console.log('[backdrop] 加载', urls[0]);
      const textures = await Promise.all(urls.map((u) => Assets.load<Texture>(u)));
      console.log('[backdrop] act', act, '完成', textures.length);
      this.cache.set(act, textures);
    }
  }

  /**
   * 构建图层。必须在 preload 之后调用。
   */
  build(): void {
    const tex = this.cache.get(1);
    if (!tex) throw new Error('StageBackdrop: 请先 preload()');

    const [farT, midT, nearT, ovT] = tex as [Texture, Texture, Texture, Texture];

    // TilingSprite 的高度用场地高度的两倍：
    // 纹理本身 384×768（纵向无缝），tilePosition 递增时视觉上无限滚动。
    // 注意：不要设置 tileScale。
    //
    // 纹理是 384×768，纵向无缝循环。TilingSprite 的可视区域是 384×448，
    // 平铺时超出部分自然裁掉，滚动时永远有内容填满 —— 这正是无缝纹理的用法。
    // 之前把 tileScale.y 设成 448/768 把纹理压扁，
    // 压扁后单个周期只有 448 高，一滚动就露底，看起来像背景没加载。
    const make = (t: Texture): TilingSprite =>
      new TilingSprite({ texture: t, width: FIELD_W, height: FIELD_H });

    this.far = make(farT);
    this.mid = make(midT);
    this.near = make(nearT);

    this.overlay = new Sprite(ovT);
    this.overlay.width = FIELD_W;
    this.overlay.height = FIELD_H;

    this.root.addChild(this.far, this.mid, this.near, this.overlay);

    this.currentAct = 1;
  }

  /**
   * 切到指定幕。只换纹理，不重建对象。
   *
   * @param act 幕编号（0 起，与 world.currentAct 一致）
   */
  setAct(act: number): void {
    const actNo = Math.max(1, Math.min(ACT_COUNT, act + 1));
    if (actNo === this.currentAct) return;

    const tex = this.cache.get(actNo);
    if (!tex) return;

    const [farT, midT, nearT, ovT] = tex as [Texture, Texture, Texture, Texture];
    this.far.texture = farT;
    this.mid.texture = midT;
    this.near.texture = nearT;
    this.overlay.texture = ovT;

    this.currentAct = actNo;
  }

  /**
   * 每帧推进滚动。
   *
   * @param dt 距上一帧的秒数
   */
  update(dt: number): void {
    if (!this.far) return;

    // 远景速度为 0：天空不动
    this.far.tilePosition.y += LAYER_SPEED[0] * BASE_SCROLL * dt;
    this.mid.tilePosition.y += LAYER_SPEED[1] * BASE_SCROLL * dt;
    this.near.tilePosition.y += LAYER_SPEED[2] * BASE_SCROLL * dt;
  }

  /**
   * 当前幕的远景纹理（供横版外框生成两侧延伸）。
   *
   * 为什么用远景而不是近景：近景层几乎全透明（平均亮度约 1），
   * 拿它做边缘延伸会得到一片黑。远景是天空，不透明且有颜色，
   * 横向拉伸后正好是"背景向两侧自然延伸"的效果。
   */
  get farTexture(): Texture | null {
    return this.far?.texture ?? null;
  }

  /** 当前幕（1 起） */
  get act(): number {
    return this.currentAct;
  }
}
