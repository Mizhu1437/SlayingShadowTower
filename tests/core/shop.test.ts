import { describe, it, expect } from 'vitest';
import { Shop } from '../../src/core/shop/shop';
import { World } from '../../src/core/world';

describe('商店：商品生成', () => {
  it('固定 8 个商品位', () => {
    const s = new Shop();
    s.roll(1, 0, 0);
    expect(s.state.items.length).toBe(8);
  });

  it('结构固定：3 主动卡 + 2 被动卡 + 删卡 + 买命 + 买符卡', () => {
    const s = new Shop();
    s.roll(42, 0, 0);

    const kinds = s.state.items.map((i) => i.kind);
    expect(kinds.filter((k) => k === 'card').length).toBe(5);
    expect(kinds).toContain('remove_card');
    expect(kinds).toContain('heal_life');
    expect(kinds).toContain('restore_spell');
  });

  it('同一幕同一 visitCount 生成完全相同的商品', () => {
    const a = new Shop();
    const b = new Shop();
    a.roll(1234, 1, 0);
    b.roll(1234, 1, 0);
    expect(JSON.stringify(a.state.items)).toBe(JSON.stringify(b.state.items));
  });

  it('不同幕生成不同商品', () => {
    const a = new Shop();
    const b = new Shop();
    a.roll(7, 0, 0);
    b.roll(7, 2, 0);
    expect(JSON.stringify(a.state.items)).not.toBe(JSON.stringify(b.state.items));
  });

  it('同一幕内不重复上架同一张卡', () => {
    const s = new Shop();
    s.roll(99, 0, 0);
    const cardIds = s.state.items
      .filter((i) => i.kind === 'card' && i.card)
      .map((i) => i.card!.id);
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });

  it('所有商品都有正价格', () => {
    const s = new Shop();
    s.roll(555, 0, 0);
    for (const it of s.state.items) {
      expect(it.price).toBeGreaterThan(0);
    }
  });

  it('删卡价格随幕数上涨', () => {
    const a = new Shop();
    const b = new Shop();
    a.roll(1, 0, 0);
    b.roll(1, 2, 0);

    const priceA = a.state.items.find((i) => i.kind === 'remove_card')!.price;
    const priceB = b.state.items.find((i) => i.kind === 'remove_card')!.price;
    expect(priceB).toBeGreaterThan(priceA);
  });

  it('难度价格倍率生效', () => {
    const a = new Shop();
    const b = new Shop();
    a.roll(1, 0, 0, 1);
    b.roll(1, 0, 0, 1.5);

    const sumA = a.state.items.reduce((s, i) => s + i.price, 0);
    const sumB = b.state.items.reduce((s, i) => s + i.price, 0);
    expect(sumB).toBeGreaterThan(sumA);
  });
});

