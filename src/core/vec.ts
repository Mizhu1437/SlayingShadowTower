/**
 * 向量与角度工具。
 *
 * 这里刻意不做成 class，只用纯函数——避免在热循环里产生对象分配。
 */

export const DEG = Math.PI / 180;

export function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

/** 归一化到 (-PI, PI] */
export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 从 (x1,y1) 指向 (x2,y2) 的角度 */
export function angleTo(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/** 平滑插值（用于追踪弹） */
export function lerpAngle(from: number, to: number, t: number): number {
  const diff = normalizeAngle(to - from);
  return from + diff * Math.min(1, Math.max(0, t));
}

/** 限制在 [min, max] */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
