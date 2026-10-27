/**
 * 卡牌驱动的自机弹幕。
 *
 * 本作没有常驻射击，所有自机子弹都来自卡牌效果。
 * 这里承担两类：
 *
 *   pierce_shot — 立刻发射一枚穿透弹（凤翼天翔的凤凰）
 *   burst_fire  — 开启一个持续射击窗口，在 duration 秒内定时发射
 *
 * 为什么单独一层：卡牌效果是"瞬时"的，但持续射击跨越多个逻辑步，
 * 需要一个常驻对象来记账。放在 World 里会污染主循环。
 */

import { PlayerShots, type ShotKind } from './playerShots';
import { LOGIC_DT } from '../loop';
import type { Player } from '../player';

/** 一个持续射击窗口 */
interface BurstWindow {
  /** 剩余时间 */
  remain: number;
  /** 两次发射的间隔 */
  interval: number;
  /** 距离下次发射的计时 */
  timer: number;
  count: number;
  damage: number;
  speed: number;
  pierce: number;
}

/** 单发子弹的穿透记账：槽位索引 → 剩余穿透次数 */
const pierceLeft = new Map<number, number>();

export class CardShots {
  readonly shots: PlayerShots;
  private bursts: BurstWindow[] = [];

  /** 每发子弹的剩余穿透次数，按槽位索引存取 */
  private readonly pierce: Int32Array;

  constructor(capacity = 1024) {
    this.shots = new PlayerShots(capacity);
    this.pierce = new Int32Array(capacity);
  }

  /** 查询某颗子弹还剩几次穿透 */
  pierceOf(index: number): number {
    return this.pierce[index] ?? 0;
  }

  /** 消耗一次穿透，返回是否还能继续穿透 */
  consumePierce(index: number): boolean {
    if (this.pierce[index] > 0) {
      this.pierce[index]--;
      return true;
    }
    return false;
  }

  clear(): void {
    this.shots.clear();
    this.bursts.length = 0;
    this.pierce.fill(0);
    pierceLeft.clear();
  }

  /**
   * 立刻发射一枚穿透弹（向前方，即 -Y 方向）。
   */
  firePierce(
    player: Player,
    count: number,
    damage: number,
    speed: number,
    pierce: number,
    radius: number,
    kind: ShotKind = 'talisman',
  ): number {
    let fired = 0;
    const spreadStep = count > 1 ? 0.12 : 0;
    const startOffset = -((count - 1) / 2) * 14;

    for (let i = 0; i < count; i++) {
      const vx = (i - (count - 1) / 2) * spreadStep * speed;
      const idx = this.shots.spawn(
        player.x + startOffset + i * 14,
        player.y - 12,
        vx,
        -speed,
        radius,
        3.0,
        damage,
        kind,
      );
      if (idx < 0) break;
      this.pierce[idx] = pierce;
      fired++;
    }
    return fired;
  }

  /**
   * 开启一个持续射击窗口。
   */
  startBurst(
    duration: number,
    interval: number,
    count: number,
    damage: number,
    speed: number,
    pierce: number,
  ): void {
    // 同一个窗口重复打出时，取较长时长（不叠加发射频率）
    this.bursts.push({
      remain: duration,
      interval: Math.max(0.05, interval),
      timer: 0,          // 立刻打第一组
      count,
      damage,
      speed,
      pierce,
    });
  }

  /** 推进一个逻辑步，处理所有持续窗口 */
  step(player: Player): void {
    const bounds = { left: 8, right: 384 - 8 };

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.remain -= LOGIC_DT;

      b.timer -= LOGIC_DT;
      if (b.timer <= 0) {
        b.timer += b.interval;
        this.emitBurstGroup(player, b, bounds);
      }

      if (b.remain <= 0) this.bursts.splice(i, 1);
    }
  }

  private emitBurstGroup(
    player: Player,
    b: BurstWindow,
    bounds: { left: number; right: number },
  ): void {
    const n = Math.max(1, Math.round(b.count));
    const spacing = 10;
    const start = -((n - 1) / 2) * spacing;

    for (let i = 0; i < n; i++) {
      const x = Math.max(bounds.left, Math.min(bounds.right, player.x + start + i * spacing));
      const idx = this.shots.spawn(
        x,
        player.y - 10,
        0,
        -b.speed,
        3,
        2.2,
        b.damage,
        'needle',
      );
      if (idx < 0) break;
      this.pierce[idx] = b.pierce;
    }
  }

  /** 当前有几个持续射击窗口在生效（供 UI） */
  get activeBursts(): number {
    return this.bursts.length;
  }
}