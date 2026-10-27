/**
 * 卡组运行时：牌堆 + 能量 + 被动卡结算 + 选卡状态。
 *
 * 这是卡牌系统的顶层协调者，World 持有它。
 */

import type { CardDef, SpellModifier } from './def';
import { Pile, DEFAULT_PILE, type DrawResult } from './pile';
import { Energy } from './energy';
import { createStarterDeck } from './library';
import { Rng } from '../rng';
import { DEFAULT_SPELL, type SpellCardDef } from '../spell/spellSystem';

/** 抽牌间隔 T，同时用于能量回复与过载停顿计算 */
export const DRAW_INTERVAL = 5.0;

/** 卡牌威力（由被动卡结算得出） */
export interface CardPower {
  /** 卡牌伤害倍率 */
  damageMul: number;
  /** 能量优惠（打出卡牌时减免的能量） */
  energyDiscount: number;
}

export class Deck {
  readonly pile: Pile;
  readonly energy: Energy;

  /** 已获得的被动卡（持续生效） */
  readonly passives: CardDef[] = [];

  /** 当前选中的手牌索引 */
  selected = 0;

  /** 过载后剩余的停顿时长（秒） */
  private drawPauseLeft = 0;
  /** 距离下次自动抽牌的计时 */
  private drawTimer = 0;

  constructor(rng: Rng, deck: CardDef[] = createStarterDeck()) {
    this.pile = new Pile(deck, rng, DEFAULT_PILE);
    this.energy = new Energy();
  }

  // ─────────────────────────────────────────────
  // 被动卡 → 卡牌威力 / 符卡
  //
  // 【设计变更】删除自动射击后，被动卡不再修改"自机火力"，
  // 而是修改**卡牌的威力**。这是同一套思路的延续：
  //   以前：符片决定自动射击的形态
  //   现在：符片决定卡牌的威力
  // 玩家唯一的输出来源是卡牌，符片决定这些输出有多强。
  // ─────────────────────────────────────────────

  /**
   * 结算卡牌威力倍率。
   *
   * 分两阶段（加法组 → 乘法组），保证**与被动卡的获得顺序无关**。
   * 这沿用了 ShotProfile 的「先加后乘」原则：
   *   加法可交换、乘法可交换，但两者之间不可交换，
   *   所以必须分阶段、不能混在一个累加变量上。
   */
  resolveCardPower(): CardPower {
    // 先把所有词条收集起来分类，避免边遍历边改同一个变量
    let addBonus = 0;      // 加法项累积（已折算成倍率增量）
    let mulFactor = 1;     // 乘法项累积
    let energyDiscount = 0;

    for (const p of this.passives) {
      if (!p.modifiers) continue;
      for (const m of p.modifiers) {
        if (m.stat === 'damage') {
          if (m.op === 'mul') mulFactor *= m.value;
          else if (m.op === 'add') addBonus += m.value / 50;  // 50 点伤害 = +1 倍
          else if (m.op === 'set') addBonus = m.value / 50 - 1;
        }
        // 射速类词条转为能量优惠（射速在本作已无意义）
        if (m.stat === 'interval' && m.op === 'mul') {
          energyDiscount += (1 - m.value) * 2;
        }
      }
    }

    // 两阶段结算：先加，后乘
    const damageMul = (1 + addBonus) * mulFactor;

    return {
      damageMul: Math.max(0.1, damageMul),
      energyDiscount: Math.max(0, Math.min(2, energyDiscount)),
    };
  }

  /** 结算符卡（被动卡可改造） */
  resolveSpell(): SpellCardDef {
    const out: SpellCardDef = { ...DEFAULT_SPELL };
    const mods: SpellModifier[] = [];
    for (const p of this.passives) {
      if (p.spellMods) mods.push(...p.spellMods);
    }

    const sums = new Map<string, number>();
    const muls = new Map<string, number>();
    const sets = new Map<string, number>();

    for (const m of mods) {
      if (m.op === 'add') sums.set(m.stat, (sums.get(m.stat) ?? 0) + m.value);
      else if (m.op === 'mul') muls.set(m.stat, (muls.get(m.stat) ?? 1) * m.value);
      else sets.set(m.stat, m.value);
    }

    for (const [k, v] of sums) {
      const cur = out[k as keyof SpellCardDef];
      if (typeof cur === 'number') (out[k as keyof SpellCardDef] as number) = cur + v;
    }
    for (const [k, v] of muls) {
      const cur = out[k as keyof SpellCardDef];
      if (typeof cur === 'number') (out[k as keyof SpellCardDef] as number) = cur * v;
    }
    for (const [k, v] of sets) {
      const cur = out[k as keyof SpellCardDef];
      if (typeof cur === 'number') (out[k as keyof SpellCardDef] as number) = v;
    }
    return out;
  }

