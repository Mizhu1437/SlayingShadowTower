import { describe, it, expect } from 'vitest';
import { World, MISS_CONFIG, FIELD_H } from '../../src/core/world';

/** 造一个掉落物 */
function makeDrop(x: number, y: number, amount = 10) {
  return {
    x, y, amount,
    vx: 0, vy: 0,
    life: 99,
    collected: false,
    pickupDelay: 0,
  };
}

describe('吸取速度：不能慢于自机', () => {
  it('吸引速度显著高于自机高速移动速度', () => {
    // 自机高速 300 px/s，吸取速度必须远超它，否则会拖尾
    expect(MISS_CONFIG.coinAttractSpeed).toBeGreaterThan(300 * 2);
  });

  it('高速移动时金币能追上自机（不拖尾）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 金币放在吸引半径内
    w.coinDrops.push(makeDrop(w.player.x + 50, w.player.y));

    // 自机持续向右高速移动
    const far = w.player.x + 250;
    for (let i = 0; i < 40; i++) {
      w.input = { dx: 1, dy: 0, focus: false };
      w.step();
      if (w.coinDrops.length === 0) break;
    }
    void far;

    // 金币应该已经被捡到（追上了自机）
    expect(w.coins).toBeGreaterThan(0);
  });

  it('极近距离时不会越过目标点（速度被 clamp）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 放在几乎贴着自机的位置
    w.coinDrops.push(makeDrop(w.player.x + 0.5, w.player.y + 0.5));

    w.step();

    // 应该被吸到并捡起，而不是飞过头
    expect(w.coins).toBeGreaterThan(0);
  });
});

describe('自动收点：自机冲到场地上部', () => {
  it('配置比例为 25%', () => {
    expect(MISS_CONFIG.autoCollectTopRatio).toBe(0.25);
  });

  it('自机在版顶 25% 以内时，远处金币也被吸引', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 自机移到顶部区域
    w.player.x = 192;
    w.player.y = FIELD_H * 0.2;   // 20% < 25%

    // 金币放在很远的地方（远超普通吸引半径 90）
    w.coinDrops.push(makeDrop(60, 400, 15));
    w.coinDrops.push(makeDrop(320, 420, 15));

    // 跑一段时间
    for (let i = 0; i < 120; i++) w.step();

    // 两个金币都应该被吸过来
    expect(w.coins).toBe(30);
    expect(w.coinDrops.length).toBe(0);
  });

  it('自机在下半场时，远处金币不会被吸引', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 自机在下方
    w.player.x = 192;
    w.player.y = FIELD_H * 0.8;

    // 金币在很远的地方
    w.coinDrops.push(makeDrop(60, 100, 15));

    // 跑一段时间
    for (let i = 0; i < 60; i++) w.step();

    // 金币不该被吸走（但它自己在往下落，可能仍在场上）
    expect(w.coins).toBe(0);
  });

  it('自机在顶部时，落到底部边缘的金币也能收', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    w.player.x = 192;
    w.player.y = FIELD_H * 0.1;

    // 金币接近底部，马上就要消失
    w.coinDrops.push(makeDrop(192, FIELD_H - 20, 25));
    w.coinDrops.push(makeDrop(100, FIELD_H - 30, 25));

    for (let i = 0; i < 90; i++) w.step();

    expect(w.coins).toBe(50);
  });

  it('普通距离下仍走常规吸引（不需要到顶部）', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.coins = 0;

    // 自机在下方（不在收点区）
    w.player.y = FIELD_H * 0.8;

    // 金币在普通吸引半径内
    w.coinDrops.push(makeDrop(w.player.x, w.player.y - 50, 20));

    for (let i = 0; i < 30; i++) w.step();

    expect(w.coins).toBe(20);
  });
});

describe('判定点只在低速时可见', () => {
  it('focusing 由输入决定', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 不按低速
    w.input = { dx: 0, dy: 0, focus: false };
    w.step();
    expect(w.player.focusing).toBe(false);

    // 按低速
    w.input = { dx: 0, dy: 0, focus: true };
    w.step();
    expect(w.player.focusing).toBe(true);
  });

  it('低速时移动速度变慢', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);

    // 高速向右
    const x0 = w.player.x;
    w.input = { dx: 1, dy: 0, focus: false };
    for (let i = 0; i < 10; i++) w.step();
    const fastDist = w.player.x - x0;

    // 复位
    w.player.x = x0;
    w.input = { dx: 1, dy: 0, focus: true };
    for (let i = 0; i < 10; i++) w.step();
    const slowDist = w.player.x - x0;

    expect(slowDist).toBeLessThan(fastDist);
  });

  it('死亡时判定点不显示', () => {
    const w = new World({ seed: 1 });
    w.startAct(0);
    w.input = { dx: 0, dy: 0, focus: true };
    w.step();
    expect(w.player.focusing).toBe(true);

    // 让自机死亡
    w.player.lives = 1;
    w.player.invuln = 0;
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    for (let i = 0; i < 150; i++) w.step();

    expect(w.player.dead).toBe(true);
  });
});
