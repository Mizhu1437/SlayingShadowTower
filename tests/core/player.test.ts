import { describe, it, expect } from 'vitest';
import { Player, DEFAULT_PLAYER } from '../../src/core/player';
import { FixedStep, LOGIC_DT } from '../../src/core/loop';
import { resolveShot, DEFAULT_SHOT, type ShotModifier } from '../../src/core/shot/profile';

const BOUNDS = { left: 8, top: 8, right: 376, bottom: 440 };

describe('Player 移动', () => {
  it('按固定 dt 移动，速度正确', () => {
    const p = new Player(200, 300);
    p.step({ dx: 1, dy: 0, focus: false }, BOUNDS);
    // 高速 300px/s × 1/60s = 5px
    expect(p.x).toBeCloseTo(200 + DEFAULT_PLAYER.speedHigh * LOGIC_DT, 5);
  });

  it('低速是高速的固定比例，且明显更慢', () => {
    const a = new Player(200, 300);
    const b = new Player(200, 300);
    a.step({ dx: 1, dy: 0, focus: false }, BOUNDS);
    b.step({ dx: 1, dy: 0, focus: true }, BOUNDS);

    const fast = a.x - 200;
    const slow = b.x - 200;
    expect(slow).toBeLessThan(fast);
    expect(slow).toBeCloseTo(DEFAULT_PLAYER.speedLow * LOGIC_DT, 5);
  });

  it('斜向移动做了归一化，不会更快', () => {
    const straight = new Player(200, 300);
    const diagonal = new Player(200, 300);
    straight.step({ dx: 1, dy: 0, focus: false }, BOUNDS);
    diagonal.step({ dx: 1, dy: 1, focus: false }, BOUNDS);

    const dStraight = Math.hypot(straight.x - 200, straight.y - 300);
    const dDiagonal = Math.hypot(diagonal.x - 200, diagonal.y - 300);
    expect(dDiagonal).toBeCloseTo(dStraight, 5);
  });

  it('不能移出场地边界', () => {
    const p = new Player(9, 9);
    for (let i = 0; i < 100; i++) {
      p.step({ dx: -1, dy: -1, focus: false }, BOUNDS);
    }
    expect(p.x).toBe(BOUNDS.left);
    expect(p.y).toBe(BOUNDS.top);
  });
});

describe('Player 受击与无敌', () => {
  it('首次命中扣一条命并进入无敌', () => {
    const p = new Player(200, 300);
    expect(p.lives).toBe(3);
    expect(p.hit()).toBe(true);
    expect(p.lives).toBe(2);
    expect(p.vulnerable).toBe(false);
  });

  it('无敌期间再次命中无效', () => {
    const p = new Player(200, 300);
    p.hit();
    expect(p.hit()).toBe(false);
    expect(p.lives).toBe(2);
  });

  it('无敌结束后可以再次受击', () => {
    const p = new Player(200, 300);
    p.hit();
    // 推进足够时长让无敌结束
    const steps = Math.ceil(DEFAULT_PLAYER.invulnTime / LOGIC_DT) + 2;
    for (let i = 0; i < steps; i++) {
      p.step({ dx: 0, dy: 0, focus: false }, BOUNDS);
    }
    expect(p.vulnerable).toBe(true);
    expect(p.hit()).toBe(true);
    expect(p.lives).toBe(1);
  });

  it('残机耗尽后标记死亡，不再受击', () => {
    const p = new Player(200, 300);
    for (let k = 0; k < 3; k++) {
      p.invuln = 0; // 强制结束无敌，模拟连续死亡
      p.hit();
    }
    expect(p.lives).toBe(0);
    expect(p.dead).toBe(true);
    expect(p.hit()).toBe(false);
  });
});

describe('FixedStep 固定步长', () => {
  it('正好一步的时间只跑一步', () => {
    const f = new FixedStep();
    let count = 0;
    const r = f.advance(LOGIC_DT, () => count++);
    expect(count).toBe(1);
    expect(r.steps).toBe(1);
  });

  it('不足一步的时间不跑逻辑', () => {
    const f = new FixedStep();
    let count = 0;
    f.advance(LOGIC_DT * 0.4, () => count++);
    expect(count).toBe(0);
  });

  it('累积的余数会在下一帧补上', () => {
    const f = new FixedStep();
    let count = 0;
    f.advance(LOGIC_DT * 0.6, () => count++);
    f.advance(LOGIC_DT * 0.6, () => count++);
    expect(count).toBe(1); // 1.2 步 → 跑 1 步，余 0.2
  });

  it('长时间卡顿不会一次跑几百步（有上限）', () => {
    const f = new FixedStep();
    let count = 0;
    f.advance(5.0, () => count++);
    expect(count).toBeLessThanOrEqual(5);
  });
});

describe('ShotProfile 三阶段结算', () => {
  const base = { ...DEFAULT_SHOT, damage: 3, count: 1, homing: 0 };

  it('加法可交换：换卡顺序不影响结果', () => {
    const a: ShotModifier[] = [
      { op: 'add', stat: 'damage', value: 2 },
      { op: 'add', stat: 'damage', value: 5 },
    ];
    const b: ShotModifier[] = [a[1]!, a[0]!];
    expect(resolveShot(base, a).damage).toBe(resolveShot(base, b).damage);
  });

  it('乘法可交换', () => {
    const a: ShotModifier[] = [
      { op: 'mul', stat: 'damage', value: 1.5 },
      { op: 'mul', stat: 'damage', value: 2 },
    ];
    const b: ShotModifier[] = [a[1]!, a[0]!];
    expect(resolveShot(base, a).damage).toBeCloseTo(resolveShot(base, b).damage, 10);
  });

  it('顺序固定为 先加 后乘', () => {
    const mods: ShotModifier[] = [
      { op: 'mul', stat: 'damage', value: 2 },
      { op: 'add', stat: 'damage', value: 3 },
    ];
    // (3 + 3) × 2 = 12，而不是 3 + 3×2 = 9
    expect(resolveShot(base, mods).damage).toBe(12);
  });

  it('set 覆盖优先级最高', () => {
    const mods: ShotModifier[] = [
      { op: 'add', stat: 'damage', value: 10 },
      { op: 'mul', stat: 'damage', value: 3 },
      { op: 'set', stat: 'damage', value: 7 },
    ];
    expect(resolveShot(base, mods).damage).toBe(7);
  });

  it('混合加减乘时顺序无关（加法组与乘法组各自可交换）', () => {
    const orderA: ShotModifier[] = [
      { op: 'add', stat: 'damage', value: 2 },
      { op: 'mul', stat: 'damage', value: 1.5 },
      { op: 'add', stat: 'damage', value: 4 },
    ];
    const orderB: ShotModifier[] = [orderA[2]!, orderA[0]!, orderA[1]!];
    expect(resolveShot(base, orderA).damage).toBeCloseTo(
      resolveShot(base, orderB).damage, 10,
    );
  });

  it('防护：count 取整、interval 有下限、damage 不为负', () => {
    const out = resolveShot(base, [
      { op: 'set', stat: 'count', value: -5 },
      { op: 'set', stat: 'interval', value: 0 },
      { op: 'set', stat: 'damage', value: -10 },
    ]);
    expect(out.count).toBe(0);
    expect(out.interval).toBeGreaterThan(0);
    expect(out.damage).toBe(0);
  });
});
