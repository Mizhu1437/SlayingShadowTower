/**
 * 开发者调试开关。
 *
 * 设计原则：开关状态存放在 core 层，由 World 在结算时读取，
 * 而不是在 UI 层拦截。这样：
 *   - 逻辑测试可以不依赖 DOM 直接验证
 *   - 关掉控制台也不会残留半截状态
 *
 * 这些开关只在开发/调试时使用，正式发布的构建里
 * 通过 import.meta.env.PROD 决定是否允许开启（见 devConsole.ts）。
 */

export interface DebugFlags {
  /** 自机无敌：关闭中弹判定 */
  invincible: boolean;
  /** 锁定能量：能量不消耗 */
  lockEnergy: boolean;
  /** 锁定金钱：金钱不因 MISS 减少 */
  lockCoins: boolean;
}

export const DEFAULT_DEBUG: DebugFlags = {
  invincible: false,
  lockEnergy: false,
  lockCoins: false,
};

export class DebugState {
  private flags: DebugFlags = { ...DEFAULT_DEBUG };

  get invincible(): boolean {
    return this.flags.invincible;
  }

  get lockEnergy(): boolean {
    return this.flags.lockEnergy;
  }

  get lockCoins(): boolean {
    return this.flags.lockCoins;
  }

  set(key: keyof DebugFlags, value: boolean): void {
    this.flags[key] = value;
  }

  toggle(key: keyof DebugFlags): boolean {
    this.flags[key] = !this.flags[key];
    return this.flags[key];
  }

  reset(): void {
    this.flags = { ...DEFAULT_DEBUG };
  }

  /** 当前所有开关的快照（供 HUD 显示） */
  snapshot(): Record<keyof DebugFlags, boolean> {
    return { ...this.flags };
  }

  /** 是否有任何开关处于开启状态 */
  get anyActive(): boolean {
    return this.flags.invincible || this.flags.lockEnergy || this.flags.lockCoins;
  }
}
