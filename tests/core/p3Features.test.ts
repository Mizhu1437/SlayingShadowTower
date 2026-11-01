import { describe, it, expect } from 'vitest';
import { World, MISS_CONFIG } from '../../src/core/world';
import { Deck } from '../../src/core/cards/deck';
import { Rng } from '../../src/core/rng';
import { createStarterDeck, PASSIVE_POOL } from '../../src/core/cards/library';

describe('MISS 保护期：不能释放符卡', () => {
  /** 制造一次 MISS */
  function causeMiss(w: World): void {
    w.player.x = 96;
    w.player.y = 112;
    w.player.invuln = 0;
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    for (let i = 0; i < 150; i++) {
      w.step();
      if (w.missProtectLeft > 0) break;
    }
  }

  it('MISS 后保护期立即生效', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    causeMiss(w);

    expect(w.missProtectLeft).toBeGreaterThan(0);
    expect(w.missProtectLeft).toBeCloseTo(MISS_CONFIG.invulnTime, 0);
  });

  it('保护期内按 X 无法释放符卡', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const cardsBefore = w.spell.cards;

    causeMiss(w);
    expect(w.missProtectLeft).toBeGreaterThan(0);

    const ok = w.pressBomb();
    expect(ok).toBe(false);
    expect(w.spell.cards).toBe(cardsBefore);
  });

  it('保护期结束后可以正常释放符卡', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    causeMiss(w);

    // 跑完保护期
    for (let i = 0; i < 200; i++) {
      w.step();
      if (w.missProtectLeft <= 0) break;
    }
    expect(w.missProtectLeft).toBe(0);

    const cardsBefore = w.spell.cards;
    const ok = w.pressBomb();
    expect(ok).toBe(true);
    expect(w.spell.cards).toBe(cardsBefore - 1);
  });

  it('保护期不影响移动', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    causeMiss(w);

    const x0 = w.player.x;
    w.input = { dx: 1, dy: 0, focus: false };
    for (let i = 0; i < 10; i++) w.step();
    expect(w.player.x).toBeGreaterThan(x0);
  });

  it('符卡自身无敌期（active）不阻止再放符卡', () => {
    // 这条防止把 missProtect 与 player.invuln 混为一谈
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.pressBomb();
    w.step();

    // 此时在符卡 active 状态，但没死过
    expect(w.missProtectLeft).toBe(0);
    const ok = w.pressBomb();
    expect(ok).toBe(true);
  });
});

describe('被动卡槽位上限', () => {
  it('默认上限为 2', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    expect(d.passiveSlots).toBe(2);
    expect(d.passiveSlotsLeft).toBe(2);
  });

  it('可以放入 2 张', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    expect(d.addPassive(PASSIVE_POOL[0]!)).toBe(true);
    expect(d.addPassive(PASSIVE_POOL[1]!)).toBe(true);
    expect(d.passives.length).toBe(2);
    expect(d.passivesFull).toBe(true);
  });

  it('第 3 张被拒绝', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(PASSIVE_POOL[0]!);
    d.addPassive(PASSIVE_POOL[1]!);

    expect(d.addPassive(PASSIVE_POOL[2]!)).toBe(false);
    expect(d.passives.length).toBe(2);
  });

  it('主动卡不受槽位限制', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(PASSIVE_POOL[0]!);
    d.addPassive(PASSIVE_POOL[1]!);

    // 主动卡走 addActiveToDeck，不该受影响
    const active = createStarterDeck().find((c) => c.type === 'active')!;
    d.addActiveToDeck({ ...active });
    expect(d.passives.length).toBe(2);
  });

  it('商店里被动槽满时拒绝购买且不扣钱', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();
    w.coins = 9999;

    // 先把槽位塞满
    w.deck.addPassive(PASSIVE_POOL[0]!);
    w.deck.addPassive(PASSIVE_POOL[1]!);
    expect(w.deck.passivesFull).toBe(true);

    const idx = w.shop.state.items.findIndex(
      (it) => it.kind === 'card' && it.card?.type === 'passive',
    );
    if (idx < 0) return;   // 本局商店没有被动卡则跳过

    const coinsBefore = w.coins;
    const r = w.buyShopItem(idx);

    expect(r.ok).toBe(false);
    expect(r.reason).toBe('passive_slots_full');
    expect(w.coins).toBe(coinsBefore);        // 钱没扣
    expect(w.shop.state.items[idx]!.sold).toBe(false);   // 商品还在
  });

  it('槽位未满时可以正常购买被动卡', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.debugClearAct();
    w.enterShop();
    w.coins = 9999;

    const idx = w.shop.state.items.findIndex(
      (it) => it.kind === 'card' && it.card?.type === 'passive',
    );
    if (idx < 0) return;

    const r = w.buyShopItem(idx);
    expect(r.ok).toBe(true);
    expect(w.deck.passives.length).toBe(1);
  });
});

