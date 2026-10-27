/**
 * 空间哈希网格 —— 用于「自机子弹 vs 敌弹」的消弹检测。
 *
 * 问题：M 颗自机子弹 × N 颗敌弹，暴力比较是 O(M×N)。
 *       400 × 400 = 160,000 次 / 帧，2000 颗敌弹时是 800,000 次。
 *
 * 解法：把屏幕切成格子，只比较落在同一格（及邻格）里的子弹。
 *       平均每格子弹数很少，于是 O(M×N) 降为接近 O(M+N)。
 *
 * 这是 P0 要验证的第二个假设。
 */

export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;

  /**
   * 每个格子存一组索引。
   * 用「计数排序 + 扁平数组」而不是 `number[][]`：
   * 后者每帧要清空几千个数组，GC 压力和内存碎片都不可接受。
   */
  private readonly cellCount: Uint32Array;
  private readonly cellStart: Uint32Array;
  private readonly items: Int32Array;

  /** 每颗子弹当前所在的格子编号，避免重复计算 */
  private readonly itemCell: Int32Array;

  constructor(
    readonly width: number,
    readonly height: number,
    cellSize: number,
    capacity: number,
  ) {
    this.cellSize = Math.max(1, cellSize);
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);

    const n = this.cols * this.rows;
    this.cellCount = new Uint32Array(n);
    this.cellStart = new Uint32Array(n + 1);
    this.items = new Int32Array(capacity);
    this.itemCell = new Int32Array(capacity);
  }

  get cellTotal(): number {
    return this.cols * this.rows;
  }

  /** 坐标 → 格子编号，越界时夹到边缘 */
  cellIndexOf(x: number, y: number): number {
    let cx = (x / this.cellSize) | 0;
    let cy = (y / this.cellSize) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /**
   * 重建网格。每帧调用一次。
   *
   * 两趟计数排序：
   *   第 1 趟：数每格有多少个
   *   第 2 趟：把索引按格子填进扁平数组
   *
   * 复杂度 O(n + cellTotal)，n 是子弹数。
   */
  rebuild(xs: Float32Array, ys: Float32Array, alive: Uint8Array, count: number): void {
    this.cellCount.fill(0);

    // 第 1 趟：统计每格数量，顺便记录每颗子弹的格子
    for (let k = 0; k < count; k++) {
      const i = alive[k] === 1 ? k : -1;
      if (i < 0) continue;
      const c = this.cellIndexOf(xs[i]!, ys[i]!);
      this.itemCell[i] = c;
      this.cellCount[c]!++;
    }

    // 前缀和 → 每格在 items 中的起始位置
    let acc = 0;
    for (let c = 0; c < this.cellTotal; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c]!;
    }
    this.cellStart[this.cellTotal] = acc;

    // 第 2 趟：填充
    const cursor = new Uint32Array(this.cellTotal);
    for (let k = 0; k < count; k++) {
      if (alive[k] !== 1) continue;
      const c = this.itemCell[k]!;
      this.items[this.cellStart[c]! + cursor[c]!] = k;
      cursor[c]!++;
    }
  }

  /**
   * 查询某点附近的条目索引，写入 out 并返回数量。
   * 搜索 3×3 邻格，保证跨格的圆形碰撞不漏检。
   */
  queryNeighbors(x: number, y: number, out: Int32Array): number {
    const cx = Math.max(0, Math.min(this.cols - 1, (x / this.cellSize) | 0));
    const cy = Math.max(0, Math.min(this.rows - 1, (y / this.cellSize) | 0));

    let n = 0;
    const x0 = Math.max(0, cx - 1);
    const x1 = Math.min(this.cols - 1, cx + 1);
    const y0 = Math.max(0, cy - 1);
    const y1 = Math.min(this.rows - 1, cy + 1);

    for (let gy = y0; gy <= y1; gy++) {
      const rowBase = gy * this.cols;
      for (let gx = x0; gx <= x1; gx++) {
        const c = rowBase + gx;
        const start = this.cellStart[c]!;
        const end = this.cellStart[c + 1]!;
        for (let k = start; k < end; k++) {
          out[n++] = this.items[k]!;
        }
      }
    }
    return n;
  }
}

/**
 * 朴素消弹：自机子弹 × 敌弹 两两比较。
 * 对照组，用于证明空间哈希的价值。
 */
export function naiveGrazeCheck(
  px: Float32Array, py: Float32Array, palive: Uint8Array, pcount: number,
  ex: Float32Array, ey: Float32Array, ealive: Uint8Array, ecount: number,
  radius: number,
): number {
  const r2 = radius * radius;
  let hits = 0;
  for (let i = 0; i < pcount; i++) {
    if (palive[i] !== 1) continue;
    const x1 = px[i]!;
    const y1 = py[i]!;
    for (let j = 0; j < ecount; j++) {
      if (ealive[j] !== 1) continue;
      const dx = x1 - ex[j]!;
      const dy = y1 - ey[j]!;
      if (dx * dx + dy * dy <= r2) hits++;
    }
  }
  return hits;
}
