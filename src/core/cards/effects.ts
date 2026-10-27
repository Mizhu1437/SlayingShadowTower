/**
 * 效果解释器。
 *
 * 卡牌的 effects 是原子操作的有序列表，这里逐条执行。
 * 新增一种卡效果 = 新增一个 op，不需要改战斗流程。
 *
 * 依赖注入：World 提供执行所需的上下文（清弹、伤害、抽牌等）。
 */

import type { EffectOp } from './def';

/** 效果执行所需的上下文，由 World 实现 */
export interface EffectContext {
  /** 对全体敌人造成伤害，返回击杀数 */
  damageAll(value: number): number;
  /** 清除半径内的敌弹，返回清除数。radius >= 9999 视为全屏 */
  clearBullets(radius: number): number;
  /** 增加能量 */
  gainEnergy(value: number): void;
  /** 增加蜃銭 */
  gainCoin(value: number): number;
  /** 恢复符卡 */
  restoreSpell(value: number): number;
  /** 抽牌（可能触发过载），返回实际抽到的张数 */
  drawCards(count: number): number;
  /** 获得无敌时间 */
  grantInvuln(seconds: number): void;
  /** 敌弹减速 */
  slowBullets(seconds: number, factor: number): void;
  /** 当前残机 */
  readonly currentLives: number;
}

export interface EffectLog {
  op: string;
  detail: string;
}

/**
 * 按顺序执行一组效果。
 * 返回执行日志（供 UI 与测试观察）。
 */
export function executeEffects(
  effects: readonly EffectOp[],
  ctx: EffectContext,
  log: EffectLog[] = [],
): EffectLog[] {
  for (const e of effects) {
    switch (e.op) {
      case 'damage_all': {
        const kills = ctx.damageAll(e.value);
        log.push({ op: e.op, detail: `造成 ${e.value} 伤害，击杀 ${kills}` });
        break;
      }
      case 'damage_boss': {
        const kills = ctx.damageAll(e.value);
        log.push({ op: e.op, detail: `对 BOSS 造成 ${e.value} 伤害，击杀 ${kills}` });
        break;
      }
      case 'clear_bullets': {
        const n = ctx.clearBullets(e.radius);
        log.push({ op: e.op, detail: `清除 ${n} 颗敌弹` });
        break;
      }
      case 'gain_energy': {
        ctx.gainEnergy(e.value);
        log.push({ op: e.op, detail: `能量 +${e.value}` });
        break;
      }
      case 'gain_coin': {
        const got = ctx.gainCoin(e.value);
        log.push({ op: e.op, detail: `蜃銭 +${got}` });
        break;
      }
      case 'heal_life': {
        ctx.restoreSpell(0); // 占位，P3 接入真正的回命
        log.push({ op: e.op, detail: `恢复 ${e.value} 残机` });
        break;
      }
      case 'restore_spell': {
        const n = ctx.restoreSpell(e.value);
        log.push({ op: e.op, detail: `符卡 +${n}` });
        break;
      }
      case 'draw': {
        const n = ctx.drawCards(e.count);
        log.push({ op: e.op, detail: `抽 ${n} 张` });
        break;
      }
      case 'invuln': {
        ctx.grantInvuln(e.seconds);
        log.push({ op: e.op, detail: `无敌 ${e.seconds} 秒` });
        break;
      }
      case 'bullet_slow': {
        ctx.slowBullets(e.seconds, e.factor);
        log.push({ op: e.op, detail: `敌弹减速至 ${e.factor}×，${e.seconds} 秒` });
        break;
      }
      case 'if_low_life': {
        if (ctx.currentLives <= e.threshold) {
          log.push({ op: 'if_low_life', detail: `条件成立（残机 ${ctx.currentLives} ≤ ${e.threshold}）` });
          executeEffects(e.then, ctx, log);
        } else {
          log.push({ op: 'if_low_life', detail: `条件不成立（残机 ${ctx.currentLives} > ${e.threshold}）` });
        }
        break;
      }
      default: {
        // 穷尽性检查：新增 op 忘了处理时这里会编译报错
        const never: never = e;
        log.push({ op: 'unknown', detail: String(never) });
      }
    }
  }
  return log;
}
