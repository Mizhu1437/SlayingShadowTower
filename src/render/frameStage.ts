/**
 * 横版外框：战场居中，两侧由背景延伸铺满整个窗口。
 *
 * 布局（全屏）：
 *
 *   ┌────────────────────────────────────────────┐
 *   │ 面板 │        战场 384×448        │ 面板  │
 *   └────────────────────────────────────────────┘
 *
 * 两侧不再是"固定 150px 的窄条"，而是**铺满窗口剩余的全部空间**。
 * 这样面板可以真正贴在屏幕边缘，而不是挤在战场旁边。
 *
 * 三层（自下而上）：
 *   sideL / sideR   背景边缘横向拉伸，铺满两侧
 *   shade           两侧压暗渐变（让面板文字可读）
 *   field           战场（由 GameRenderer 挂入）
 */

import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';

/** 战场逻辑宽度 */
export const FIELD_W = 384;
/** 战场逻辑高度 */
export const FIELD_H = 448;

export class FrameStage {
  readonly root: Container;
  /** 战场容器（GameRenderer.root 挂到这里） */
  readonly fieldHost: Container;

  private sideL: Sprite | null = null;
  private sideR: Sprite | null = null;
  private shade: Graphics | null = null;

  /** 两侧延伸的宽度（由 main.ts 按窗口尺寸设置） */
  private sideWidth = 0;

  constructor() {
    this.root = new Container();

    this.fieldHost = new Container();
    this.root.addChild(this.fieldHost);
  }

  /**
   * 用背景图左右边缘生成两侧延伸，铺满窗口剩余宽度。
   *
   * @param farTexture 远景（天空）纹理。近景几乎全透明，不能用。
   * @param sideWidth 单侧宽度（像素，逻辑坐标）
   */
  setEdgeSource(farTexture: Texture, sideWidth: number): void {
    this.sideL?.destroy();
    this.sideR?.destroy();
    this.shade?.destroy();
    this.sideWidth = Math.max(0, sideWidth);

    if (this.sideWidth <= 0) return;

    const edgeW = 24;
    const h = farTexture.height;
    const mk = (x: number): Texture =>
      new Texture({
        source: farTexture.source,
        frame: new Rectangle(x, 0, edgeW, h),
      });

    this.sideL = new Sprite(mk(0));
    this.sideR = new Sprite(mk(farTexture.width - edgeW));

    for (const s of [this.sideL, this.sideR]) {
      s.width = this.sideWidth;
      s.height = FIELD_H;
      s.tint = 0x6a7896;   // 压一档，让战场显得更亮更聚焦
      s.alpha = 0.75;
    }

    this.sideL.position.set(-this.sideWidth, 0);
    this.sideR.position.set(FIELD_W, 0);

    this.root.addChildAt(this.sideR, 0);
    this.root.addChildAt(this.sideL, 0);

    this.buildShade();
  }

  /**
   * 两侧压暗：从外向内逐渐变透明，面板文字有对比度，
   * 同时不切断战场的视觉边界。
   */
  private buildShade(): void {
    const g = new Graphics();
    const STEPS = 28;
    const w = this.sideWidth;
    if (w <= 0) return;

    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      const x = -w + t * w;
      g.rect(x, 0, w / STEPS + 1, FIELD_H)
        .fill({ color: 0x05060c, alpha: 0.82 * (1 - t) });
    }
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      const x = FIELD_W + t * w;
      g.rect(x, 0, w / STEPS + 1, FIELD_H)
        .fill({ color: 0x05060c, alpha: 0.82 * t });
    }

    this.shade = g;
    this.root.addChildAt(g, 1);
  }

  /** 战场外框细线 */
  buildFieldBorder(): void {
    const g = new Graphics()
      .rect(0, 0, FIELD_W, FIELD_H)
      .stroke({ width: 1, color: 0x3a4a75, alpha: 0.5 });
    this.root.addChild(g);
  }
}
