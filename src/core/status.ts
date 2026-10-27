/**
 * 状态效果系统。
 *
 * 目前实现三种：
 *   weak（虚弱） — 敌人发射的弹幕量减少 25%
 *   burn（燃烧） — 持续失去生命值，并可点燃附近的未燃烧敌人
 *   ignite（点燃） — 不是独立状态，而是"燃烧的传播"这一行为
 *
 * 设计要点：
 *   状态挂在敌人身上，由 EnemyStatus 承担，Enemy 只持有它。
 *   这样卡牌效果只需调用 apply()，不必知道内部计时细节。
 */

import { LOGIC_DT } from './loop';

export type StatusKind = 'weak' | 'burn';

export interface StatusState {
  kind: StatusKind;
  /** 剩余时间（秒） */
  remain: number;
}

/** 燃烧的伤害参数 */
export const BURN_CONFIG = {
  /** 每秒造成的伤害 */
  dpsPerSecond: 0.06,
  /** 点燃传播半径（像素） */
  spreadRadius: 90,
  /** 传播检查间隔（秒） */
  spreadInterval: 0.5,
};

/** 虚弱的效果强度：发射量乘以这个系数 */
export const WEAK_FIRE_FACTOR = 0.75;

export class EnemyStatus {
  private states = new Map<StatusKind, number>();

  /** 燃烧传播的检查计时 */
  private spreadTimer = 0;

  /** 本帧要传播给邻居的请求（由 World 读取） */
  pendingSpread = false;

  clear(): void {
    this.states.clear();
    this.spreadTimer = 0;
    this.pendingSpread = false;
  }

  /**
   * 施加或刷新状态。
   * 同名状态取较长时间（不叠加，避免无限堆伤害）。
   */
  apply(kind: StatusKind, seconds: number): void {
    const cur = this.states.get(kind) ?? 0;
    this.states.set(kind, Math.max(cur, seconds));
  }

  has(kind: StatusKind): boolean {
    return (this.states.get(kind) ?? 0) > 0;
  }

  /** 剩余时间 */
  remain(kind: StatusKind): number {
    return this.states.get(kind) ?? 0;
  }

  get isWeak(): boolean {
    return this.has('weak');
  }

  get isBurning(): boolean {
    return this.has('burn');
  }

  /**
   * 推进一个逻辑步。
   *
   * @param maxHp 敌人最大生命值，用于按比例计算燃烧伤害
   * @returns 本步应造成多少燃烧伤害（由 World 负责扣血）
   */
  step(dt = LOGIC_DT, maxHp = 100): number {
    let burnDamage = 0;

    for (const [kind, remain] of this.states) {
      const next = remain - dt;
      if (next <= 0) this.states.delete(kind);
      else this.states.set(kind, next);
    }

    if (this.isBurning) {
      burnDamage = maxHp * BURN_CONFIG.dpsPerSecond * dt;

      // 按间隔检查传播，避免每帧都扫描
      this.spreadTimer += dt;
      if (this.spreadTimer >= BURN_CONFIG.spreadInterval) {
        this.spreadTimer = 0;
        this.pendingSpread = true;
      }
    }

    // 移除本帧已过期的 weak（按帧清理）
    return burnDamage;
  }
}
