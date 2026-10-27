/**
 * 确定性随机源（mulberry32）。
 *
 * 硬约束：整个游戏只有这一个随机源，且必须显式注入种子。
 * 禁止在任何地方调用 Math.random() —— ESLint 会拦。
 *
 * 为什么：可复现性是一切的测试前提。
 *   "种子 8842，第二幕 1 分 15 秒" 比 "我打了半小时突然卡住" 有用得多。
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    // 0 会让 mulberry32 退化，偏移一下
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [0, n) 的整数 */
  int(n: number): number {
    return (this.next() * n) | 0;
  }

  /** [-0.5, 0.5) 的浮点，常用于抖动 */
  jitter(): number {
    return this.next() - 0.5;
  }
}

/**
 * 结构化种子派生。
 *
 * 理由：波次生成、掉落、抽卡必须互不污染。
 * 若共用一个 Rng 流，调波次生成器会意外改变抽卡顺序，
 * 这会让"种子复现"变成"整局任何改动都会让旧种子失效"。
 */
export function derive(masterSeed: number, ...tags: (string | number)[]): number {
  let h = masterSeed >>> 0;
  for (const tag of tags) {
    const s = String(tag);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}
