/**
 * 自机子弹（PlayerShot）
 *
 * 与敌弹分开存：数量级不同（自机子弹少、敌弹多），生命周期与碰撞对象也不同。
 * 共用一套结构会白白增加遍历成本。
 */

import { BulletField } from '../danmaku/bulletField';

/** 自机子弹的视觉类型，渲染层按它选贴图 */
export type ShotKind = 'needle' | 'orb' | 'talisman';

export class PlayerShots {
  readonly field: BulletField;
  readonly damage: Float32Array;
  readonly kind: Uint8Array;

  static readonly KIND_NEEDLE = 0;
  static readonly KIND_ORB = 1;
  static readonly KIND_TALISMAN = 2;

  constructor(capacity = 1024) {
    this.field = new BulletField(capacity);
    this.damage = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
  }

  spawn(
    x: number, y: number,
    vx: number, vy: number,
    radius: number, life: number,
    damage: number, kind: ShotKind,
  ): number {
    const i = this.field.spawn(x, y, vx, vy, radius, life);
    if (i < 0) return -1;
    this.damage[i] = damage;
    this.kind[i] =
      kind === 'orb' ? PlayerShots.KIND_ORB
        : kind === 'talisman' ? PlayerShots.KIND_TALISMAN
          : PlayerShots.KIND_NEEDLE;
    return i;
  }

  integrate(dt: number): void {
    this.field.integrate(dt);
  }

  clear(): void {
    this.field.clear();
  }

  get aliveCount(): number {
    return this.field.aliveCount;
  }
}
