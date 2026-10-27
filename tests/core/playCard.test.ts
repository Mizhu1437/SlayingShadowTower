import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world';
import { Deck } from '../../src/core/cards/deck';
import { Rng } from '../../src/core/rng';
import type { CardDef } from '../../src/core/cards/def';
import { ENERGY_CAP } from '../../src/core/cards/energy';

describe('出牌能量扣费（回归：双重扣费）', () => {
  /** 构造一个只有指定耗能卡的牌组 */
  function deckOfCost(cost: number): CardDef[] {
    return Array.from({ length: 10 }, (_, i) => ({
      id: `c${cost}_${i}`,
      name: `${cost}费卡${i}`,
      type: 'active' as const,
      rarity: 'common' as const,
      price: 1,
      energy: cost,
      effects: [{ op: 'gain_coin' as const, value: 1 }],
    }));
  }

  /** 建一个全部为该费用卡的 World */
  function worldOfCost(cost: number): World {
    const w = new World({ seed: 1 });
    w.deck.pile.reset(deckOfCost(cost));
    w.deck.energy.refill();
    return w;
  }

  it('出 1 费卡只扣 1 点能量（不是 2 点）', () => {
    const w = worldOfCost(1);
    const before = w.deck.energy.value;
    expect(before).toBe(ENERGY_CAP);

    expect(w.playSelectedCard()).toBe(true);

    // 只应扣 1 点
    expect(w.deck.energy.value).toBe(before - 1);
  });

  it('出 2 费卡只扣 2 点能量', () => {
    const w = worldOfCost(2);
    const before = w.deck.energy.value;

    expect(w.playSelectedCard()).toBe(true);

    expect(w.deck.energy.value).toBe(before - 2);
  });

  it('连续出 3 张 1 费卡，能量正好扣 3 点', () => {
    const w = worldOfCost(1);

    let played = 0;
    for (let i = 0; i < 3; i++) {
      if (w.playSelectedCard()) played++;
    }

    // 3 张 × 1 点 = 3 点，能量应该刚好归零
    expect(played).toBe(3);
    expect(w.deck.energy.value).toBe(0);
  });

  it('能量不足时不出牌，也不扣能量', () => {
    const w = worldOfCost(2);
    w.deck.energy.pay(ENERGY_CAP);  // 清空
    const before = w.deck.energy.value;
    const handBefore = w.deck.pile.handSize;

    expect(w.playSelectedCard()).toBe(false);
    expect(w.deck.energy.value).toBe(before);       // 一点都不能扣
    expect(w.deck.pile.handSize).toBe(handBefore);  // 手牌不变
  });

  it('Deck.playSelected 本身不扣能量', () => {
    // 这条直接锁定 bug 的根因：能量扣费只应发生在一个地方
    const d = new Deck(new Rng(1), deckOfCost(1));
    d.energy.refill();
    const before = d.energy.value;

    d.selected = 0;
    const played = d.playSelected();

    expect(played).not.toBeNull();
    expect(d.energy.value).toBe(before);   // Deck 不动能量
  });
});

describe('出牌后手牌与选中索引保持一致', () => {
  it('出牌后选中索引不越界', () => {
    const w = new World({ seed: 1 });
    w.deck.energy.refill();

    for (let i = 0; i < 5; i++) {
      w.deck.selected = Math.max(0, w.deck.pile.handSize - 1);
      w.deck.energy.refill();
      w.playSelectedCard();
      expect(w.deck.selected).toBeLessThan(Math.max(1, w.deck.pile.handSize));
    }
  });

  it('出牌后手牌减少 1 张', () => {
    const w = new World({ seed: 1 });
    w.deck.energy.refill();
    const before = w.deck.pile.handSize;
    w.playSelectedCard();
    expect(w.deck.pile.handSize).toBe(before - 1);
  });
});
