/**
 * 画面布局计算。
 *
 * 目标：任何窗口尺寸下，战场都占据合理的视觉重心，
 * 手牌区紧贴其下，两侧留白按比例分配。
 *
 * 关键点：**不能用固定像素**。
 * 早期用「底部预留 264px」，在 1600×900 上占 29% 刚好，
 * 但在 2560×1560 上只占 17% —— 战场被压得过小，下方一大堆空地。
 * 现在全部改成按视口高度的比例算。
 */

/** 战场逻辑尺寸 */
export const FIELD_W = 384;
export const FIELD_H = 448;

/**
 * 竖直方向的占比分配。
 *
 * 关键约束：**必须留足底部空间给手牌区**，否则手牌会溢出视口。
 * 手牌的实际高度约为 190 × uiScale，按钮约 40 × uiScale，
 * 灵力行约 34 × uiScale —— 所以底部区块按 uiScale 动态算，
 * 不能写死比例（大屏时手牌也会跟着放大）。
 */
const RATIO = {
  top: 0.055,     // 幕次横幅留白
  bar: 0.04,      // 底部按钮留白
} as const;

/** 底部区块的高度基准（px @ uiScale=1） */
const BOTTOM_BASE = {
  spirit: 34,     // 灵力 + 符卡
  hand: 152,      // 手牌卡片
  count: 18,      // 手牌数量行
  gaps: 12,
} as const;

/**
 * 战场与手牌区的基准宽度比。
 *
 * 手牌 6 张 × 92px + 间隙 ≈ 580px；战场按比例缩放后
 * 宽度要与这个数量级匹配，避免大屏上战场和手牌尺寸脱节。
 */
const HAND_BASE_W = 600;

export interface Layout {
  vw: number;
  vh: number;
  /** 战场缩放倍率 */
  scale: number;
  /** 战场左上角 */
  fieldX: number;
  fieldY: number;
  /** 战场像素尺寸 */
  fieldW: number;
  fieldH: number;
  /** 手牌区可用宽度 */
  handW: number;
  /** UI 缩放（手牌字号、按钮等跟随） */
  uiScale: number;
}

export function computeLayout(): Layout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // UI 缩放：以 1600×900 为基准 1.0
  const uiScale = Math.max(0.8, Math.min(1.45, vh / 900));

  // 底部区块按 uiScale 放大，必须先扣掉它，战场才不会被挤到视口外
  const bottomNeeded =
    (BOTTOM_BASE.spirit + BOTTOM_BASE.hand + BOTTOM_BASE.count + BOTTOM_BASE.gaps)
    * uiScale;

  const topZone = vh * RATIO.top;
  const barZone = vh * RATIO.bar;

  // 战场可用的高度 = 视口 - 顶部 - 底部区块 - 按钮区
  const availH = Math.max(200, vh - topZone - bottomNeeded - barZone);

  /*
   * 主缩放 = 高度能塞下的最大倍数。
   *
   * 早期还额外限制了「宽度不超过视口 46%」，那是为了给两侧状态面板留位。
   * 但实际战场上下的留白已经足够，横向再卡 46% 只会让战场无谓变小。
   * 现在宽度上限放宽到 62%，让战场尽量吃满可用高度。
   */
  const byH = availH / FIELD_H;
  const byW = (vw * 0.62) / FIELD_W;
  const scale = Math.max(0.55, Math.min(byH, byW));

  const fieldW = Math.round(FIELD_W * scale);
  const fieldH = Math.round(FIELD_H * scale);
  const fieldX = Math.round((vw - fieldW) / 2);
  const fieldY = Math.round(topZone);

  // 手牌区宽度：不小于能放下 6 张卡，也不超过视口
  const handW = Math.min(vw - 40, Math.max(HAND_BASE_W, fieldW));

  return {
    vw, vh, scale,
    fieldX, fieldY, fieldW, fieldH,
    handW,
    uiScale,
  };
}
