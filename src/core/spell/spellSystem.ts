/**
 * 符卡（Bomb）与决死系统。
 *
 * 设计依据：
 *   - 初始 3 张，**仅失残机时重置**（不是每幕回满）
 *   - 决死时间 = 8 帧 + 符卡数 × 6，上限 30 帧
 *   - 符卡为 0 时 4 帧
 *   - BOSS 符卡战中 ×2
 *
 * 为什么决死要跟符卡数挂钩（永夜抄的做法）：
 *   手里有符卡本身就是免疫力。用掉一张，下次中弹的容错时间就少 6 帧。
 *   这是"用未来的容错，换现在的清屏"。
 */

import { LOGIC_DT } from '../loop';
/** 逻辑帧率（60），用于把帧数换算成秒 */
export const FRAMES_PER_SEC = 60;

/** 一帧对应的秒数 */
const SEC_PER_FRAME = 1 / FRAMES_PER_SEC;

export interface SpellCardDef {
  id: string;
  name: string;
  /** 清屏半径，9999 视为全屏 */
  clearRadius: number;
  /** 无敌时长（秒） */
  invulnTime: number;
  /** 对全场敌人的伤害（默认 0） */
  damage: number;
  /** 释放后敌弹冻结时长（秒） */
  freezeTime: number;
}

export const DEFAULT_SPELL: SpellCardDef = {
  id: 'spell_default',
  name: '符片解放',
  clearRadius: 9999,
  invulnTime: 2.0,
  damage: 0,
  freezeTime: 0,
};

/** 决死时间计算参数 */
export const DEATHBOMB = {
  /** 基础帧数 */
  baseFrames: 8,
  /** 每张符卡增加的帧数 */
  perCardFrames: 6,
  /** 上限帧数 */
  maxFrames: 30,
  /** 符卡为 0 时的帧数 */
  noCardFrames: 4,
} as const;

/**
 * 计算决死窗口（帧）。
 *
 * @param cardCount 当前符卡数
 * @param inBossSpell 是否处于 BOSS 符卡战（时长翻倍）
 */
export function deathbombFrames(cardCount: number, inBossSpell = false): number {
  let frames: number;
  if (cardCount <= 0) {
    frames = DEATHBOMB.noCardFrames;
  } else {
    frames = Math.min(
      DEATHBOMB.baseFrames + cardCount * DEATHBOMB.perCardFrames,
      DEATHBOMB.maxFrames,
    );
  }
  if (inBossSpell) frames *= 2;
  return frames;
}

/** 换算成秒 */
export function deathbombSeconds(cardCount: number, inBossSpell = false): number {
  return deathbombFrames(cardCount, inBossSpell) * SEC_PER_FRAME;
}

/** 符卡系统状态 */
export type SpellPhase =
  | 'idle'        // 正常
  | 'deathbomb'   // 已中弹，决死窗口内
  | 'active';     // 炸弹生效中

export class SpellSystem {
  /** 剩余符卡数 */
  cards = 3;
  /** 初始符卡数（用于重置） */
  readonly initialCards: number;
  /** 符卡上限（可被被动卡提升） */
  cardsLimit = 3;

  phase: SpellPhase = 'idle';

  /** 决死剩余时间（秒） */
  private deathbombLeft = 0;
  /** 炸弹无敌剩余时间（秒） */
  private activeLeft = 0;
  /** 冻结剩余时间（秒） */
  private freezeLeft = 0;

  /** 本帧是否应当清屏（释放瞬间只清一次） */
  clearRequested = false;
  /** 本帧是否应当对敌人造成伤害（值为伤害量，0 表示不施放） */
  damageRequested = 0;

  /** 当前符卡配置（可被被动卡修改） */
  def: SpellCardDef;

  constructor(initialCards = 3, def: SpellCardDef = DEFAULT_SPELL) {
    this.initialCards = initialCards;
    this.cards = initialCards;
    this.def = { ...def };
  }

  reset(): void {
    this.cards = this.initialCards;
    this.phase = 'idle';
    this.deathbombLeft = 0;
    this.activeLeft = 0;
    this.freezeLeft = 0;
    this.clearRequested = false;
    this.damageRequested = 0;
  }

