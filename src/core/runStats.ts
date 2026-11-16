/**
 * 对局结算。
 *
 * 结算面板要回答玩家三个问题：
 *   1. 我打得怎么样？（分数、击破、通关到第几幕）
 *   2. 我为什么是这个分数？（分数由哪些项构成）
 *   3. 下次能改进什么？（用时、续关次数、难度）
 *
 * 所以数据结构不是简单的一个数字，而是**分项明细** ——
 * 这也是本作「伤害拆解面板」设计思路的延伸：
 * 让玩家看得懂自己的成绩是怎么来的。
 */

import type { DifficultyDef } from './difficulty';

/** 结算状态 */
export type RunOutcome = 'cleared' | 'gaveup';

export interface RunStats {
  /** 结局：真的打完了，还是放弃 */
  outcome: RunOutcome;

  /** 难度 */
  difficulty: DifficultyDef;

  /** 总分 */
  score: number;
  /** 击破数 */
  kills: number;
  /** 剩余蜃銭 */
  coins: number;
  /** 到达第几幕（1–4） */
  actReached: number;
  /** 总幕数 */
  totalActs: number;
  /** 用时（秒） */
  elapsedSeconds: number;
  /** 续关次数 */
  continues: number;

  /** 最终卡组规模（含被动） */
  deckSize: number;
  /** 装备的被动卡数量 */
  passiveCount: number;
}

/**
 * 评分等级。
 *
 * 为什么按"分数 + 进度"双维度而不是只看分数：
 * 只打第一幕但疯狂刷分，不该和真打通四幕拿到同样的评价。
 */
export function gradeOf(stats: RunStats): { letter: string; label: string } {
  // 通关是拿高评价的前提
  const progress =
    stats.totalActs > 0
      ? Math.min(1, stats.actReached / stats.totalActs)
      : 0;

  const cleared = stats.outcome === 'cleared';
  const s = stats.score;

  if (cleared && progress >= 1) {
    if (s >= 30000) return { letter: 'S', label: '完美通关' };
    if (s >= 18000) return { letter: 'A', label: '通关' };
    return { letter: 'B', label: '通关' };
  }

  if (progress >= 0.75) return { letter: 'B', label: '惜败' };
  if (progress >= 0.5) return { letter: 'C', label: '中途折戟' };
  if (progress >= 0.25) return { letter: 'D', label: '初入塔中' };
  return { letter: 'E', label: '折返' };
}

/** 把秒格式化成 mm:ss */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
