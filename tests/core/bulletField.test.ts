import { describe, it, expect } from 'vitest';
import { BulletField } from '../../src/core/danmaku/bulletField';
import { Rng, derive } from '../../src/core/rng';

describe('BulletField 对象池', () => {
  it('分配与回收后计数正确', () => {
    const f = new BulletField(16);
    expect(f.aliveCount).toBe(0);

    const a = f.spawn(10, 10, 1, 1, 2, 1);
    const b = f.spawn(20, 20, 1, 1, 2, 1);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(f.aliveCount).toBe(2);

    f.kill(a);
    expect(f.aliveCount).toBe(1);
  });

  it('池满时返回 -1 而不是崩溃', () => {
    const f = new BulletField(2);
    expect(f.spawn(0, 0, 0, 0, 1, 1)).toBe(0);
    expect(f.spawn(0, 0, 0, 0, 1, 1)).toBe(1);
    expect(f.spawn(0, 0, 0, 0, 1, 1)).toBe(-1);
  });

  it('重复回收同一槽位不会让计数变负', () => {
    const f = new BulletField(4);
    const i = f.spawn(0, 0, 0, 0, 1, 1);
    f.kill(i);
    f.kill(i);
    expect(f.aliveCount).toBe(0);
  });

  it('跑满一帧后数量恒定（无泄漏）', () => {
    const f = new BulletField(32);
    for (let i = 0; i < 10; i++) f.spawn(i, i, 10, 0, 1, 100);

    // 跑 60 帧
    for (let t = 0; t < 60; t++) f.integrate(1 / 60);

    // 生命周期 100 秒，不该有任何子弹死亡
    expect(f.aliveCount).toBe(10);
  });

  it('生命周期到期的子弹被回收', () => {
    const f = new BulletField(8);
    f.spawn(0, 0, 0, 0, 1, 0.1); // 0.1 秒生命
    for (let t = 0; t < 20; t++) f.integrate(1 / 60);
    expect(f.aliveCount).toBe(0);
  });
});

describe('Rng 确定性', () => {
  it('同一种子产生同一序列', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('不同种子产生不同序列', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() === b.next()) same++;
    }
    expect(same).toBeLessThan(5);
  });

  it('next() 落在 [0, 1)', () => {
    const r = new Rng(999);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) 落在 [0, n)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('种子派生', () => {
  it('相同参数得到相同子种子', () => {
    expect(derive(42, 'stage', 1)).toBe(derive(42, 'stage', 1));
  });

  it('不同标签互相隔离', () => {
    const s1 = derive(42, 'stage', 1);
    const s2 = derive(42, 'reward');
    const s3 = derive(42, 'cards');
    expect(new Set([s1, s2, s3]).size).toBe(3);
  });

  it('不同主种子得到不同子种子', () => {
    expect(derive(1, 'stage')).not.toBe(derive(2, 'stage'));
  });
});
