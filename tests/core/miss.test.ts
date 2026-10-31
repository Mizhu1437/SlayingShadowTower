import { describe, it, expect } from 'vitest';
import { World, MISS_CONFIG, FIELD_W, FIELD_H } from '../../src/core/world';
import { DEFAULT_SPELL } from '../../src/core/spell/spellSystem';

describe('符卡：消弹 + 全屏伤害', () => {
  it('默认符卡有全屏伤害', () => {
    expect(DEFAULT_SPELL.damage).toBeGreaterThan(0);
    expect(DEFAULT_SPELL.clearRadius).toBeGreaterThanOrEqual(9999);
  });

  it('释放符卡清除全部敌弹', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    // 撒一堆敌弹
    for (let i = 0; i < 50; i++) {
      w.enemyBullets.spawn(20 + i * 6, 100, 0, 40, 4, 5);
    }
    expect(w.enemyBullets.aliveCount).toBeGreaterThan(0);

    w.pressBomb();
    w.step();

    expect(w.enemyBullets.aliveCount).toBe(0);
  });

  it('释放符卡对全场敌人造成伤害', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 放三个敌人
    const positions = [[100, 100], [200, 150], [300, 100]];
    for (const [x, y] of positions) {
      w.spawnEnemy({ hp: 5000, radius: 20, score: 1, coin: 1 }, x!, y!);
    }
    w.step();

    const hps = w.enemies.map((e) => e.hp);
    expect(hps.length).toBe(3);

    w.pressBomb();
    w.step();

    // 每个敌人都应该掉血
    for (let i = 0; i < 3; i++) {
      expect(w.enemies[i]!.hp).toBeLessThan(hps[i]!);
    }
  });

  it('符卡伤害 = 默认值', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.spawnEnemy({ hp: 5000, radius: 20, score: 1, coin: 1 }, 200, 150);
    w.step();

    const e = w.enemies[0]!;
    const before = e.hp;

    w.pressBomb();
    w.step();

    expect(before - e.hp).toBe(DEFAULT_SPELL.damage);
  });

  it('释放符卡消耗一张符卡', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const before = w.spell.cards;

    w.pressBomb();
    w.step();

    expect(w.spell.cards).toBe(before - 1);
  });

  it('符卡释放后获得无敌', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.player.invuln = 0;

    w.pressBomb();
    w.step();

    expect(w.player.invuln).toBeGreaterThan(0);
  });
});

