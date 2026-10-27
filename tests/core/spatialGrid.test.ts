import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../../src/core/danmaku/spatialGrid';
import { Rng } from '../../src/core/rng';

describe('SpatialGrid', () => {
  it('坐标映射到正确的格子', () => {
    const g = new SpatialGrid(320, 320, 32, 64);
    expect(g.cols).toBe(10);
    expect(g.rows).toBe(10);
    expect(g.cellIndexOf(0, 0)).toBe(0);
    expect(g.cellIndexOf(31, 0)).toBe(0);
    expect(g.cellIndexOf(32, 0)).toBe(1);
    expect(g.cellIndexOf(0, 32)).toBe(10);
  });

  it('越界坐标夹到边缘，不越界访问', () => {
    const g = new SpatialGrid(100, 100, 25, 16);
    expect(g.cellIndexOf(-50, -50)).toBe(0);
    expect(g.cellIndexOf(999, 999)).toBe(g.cellTotal - 1);
  });

  it('能找到落在同一格的邻居', () => {
    const g = new SpatialGrid(120, 120, 40, 16);
    const xs = new Float32Array([12, 18, 100]);
    const ys = new Float32Array([12, 15, 100]);
    const alive = new Uint8Array([1, 1, 1]);
    g.rebuild(xs, ys, alive, 3);

    const out = new Int32Array(16);
    const n = g.queryNeighbors(14, 14, out);
    expect(n).toBeGreaterThanOrEqual(2);

    const found = new Set(Array.from(out.slice(0, n)));
    expect(found.has(0)).toBe(true);
    expect(found.has(1)).toBe(true);
  });

  it('查询空区域返回 0', () => {
    const g = new SpatialGrid(300, 300, 30, 8);
    const xs = new Float32Array([5]);
    const ys = new Float32Array([5]);
    const alive = new Uint8Array([1]);
    g.rebuild(xs, ys, alive, 1);

    const out = new Int32Array(64);
    const n = g.queryNeighbors(290, 290, out);
    expect(n).toBe(0);
  });

  it('重建后不残留上一帧的条目', () => {
    const g = new SpatialGrid(120, 120, 40, 16);
    const out = new Int32Array(64);

    const xs = new Float32Array([12]);
    const ys = new Float32Array([12]);
    const alive = new Uint8Array([1]);

    g.rebuild(xs, ys, alive, 1);
    expect(g.queryNeighbors(12, 12, out)).toBeGreaterThan(0);

    // 全部标记为死亡后重建
    alive[0] = 0;
    g.rebuild(xs, ys, alive, 1);
    expect(g.queryNeighbors(12, 12, out)).toBe(0);
  });

  it('与暴力遍历结果一致（随机数据交叉验证）', () => {
    const W = 400;
    const H = 400;
    const cell = 25;
    const n = 120;
    const rng = new Rng(2024);

    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      xs[i] = rng.range(0, W);
      ys[i] = rng.range(0, H);
    }

    const grid = new SpatialGrid(W, H, cell, n);
    grid.rebuild(xs, ys, alive, n);

    const radius = 6;
    const r2 = radius * radius;
    const out = new Int32Array(256);

    // 随机的若干查询点，比对两种方法的核心结果
    for (let q = 0; q < 200; q++) {
      const qx = rng.range(0, W);
      const qy = rng.range(0, H);

      const hitsNaive: number[] = [];
      for (let j = 0; j < n; j++) {
        if (alive[j] !== 1) continue;
        const dx = qx - xs[j]!;
        const dy = qy - ys[j]!;
        if (dx * dx + dy * dy <= r2) hitsNaive.push(j);
      }

      const cnt = grid.queryNeighbors(qx, qy, out);
      const hitsGrid: number[] = [];
      for (let k = 0; k < cnt; k++) {
        const j = out[k]!;
        const dx = qx - xs[j]!;
        const dy = qy - ys[j]!;
        if (dx * dx + dy * dy <= r2) hitsGrid.push(j);
      }

      expect(hitsGrid.sort((a, b) => a - b)).toEqual(hitsNaive.sort((a, b) => a - b));
    }
  });
});
