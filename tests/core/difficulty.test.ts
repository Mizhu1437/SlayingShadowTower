/**
 * 难度系统测试。
 *
 * 重点验证设计红线：**自机侧参数全难度一致**，
 * 难度只通过三条轴（弹幕密度 / 掉落 / 价格）变化。
 */

import { describe, expect, it } from 'vitest';
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  getDifficulty,
} from '../../src/core/difficulty';
import { World } from '../../src/core/world';
import { ENEMY_POOL } from '../../src/core/stage/enemies';

describe('难度表', () => {
  it('四档难度都存在且字段完整', () => {
    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      expect(d.id).toBe(id);
      expect(d.name).toBeTruthy();
      expect(d.desc).toBeTruthy();
      expect(d.fireIntervalMul).toBeGreaterThan(0);
      expect(d.bulletCountMul).toBeGreaterThan(0);
      expect(d.bulletSpeedMul).toBeGreaterThan(0);
      expect(d.coinDropMul).toBeGreaterThan(0);
      expect(d.priceMul).toBeGreaterThan(0);
    }
  });

  it('normal 是基准（全部倍率为 1）', () => {
    const n = DIFFICULTIES.normal;
    expect(n.fireIntervalMul).toBe(1);
    expect(n.bulletCountMul).toBe(1);
    expect(n.bulletSpeedMul).toBe(1);
    expect(n.coinDropMul).toBe(1);
    expect(n.priceMul).toBe(1);
  });

  it('难度越高弹幕越密、资源越少', () => {
    const order = DIFFICULTY_ORDER;
    for (let i = 1; i < order.length; i++) {
      const prev = DIFFICULTIES[order[i - 1]!];
      const cur = DIFFICULTIES[order[i]!];
      // 开火更快（间隔倍率更小）
      expect(cur.fireIntervalMul).toBeLessThan(prev.fireIntervalMul);
      // 弹数更多
      expect(cur.bulletCountMul).toBeGreaterThan(prev.bulletCountMul);
      // 掉落更少
      expect(cur.coinDropMul).toBeLessThan(prev.coinDropMul);
      // 价格更高
      expect(cur.priceMul).toBeGreaterThan(prev.priceMul);
    }
  });

  it('非法难度 id 回落到 normal', () => {
    expect(getDifficulty('nonexistent').id).toBe('normal');
  });
});

describe('难度接入 World', () => {
  it('默认是 normal', () => {
    const w = new World({ seed: 1 });
    expect(w.difficulty.id).toBe('normal');
    expect(w.shopPriceMul).toBe(1);
  });

  it('设置难度后价格倍率随之变化', () => {
    const w = new World({ seed: 1 });
    w.setDifficulty('lunatic');
    expect(w.difficulty.id).toBe('lunatic');
    expect(w.shopPriceMul).toBe(DIFFICULTIES.lunatic.priceMul);
  });

  it('自机侧参数不随难度改变（设计红线）', () => {
    // 抽牌间隔、能量上限、初始手牌、初始残机必须全部一致
    const snap = (id: 'easy' | 'lunatic') => {
      const w = new World({ seed: 42 });
      w.setDifficulty(id);
      return {
        energyInterval: w.deck.energy.interval,
        handUpper: w.deck.pile.cfg.upper,
        energyCap: w.deck.energy.cap,
        lives: w.player.lives,
        spells: w.spell.cards,
      };
    };
    expect(snap('easy')).toEqual(snap('lunatic'));
  });

  it('难度不修改共享的敌人模板（避免倍率被反复叠加）', () => {
    const before = JSON.stringify(ENEMY_POOL.boss_placeholder);
    const w = new World({ seed: 1 });
    w.setDifficulty('lunatic');
    // 触发一次敌人生成路径
    w.debugJumpToWave(0, 1);
    for (let i = 0; i < 60; i++) w.step();
    expect(JSON.stringify(ENEMY_POOL.boss_placeholder)).toBe(before);
  });
});
