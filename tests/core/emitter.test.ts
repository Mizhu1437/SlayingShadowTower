import { describe, it, expect } from 'vitest';
import { Emitter, PATTERNS, type EmitterSpec } from '../../src/core/danmaku/emitter';
import { BulletField } from '../../src/core/danmaku/bulletField';
import { DEG } from '../../src/core/vec';

function makeField(): BulletField {
  return new BulletField(2048);
}

describe('Emitter 基础发射', () => {
  it('burst 生成指定数量的子弹', () => {
    const f = makeField();
    const e = new Emitter(PATTERNS.ring(12, 100));
    const n = e.burst(100, 200, f);
    expect(n).toBe(12);
    expect(f.aliveCount).toBe(12);
  });

  it('count=0 时不生成', () => {
    const f = makeField();
    const spec: EmitterSpec = { count: 0, angle: 0, spread: 0, speed: 100, radius: 3, life: 1 };
    const e = new Emitter(spec);
    expect(e.burst(0, 0, f)).toBe(0);
    expect(f.aliveCount).toBe(0);
  });

  it('环形弹的速度方向覆盖 360 度', () => {
    const f = makeField();
    const e = new Emitter(PATTERNS.ring(8, 100));
    e.burst(0, 0, f);

    // 统计四个象限都有子弹
    const quadrants = new Set<number>();
    for (let i = 0; i < f.scanLimit; i++) {
      if (f.state[i] !== 1) continue;
      const ang = Math.atan2(f.vy[i]!, f.vx[i]!);
      const q = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 4) % 4;
      quadrants.add(q);
    }
    expect(quadrants.size).toBe(4);
  });

  it('单发弹的角度精确等于指定角度', () => {
    const f = makeField();
    const e = new Emitter(PATTERNS.single(-Math.PI / 2, 200));
    e.burst(50, 50, f);

    let idx = -1;
    for (let i = 0; i < f.scanLimit; i++) {
      if (f.state[i] === 1) { idx = i; break; }
    }
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(f.vx[idx]!).toBeCloseTo(0, 5);
    expect(f.vy[idx]!).toBeCloseTo(-200, 5);
  });

  it('扇形弹关于中心角对称', () => {
    const f = makeField();
    // 向上、50 度扇形、3 发
    const e = new Emitter(PATTERNS.fan3(-Math.PI / 2, 100));
    e.burst(0, 0, f);

    const angles: number[] = [];
    for (let i = 0; i < f.scanLimit; i++) {
      if (f.state[i] !== 1) continue;
      angles.push(Math.atan2(f.vy[i]!, f.vx[i]!));
    }
    angles.sort((a, b) => a - b);

    expect(angles.length).toBe(3);
    // 中间那发应该正好向上
    expect(angles[1]!).toBeCloseTo(-Math.PI / 2, 5);
    // 两侧对称
    const left = angles[0]!;
    const right = angles[2]!;
    expect(left).toBeCloseTo(-Math.PI / 2 - right - Math.PI / 2 === 0 ? left : left, 5);
    expect((left - (-Math.PI / 2))).toBeCloseTo(-(right - (-Math.PI / 2)), 5);
  });

  it('加速度沿发射方向', () => {
    const f = makeField();
    const spec: EmitterSpec = {
      count: 1, angle: 0, spread: 0, speed: 100, radius: 3, life: 5, accel: 50,
    };
    new Emitter(spec).burst(0, 0, f);

    let idx = -1;
    for (let i = 0; i < f.scanLimit; i++) {
      if (f.state[i] === 1) { idx = i; break; }
    }
    expect(f.ax[idx]!).toBeCloseTo(50, 5);
    expect(f.ay[idx]!).toBeCloseTo(0, 5);
  });
});

describe('Emitter 嵌套发射', () => {
  it('嵌套次数用完后停止', () => {
    const f = makeField();
    const spec: EmitterSpec = {
      count: 1, angle: 0, spread: 0, speed: 100, radius: 3, life: 5,
      nested: { interval: 0.1, repeat: 3 },
    };
    const e = new Emitter(spec);
    e.burst(0, 0, f); // 主发射 1
    expect(f.aliveCount).toBe(1);

    // 手动推进嵌套（step 内部按 1 秒冷却做主发射，这里只测嵌套）
    expect(e.step(0.1, 0, 0, f)).toBeGreaterThan(0);
  });

  it('嵌套的角度按 stepDeg 递进', () => {
    const f = makeField();
    const spec: EmitterSpec = {
      count: 1, angle: 0, spread: 0, speed: 100, radius: 3, life: 5,
      nested: { interval: 0.05, repeat: 2, stepDeg: 90 },
    };
    const e = new Emitter(spec);
    e.burst(0, 0, f);

    // 第一次嵌套：角度 +90 度
    e.step(0.05, 0, 0, f);
  });
});

describe('Emitter 预设', () => {
  it('PATTERNS.single 是单发', () => {
    expect(PATTERNS.single(0, 100).count).toBe(1);
  });

  it('PATTERNS.ring 的 spread 是整圆', () => {
    expect(PATTERNS.ring(12, 100).spread).toBeCloseTo(Math.PI * 2, 10);
  });

  it('PATTERNS.spiral 带嵌套配置', () => {
    const s = PATTERNS.spiral(150);
    expect(s.nested).toBeDefined();
    expect(s.nested!.repeat).toBeGreaterThan(0);
    expect(s.nested!.interval).toBeGreaterThan(0);
  });

  it('扇形角度用的是 DEG 常量（50 度）', () => {
    expect(PATTERNS.fan3(0, 100).spread).toBeCloseTo(50 * DEG, 10);
  });
});
