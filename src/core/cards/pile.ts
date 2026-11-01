/**
 * 牌堆：抽牌堆 / 手牌 / 弃牌堆。
 *
 * 核心规则（DESIGN.md 第二节）：
 *   初始手牌 S = 3，上限 U = 6
 *   每次抽牌事件触发时：
 *     若 手牌 >= U → 过载：弃全部，重抽 R = min(S + D, U) 张，然后停顿 R × T 秒
 *     否则 → 抽 min(D, U - 手牌数) 张
 *
 * 硬约束：**不得有任何状态标记**。
 * 加"过载后需先打出一张才能再过载"会导致死锁——玩家不出牌就永远卡在 6 张。
 */

import type { CardDef } from './def';
import { Rng } from '../rng';

export interface PileConfig {
  /** 初始手牌数 */
  initial: number;
  /** 手牌上限 */
  upper: number;
}

export const DEFAULT_PILE: PileConfig = { initial: 3, upper: 6 };

/** 一次抽牌的结果 */
export interface DrawResult {
  /** 实际抽到的牌数 */
  drawn: number;
  /** 是否触发过载 */
  overloaded: boolean;
  /** 过载后需要停顿的毫秒数（0 表示不停顿） */
  pauseMs: number;
  /** 被弃置的牌 */
  discarded: CardDef[];
}

export class Pile {
  /** 抽牌堆（表尾为顶部，pop 取） */
  private drawPile: CardDef[] = [];
  /** 手牌（按抽到的顺序，索引 0 是最早的） */
  hand: CardDef[] = [];
  /** 弃牌堆 */
  private discardPile: CardDef[] = [];

  readonly cfg: PileConfig;

  /** 过载计数，仅供统计与 UI，不参与任何判断 */
  overloadCount = 0;

  constructor(
    /** 本局的完整卡组 */
    deck: CardDef[],
    private readonly rng: Rng,
    cfg: PileConfig = DEFAULT_PILE,
  ) {
    this.cfg = cfg;
    this.reset(deck);
  }

  /**
   * 把现有全部卡牌洗回抽牌堆，重新发初始手牌。
   *
   * 与 reset(deck) 的区别：
   *   reset(deck)      —— 用传入的牌组整体替换（会丢掉商店买的卡）
   *   reshuffleAll()   —— 只重排现有卡牌，卡组内容不变
   *
   * 每幕开始时用后者：玩家构筑的牌组必须跨幕保留。
   */
  reshuffleAll(): void {
    const all = [...this.hand, ...this.drawPile, ...this.discardPile];
    this.drawPile = all;
    this.hand = [];
    this.discardPile = [];
    this.overloadCount = 0;

    this.shuffle(this.drawPile);

    const n = Math.min(this.cfg.initial, this.drawPile.length);
    for (let i = 0; i < n; i++) {
      const c = this.drawPile.pop();
      if (c) this.hand.push(c);
    }
  }

  /** 洗牌并重置 */
  reset(deck: CardDef[]): void {
    this.drawPile = [...deck];
    this.shuffle(this.drawPile);
    this.hand = [];
    this.discardPile = [];
    this.overloadCount = 0;

    // 初始手牌（从抽牌堆直接抽，不触发抽牌事件）
    const n = Math.min(this.cfg.initial, this.drawPile.length);
    for (let i = 0; i < n; i++) {
      const c = this.drawPile.pop();
      if (c) this.hand.push(c);
    }
  }

  /** Fisher-Yates，用注入的 Rng 保证确定性 */
  private shuffle(arr: CardDef[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  }

  get handSize(): number {
    return this.hand.length;
  }

  get drawCount(): number {
    return this.drawPile.length;
  }

  get discardCount(): number {
    return this.discardPile.length;
  }

  /** 抽牌堆的内容（只读快照，供 UI 展示） */
  get drawCards(): readonly CardDef[] {
    return this.drawPile;
  }

  /** 弃牌堆的内容（只读快照，供 UI 展示） */
  get discardCards(): readonly CardDef[] {
    return this.discardPile;
  }

  /**
   * 往抽牌堆加入一张新卡（商店购买）。
   *
   * 新卡进入弃牌堆而不是直接进手牌：
   * 买卡的效果是"这副牌以后会变强"，不是"立刻多一张牌可以打"。
   * 直接进手牌会让商店变成瞬时增益，破坏牌组循环的意义。
   */
  addCard(card: CardDef): void {
    this.discardPile.push(card);
  }

  /**
   * 从整副牌中永久移除一张卡（商店删卡服务）。
   *
   * 优先从弃牌堆找，其次抽牌堆，最后手牌。
   * 返回是否成功移除。
   */
  removeCardById(cardId: string): boolean {
    let idx = this.discardPile.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      this.discardPile.splice(idx, 1);
      return true;
    }

    idx = this.drawPile.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      this.drawPile.splice(idx, 1);
      return true;
    }