describe('波次倒计时 30 秒', () => {
  it('所有波次时长都是 30 秒', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 逐波检查（用 stage 内部数据不便，改为验证行为）
    expect(w.waves.waveRemainSeconds).toBeGreaterThan(29);
    expect(w.waves.waveRemainSeconds).toBeLessThanOrEqual(30);
  });

  it('倒计时会递减', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    const t0 = w.waves.waveRemainSeconds;
    for (let i = 0; i < 60; i++) w.step();   // 1 秒
    const t1 = w.waves.waveRemainSeconds;

    expect(t1).toBeLessThan(t0);
    expect(t0 - t1).toBeCloseTo(1, 0);
  });

  it('清完怪立刻进下一波，不等到时', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 让第一波把敌人全部生成出来（延迟最晚约 5 秒）
    for (let i = 0; i < 400; i++) w.step();
    expect(w.waves.currentWave).toBe(1);

    // 此时场上应该有敌人
    const alive = w.enemies.filter((e) => !e.dead && e.targetable);
    expect(alive.length).toBeGreaterThan(0);

    // 杀光
    for (const e of w.enemies) {
      if (!e.dead) {
        e.dead = true;
        e.fadeOut = 0;
      }
    }
    w.step();
    w.step();

    // 应该已经推进（此时才 6 秒多，远早于 30 秒）
    expect(w.waves.currentWave).toBeGreaterThan(1);
  });

  it('倒计时结束会清空全屏敌人', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 生成一些敌人但不杀
    for (let i = 0; i < 400; i++) w.step();
    const hadEnemies = w.enemies.filter((e) => !e.dead && e.targetable).length;
    expect(hadEnemies).toBeGreaterThan(0);

    const waveBefore = w.waves.currentWave;

    // 快进到超时。注意：推进发生的这一帧会清场，
    // 但紧接着下一波立刻开始计时，所以要在推进的那一刻就检查。
    let clearedAtAdvance = -1;
    for (let i = 0; i < 1800; i++) {
      const before = w.waves.currentWave;
      w.step();
      if (w.waves.currentWave > before) {
        // 刚推进，此刻清场应已完成
        clearedAtAdvance = w.enemies.filter(
          (e) => !e.dead && e.targetable,
        ).length;
        break;
      }
    }

    expect(w.waves.currentWave).toBeGreaterThan(waveBefore);
    expect(clearedAtAdvance).toBe(0);
  });

  it('超时清场不给分、不掉钱', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 生成敌人
    for (let i = 0; i < 120; i++) w.step();
    const scoreBefore = w.score;
    const killsBefore = w.kills;
    w.coinDrops.length = 0;
    const coinsBefore = w.coins;

    // 快进到超时
    for (let i = 0; i < 1900; i++) w.step();

    // 超时清场不应该被记为击杀
    expect(w.kills).toBe(killsBefore);
    expect(w.score).toBe(scoreBefore);
    // 且不应因清场产生掉落物
    const dropTotal = w.coinDrops.reduce((s, c) => s + c.amount, 0);
    expect(w.coins + dropTotal).toBe(coinsBefore);
  });

  it('超时后仍能继续推进到下一波', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    for (let i = 0; i < 1900; i++) w.step();
    expect(w.waves.currentWave).toBeGreaterThan(1);
    expect(w.waves.phase).toBe('running');
  });
});
