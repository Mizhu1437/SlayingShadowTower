/**
 * 商店系统。
 *
 * 设计（参考《杀戮尖塔》，但不使用其任何素材或专有名词）：
 *   - 每幕结束后开一次商店，8 个商品位
 *   - 商品由种子决定，同一局同一幕的商品固定（可复现）
 *   - 支持买卡、删卡、买残机、买符卡
 *
 * 为什么商店要确定性：
 *   如果每次进商店都随机，玩家无法规划"攒钱买那张卡"。
 *   固定商品让经济决策有意义 —— 这是构筑游戏的核心乐趣之一。
 */

import type { CardDef, Rarity } from '../cards/def';
import { ACTIVE_POOL, PASSIVE_POOL } from '../cards/library';
import { derive, Rng } from '../rng';

/** 商品种类 */
export type ShopItemKind = 'card' | 'remove_card' | 'heal_life' | 'restore_spell';

/** 一件商品 */
export interface ShopItem {
  kind: ShopItemKind;
  /** 商品 id（用于去重与购买记录） */
  id: string;
  /** 显示名 */
  name: string;
  /** 价格 */
  price: number;
  /** 描述 */
  desc: string;
  /** 卡牌商品对应的卡（未购买前不展示具体是谁，购买时取） */
  card?: CardDef;
  /** 是否已售出 */
  sold: boolean;
}

/** 商店状态 */
export interface ShopState {
  items: ShopItem[];
  /** 已进入过几次商店（用于派生子种子） */
  visitCount: number;
}

/** 稀有度对应的价格倍率 */
const RARITY_PRICE_MUL: Record<Rarity, number> = {
  starter: 1,
  common: 1,
  uncommon: 1.35,
  rare: 1.8,
};

/** 固定商品的价格与描述 */
const FIXED_ITEMS: Record<'remove_card' | 'heal_life' | 'restore_spell',
  { name: string; basePrice: number; desc: string }> = {
  remove_card: {
    name: '焚符之仪',
    basePrice: 75,
    desc: '从牌组中永久移除一张卡。',
  },
  heal_life: {
    name: '续命之符',
    basePrice: 100,
    desc: '残机 +1。',
  },
  restore_spell: {
    name: '符卡复原',
    basePrice: 60,
    desc: '符卡 +1（不超过上限）。',
  },
};

/**
 * 一次商店的商品位构成（固定结构，内容随机）：
 *   3 张主动卡 + 2 张被动卡 + 删卡 + 买命 + 买符卡 = 8 件
 *
 * 为什么结构固定：保证每局都有"删卡"这个关键的牌组压缩手段，
 * 否则随机不到删卡会让某些构筑彻底无法成型。
 */
const SHOP_LAYOUT: { kind: ShopItemKind; pool?: 'active' | 'passive' }[] = [
  { kind: 'card', pool: 'active' },
  { kind: 'card', pool: 'active' },
  { kind: 'card', pool: 'active' },
  { kind: 'card', pool: 'passive' },
  { kind: 'card', pool: 'passive' },
  { kind: 'remove_card' },
  { kind: 'heal_life' },
  { kind: 'restore_spell' },
];

export class Shop {
  state: ShopState = { items: [], visitCount: 0 };

  /**
   * 生成一次商店的商品。
   *
   * @param masterSeed 主种子
   * @param actIndex 当前幕
   * @param visitCount 第几次进商店
   * @param priceMul 难度导致的价格倍率
   */
  roll(
    masterSeed: number,
    actIndex: number,
    visitCount: number,
    priceMul = 1,
  ): void {
    const seed = derive(masterSeed, 'shop', actIndex, visitCount);
    const rng = new Rng(seed);

    const items: ShopItem[] = [];
    const usedIds = new Set<string>();

    SHOP_LAYOUT.forEach((slot, i) => {
      if (slot.kind === 'card') {
        const pool = slot.pool === 'passive' ? PASSIVE_POOL : ACTIVE_POOL;
        const card = pickCard(pool, rng, usedIds);
        if (!card) return;
        usedIds.add(card.id);

        const price = Math.round(
          card.price * (RARITY_PRICE_MUL[card.rarity] ?? 1) * priceMul,
        );

        items.push({
          kind: 'card',
          id: `slot${i}_${card.id}`,
          name: card.name,
          price,
          desc: card.text ?? (card.type === 'passive' ? '被动：持续生效' : ''),
          card: { ...card },
          sold: false,
        });
        return;
      }

      const fixed = FIXED_ITEMS[slot.kind as keyof typeof FIXED_ITEMS];
      // 删卡价格随幕数上涨（越到后面删卡越贵，抑制无限压缩）
      const actScale = slot.kind === 'remove_card' ? 1 + actIndex * 0.35 : 1;

      items.push({
        kind: slot.kind,
        id: `slot${i}_${slot.kind}`,
        name: fixed.name,
        price: Math.round(fixed.basePrice * actScale * priceMul),
        desc: fixed.desc,
        sold: false,
      });
    });

    this.state = { items, visitCount };
  }

  /** 未售出的商品 */
  get available(): ShopItem[] {
    return this.state.items.filter((it) => !it.sold);
  }

  /**
   * 尝试购买指定商品。
   *
   * 返回购买结果。失败时不改变任何状态（不给钱、不发货）。
   */
  buy(index: number, coins: number): BuyResult {
    const item = this.state.items[index];
    if (!item) return { ok: false, reason: 'no_item' };
    if (item.sold) return { ok: false, reason: 'sold' };
    if (coins < item.price) return { ok: false, reason: 'no_money' };

    item.sold = true;
    return {
      ok: true,
      cost: item.price,
      item,
    };
  }

  /** 是否所有商品都卖完了 */
  get soldOut(): boolean {
    return this.state.items.every((it) => it.sold);
  }

  reset(): void {
    this.state = { items: [], visitCount: 0 };
  }
}

export type BuyFailReason = 'no_item' | 'sold' | 'no_money';

export type BuyResult =
  | { ok: false; reason: BuyFailReason }
  | { ok: true; cost: number; item: ShopItem };

/**
 * 从池子里挑一张还没上架的卡。
 *
 * 稀有度加权：稀有卡出现概率低。
 * 用「权重展开 + 随机抽取」而不是逐张判定，保证一次就能抽中。
 */
function pickCard(
  pool: readonly CardDef[],
  rng: Rng,
  used: Set<string>,
): CardDef | null {
  const WEIGHT: Record<Rarity, number> = {
    starter: 0,
    common: 6,
    uncommon: 3,
    rare: 1,
  };

  const candidates = pool.filter(
    (c) => !used.has(c.id) && WEIGHT[c.rarity] > 0,
  );
  if (candidates.length === 0) return null;

  const total = candidates.reduce((s, c) => s + WEIGHT[c.rarity], 0);
  let roll = rng.next() * total;

  for (const c of candidates) {
    roll -= WEIGHT[c.rarity];
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1] ?? null;
}
