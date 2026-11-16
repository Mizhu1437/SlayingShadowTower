/**
 * BOSS 分阶段弹幕测试。
 *
 * 验证的是「血量跨过阈值时切换弹幕」这条核心逻辑，
 * 以及切换瞬间的停火窗口 —— 这两点直接决定最终战的手感。
 */

import { describe, expect, it } from 'vitest';
import { Enemy } from '../../src/core/enemy';
import type { EnemyConfig } from '../../src/core/enemy';
import { BulletField } from '../../src/core/danmaku/bulletField';
import { PATTERNS } from '../../src/core/danmaku/emitter';


/** 三段式测试用 BOSS：100%–66% / 66%–33% / 33%–0 */
function makeBoss(): EnemyConfig {
  return {
    hp: 300,
    radius: 30,
    score: 1000,
    coin: 100,
    phases: [
      {
        hpAbove: 0.66,
        fireInterval: 1,
        emitter: PATTERNS.ring(8, 100),
      },
      {
        hpAbove: 0.33,
        fireInterval: 1,
        pauseSeconds: 0.5,
        emitter: PATTERNS.ring(12, 120),
      },
      {
        hpAbove: 0,
        fireInterval: 1,
        pauseSeconds: 1.0,
        emitter: PATTERNS.ring(16, 140),
      },
    ],
  };
}

describe('BOSS 分阶段', () => {
  it('初始处于第一阶段', () => {
    const e = new Enemy(makeBoss(), 192, 100);
    expect(e.currentPhase).toBe(1);
    expect(e.totalPhases).toBe(3);
  });

  it('血量降到 66% 以下时进入第二阶段', () => {
    const e = new Enemy(makeBoss(), 192, 100);

    // 300 血，打到 200（约 67%）—— 还没过线
    e.damage(100);
    expect(e.currentPhase).toBe(1);

    // 再打 1 点，到 199（66.3%），仍未过 66%
    e.damage(1);
    expect(e.currentPhase).toBe(1);

    // 打到 198（66%），刚好不高于阈值 → 切段
    e.damage(1);
    expect(e.currentPhase).toBe(2);
  });

  it('血量降到 33% 以下时进入第三阶段', () => {
    const e = new Enemy(makeBoss(), 192, 100);
    e.damage(200);          // 100 血（33.3%）
    expect(e.currentPhase).toBe(2);

    e.damage(2);            // 98 血（32.7%）
    expect(e.currentPhase).toBe(3);
  });

  it('阶段切换后有一段停火窗口', () => {
    const e = new Enemy(makeBoss(), 192, 100);
    const field = new BulletField(256);

    // 先让它到位并跑到可以开火
    e.moveTo(192, 100);
    for (let i = 0; i < 120; i++) e.step(1 / 60, field);
    const before = field.aliveCount;

    // 打穿到第二阶段
    e.damage(102);
    expect(e.currentPhase).toBe(2);

    // 停火窗口 0.5 秒内不应产出新弹
    for (let i = 0; i < 20; i++) e.step(1 / 60, field);
    // 允许旧弹仍在场，只验证没有"新增"
    expect(field.aliveCount).toBeLessThanOrEqual(before);
  });

  it('一击打穿多段时只前进一段，不跳过中间阶段', () => {
    const e = new Enemy(makeBoss(), 192, 100);
    // 一次打掉 250 血（剩 50，17%）—— 同时跨过 66% 和 33%
    e.damage(250);
    // 只前进到第 2 阶段，避免中间阶段的表现被跳过
    expect(e.currentPhase).toBe(2);
  });

  it('无 phases 的普通敌人不受影响', () => {
    const e = new Enemy(
      {
        hp: 20, radius: 10, score: 100, coin: 5,
        emitter: PATTERNS.single(Math.PI / 2, 100),
        fireInterval: 2,
      },
      192, 100,
    );
    expect(e.currentPhase).toBe(1);
    expect(e.totalPhases).toBe(1);
    e.damage(10);
    expect(e.currentPhase).toBe(1);
  });
});
