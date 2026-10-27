import { describe, it, expect } from 'vitest';
import { Pile } from '../../src/core/cards/pile';
import { Rng } from '../../src/core/rng';
import { createStarterDeck } from '../../src/core/cards/library';

describe('牌堆不会枯竭（回归测试）', () => {
  it('初始卡组必须大于手牌上限', () => {
    // 这是硬约束：若卡组 <= 上限，手牌攒满后抽牌堆和弃牌堆都会空
    const deck = createStarterDeck();
    expect(deck.length).toBeGreaterThan(6);
  });

  it('初始卡组符合用户设计：4 符击 + 3 防御 + 1 凤翼天翔 = 8 张', () => {
    const deck = createStarterDeck();
    expect(deck.length).toBe(8);

    const names = deck.map((c) => c.name);
    expect(names.filter((n) => n === '符击').length).toBe(4);
    expect(names.filter((n) => n === '防御').length).toBe(3);
    expect(names.filter((n) => n.includes('火鸟')).length).toBe(1);
  });

  it('初始卡组里必须有保命卡（清弹或无敌）', () => {
    const deck = createStarterDeck();
    const hasSave = deck.some((c) =>
      c.effects?.some((e) => e.op === 'clear_bullets' || e.op === 'invuln'),
    );
    expect(hasSave).toBe(true);
  });

  it('连续抽牌 200 次不会因为牌堆空而卡住', () => {
    // 复现用户报告的问题：手牌到 5 就无法继续抽牌
    const p = new Pile(createStarterDeck(), new Rng(7));
    let lastDrawn = -1;

    for (let i = 0; i < 200; i++) {
      // 交替：抽牌、偶尔出牌（模拟真实循环）
      if (i % 3 === 0 && p.handSize > 0) {
        p.playAt(0);
      }
      const r = p.draw(1, 3);
      lastDrawn = r.drawn;
      // 任何时候都应该能抽到牌（除非整副牌都在手上）
      expect(p.hasAnyCard || p.handSize >= 6).toBe(true);
    }

    // 最后几次抽牌仍然有效（说明没有枯竭）
    expect(lastDrawn).toBeGreaterThan(0);
  });

  it('手牌到 5 时仍能抽牌（用户报告的具体场景）', () => {
    const p = new Pile(createStarterDeck(), new Rng(3));

    // 一路抽到 5 张
    while (p.handSize < 5) {
      const r = p.draw(1, 3);
      expect(r.drawn).toBeGreaterThan(0);
    }
    expect(p.handSize).toBe(5);

    // 再抽一张，应该成功（第 6 张）
    const r6 = p.draw(1, 3);
    expect(r6.drawn).toBe(1);
    expect(p.handSize).toBe(6);

    // 满手后再抽，应触发过载
    const r7 = p.draw(1, 3);
    expect(r7.overloaded).toBe(true);
    expect(r7.drawn).toBeGreaterThan(0);
  });

  it('卡牌抽牌在牌堆接近空时仍有效', () => {
    const p = new Pile(createStarterDeck(), new Rng(11));
    // 消耗掉一部分牌
    for (let i = 0; i < 5; i++) p.draw(1, 3);
    // 此时手牌应该 6 张（已过载过）
    const r = p.draw(2, 3);
    expect(r.drawn).toBeGreaterThan(0);
  });

  it('牌堆 + 手牌 + 弃牌 始终等于卡组总数', () => {
    const deck = createStarterDeck();
    const total = deck.length;
    const p = new Pile(deck, new Rng(5));

    for (let i = 0; i < 50; i++) {
      if (i % 2 === 0 && p.handSize > 0) p.playAt(0);
      p.draw(1, 3);
      expect(p.drawCount + p.handSize + p.discardCount).toBe(total);
    }
  });
});