  /** 获得一张被动卡 */
  addPassive(card: CardDef): void {
    if (card.type !== 'passive') return;
    this.passives.push(card);
  }

  /** 获得一张主动卡（进入抽牌堆） */
  addActiveToDeck(card: CardDef): void {
    if (card.type !== 'active') return;
    this.pile.addToDraw(card);
  }

  // ─────────────────────────────────────────────
  // 选卡
  // ─────────────────────────────────────────────

  /** C 键：循环切换选中的手牌 */
  cycleSelection(): void {
    const n = this.pile.handSize;
    if (n === 0) {
      this.selected = 0;
      return;
    }
    this.selected = (this.selected + 1) % n;
  }

  /** 选中的卡（可能为 null） */
  get selectedCard(): CardDef | null {
    return this.pile.hand[this.selected] ?? null;
  }

  /** 修正选中索引（手牌变化后调用） */
  clampSelection(): void {
    const n = this.pile.handSize;
    if (n === 0) this.selected = 0;
    else if (this.selected >= n) this.selected = n - 1;
  }

  /**
   * 尝试打出手牌中指定索引的卡。
   *
   * 注意：**这里不扣能量**。能量由调用方（World.playSelectedCard）统一扣除，
   * 因为它需要套用被动卡的能量优惠（energyDiscount），
   * 而 Deck 本身不知道被动卡结算结果。
   *
   * 若这里也扣一次，会造成双重扣费 —— 这正是早期"经常打不出牌"的原因。
   *
   * 前置条件：调用方已确认是主动卡且能量足够。
   * 返回被移除的卡，索引非法时返回 null。
   */
  playSelected(): CardDef | null {
    const card = this.selectedCard;
    if (!card) return null;
    if (card.type !== 'active') return null;

    const played = this.pile.playAt(this.selected);
    this.clampSelection();
    return played;
  }

  // ─────────────────────────────────────────────
  // 抽牌
  // ─────────────────────────────────────────────

  /** 是否因为过载而在停顿中 */
  get paused(): boolean {
    return this.drawPauseLeft > 0;
  }

  /** 过载停顿剩余秒数 */
  get pauseLeft(): number {
    return this.drawPauseLeft;
  }

  /**
   * 手动触发一次抽牌（卡牌效果用）。
   * 不受自动抽牌计时影响，但仍遵循过载规则。
   */
  drawNow(count: number): DrawResult {
    const r = this.pile.draw(count, DRAW_INTERVAL);
    this.applyDrawResult(r);
    return r;
  }

  private applyDrawResult(r: DrawResult): void {
    if (r.overloaded) {
      this.drawPauseLeft += r.pauseMs / 1000;
      this.selected = 0;
    }
    this.clampSelection();
  }

  /** 推进一个逻辑步 */
  step(dt: number): void {
    this.energy.step(dt);

    // 过载停顿：停的是抽牌，不是时间——能量照常回复（已在上面处理）
    if (this.drawPauseLeft > 0) {
      this.drawPauseLeft = Math.max(0, this.drawPauseLeft - dt);
      return;
    }

    this.drawTimer += dt;
    if (this.drawTimer >= DRAW_INTERVAL) {
      this.drawTimer -= DRAW_INTERVAL;
      const r = this.pile.draw(1, DRAW_INTERVAL);
      this.applyDrawResult(r);
    }
  }

  /** 每幕开局重置：能量回满、牌堆重洗、手牌回初始 */
  resetForNewAct(deck: CardDef[]): void {
    this.energy.refill();
    this.pile.reset(deck);
    this.drawTimer = 0;
    this.drawPauseLeft = 0;
    this.selected = 0;
  }
}
