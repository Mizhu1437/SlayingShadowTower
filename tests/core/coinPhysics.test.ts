import { describe, it, expect } from 'vitest';
import { World, MISS_CONFIG, FIELD_W, FIELD_H } from '../../src/core/world';

/** 造一个掉落物 */
function makeDrop(x: number, y: number, amount = 10, vy = 0) {
  return {
    x, y, amount,
    vx: 0, vy,
    life: 6,
    collected: false,
    pickupDelay: 0,
  };
}

describe('蜃銭掉落物：重力下落', () => {
  it('无初速度时会向下落', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.coinDrops.push(makeDrop(200, 100));
    const y0 = w.coinDrops[0]!.y;

    // 跑 0.5 秒
    for (let i = 0; i < 30; i++) w.step();

    const drop = w.coinDrops.find((c) => !c.collected);
    expect(drop).toBeDefined();
    expect(drop!.y).toBeGreaterThan(y0);
  });

  it('向上抛出的金币会先升后降', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.coinDrops.push(makeDrop(200, 200, 10, -150));
    let maxUp = 200;
    let cameBackDown = false;

    for (let i = 0; i < 90; i++) {
      w.step();
      const d = w.coinDrops.find((c) => !c.collected);
      if (!d) break;
      maxUp = Math.min(maxUp, d.y);
      if (d.y > 200) cameBackDown = true;
    }

    // 应该先飞到比 200 更高的地方（y 更小）
    expect(maxUp).toBeLessThan(200);
    // 然后落回到出发点以下
    expect(cameBackDown).toBe(true);
  });

  it('金币不会掉出场地底部', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 放到很靠下的位置，给很大向下速度
    w.coinDrops.push(makeDrop(200, FIELD_H - 30, 10, 500));

    for (let i = 0; i < 120; i++) w.step();

    const d = w.coinDrops.find((c) => !c.collected);
    if (d) {
      expect(d.y).toBeLessThanOrEqual(FIELD_H);
      expect(d.y).toBeGreaterThan(0);
    }
  });

  it('金币不会飞出左右边界', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.coinDrops.push({ ...makeDrop(10, 100), vx: -400 });
    w.coinDrops.push({ ...makeDrop(FIELD_W - 10, 100), vx: 400 });

    for (let i = 0; i < 120; i++) w.step();

    for (const d of w.coinDrops) {
      if (d.collected) continue;
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(FIELD_W);
    }
  });

  it('落到地面后停住（不再继续加速下落）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.coinDrops.push(makeDrop(200, FIELD_H - 100, 10, 600));

    // 跑足够久让它落地并稳定
    for (let i = 0; i < 180; i++) w.step();

    const d = w.coinDrops.find((c) => !c.collected);
    if (d) {
      const floor = FIELD_H - MISS_CONFIG.coinFloorOffset;
      expect(d.y).toBeCloseTo(floor, 0);
      // 落地后竖直速度应接近 0
      expect(Math.abs(d.vy)).toBeLessThan(80);
    }
  });

  it('重力数值为正且合理', () => {
    expect(MISS_CONFIG.coinGravity).toBeGreaterThan(0);
    // 太小则漂浮，太大则一闪而过
    expect(MISS_CONFIG.coinGravity).toBeGreaterThan(200);
    expect(MISS_CONFIG.coinGravity).toBeLessThan(2000);
  });
});

describe('怪物死亡掉钱', () => {
  it('敌人死亡时在它的位置爆出蜃銭', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    w.spawnEnemy({ hp: 1, radius: 12, score: 100, coin: 30 }, 150, 200);
    w.step();

    const e = w.enemies[0]!;
    e.x = 150;
    e.y = 200;

    const coinsBefore = w.coins;
    e.damage(999);
    // 手动走一次击杀结算（模拟任意来源的击杀）
    for (let i = 0; i < 3; i++) w.step();

    // 用符卡造成击杀，确保走的是统一路径
    w.coinDrops.length = 0;
    w.pressBomb();
    w.step();

    expect(w.coins).toBe(coinsBefore);
    const total = w.coinDrops.reduce((s, c) => s + c.amount, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('掉落总额等于敌人 coin 值', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.spawnEnemy({ hp: 1, radius: 12, score: 100, coin: 45 }, 150, 200);
    w.step();

    w.pressBomb();
    w.step();

    const total = w.coinDrops.reduce((s, c) => s + c.amount, 0);
    // 允许取整误差（每件是整数，n 件之和可能略少于 45）
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

  it('击杀仍然加分与计数（只有钱改成掉落）', () => {
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

describe('MISS 掉钱也遵守重力', () => {
  it('MISS 爆出的钱会向下落', () => {
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
    const yStart = w.coinDrops.map((c) => c.y);

    // 继续跑，金币应整体下移
    for (let i = 0; i < 40; i++) w.step();

    const alive = w.coinDrops;
    expect(alive.length).toBeGreaterThan(0);

    // 至少有一部分金币的 y 变大了（下落）
    const fell = alive.filter((c, i) => i < yStart.length && c.y > yStart[i]!).length;
    expect(fell).toBeGreaterThan(0);
  });
});
