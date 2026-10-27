/**
 * 能量系统。
 *
 * 规则（DESIGN.md 第三节）：
 *   上限 E = 3，回复间隔 = 抽牌间隔 T = 3.0s
 *   满能量时计时器清零，不累积
 *   每幕开局回满
 *   过载停顿期间能量照常回复（停的是抽牌，不是时间）
 */

import { LOGIC_DT } from '../loop';

export const ENERGY_CAP = 3;
/**
 * 能量回复间隔，与抽牌间隔共用同一个 T = 5.0 秒。
 *
 * 硬约束：这个值必须与 deck.ts 的 DRAW_INTERVAL 一致，
 * 否则「牌:能量 = 1:1」的耦合性质失效，过载中性也不再成立。
 */
export const ENERGY_INTERVAL = 5.0;

export class Energy {
  /** 当前能量 */
  value = ENERGY_CAP;

  /** 距离下一点能量的计时 */
  private timer = 0;

  readonly cap: number;
  readonly interval: number;

  constructor(cap = ENERGY_CAP, interval = ENERGY_INTERVAL) {
    this.cap = cap;
    this.interval = interval;
    this.value = cap;
  }

  reset(): void {
    this.value = this.cap;
    this.timer = 0;
  }

  /** 每幕开局回满 */
  refill(): void {
    this.value = this.cap;
    this.timer = 0;
  }

  get full(): boolean {
    return this.value >= this.cap;
  }

  /** 下一点能量的进度（0–1），供 UI 画进度条 */
  get progress(): number {
    if (this.full) return 1;
    return Math.min(1, this.timer / this.interval);
  }

  /** 是否有足够能量 */
  canPay(cost: number): boolean {
    return this.value >= cost;
  }

  /** 扣能量。不足时返回 false 且不扣。 */
  pay(cost: number): boolean {
    if (this.value < cost) return false;
    this.value -= cost;
    return true;
  }

  /** 回复能量（卡牌效果用），不超上限 */
  gain(n: number): void {
    this.value = Math.min(this.cap, this.value + n);
  }

  /** 推进一个逻辑步 */
  step(dt = LOGIC_DT): void {
    if (this.full) {
      // 满能量时计时器清零，不累积
      this.timer = 0;
      return;
    }

    this.timer += dt;
    if (this.timer >= this.interval) {
      this.timer -= this.interval;
      this.value = Math.min(this.cap, this.value + 1);
      if (this.full) this.timer = 0;
    }
  }
}
