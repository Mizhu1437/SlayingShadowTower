import { describe, it, expect } from 'vitest';
import { World, FIELD_H } from '../../src/core/world';
import { DebugState, DEFAULT_DEBUG } from '../../src/core/debug';

describe('DebugState 开关', () => {
  it('默认全部关闭', () => {
    const d = new DebugState();
    expect(d.invincible).toBe(false);
    expect(d.lockEnergy).toBe(false);
    expect(d.lockCoins).toBe(false);
    expect(d.anyActive).toBe(false);
  });

  it('set 与 toggle 生效', () => {
    const d = new DebugState();
    d.set('invincible', true);
    expect(d.invincible).toBe(true);
    expect(d.anyActive).toBe(true);

    expect(d.toggle('invincible')).toBe(false);
    expect(d.invincible).toBe(false);
  });

  it('reset 关闭全部', () => {
    const d = new DebugState();
    d.set('invincible', true);
    d.set('lockEnergy', true);
    d.reset();
    expect(d.snapshot()).toEqual(DEFAULT_DEBUG);
  });
});

describe('调试：无敌', () => {
  it('开启后中弹不掉残机', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debug.set('invincible', true);

    const livesBefore = w.player.lives;

    // 连续中弹
    for (let round = 0; round < 3; round++) {
      w.player.invuln = 0;
      w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
      for (let i = 0; i < 120; i++) w.step();
    }

    expect(w.player.lives).toBe(livesBefore);
    expect(w.phase).toBe('playing');
  });

  it('关闭后中弹正常掉残机', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const livesBefore = w.player.lives;

    w.player.invuln = 0;
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    for (let i = 0; i < 150; i++) w.step();

    expect(w.player.lives).toBe(livesBefore - 1);
  });
});

describe('调试：锁能量', () => {
  it('开启后出牌不扣能量', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debug.set('lockEnergy', true);
    w.deck.energy.refill();

    const before = w.deck.energy.value;

    // 连打三张
    for (let i = 0; i < 3; i++) {
      w.deck.energy.refill();
      const e0 = w.deck.energy.value;
      w.playSelectedCard();
      expect(w.deck.energy.value).toBe(e0);
    }

    expect(w.deck.energy.value).toBe(before);
  });

  it('关闭后出牌正常扣能量', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.deck.energy.refill();

    const before = w.deck.energy.value;
    const card = w.deck.selectedCard;
    w.playSelectedCard();

    expect(w.deck.energy.value).toBeLessThan(before);
    void card;
  });
});

describe('调试：锁金钱', () => {
  it('开启后 MISS 不扣钱', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debug.set('lockCoins', true);
    w.coins = 1000;

    w.player.x = 96;
    w.player.y = 112;
    w.player.invuln = 0;
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    for (let i = 0; i < 150; i++) w.step();

    expect(w.coins).toBe(1000);
    expect(w.coinDrops.length).toBe(0);
  });
});

describe('调试：跳跃', () => {
  it('跳转到指定幕的指定波', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    const ok = w.debugJumpToWave(1, 5);   // 第 2 幕第 5 波
    expect(ok).toBe(true);
    expect(w.currentAct).toBe(1);
    expect(w.waves.currentWave).toBe(5);
    expect(w.phase).toBe('playing');
  });

  it('跳到第 1 波', () => {
    const w = new World({ seed: 1 });
    const ok = w.debugJumpToWave(0, 1);
    expect(ok).toBe(true);
    expect(w.currentAct).toBe(0);
    expect(w.waves.currentWave).toBe(1);
  });

  it('波次超过上限时自动夹到最后一波', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const total = w.waves.totalWaves;

    w.debugJumpToWave(0, 999);
    expect(w.waves.currentWave).toBeLessThanOrEqual(total);
  });

  it('幕编号越界时返回 false', () => {
    const w = new World({ seed: 1 });
    expect(w.debugJumpToWave(-1, 1)).toBe(false);
    expect(w.debugJumpToWave(99, 1)).toBe(false);
  });

  it('跳转后清空残留的敌人与弹幕', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    for (let i = 0; i < 200; i++) w.step();
    for (let i = 0; i < 20; i++) w.enemyBullets.spawn(100, 100, 0, 30, 4, 6);

    w.debugJumpToWave(2, 3);

    // 跳转瞬间应没有旧残留（新波次的敌人要等生成）
    expect(w.enemyBullets.aliveCount).toBe(0);
  });

  it('跳到商店', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    const ok = w.debugJumpToShop(1);
    expect(ok).toBe(true);
    expect(w.phase).toBe('shop');
    expect(w.currentAct).toBe(1);
    expect(w.shop.state.items.length).toBe(8);
  });
});

describe('调试：数值设置', () => {
  it('设置金币', () => {
    const w = new World({ seed: 1 });
    w.debugSetCoins(1234);
    expect(w.coins).toBe(1234);
  });

  it('金币不会设为负数', () => {
    const w = new World({ seed: 1 });
    w.debugSetCoins(-500);
    expect(w.coins).toBe(0);
  });

  it('设置残机', () => {
    const w = new World({ seed: 1 });
    w.debugSetLives(7);
    expect(w.player.lives).toBe(7);
  });

  it('设置残机时复活（清除 dead）', () => {
    const w = new World({ seed: 1 });
    w.player.lives = 0;
    w.player.dead = true;
    w.debugSetLives(3);
    expect(w.player.dead).toBe(false);
    expect(w.player.lives).toBe(3);
  });

  it('设置符卡不超过上限', () => {
    const w = new World({ seed: 1 });
    w.debugSetSpells(99);
    expect(w.spell.cards).toBeLessThanOrEqual(w.spell.cardsLimit);
  });

  it('补满能量', () => {
    const w = new World({ seed: 1 });
    w.deck.energy.pay(w.deck.energy.cap);
    w.debugFillEnergy();
    expect(w.deck.energy.value).toBe(w.deck.energy.cap);
  });

  it('抽满手牌', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugFillHand();
    const U = w.deck.pile.cfg.upper;
    expect(w.deck.pile.handSize).toBeGreaterThan(0);
    expect(w.deck.pile.handSize).toBeLessThanOrEqual(U);
  });
});

