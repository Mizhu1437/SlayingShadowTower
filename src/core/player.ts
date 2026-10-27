/**
 * 自机（Player）
 *
 * 关键设计：
 * 1. 判定点（hitRadius）远小于视觉半径 —— 这是 STG 的基本正确性。
 *    玩家看到的是一坨光，被击中的只有中心一个小点。
 * 2. 高速 / 低速两套速度。低速用于精确走位，并显示判定点。
 * 3. 自动射击：不需要玩家按键，火力由 ShotProfile 决定（P2 接入）。
 */

import { clamp } from './vec';
import { LOGIC_DT } from './loop';

export interface PlayerConfig {
  /** 视觉半径（碰撞用） */
  hitRadius: number;
  /** 高速移动速度 px/s */
  speedHigh: number;
  /** 低速移动速度 px/s */
  speedLow: number;
  /** 受击后的无敌时长（秒） */
  invulnTime: number;
  /** 起始残机 */
  lives: number;
}

export const DEFAULT_PLAYER: PlayerConfig = {
  hitRadius: 2.4,
  speedHigh: 300,
  speedLow: 130,
  invulnTime: 2.0,
  lives: 3,
};

export interface InputState {
  /** -1 左 / 0 / 1 右 */
  dx: number;
  /** -1 上 / 0 / 1 下 */
  dy: number;
  /** 低速 */
  focus: boolean;
}

/** 场地的可活动区域（自机不能贴边出界） */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class Player {
  x = 0;
  y = 0;
  /** 是否正在低速，供渲染层判断要不要显示判定点 */
  focusing = false;
  /** 剩余无敌时间，>0 时不吃伤害 */
  invuln = 0;
  lives = 3;
  /** 本局是否已经死亡（残机耗尽） */
  dead = false;

  readonly cfg: PlayerConfig;

  constructor(x: number, y: number, cfg: PlayerConfig = DEFAULT_PLAYER) {
    this.x = x;
    this.y = y;
    this.cfg = cfg;
    this.lives = cfg.lives;
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.invuln = 0;
    this.lives = this.cfg.lives;
    this.dead = false;
    this.focusing = false;
  }

  /**
   * 推进一个逻辑步。
   * 注意：这里用固定 dt，不用真实帧时间——保证不同帧率下行为一致。
   */
  step(input: InputState, bounds: Bounds): void {
    if (this.dead) return;

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - LOGIC_DT);

    this.focusing = input.focus;
    const speed = input.focus ? this.cfg.speedLow : this.cfg.speedHigh;

    let dx = input.dx;
    let dy = input.dy;
    // 斜向归一化，否则对角线速度是 1.41 倍
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2;
      dx *= inv;
      dy *= inv;
    }

    this.x = clamp(this.x + dx * speed * LOGIC_DT, bounds.left, bounds.right);
    this.y = clamp(this.y + dy * speed * LOGIC_DT, bounds.top, bounds.bottom);
  }

  /** 是否处于可被命中的状态 */
  get vulnerable(): boolean {
    return !this.dead && this.invuln <= 0;
  }

  /**
   * 处理被命中。返回 true 表示本次真的吃到了伤害
   * （无敌帧内或已死亡时返回 false）。
   */
  hit(): boolean {
    if (!this.vulnerable) return false;

    this.lives--;
    this.invuln = this.cfg.invulnTime;
    if (this.lives <= 0) {
      this.lives = 0;
      this.dead = true;
    }
    return true;
  }
}
