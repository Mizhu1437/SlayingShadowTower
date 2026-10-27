import { BulletField } from '../core/danmaku/bulletField';

/**
 * 帧时间统计器。
 *
 * 用 performance.now() 包住一段逻辑，记录每帧耗时。
 * 只统计「逻辑」不统计「渲染」——渲染耗时由渲染层的 FPS 显示负责。
 */
export class FrameTimer {
  private readonly samples: Float64Array;
  private writeIndex = 0;
  private filled = 0;

  constructor(capacity = 600) {
    this.samples = new Float64Array(capacity);
  }

  push(ms: number): void {
    this.samples[this.writeIndex] = ms;
    this.writeIndex = (this.writeIndex + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled++;
  }

  reset(): void {
    this.writeIndex = 0;
    this.filled = 0;
  }

  private sorted(): Float64Array {
    const copy = this.samples.slice(0, this.filled);
    copy.sort();
    return copy;
  }

  avg(): number {
    if (this.filled === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.filled; i++) s += this.samples[i]!;
    return s / this.filled;
  }

  /** 第 p 分位（0–1），p=0.99 即 P99 */
  percentile(p: number): number {
    if (this.filled === 0) return 0;
    const s = this.sorted();
    const idx = Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)));
    return s[idx]!;
  }

  max(): number {
    if (this.filled === 0) return 0;
    let m = 0;
    for (let i = 0; i < this.filled; i++) m = Math.max(m, this.samples[i]!);
    return m;
  }

  get count(): number {
    return this.filled;
  }
}

export interface BenchResult {
  /** 每组测试的子弹数量 */
  bulletCount: number;
  /** 单帧逻辑耗时：平均 / P99 / 最大，单位毫秒 */
  avgMs: number;
  p99Ms: number;
  maxMs: number;
  /** 相对 16.67ms 预算的占用百分比 */
  budgetPct: number;
}

/**
 * 运行一次定点压测：让 N 颗子弹跑若干帧，记录每帧 integrate 的耗时。
 *
 * 不涉及渲染——这里只测逻辑层是否能在一帧预算内完成。
 */
export function benchIntegrate(
  bulletCount: number,
  frames = 600,
  warmup = 120,
): BenchResult {
  const field = new BulletField(Math.max(4096, bulletCount + 16));
  const W = 384;
  const H = 448;
  const rng = mulberry(0xdeadbeef);

  // 铺满子弹
  for (let i = 0; i < bulletCount; i++) {
    const a = rng() * Math.PI * 2;
    const speed = 60 + rng() * 180;
    field.spawn(
      rng() * W,
      rng() * H,
      Math.cos(a) * speed,
      Math.sin(a) * speed,
      3,
      999, // 生命周期足够长，避免中途大量回收影响测量
      (rng() - 0.5) * 20,
      (rng() - 0.5) * 20,
    );
  }

  const timer = new FrameTimer(frames);
  const dt = 1 / 60;

  const runFrame = () => {
    const t0 = performance.now();
    field.integrate(dt);
    // 出界后循环回来，保持子弹数量恒定
    const { x, y, radius } = field;
    for (let i = 0; i < field.capacity; i++) {
      if (field.state[i] !== 1) continue;
      if (x[i]! < 0) x[i] = W;
      else if (x[i]! > W) x[i] = 0;
      if (y[i]! < 0) y[i] = H;
      else if (y[i]! > H) y[i] = 0;
      void radius;
    }
    return performance.now() - t0;
  };

  for (let i = 0; i < warmup; i++) runFrame();
  timer.reset();
  for (let i = 0; i < frames; i++) timer.push(runFrame());

  const avgMs = timer.avg();
  return {
    bulletCount,
    avgMs,
    p99Ms: timer.percentile(0.99),
    maxMs: timer.max(),
    budgetPct: (avgMs / 16.667) * 100,
  };
}

/** 极简 LCG，避免压测代码依赖业务 Rng */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