describe('调试：状态下不影响正常流程', () => {
  it('未开启任何开关时行为与之前一致', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugSetCoins(500);

    // 正常出牌扣能量
    w.deck.energy.refill();
    const e0 = w.deck.energy.value;
    w.playSelectedCard();
    expect(w.deck.energy.value).toBeLessThan(e0);

    // 正常 MISS 扣钱
    w.player.x = 96;
    w.player.y = 112;
    w.player.invuln = 0;
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    for (let i = 0; i < 150; i++) w.step();
    expect(w.coins).toBeLessThan(500);
  });

  it('无敌不影响自机移动', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debug.set('invincible', true);

    const x0 = w.player.x;
    w.input = { dx: 1, dy: 0, focus: false };
    for (let i = 0; i < 10; i++) w.step();
    expect(w.player.x).toBeGreaterThan(x0);
  });

  it('无敌时自机仍会被限制在场地内', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debug.set('invincible', true);

    // 往右下一直冲
    w.input = { dx: 1, dy: 1, focus: false };
    for (let i = 0; i < 600; i++) w.step();

    expect(w.player.y).toBeLessThanOrEqual(FIELD_H);
  });

describe('调试：抽牌', () => {
  it('抽 1 张手牌 +1', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const before = w.deck.pile.handSize;

    const r = w.debugDraw(1);
    expect(r.drawn).toBe(1);
    expect(w.deck.pile.handSize).toBe(before + 1);
  });

  it('一次抽多张', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const before = w.deck.pile.handSize;

    const r = w.debugDraw(2);
    expect(r.drawn).toBe(2);
    expect(w.deck.pile.handSize).toBe(before + 2);
  });

  it('抽牌走正式规则：满手时会触发过载', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 先补满
    w.debugFillHand();
    const U = w.deck.pile.cfg.upper;
    expect(w.deck.pile.handSize).toBe(U);

    const r = w.debugDraw(1);
    expect(r.overloaded).toBe(true);
    // 过载后手牌回到初始张数附近
    expect(w.deck.pile.handSize).toBeLessThanOrEqual(U);
  });

  it('张数小于 1 时按 1 处理', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const before = w.deck.pile.handSize;
    w.debugDraw(0);
    expect(w.deck.pile.handSize).toBe(before + 1);
  });

  it('牌堆总数守恒', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const total = w.deck.pile.totalCards;

    w.debugDraw(3);
    expect(w.deck.pile.totalCards).toBe(total);
  });
});

describe('调试：弃牌', () => {
  it('弃第 1 张：手牌 -1，弃牌堆 +1', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const handBefore = w.deck.pile.handSize;
    const discardBefore = w.deck.pile.discardCount;

    const card = w.debugDiscard(0);
    expect(card).not.toBeNull();
    expect(w.deck.pile.handSize).toBe(handBefore - 1);
    expect(w.deck.pile.discardCount).toBe(discardBefore + 1);
  });

  it('弃指定位置的牌，返回的正是那张', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugFillHand();

    const target = w.deck.pile.hand[2];
    const card = w.debugDiscard(2);
    expect(card?.id).toBe(target?.id);
  });

  it('位置越界时夹到最后一第', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const n = w.deck.pile.handSize;

    const card = w.debugDiscard(999);
    expect(card).not.toBeNull();
    expect(w.deck.pile.handSize).toBe(n - 1);
  });

  it('手牌为空时返回 null', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugDiscardAll();
    expect(w.deck.pile.handSize).toBe(0);
    expect(w.debugDiscard(0)).toBeNull();
  });

  it('弃掉整手牌', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const n = w.debugDiscardAll();
    expect(n).toBeGreaterThan(0);
    expect(w.deck.pile.handSize).toBe(0);
  });

  it('弃牌总数守恒（弃的牌进弃牌堆，不消失）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const total = w.deck.pile.totalCards;

    w.debugDiscardAll();
    expect(w.deck.pile.totalCards).toBe(total);
  });

  it('弃牌后选中索引不越界', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.deck.selected = w.deck.pile.handSize - 1;

    w.debugDiscard(0);
    expect(w.deck.selected).toBeLessThan(Math.max(1, w.deck.pile.handSize));
  });

  it('连续弃牌不会崩溃', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    for (let i = 0; i < 20; i++) w.debugDiscard(0);
    expect(w.deck.pile.handSize).toBe(0);
  });
});

describe('调试：抽弃组合', () => {
  it('弃完后仍能抽回来', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugDiscardAll();
    expect(w.deck.pile.handSize).toBe(0);

    w.debugDraw(2);
    expect(w.deck.pile.handSize).toBe(2);
  });

  it('抽满后弃一张，再抽一张，手牌数量回到原值', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugFillHand();
    const U = w.deck.pile.handSize;

    w.debugDiscard(0);
    expect(w.deck.pile.handSize).toBe(U - 1);

    w.debugDraw(1);
    expect(w.deck.pile.handSize).toBe(U);
  });
});
});
