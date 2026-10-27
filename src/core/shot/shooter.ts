/**
 * 自动射击器。
 *
 * 按 ShotProfile 的参数，每隔 interval 秒从自机位置射出一组子弹。
 * 玩家不需要按任何键——Z 键留给了卡牌。
 */

import type { Player } from '../player';
import type { PlayerShots, ShotKind } from './playerShots';
import type { ShotProfile } from './profile';
import { LOGIC_DT } from '../loop';

export class Shooter {
  private cooldown = 0;

  constructor(
    private profile: ShotProfile,
    private readonly shots: PlayerShots,
  ) {}

  setProfile(p: ShotProfile): void {
    this.profile = p;
  }

  getProfile(): ShotProfile {
    return this.profile;
  }

  reset(): void {
    this.cooldown = 0;
  }

  /**
   * 推进一个逻辑步。到时间就射出一组。
   * 返回本步发射的子弹数（供测试断言）。
   */
  step(player: Player, bounds: { top: number }): number {
    if (player.dead) return 0;

    this.cooldown -= LOGIC_DT;
    if (this.cooldown > 0) return 0;

    // 用 while 而不是 if：若 interval 极短（被卡牌改小），
    // 一次逻辑步内可能需要发射多组。
    let fired = 0;
    let guard = 0;
    while (this.cooldown <= 0 && guard++ < 8) {
      fired += this.fire(player, bounds);
      this.cooldown += this.profile.interval;
    }
    return fired;
  }

  private fire(player: Player, bounds: { top: number }): number {
    const p = this.profile;
    const n = p.count;
    if (n <= 0) return 0;

    // 单发时正上方；多发时在 spread 角度内均匀展开
    const baseAngle = -Math.PI / 2;
    const half = p.spread / 2;
    const stepAngle = n > 1 ? p.spread / (n - 1) : 0;
    const startAngle = baseAngle - half;

    // 横向偏移：多发时左右排开，避免完全重叠
    const offsetSpan = n > 1 ? p.offsetX * (n - 1) : 0;
    const startOffset = -offsetSpan / 2;

    const speed = p.speed;
    const kind: ShotKind = p.kind;

    let count = 0;
    for (let i = 0; i < n; i++) {
      const a = n > 1 ? startAngle + stepAngle * i : baseAngle;
      const ox = n > 1 ? startOffset + p.offsetX * i : 0;

      const idx = this.shots.spawn(
        player.x + ox,
        player.y - 8,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        p.radius,
        p.lifetime,
        p.damage,
        kind,
      );
      if (idx < 0) break;
      count++;
    }

    void bounds;
    return count;
  }
}
