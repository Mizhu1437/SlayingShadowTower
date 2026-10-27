import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world';
import { Enemy } from '../../src/core/enemy';

const FIELD_H = 448;

describe('敌人进场（回归：停在場外）', () => {
  it('出生在场外时，会自动向场内移动', () => {
    const e = new Enemy(
      { hp: 10, radius: 10, score: 1, coin: 1 },
      100, -35,   // 出生在场外上方
    );
    e.moveSpeed = 600;

    const y0 = e.y;
    for (let i = 0; i < 60; i++) e.step(1 / 60);

    // 应该向场内移动（y 增大）
    expect(e.y).toBeGreaterThan(y0);
    // 并最终落在场内
    expect(e.y).toBeGreaterThan(0);
  });

  it('未指定 targetY 时，场外出生的敌人默认进场到上部区域', () => {
    const e = new Enemy(
      { hp: 10, radius: 10, score: 1, coin: 1 },
      100, -35,
    );
    // 默认目标应在场内
    expect(e.targetY).toBeGreaterThan(0);
    expect(e.targetY).toBeLessThan(FIELD_H * 0.5);
  });

  it('显式指定 targetY 时按指定值进场', () => {
    const e = new Enemy(
      { hp: 10, radius: 10, score: 1, coin: 1 },
      100, -35, 200,
    );
    expect(e.targetY).toBe(200);
  });

  it('出生在场上时，不指定目标则原地停留（不强制移走）', () => {
    const e = new Enemy(
      { hp: 10, radius: 10, score: 1, coin: 1 },
      100, 150,
    );
    expect(e.targetY).toBe(150);
  });

  it('整幕推进后，所有敌人都在场内', async () => {
    const w = new World({ seed: 20261026 });
    expect(w.startAct(0)).toBe(true);

    // 跑 8 秒让第一波敌人进场
    for (let i = 0; i < 480; i++) w.step();

    const enemies = w.enemies.filter((e) => !e.dead);
    expect(enemies.length).toBeGreaterThan(0);

    for (const e of enemies) {
      // 所有存活敌人都应该在场地内（y >= 0）
      expect(e.y).toBeGreaterThan(0);
      expect(e.y).toBeLessThan(FIELD_H);
    }
  });

  it('敌人进场后会停在目标位置附近', async () => {
    const w = new World({ seed: 42 });
    w.startAct(0);

    // 跑 10 秒
    for (let i = 0; i < 600; i++) w.step();

    const enemies = w.enemies.filter((e) => !e.dead && e.y > 0);
    expect(enemies.length).toBeGreaterThan(0);

    for (const e of enemies.slice(0, 3)) {
      // 应该已经接近或到达目标（允许移动中的误差）
      const dist = Math.abs(e.y - e.targetY);
      expect(dist).toBeLessThan(80);
    }
  });
});
