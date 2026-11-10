/**
 * 横版外框：把竖版战场嵌进横版画面。
 *
 * 为什么这么做：
 *   背景素材是 384×768 的竖版 tile，但整体画面要像东方正作那样是横版。
 *   东方正作的做法是「中间战场 + 两侧留边」，两侧不是纯色，
 *   而是背景向外的自然延伸。
 *
 * 实现：
 *   取战场背景的左右边缘各一条竖带，横向拉伸并模糊，作为两侧的底衬。
 *   这样两侧的颜色、纹理与战场连续，不会出现生硬的接缝。
 *
 * 三层结构（自下而上）：
 *   sideL / sideR  虚化延伸（不参与游戏逻辑）
 *   field          现有 root，居中
 *   vignette       两侧压暗渐变，让面板文字可读
 */

import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

/** 战场宽度（逻辑坐标） */
export const FIELD_W = 384;
/** 战场高度 */
export const FIELD_H = 448;

/** 战场两侧各留出的面板宽度（逻辑坐标） */
export const SIDE_W = 150;

/** 整体画面的逻辑宽度 */
export const FRAME_W = FIELD_W + SIDE_W * 2;

export class FrameStage {
  readonly root: Container;
  /** 战场容器（现有 GameRenderer.root 挂到这里） */
  readonly fieldHost: Container;

  private sideL: Sprite | null = null;
  private sideR: Sprite | null = null;

  constructor() {
    this.root = new Container();

    this.fieldHost = new Container();
    // 战场居中：左右各留 SIDE_W
    this.fieldHost.position.set(SIDE_W, 0);

    this.root.addChild(this.fieldHost);
  }

  /**
   * 用背景图的左右边缘生成两侧虚化延伸。
   *
   * @param nearTexture 近景纹理（它最贴近观者，颜色最接近战场边缘）
   */
  setEdgeSource(nearTexture: Texture): void {
    this.sideL?.destroy();
    this.sideR?.destroy();

    // 取边缘 24px 宽的竖条
    const edgeW = 24;
    const h = nearTexture.height;
    const mk = (x: number): Texture =>
      new Texture({
        source: nearTexture.source,
        frame: new Rectangle(x, 0, edgeW, h),
      });

    const leftTex = mk(0);
    const rightTex = mk(nearTexture.width - edgeW);

    this.sideL = new Sprite(leftTex);
    this.sideR = new Sprite(rightTex);

    // 横向拉伸到 SIDE_W，纵向铺满
    for (const s of [this.sideL, this.sideR]) {
      s.width = SIDE_W;
      s.height = FIELD_H;
      // 让延伸部分比战场暗一档，暗示"战场之外"
      s.tint = 0x8090b0;
      s.alpha = 0.55;
    }

    this.sideL.position.set(0, 0);
    this.sideR.position.set(SIDE_W + FIELD_W, 0);

    // 插到最底层
    this.root.addChildAt(this.sideR, 0);
    this.root.addChildAt(this.sideL, 0);

    this.buildSideShade();
  }

  /**
   * 两侧压暗：中间透明、向外渐黑。
   * 作用是让面板文字有足够对比度，同时不切断战场的视觉边界。
   */
  private buildSideShade(): void {
    const g = new Graphics();

    // 左：从 x=0 的深黑渐变到 x=SIDE_W 的透明
    const STEPS = 24;
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      const x = t * SIDE_W;
      g.rect(x, 0, SIDE_W / STEPS + 1, FIELD_H)
        .fill({ color: 0x05060c, alpha: 0.72 * (1 - t) });
    }
    // 右：镜像
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      const x = SIDE_W + FIELD_W + t * SIDE_W;
      g.rect(x, 0, SIDE_W / STEPS + 1, FIELD_H)
        .fill({ color: 0x05060c, alpha: 0.72 * t });
    }

    this.root.addChildAt(g, 1);
  }

  /**
   * 战场外框细线，标出可玩区域的边界。
   */
  buildFieldBorder(): void {
    const g = new Graphics()
      .rect(SIDE_W, 0, FIELD_W, FIELD_H)
      .stroke({ width: 1, color: 0x3a4a75, alpha: 0.55 });
    this.root.addChildAt(g, this.root.children.length - 1);
  }
}
