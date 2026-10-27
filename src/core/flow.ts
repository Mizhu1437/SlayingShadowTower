/**
 * 游戏阶段状态机。
 *
 * 为什么用状态机而不是一堆 boolean：
 *   一个时刻只能处于一个阶段。用 `if (paused && !gameover && ...)` 这种组合，
 *   迟早会出现"暂停中还在掉血"或"结束后还能移动"这类状态漏洞。
 */

export type GamePhase =
  | 'playing'   // 正常游玩
  | 'dead'      // 残机耗尽，等待玩家选择是否续关
  | 'cleared';  // 结算完成（P3 接入）

export interface ContinueState {
  phase: GamePhase;
  /** 已续关次数 */
  continueCount: number;
  /** 续关上限，null 表示无限 */
  maxContinues: number | null;
}

export class GameFlow {
  phase: GamePhase = 'playing';
  continueCount = 0;
  readonly maxContinues: number | null;

  constructor(maxContinues: number | null = null) {
    this.maxContinues = maxContinues;
  }

  reset(): void {
    this.phase = 'playing';
    this.continueCount = 0;
  }

  /** 是否还能续关 */
  get canContinue(): boolean {
    if (this.maxContinues === null) return true;
    return this.continueCount < this.maxContinues;
  }

  /** 是否应该暂停推进逻辑（死亡时暂停） */
  get paused(): boolean {
    return this.phase !== 'playing';
  }

  /**
   * 自机死亡时调用。
   * 只有在还能续关时才进入 dead 阶段；否则直接结束。
   */
  onPlayerDead(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'dead';
  }

  /**
   * 玩家选择续关。返回是否成功。
   * 成功时计数 +1 并回到 playing。
   */
  doContinue(): boolean {
    if (this.phase !== 'dead') return false;
    if (!this.canContinue) return false;

    this.continueCount++;
    this.phase = 'playing';
    return true;
  }

  /**
   * 玩家选择放弃。进入结算。
   */
  giveUp(): void {
    if (this.phase !== 'dead') return;
    this.phase = 'cleared';
  }
}
