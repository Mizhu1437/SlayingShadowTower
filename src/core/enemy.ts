/**
 * 敌人（Enemy）
 *
 * 现在包含：位置、血量、体型、移动、被击中、以及可选的弹幕发射器。
 */

import { Emitter, type EmitterSpec } from './danmaku/emitter';
import type { BulletField } from './danmaku/bulletField';
import { EnemyStatus, WEAK_FIRE_FACTOR } from './status';

export interface EnemyConfig {
  hp: number;
  radius: number;
  /** 得分 */
  score: number;
  /** 掉落蜃銭 */
  coin: number;
  /** 弹幕配置。不给就不开火 */
  emitter?: EmitterSpec;
  /** 开火间隔（秒）。emitter 的 step 内部用它作冷却 */
  fireInterval?: number;
}

export class Enemy {
  x = 0;
  y = 0;
  hp = 1;
  maxHp = 1;
  radius = 12;
  score = 0;
  coin = 0;

  /** 移动目标（简单直线插值，够 MVP 用） */
  targetX = 0;
  targetY = 0;
  /** 移动到位的速度 px/s */
  moveSpeed = 900;

  /** 是否已死亡（等待清理） */
  dead = false;
  /** 死亡动画计时（秒），>0 时仍在播放消散 */
  fadeOut = 0;

  /** 受击闪白计时 */
  hitFlash = 0;

  /** 弹幕发射器（可选） */
  private emitter: Emitter | null = null;
  private fireCooldown = 0;
  private readonly fireInterval: number;

  /** 状态效果（虚弱 / 燃烧） */
  readonly status: EnemyStatus = new EnemyStatus();

  constructor(cfg: EnemyConfig, x: number, y: number, targetY?: number) {
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.radius = cfg.radius;
    this.score = cfg.score;
    this.coin = cfg.coin;
    this.x = x;
    this.y = y;
    this.targetX = x;

    // 进场目标位置。
    //
    // 关键：如果出生点在场地外（y < 0），必须指定一个场内的目标点，
    // 否则 targetY = y 会让敌人"已到位"，永远停在场外。
    // 默认把目标设为场地高度的 20%（上方安全区），
    // 调用方可通过 targetY 覆盖。
    const inFieldY = targetY ?? (y < 0 ? 448 * 0.2 : y);
    this.targetY = inFieldY;

    if (cfg.emitter) {
      this.emitter = new Emitter(cfg.emitter);
      this.fireInterval = cfg.fireInterval ?? 1.6;
      // 错开首次开火，避免所有敌人同时发射
      this.fireCooldown = this.fireInterval * 0.5;
    } else {
      this.fireInterval = 0;
    }
  }

  moveTo(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * 推进一个逻辑步。
   * bullets 为 null 时不处理开火（用于纯逻辑测试）。
   */
  step(dt: number, bullets: BulletField | null = null): void {
    if (this.dead) {
      if (this.fadeOut > 0) this.fadeOut = Math.max(0, this.fadeOut - dt);
      return;
    }

    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const move = Math.min(dist, this.moveSpeed * dt);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }

    // 到位后才开火
    if (this.emitter && bullets && dist <= 2) {
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0) {
        this.fireCooldown += this.fireInterval;

        // 虚弱：发射的弹幕量减少 25%
        if (this.status.isWeak) {
          this.emitter.burst(this.x, this.y, bullets, WEAK_FIRE_FACTOR);
        } else {
          this.emitter.burst(this.x, this.y, bullets);
        }
      }
    }
  }

  /**
   * 造成伤害。返回 true 表示本次击杀。
   */
  damage(amount: number): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.hitFlash = 0.08;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.fadeOut = 0.25;
      return true;
    }
    return false;
  }

  /** 是否还能被自机子弹命中 */
  get targetable(): boolean {
    return !this.dead;
  }

  /** 是否有弹幕（供渲染层区分外观） */
  get hasEmitter(): boolean {
    return this.emitter !== null;
  }
}
