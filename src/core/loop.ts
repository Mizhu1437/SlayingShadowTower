/**
 * 固定步长逻辑帧。
 *
 * 为什么需要它：
 *   渲染帧率会波动（60 / 144 / 掉帧），但游戏逻辑必须按固定节奏推进，
 *   否则同一段操作在不同机器上结果不同，种子复现就失效了。
 *
 * 做法：累加真实经过的时间，每当累积够一步就推进一次逻辑，
 *       余数留给下一帧。单帧最多追赶 MAX_STEPS 步，防止卡顿后"瞬移"。
 */

export const LOGIC_HZ = 60;
export const LOGIC_DT = 1 / LOGIC_HZ;
/** 单帧最多追赶的逻辑步数，避免长时间卡顿后一次性跑几百步 */
const MAX_STEPS = 5;

export interface StepResult {
  /** 实际执行的逻辑步数 */
  steps: number;
  /** 本帧剩余的真实时间占比（0–1），供渲染插值用 */
  alpha: number;
}

export class FixedStep {
  private accumulator = 0;

  /**
   * 传入本帧真实经过的秒数，回调会被调用 0..MAX_STEPS 次。
   */
  advance(realDt: number, onStep: () => void): StepResult {
    // 单帧时间钳制：切后台回来时 realDt 可能是几十秒
    this.accumulator += Math.min(realDt, 0.25);

    let steps = 0;
    while (this.accumulator >= LOGIC_DT && steps < MAX_STEPS) {
      onStep();
      this.accumulator -= LOGIC_DT;
      steps++;
    }

    // 追赶不上时丢弃积压，避免越积越多
    if (steps === MAX_STEPS && this.accumulator > LOGIC_DT) {
      this.accumulator = 0;
    }

    return { steps, alpha: this.accumulator / LOGIC_DT };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