describe('MISS：撞弹且决死失败的惩罚', () => {
  /** 让自机中弹并跑完决死窗口（不按 X），触发 MISS */
  function causeMiss(w: World): void {
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    // 跑完决死窗口
    for (let i = 0; i < 120; i++) {
      w.step();
      if (w.player.invuln > 0) break;
    }
  }

  it('损失 40% 蜃銭', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 1000;

    causeMiss(w);

    // 损失 400，爆出 200（可能被捡回，看位置）
    // 这里只验证"钱一定减少了"
    expect(w.coins).toBeLessThan(1000);
  });

  it('损失比例符合 40%', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 1000;

    const before = w.coins;
    causeMiss(w);

    // 掉落物在天上，自机已重置到下方，不会被立刻捡到
    const lost = before - w.coins;
    expect(lost).toBeCloseTo(before * MISS_CONFIG.coinLossRatio, 0);
  });

  it('在撞弹位置产生掉落物', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 1000;

    // 记录撞弹位置
    const hitX = w.player.x;
    const hitY = w.player.y;

    causeMiss(w);

    expect(w.coinDrops.length).toBeGreaterThan(0);

    // 掉落物应该聚集在撞弹位置附近（自机已移走）
    const anyNearHit = w.coinDrops.some((c) => {
      const dx = c.x - hitX;
      const dy = c.y - hitY;
      return dx * dx + dy * dy < 100 * 100;
    });
    expect(anyNearHit).toBe(true);
  });

  it('掉落总额约为损失量的一半', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 1000;

    causeMiss(w);

    const droppedTotal = w.coinDrops.reduce((s, c) => s + c.amount, 0);
    const expected = Math.floor(1000 * MISS_CONFIG.coinLossRatio)
      * MISS_CONFIG.coinDropRatio;

    // 允许取整误差（每个物件是整数）
    expect(droppedTotal).toBeGreaterThan(expected * 0.85);
    expect(droppedTotal).toBeLessThanOrEqual(expected * 1.02);
  });

  it('自机重置到初始位置', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 先把自机挪到角落
    w.player.x = 40;
    w.player.y = 60;

    causeMiss(w);

    expect(w.player.x).toBeCloseTo(FIELD_W / 2, 0);
    expect(w.player.y).toBeCloseTo(FIELD_H * 0.82, 0);
  });

  it('MISS 后获得无敌', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.player.invuln = 0;

    causeMiss(w);

    expect(w.player.invuln).toBeGreaterThan(0);
    expect(w.player.invuln).toBeCloseTo(MISS_CONFIG.invulnTime, 0);
  });

  it('失去一张残机', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    const before = w.player.lives;

    causeMiss(w);

    expect(w.player.lives).toBe(before - 1);
  });

  it('残机耗尽时进入死亡阶段', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.player.lives = 1;

    causeMiss(w);

    expect(w.phase).toBe('dead');
  });

  it('钱为 0 时 MISS 不会产生负数或掉落物', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    causeMiss(w);

    expect(w.coins).toBeGreaterThanOrEqual(0);
    expect(w.coinDrops.length).toBe(0);
  });

  it('重置位置附近的敌人被清掉（防落地即死）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 在重置点附近放敌人
    w.spawnEnemy(
      { hp: 99999, radius: 15, score: 1, coin: 1 },
      FIELD_W / 2, FIELD_H * 0.82 - 50,
    );
    w.step();
    expect(w.enemies.some((e) => e.targetable)).toBe(true);

    causeMiss(w);

    // 附近敌人应被清掉
    const nearAlive = w.enemies.filter((e) => {
      if (!e.targetable) return false;
      const dx = e.x - FIELD_W / 2;
      const dy = e.y - FIELD_H * 0.82;
      return dx * dx + dy * dy < MISS_CONFIG.spawnClearRadius ** 2;
    });
    expect(nearAlive.length).toBe(0);
  });
});

describe('蜃銭掉落物：拾取', () => {
  it('自机靠近后能捡起掉落物', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 在自机位置附近手动放一个掉落物
    w.coinDrops.push({
      x: w.player.x,
      y: w.player.y,
      amount: 25,
      vx: 0,
      vy: 0,
      life: 5,
      collected: false,
      pickupDelay: 0,
    });

    w.step();

    expect(w.coins).toBeGreaterThanOrEqual(25);
    expect(w.coinDrops.length).toBe(0);
  });

  it('掉落物落出场地底部后消失', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 放在场地中部，远离自机（不会被捡）
    w.coinDrops.push({
      x: 20,
      y: 100,
      amount: 10,
      vx: 0,
      vy: 0,
      life: 99,
      collected: false,
      pickupDelay: 0,
    });

    // 以 70 px/s 匀速下落，(448-100)/70 ≈ 5 秒后离开
    for (let i = 0; i < 400; i++) w.step();

    expect(w.coinDrops.length).toBe(0);
  });

  it('掉落物在落出前一直存在（不会超时消失）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.coinDrops.push({
      x: 20,
      y: 100,
      amount: 10,
      vx: 0,
      vy: 0,
      life: 0.1,      // 旧的超时值，现在应该被忽略
      collected: false,
      pickupDelay: 0,
    });

    // 跑 1 秒，位置还远未到底，应该还在
    for (let i = 0; i < 60; i++) w.step();

    expect(w.coinDrops.length).toBe(1);
  });

  it('多个掉落物可以全部捡起', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    for (let i = 0; i < 5; i++) {
      w.coinDrops.push({
        x: w.player.x + (i - 2) * 2,
        y: w.player.y,
        amount: 10,
        vx: 0,
        vy: 0,
        life: 5,
        collected: false,
        pickupDelay: 0,
      });
    }

    w.step();

    expect(w.coins).toBe(50);
    expect(w.coinDrops.length).toBe(0);
  });
});
