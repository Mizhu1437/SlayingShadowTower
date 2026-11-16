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
  /**
   * 分阶段弹幕（BOSS 用）。
   *
   * 按血量百分比从高到低排列，每段带一个 `hpAbove` 阈值：
   * 当前血量比例 > 该值时使用这一段的弹幕。
   *
   * 为什么这么做：单一弹幕打 1800 血是重复劳动，
   * 玩家会感到"血条在掉但没有新东西"。分段切换让战斗有推进感，
   * 也是东方/弹幕游戏的通行做法。
   *
   * 切换时会短暂停止开火（`pauseSeconds`），
   * 给玩家一个喘息与重新定位的窗口 —— 否则血量刚破线就被新弹幕糊脸，
   * 难度断层会非常突兀。
   */
  phases?: EnemyPhase[];
}

/** BOSS 的一个战斗阶段 */
export interface EnemyPhase {
  /** 血量比例高于此值时处于该阶段（0–1）。最后一段用 0 */
  hpAbove: number;
  emitter: EmitterSpec;
  fireInterval: number;
  /** 进入该阶段后短暂停火秒数（默认 0.8） */
  pauseSeconds?: number;
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
  private fireInterval: number;

  /** 分阶段弹幕：按血量阈值切换。空数组表示不启用 */
  private readonly phases: EnemyPhase[] = [];
  /** 当前阶段下标（-1 表示尚未进入任何阶段） */
  private phaseIndex = -1;
  /** 阶段切换后的停火倒计时（秒） */
  private phasePause = 0;
  /** 本帧是否刚刚切换了阶段（供表现层播放提示） */
  phaseJustChanged = false;

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

    // 有 phases 时以它为准（按 hpAbove 从高到低排序，保证顺序稳定）
    if (cfg.phases && cfg.phases.length > 0) {
      this.phases = [...cfg.phases].sort((a, b) => b.hpAbove - a.hpAbove);
      this.fireInterval = this.phases[0]!.fireInterval;
      this.emitter = new Emitter(this.phases[0]!.emitter);
      this.fireCooldown = this.fireInterval * 0.5;
      this.phaseIndex = 0;
      return;
    }

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
   * 检查血量是否已跌破**当前阶段**的下限，若是则进入下一段。
   *
   * 阈值语义：`phases[i].hpAbove` 是该段的血量下限。
   * 排序后为 [0.66, 0.33, 0]，含义是：
   *   第 1 段在 hp > 0.66 时有效
   *   第 2 段在 hp > 0.33 时有效
   *   第 3 段在 hp > 0    时有效
   *
   * 所以判断依据是「当前段的 hpAbove」：血量一旦不高于它，
   * 就说明该离开这一段了。
   *
   * 之前写成比较 phases[phaseIndex+1].hpAbove，等于永远在等
   * **下一段的下限**，结果 66% 那一段被整个跳过，
   * 第一次切换要等血量掉到 33% 才发生。
   *
   * 每次只前进一段，避免一击打穿时跳过中间阶段的表现。
   */
  private updatePhase(): void {
    this.phaseJustChanged = false;
    if (this.phases.length === 0) return;

    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;

    // 当前段已失效？逐段前进（一次伤害最多跨一段）
    while (this.phaseIndex + 1 < this.phases.length) {
      const cur = this.phases[this.phaseIndex]!;
      if (ratio > cur.hpAbove) break;   // 仍在当前段范围内

      this.phaseIndex++;
      const nx = this.phases[this.phaseIndex]!;
      this.emitter = new Emitter(nx.emitter);
      this.fireInterval = nx.fireInterval;
      this.phasePause = nx.pauseSeconds ?? 0.8;
      this.fireCooldown = this.fireInterval * 0.5;
      this.phaseJustChanged = true;
      break;                            // 一次只切一段
    }
  }

  /** 当前处于第几阶段（从 1 开始；无 phases 的普通敌人恒为 1） */
  get currentPhase(): number {
    return this.phases.length === 0 ? 1 : this.phaseIndex + 1;
  }

  /** 总阶段数 */
  get totalPhases(): number {
    return Math.max(1, this.phases.length);
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

    if (this.phasePause > 0) this.phasePause = Math.max(0, this.phasePause - dt);

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const move = Math.min(dist, this.moveSpeed * dt);
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }

    // 到位后才开火。阶段切换的停火窗口内不开火，
    // 给玩家喘息与重新定位的时间。
    if (this.emitter && bullets && dist <= 2 && this.phasePause <= 0) {
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

    // 血量变化可能跨过阶段阈值
    this.updatePhase();
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
