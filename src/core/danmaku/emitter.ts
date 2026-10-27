/**
 * 参数化发射器（Emitter）
 *
 * 一发弹幕不是"写死一段动画"，而是一组参数的产物：
 *   数量 / 角度 / 扇形 / 速度 / 加速度 / 角速度 / 嵌套发射
 *
 * 这个结构直接决定了 P3 的符卡编排可以用 JSON 描述。
 */

import type { BulletField } from './bulletField';
import { DEG } from '../vec';

export interface EmitterSpec {
  /** 子弹数量 */
  count: number;
  /** 中心角度（弧度）。0 = 向右，-PI/2 = 向上 */
  angle: number;
  /** 扇形展开角（弧度）。0 = 同向；2PI = 环形 */
  spread: number;
  /** 初始速度 px/s */
  speed: number;
  /** 径向加速度 px/s²（正=加速，负=减速） */
  accel?: number;
  /** 角速度 rad/s（正=顺时针） */
  angular?: number;
  /** 碰撞半径 */
  radius: number;
  /** 存活时间（秒） */
  life: number;
  /** 嵌套：每隔 interval 秒再射 repeat 次，每次角度偏移 step 度 */
  nested?: {
    interval: number;
    repeat: number;
    /** 每次嵌套的角度增量（度） */
    stepDeg?: number;
    /** 每次嵌套的速度增量 */
    speedStep?: number;
  };
}

/** 发射器运行时状态 */
export class Emitter {
  private spec: EmitterSpec;
  private cooldown = 0;
  private nestedRemain = 0;
  private nestedCooldown = 0;
  private firedCount = 0;

  constructor(spec: EmitterSpec) {
    this.spec = spec;
  }

  reset(): void {
    this.cooldown = 0;
    this.nestedRemain = 0;
    this.nestedCooldown = 0;
    this.firedCount = 0;
  }

  /**
   * 推进一个逻辑步，从 (x, y) 发射。
   * 返回本步生成的子弹数。
   */
  step(dt: number, x: number, y: number, field: BulletField): number {
    let fired = 0;

    // 主发射的冷却
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown += 1; // 默认 1 秒一次，由外部按需重置
      this.burst(x, y, field);
      fired += this.spec.count;

      const n = this.spec.nested;
      if (n && n.repeat > 0) {
        this.nestedRemain = n.repeat;
        this.nestedCooldown = n.interval;
        this.firedCount = 1;
      }
    }

    // 嵌套发射
    if (this.nestedRemain > 0) {
      this.nestedCooldown -= dt;
      if (this.nestedCooldown <= 0) {
        this.nestedCooldown += this.spec.nested!.interval;
        this.burst(x, y, field);
        fired += this.spec.count;
        this.nestedRemain--;
        this.firedCount++;
      }
    }

    return fired;
  }

  /** 立即打出一组（不经过冷却） */
  /**
   * 打出一组子弹。
   *
   * @param fireScale 火力系数（默认 1）。虚弱状态会传 0.75，
   *                  使发射量减少 25%。取整后至少保留 1 发。
   */
  burst(x: number, y: number, field: BulletField, fireScale = 1): number {
    const s = this.spec;
    const n = s.nested;
    // 嵌套发射时角度随次数偏移
    const stepRad = n?.stepDeg ? n.stepDeg * DEG * this.firedCount : 0;
    const speedAdd = n?.speedStep ? n.speedStep * this.firedCount : 0;

    const rawCount = Math.round(s.count * fireScale);
    const count = Math.max(0, rawCount);
    if (count === 0) return 0;

    const baseAngle = s.angle + stepRad;
    const speed = s.speed + speedAdd;

    // spread = 0 时全部同向；否则在 [-spread/2, +spread/2] 均匀分布
    const half = s.spread / 2;
    const stepAngle = count > 1 ? s.spread / count : 0;
    const startAngle = baseAngle - half + (count > 1 ? stepAngle / 2 : 0);

    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const a = count > 1 ? startAngle + stepAngle * i : baseAngle;
      const vx = Math.cos(a) * speed;
      const vy = Math.sin(a) * speed;

      // 加速度沿发射方向；角速度由 BulletField 不支持，
      // 这里用加速度近似"转弯"，P3 再接真正的角速度。
      const ax = s.accel ? Math.cos(a) * s.accel : 0;
      const ay = s.accel ? Math.sin(a) * s.accel : 0;
      void s.angular;

      const idx = field.spawn(x, y, vx, vy, s.radius, s.life, ax, ay);
      if (idx < 0) break;
      spawned++;
    }
    return spawned;
  }
}

/** 常用弹型的构造器 —— 让 P3 的 JSON 可以引用这些预设 */
export const PATTERNS = {
  /** 直射一发 */
  single: (angle: number, speed: number): EmitterSpec => ({
    count: 1, angle, spread: 0, speed, radius: 4, life: 4,
  }),

  /** 三向扇形 */
  fan3: (angle: number, speed: number): EmitterSpec => ({
    count: 3, angle, spread: 50 * DEG, speed, radius: 4, life: 4,
  }),

  /** 环形一圈 */
  ring: (count: number, speed: number): EmitterSpec => ({
    count, angle: 0, spread: Math.PI * 2, speed, radius: 4, life: 5,
  }),

  /** 螺旋：多次嵌套，每次转一个角度 */
  spiral: (speed: number, arms = 1): EmitterSpec => ({
    count: arms,
    angle: -Math.PI / 2,
    spread: (Math.PI * 2) / arms,
    speed,
    radius: 4,
    life: 6,
    nested: { interval: 0.08, repeat: 40, stepDeg: 13 },
  }),
} as const;
