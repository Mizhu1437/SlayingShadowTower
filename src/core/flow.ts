/**
 * 游戏阶段状态机。
 *
 * 为什么用状态机而不是一堆 boolean：
 *   一个时刻只能处于一个阶段。用 `if (paused && !gameover && ...)` 这种组合，
 *   迟早会出现"暂停中还在掉血"或"结束后还能移动"这类状态漏洞。
 *
 * 完整循环：
 *   menu → playing ⇄ shop
 *            ↓
 *          dead ──续关──→ playing
 *            │
 *          放弃
 *            ↓
 *         cleared ──回主菜单──→ menu
 */

export type GamePhase =
  | 'menu'      // 主菜单，未开始对局
  | 'playing'   // 正常游玩
  | 'shop'      // 幕间商店
  | 'dead'      // 残机耗尽，等待玩家选择是否续关
  | 'cleared';  // 本局结束（通关或放弃），展示结算

export interface ContinueState {
  phase: GamePhase;
  /** 已续关次数 */
  continueCount: number;
  /** 续关上限，null 表示无限 */
  maxContinues: number | null;
}

export class GameFlow {
  /**
   * 默认 playing 而不是 menu。
   *
   * 原因：World/GameFlow 是纯逻辑层，单元测试直接构造它就跑战斗逻辑。
   * 若默认 menu，所有逻辑都被 paused 挡住，测试与嵌入式用法都要额外
   * 调一次 startGame()。主菜单是 UI 层的事，由 main.ts 启动时显式
   * 调用 toMenu() 进入。
   */
  phase: GamePhase = 'playing';
  continueCount = 0;
  readonly maxContinues: number | null;

  constructor(maxContinues: number | null = null) {
    this.maxContinues = maxContinues;
  }

  /** 回到主菜单 */
  toMenu(): void {
    this.phase = 'menu';
    this.continueCount = 0;
  }

  /** 开始一局新游戏 */
  startGame(): void {
    this.phase = 'playing';
    this.continueCount = 0;
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

  /** 是否应该暂停推进逻辑（非游玩阶段都暂停） */
  get paused(): boolean {
    return this.phase !== 'playing';
  }

  /** 是否处于主菜单 */
  get inMenu(): boolean {
    return this.phase === 'menu';
  }

  /** 是否处于商店阶段 */
  get inShop(): boolean {
    return this.phase === 'shop';
  }

  /** 是否已结束（死亡待选或已结算） */
  get isOver(): boolean {
    return this.phase === 'dead' || this.phase === 'cleared';
  }

  /**
   * 进入商店（一幕打完时调用）。
   * 只在 playing 阶段生效，避免重复进入。
   */
  enterShop(): boolean {
    if (this.phase !== 'playing') return false;
    this.phase = 'shop';
    return true;
  }

  /** 离开商店，进入下一幕 */
  leaveShop(): boolean {
    if (this.phase !== 'shop') return false;
    this.phase = 'playing';
    return true;
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

  /**
   * 通关（打完第四幕）时直接进入结算。
   *
   * 与 giveUp 分开：那个是"死了之后放弃"，这个是"真的打完了"，
   * 结算界面据此显示「通关」还是「放弃」。
   */
  onCleared(): void {
    if (this.phase === 'cleared') return;
    this.phase = 'cleared';
  }
}