describe('商店：购买', () => {
  it('钱够就能买，扣钱并标记售出', () => {
    const s = new Shop();
    s.roll(1, 0, 0);
    const price = s.state.items[0]!.price;

    const r = s.buy(0, price + 10);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cost).toBe(price);
    expect(s.state.items[0]!.sold).toBe(true);
  });

  it('钱不够时购买失败，不改变任何状态', () => {
    const s = new Shop();
    s.roll(1, 0, 0);
    const price = s.state.items[0]!.price;

    const r = s.buy(0, price - 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_money');
    expect(s.state.items[0]!.sold).toBe(false);
  });

  it('已售出的商品不能再买', () => {
    const s = new Shop();
    s.roll(1, 0, 0);
    const price = s.state.items[0]!.price;

    s.buy(0, price * 2);
    const r = s.buy(0, price * 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sold');
  });

  it('不存在的商品位返回 no_item', () => {
    const s = new Shop();
    s.roll(1, 0, 0);
    const r = s.buy(99, 9999);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_item');
  });

  it('全部卖完后 soldOut 为真', () => {
    const s = new Shop();
    s.roll(1, 0, 0);
    for (let i = 0; i < s.state.items.length; i++) {
      s.buy(i, 99999);
    }
    expect(s.soldOut).toBe(true);
  });
});

describe('商店：与 World 整合', () => {
  it('未打完时不能进商店', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    expect(w.enterShop()).toBe(false);
  });

  it('打完一幕可以进商店', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.debugClearAct();
    expect(w.waves.phase).toBe('done');

    expect(w.enterShop()).toBe(true);
    expect(w.phase).toBe('shop');
    expect(w.shop.state.items.length).toBe(8);
  });

  it('商店阶段游戏逻辑暂停', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    expect(w.flow.paused).toBe(true);
  });

  it('买卡后牌组总数增加', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    w.coins = 9999;
    const before = w.deck.pile.totalCards;

    // 找一件卡牌商品
    const idx = w.shop.state.items.findIndex(
      (it) => it.kind === 'card' && it.card?.type === 'active',
    );
    if (idx >= 0) {
      const r = w.buyShopItem(idx);
      expect(r.ok).toBe(true);
      expect(w.deck.pile.totalCards).toBe(before + 1);
    }
  });

  it('买被动卡进入被动列表', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    w.coins = 9999;
    const before = w.deck.passives.length;
    const idx = w.shop.state.items.findIndex(
      (it) => it.kind === 'card' && it.card?.type === 'passive',
    );
    if (idx >= 0) {
      w.buyShopItem(idx);
      expect(w.deck.passives.length).toBe(before + 1);
    }
  });

  it('买命后残机 +1', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    w.coins = 9999;
    const before = w.player.lives;
    const idx = w.shop.state.items.findIndex((it) => it.kind === 'heal_life');
    if (idx >= 0) {
      w.buyShopItem(idx);
      expect(w.player.lives).toBe(before + 1);
    }
  });

  it('买符卡后符卡数增加（不超上限）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    w.coins = 9999;
    w.spell.cards = 1;
    const idx = w.shop.state.items.findIndex((it) => it.kind === 'restore_spell');
    if (idx >= 0) {
      w.buyShopItem(idx);
      expect(w.spell.cards).toBe(2);
    }
  });

  it('钱不够时购买失败且不发货', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    w.coins = 0;
    const livesBefore = w.player.lives;
    const idx = w.shop.state.items.findIndex((it) => it.kind === 'heal_life');
    if (idx >= 0) {
      const r = w.buyShopItem(idx);
      expect(r.ok).toBe(false);
      expect(w.player.lives).toBe(livesBefore);
    }
  });

  it('离开商店进入下一幕', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    const ok = w.leaveShopAndAdvance();
    expect(ok).toBe(true);
    expect(w.currentAct).toBe(1);
    expect(w.phase).toBe('playing');
    expect(w.waves.phase).toBe('running');
  });

  it('第四幕：道中BOSS 后开中途商店，离开后继续打关底', () => {
    const w = new World({ seed: 1 });
    w.currentAct = 3;
    w.startAct(3);

    // 第四幕结构：1 精英 + 道中BOSS + 关底BOSS
    // 道中BOSS 是第 1 波（索引 1），打完它应该停在中间点
    expect(w.waves.totalWaves).toBe(3);

    // 推完第 1 波（精英）
    w.waves.step(9999);
    // 推完第 2 波（道中BOSS）
    w.waves.step(9999);

    // 此时应停在中间点，等商店
    expect(w.waves.isPausedMidway).toBe(true);
    expect(w.actCleared).toBe(false);

    // 可以进商店
    expect(w.enterShop()).toBe(true);
    expect(w.phase).toBe('shop');
    expect(w.shopAfterMidway).toBe(true);

    // 离开后恢复波次，继续打关底
    const ok = w.leaveShopAndAdvance();
    expect(ok).toBe(true);
    expect(w.phase).toBe('playing');
    expect(w.waves.phase).toBe('running');
    expect(w.shopAfterMidway).toBe(false);
  });

  it('第四幕：打完关底BOSS 后整幕完成', () => {
    const w = new World({ seed: 1 });
    w.currentAct = 3;
    w.startAct(3);

    w.debugClearAct();
    expect(w.waves.phase).toBe('done');
    expect(w.actCleared).toBe(true);
  });

  it('前三幕不会中途停下', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    expect(w.waves.isPausedMidway).toBe(false);
    expect(w.actCleared).toBe(true);
  });
});

describe('商店：删卡服务', () => {
  it('买删卡后进入待选状态，选卡后真正移除', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();

    w.coins = 9999;
    const idx = w.shop.state.items.findIndex((it) => it.kind === 'remove_card');
    if (idx < 0) return;

    const before = w.deck.pile.totalCards;
    w.buyShopItem(idx);
    expect(w.pendingRemoveCard).toBe(true);

    const target = w.deck.pile.allCards()[0]!;
    expect(w.completeRemoveCard(target.id)).toBe(true);
    expect(w.pendingRemoveCard).toBe(false);
    expect(w.deck.pile.totalCards).toBe(before - 1);
  });

  it('没有待选状态时不能删卡', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    expect(w.completeRemoveCard('anything')).toBe(false);
  });

  it('删不存在的卡返回 false', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();
    w.coins = 9999;

    const idx = w.shop.state.items.findIndex((it) => it.kind === 'remove_card');
    if (idx < 0) return;
    w.buyShopItem(idx);

    expect(w.completeRemoveCard('no_such_card')).toBe(false);
    expect(w.pendingRemoveCard).toBe(true);   // 仍待选
  });
});
