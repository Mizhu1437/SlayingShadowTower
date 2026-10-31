import { describe, it, expect } from 'vitest';
import { World, MISS_CONFIG, FIELD_W, FIELD_H } from '../../src/core/world';

/** 造一个掉落物 */
function makeDrop(x: number, y: number, amount = 10, vx = 0) {
  return {
    x, y, amount,
    vx, vy: 0,
    life: 6,
    collected: false,
    pickupDelay: 0,
  };
}

describe('蜃銭掉落物：匀速下落', () => {
  it('以恒定速度下落（不受重力加速）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coinDrops.push(makeDrop(200, 60));

    const y0 = w.coinDrops[0]!.y;
    for (let i = 0; i < 10; i++) w.step();
    const d1 = w.coinDrops[0]!.y - y0;

    const y1 = w.coinDrops[0]!.y;
    for (let i = 0; i < 10; i++) w.step();
    const d2 = w.coinDrops[0]!.y - y1;

    // 相同帧数内下落距离应相等（匀速）
    expect(d1).toBeCloseTo(d2, 3);
  });

  it('下落速度等于配置值', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coinDrops.push(makeDrop(200, 60));

    const y0 = w.coinDrops[0]!.y;
    // 跑 1 秒（60 帧）
    for (let i = 0; i < 60; i++) w.step();
    const moved = w.coinDrops[0]!.y - y0;

    // 允许一帧误差
    expect(moved).toBeCloseTo(MISS_CONFIG.coinFallSpeed, 0);
  });

  it('落出场地底部后消失', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 放在接近底部的位置
    w.coinDrops.push(makeDrop(200, FIELD_H - 20));

    // 以 70 px/s 的速度，约 0.5 秒后离开
    for (let i = 0; i < 120; i++) w.step();

    expect(w.coinDrops.length).toBe(0);
  });

  it('掉落物不会停在场地上不动', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coinDrops.push(makeDrop(200, 100));

    // 跑 3 秒，它应该已经离开屏幕（100 + 70*3 = 310 < 448，还在场内）
    // 跑到 6 秒才离开
    const startY = w.coinDrops[0]!.y;
    for (let i = 0; i < 300; i++) w.step();

    // 要么已经消失，要么比原来更靠下
    if (w.coinDrops.length > 0) {
      expect(w.coinDrops[0]!.y).toBeGreaterThan(startY);
    }
  });

  it('横向不会飞出场地', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.coinDrops.push(makeDrop(10, 60, 10, -400));
    w.coinDrops.push(makeDrop(FIELD_W - 10, 60, 10, 400));

    for (let i = 0; i < 60; i++) w.step();

    for (const d of w.coinDrops) {
      if (d.collected) continue;
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(FIELD_W);
    }
  });

  it('下落速度为正且在合理范围', () => {
    expect(MISS_CONFIG.coinFallSpeed).toBeGreaterThan(0);
    // 太慢则捡不完，太快则看不清
    expect(MISS_CONFIG.coinFallSpeed).toBeGreaterThan(30);
    expect(MISS_CONFIG.coinFallSpeed).toBeLessThan(200);
  });

  it('不依赖重力参数（已移除）', () => {
    // 确认配置里不再有重力字段
    expect('coinGravity' in MISS_CONFIG).toBe(false);
    expect('coinBounce' in MISS_CONFIG).toBe(false);
  });
});

describe('蜃銭掉落物：可被拾取', () => {
  it('自机靠近时被吸引并拾取', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 放在吸引半径内
    w.coinDrops.push(makeDrop(w.player.x + 30, w.player.y, 25));

    for (let i = 0; i < 30; i++) w.step();

    expect(w.coins).toBe(25);
    expect(w.coinDrops.length).toBe(0);
  });

  it('刚爆出的金币有拾取冷却', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    w.coinDrops.push({
      ...makeDrop(w.player.x, w.player.y, 25),
      pickupDelay: 0.5,
    });

    // 冷却期间不应被拾取
    for (let i = 0; i < 10; i++) w.step();
    expect(w.coins).toBe(0);

    // 冷却结束后被拾取
    for (let i = 0; i < 60; i++) w.step();
    expect(w.coins).toBe(25);
  });
});

describe('怪物死亡掉钱', () => {
  it('敌人死亡时在它的位置爆出蜃銭', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.spawnEnemy({ hp: 1, radius: 12, score: 100, coin: 30 }, 150, 200);
    w.step();

    const coinsBefore = w.coins;
    w.pressBomb();
    w.step();

    // 金币数字不变，场上多出掉落物
    expect(w.coins).toBe(coinsBefore);
    const total = w.coinDrops.reduce((s, c) => s + c.amount, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('掉落总额接近敌人 coin 值', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.spawnEnemy({ hp: 1, radius: 12, score: 100, coin: 45 }, 150, 200);
    w.step();

    w.pressBomb();
    w.step();

    const total = w.coinDrops.reduce((s, c) => s + c.amount, 0);
    expect(total).toBeGreaterThan(45 * 0.75);
    expect(total).toBeLessThanOrEqual(45);
  });

  it('coin 为 0 的敌人不产生掉落物', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.spawnEnemy({ hp: 1, radius: 12, score: 100, coin: 0 }, 150, 200);
    w.step();

    w.pressBomb();
    w.step();

    expect(w.coinDrops.length).toBe(0);
  });

  it('击杀仍然加分与计数', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.spawnEnemy({ hp: 1, radius: 12, score: 777, coin: 20 }, 150, 200);
    w.step();

    const scoreBefore = w.score;
    const killsBefore = w.kills;

    w.pressBomb();
    w.step();

    expect(w.score).toBe(scoreBefore + 777);
    expect(w.kills).toBe(killsBefore + 1);
  });
});

describe('MISS 掉钱也遵守匀速下落', () => {
  it('MISS 爆出的钱会向下落并在落底后消失', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 1000;
    w.player.invuln = 0;
    w.player.x = 96;
    w.player.y = 112;

    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    for (let i = 0; i < 150; i++) {
      w.step();
      if (w.coinDrops.length > 0) break;
    }

    expect(w.coinDrops.length).toBeGreaterThan(0);

    const y0 = w.coinDrops[0]!.y;
    for (let i = 0; i < 30; i++) w.step();

    const alive = w.coinDrops[0];
    if (alive) {
      expect(alive.y).toBeGreaterThan(y0);
    }
  });
});