  /** 失去残机时重置符卡数（正作规则） */
  onPlayerMiss(): void {
    this.cards = this.initialCards;
    this.phase = 'idle';
    this.deathbombLeft = 0;
  }

  /** 当前决死窗口总时长（秒），供 UI 显示 */
  deathbombWindow(inBossSpell = false): number {
    return deathbombSeconds(this.cards, inBossSpell);
  }

  /** 当前决死窗口时长（秒），内部使用 */
  private computeWindow(inBossSpell = false): number {
    return deathbombSeconds(this.cards, inBossSpell);
  }

  /** 是否有符卡可用 */
  get hasCard(): boolean {
    return this.cards > 0;
  }

  /** 是否处于无敌（炸弹生效中） */
  get invulnerable(): boolean {
    return this.phase === 'active' && this.activeLeft > 0;
  }

  /** 敌弹是否被冻结 */
  get frozen(): boolean {
    return this.freezeLeft > 0;
  }

  /** 剩余无敌时间 */
  get invulnLeft(): number {
    return this.activeLeft;
  }

  /**
   * 自机被命中时立即调用。进入决死窗口。
   * 返回决死窗口时长（秒）。若符卡为 0，窗口很短。
   */
  enterDeathbomb(inBossSpell = false): number {
    if (this.phase !== 'idle') return 0;
    const win = this.computeWindow(inBossSpell);
    this.phase = 'deathbomb';
    this.deathbombLeft = win;
    return win;
  }

  /**
   * 玩家在决死窗口内按了 X。
   * 成功则进入炸弹生效状态，返回 true。
   */
  tryBombDuringDeathbomb(): boolean {
    if (this.phase !== 'deathbomb') return false;
    if (!this.hasCard) {
      // 没符卡不能决死，窗口结束就是 MISS
      return false;
    }
    this.phase = 'idle';
    this.deathbombLeft = 0;
    this.activate();
    return true;
  }

  /**
   * 主动按 X 释放（非决死）。
   *
   * 注意：**允许在炸弹生效期间再次释放**。
   * 正作里连按 X 可以连续消弹（每次消耗一张），
   * 所以不该因为 phase === 'active' 就拒绝。
   * 返回是否成功释放。
   */
  tryCast(): boolean {
    // 只在决死窗口中拒绝（那种情况应走 tryBombDuringDeathbomb）
    if (this.phase === 'deathbomb') return false;
    if (!this.hasCard) return false;
    this.activate();
    return true;
  }

  private activate(): void {
    this.cards--;
    this.phase = 'active';
    this.activeLeft = this.def.invulnTime;
    this.freezeLeft = this.def.freezeTime;
    // 请求清屏与伤害，由 World 在本步处理
    this.clearRequested = true;
    this.damageRequested = this.def.damage;
  }

  /**
   * 推进一个逻辑步。
   *
   * 返回 'miss' 表示决死窗口走完仍未按 X，应当扣残机。
   * 返回 'deathbomb-ended' 表示容错窗口结束（已 MISS）。
   */
  step(dt = LOGIC_DT): 'miss' | null {
    // 决死倒计时
    if (this.phase === 'deathbomb') {
      this.deathbombLeft -= dt;
      if (this.deathbombLeft <= 0) {
        this.phase = 'idle';
        this.deathbombLeft = 0;
        return 'miss';
      }
    }

    // 炸弹无敌
    if (this.phase === 'active') {
      this.activeLeft -= dt;
      if (this.activeLeft <= 0) {
        this.activeLeft = 0;
        this.phase = 'idle';
      }
    }

    // 冻结
    if (this.freezeLeft > 0) {
      this.freezeLeft = Math.max(0, this.freezeLeft - dt);
    }

    return null;
  }

  /** 决死剩余时间，供 UI */
  get deathbombLeftSeconds(): number {
    return this.deathbombLeft;
  }

  /** 清除一次性请求标志（在 World 处理完后调用） */
  consumeRequests(): { clear: boolean; damage: number } {
    const r = { clear: this.clearRequested, damage: this.damageRequested };
    this.clearRequested = false;
    this.damageRequested = 0;
    return r;
  }
}