    idx = this.hand.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      this.hand.splice(idx, 1);
      this.clampSelectionPublic();
      return true;
    }

    return false;
  }

  /** 供外部安全地修正选中索引 */
  private clampSelectionPublic(): void {
    if (this.hand.length === 0) return;
    // 选中索引由上层的 Deck 管理，这里只保证不越界留给上层处理
  }

  /** 全部卡牌的快照（供商店删卡界面展示） */
  allCards(): CardDef[] {
    return [...this.hand, ...this.drawPile, ...this.discardPile];
  }

  /**
   * 从抽牌堆顶部取一张。堆空时把弃牌堆洗回来。
   * 两者都空时返回 null。
   */
  private takeFromDraw(): CardDef | null {
    if (this.drawPile.length === 0) {
      if (this.discardPile.length === 0) return null;
      // 散逸的术式重新凝聚
      this.drawPile = this.discardPile;
      this.discardPile = [];
      this.shuffle(this.drawPile);
    }
    return this.drawPile.pop() ?? null;
  }

  /**
   * 牌堆是否有牌可抽（含弃牌堆可洗回的情况）。
   *
   * 用途：让 UI 能在"无牌可抽"时给出明确提示，
   * 而不是让玩家面对一个静默失效的抽牌机制。
   */
  get hasAnyCard(): boolean {
    return this.drawPile.length > 0 || this.discardPile.length > 0;
  }

  /**
   * 卡组总数。用于自检：若 <= 手牌上限，机制会死锁。
   */
  get totalCards(): number {
    return this.drawPile.length + this.hand.length + this.discardPile.length;
  }

  /**
   * 触发一次抽牌事件。
   *
   * @param count 本次应抽的张数（D）。自动抽牌传 1，卡牌效果可传 N。
   * @param intervalSec 抽牌间隔 T，用于计算过载停顿
   *
   * 两种情形：
   *   ① 手牌已满（>= U）→ 直接过载
   *   ② 未满但装不下 → 先装下能装的，**只把溢出部分计入过载**
   *
   * 停顿恒为 S × T，与 D 无关。
   */
  draw(count: number, intervalSec: number): DrawResult {
    const U = this.cfg.upper;

    // ── 情形 ①：手牌已满，直接过载 ──
    if (this.hand.length >= U) {
      return this.doOverload(count, intervalSec);
    }

    // ── 情形 ②：未满但装不下 ──
    const space = U - this.hand.length;
    if (count > space) {
      // 先装下能装的部分
      let drawn = 0;
      for (let i = 0; i < space; i++) {
        const c = this.takeFromDraw();
        if (!c) break;
        this.hand.push(c);
        drawn++;
      }
      // 溢出部分计入过载
      const overflow = count - drawn;
      const r = this.doOverload(overflow, intervalSec);
      return {
        drawn: drawn + r.drawn,
        overloaded: true,
        pauseMs: r.pauseMs,
        discarded: r.discarded,
      };
    }

    // ── 情形 ③：装得下，正常抽牌 ──
    let drawn = 0;
    for (let i = 0; i < count; i++) {
      const c = this.takeFromDraw();
      if (!c) break;
      this.hand.push(c);
      drawn++;
    }

    return { drawn, overloaded: false, pauseMs: 0, discarded: [] };
  }

  /**
   * 执行过载：弃全部手牌，重抽 min(S + overflow, U) 张，停顿 S × T。
   *
   * @param overflow 溢出到上限之外的张数（判断过载的那部分抽牌）
   */
  private doOverload(overflow: number, intervalSec: number): DrawResult {
    const S = this.cfg.initial;
    const U = this.cfg.upper;

    const discarded = [...this.hand];
    this.discardPile.push(...discarded);
    this.hand = [];

    // 重抽量 = 初始手牌 + 溢出张数，且不超过上限
    const refill = Math.min(S + overflow, U);
    let drawn = 0;
    for (let i = 0; i < refill; i++) {
      const c = this.takeFromDraw();
      if (!c) break;
      this.hand.push(c);
      drawn++;
    }

    this.overloadCount++;

    // 停顿时长恒为 S × T，与本次抽牌数无关。
    //
    // 为什么是 S × T：
    //   过载由一次抽牌事件触发，重抽 R = S + overflow 张。
    //   相比"正常抽到的那部分"，净多赚 S 张（未截断时）。
    //   赚了 S 张，就要跳过 S 个抽牌名额来抵消 → 停顿 S × T。
    //
    // 这个结果与 overflow 无关，因此自动抽牌与卡牌抽牌用同一条公式。
    return {
      drawn,
      overloaded: true,
      pauseMs: S * intervalSec * 1000,
      discarded,
    };
  }

  /**
   * 打出手牌中的某一张。
   * 返回被移除的卡，索引非法时返回 null。
   */
  playAt(index: number): CardDef | null {
    if (index < 0 || index >= this.hand.length) return null;
    const [card] = this.hand.splice(index, 1);
    if (card) this.discardPile.push(card);
    return card ?? null;
  }

  /** 按 id 移除（用于删卡） */
  removeById(id: string): boolean {
    const i = this.hand.findIndex((c) => c.id === id);
    if (i >= 0) {
      this.hand.splice(i, 1);
      return true;
    }
    return false;
  }

  /** 往抽牌堆加一张牌（买卡后调用），然后重洗 */
  addToDraw(card: CardDef): void {
    this.drawPile.push(card);
    this.shuffle(this.drawPile);
  }
}
