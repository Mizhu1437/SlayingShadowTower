/**
 * 游戏循环与结算测试。
 *
 * 覆盖「主菜单 → 对局 → 结束 → 结算 → 再来一局」这条链路里
 * 属于纯逻辑的部分（UI 部分由 e2e 覆盖）。
 */

import { describe, expect, it } from 'vitest';
import { GameFlow } from '../../src/core/flow';
import { World } from '../../src/core/world';
import { formatDuration, gradeOf, type RunStats } from '../../src/core/runStats';
import { DIFFICULTIES } from '../../src/core/difficulty';

describe('GameFlow 阶段', () => {
  it('默认是 playing（纯逻辑层的默认值）', () => {
    expect(new GameFlow().phase).toBe('playing');
  });

  it('toMenu 进入主菜单，startGame 回到对局', () => {
    const f = new GameFlow();
    f.toMenu();
    expect(f.phase).toBe('menu');
    expect(f.inMenu).toBe(true);
    expect(f.paused).toBe(true);

    f.startGame();
    expect(f.phase).toBe('playing');
    expect(f.paused).toBe(false);
  });

  it('主菜单阶段不会因为外部事件跳到别的阶段', () => {
    const f = new GameFlow();
    f.toMenu();
    f.onPlayerDead();          // 不在 playing，应无效
    expect(f.phase).toBe('menu');
  });

  it('死亡 → 续关回到对局', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    expect(f.phase).toBe('dead');
    expect(f.isOver).toBe(true);

    expect(f.doContinue()).toBe(true);
    expect(f.phase).toBe('playing');
    expect(f.continueCount).toBe(1);
  });

  it('死亡 → 放弃进入结算', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    f.giveUp();
    expect(f.phase).toBe('cleared');
  });

  it('onCleared 直接结算（通关）', () => {
    const f = new GameFlow();
    f.onCleared();
    expect(f.phase).toBe('cleared');
  });

  it('回主菜单会清空续关次数', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    f.doContinue();
    expect(f.continueCount).toBe(1);
    f.toMenu();
    expect(f.continueCount).toBe(0);
  });
});

/** 构造一个最小可用的 RunStats */
function makeStats(over: Partial<RunStats> = {}): RunStats {
  return {
    outcome: 'gaveup',
    difficulty: DIFFICULTIES.normal,
    score: 0,
    kills: 0,
    coins: 0,
    actReached: 1,
    totalActs: 4,
    elapsedSeconds: 60,
    continues: 0,
    deckSize: 8,
    passiveCount: 0,
    ...over,
  };
}

describe('结算评级', () => {
  it('通关且高分拿 S', () => {
    const g = gradeOf(makeStats({ outcome: 'cleared', actReached: 4, score: 32000 }));
    expect(g.letter).toBe('S');
  });

  it('通关但分数一般拿 A', () => {
    const g = gradeOf(makeStats({ outcome: 'cleared', actReached: 4, score: 20000 }));
    expect(g.letter).toBe('A');
  });

  it('只打到第一幕不可能拿高评价（防止刷分）', () => {
    const g = gradeOf(makeStats({ actReached: 1, score: 999999 }));
    expect(['D', 'E']).toContain(g.letter);
  });

  it('打到第四幕但没通关是惜败', () => {
    const g = gradeOf(makeStats({ actReached: 4, score: 1000 }));
    expect(g.letter).toBe('B');
  });

  it('评级随进度单调不降', () => {
    const order = ['E', 'D', 'C', 'B', 'A', 'S'];
    let prev = -1;
    for (const act of [1, 2, 3, 4]) {
      const g = gradeOf(makeStats({ actReached: act, score: 0 }));
      const idx = order.indexOf(g.letter);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});

describe('用时格式化', () => {
  it('秒转 mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(125)).toBe('2:05');
  });

  it('负数按 0 处理', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('World.buildRunStats', () => {
  it('快照包含关键字段且与 World 状态一致', () => {
    const w = new World({ seed: 7 });
    w.setDifficulty('hard');
    w.score = 1234;
    w.kills = 9;
    w.coins = 77;

    const st = w.buildRunStats('gaveup');
    expect(st.outcome).toBe('gaveup');
    expect(st.difficulty.id).toBe('hard');
    expect(st.score).toBe(1234);
    expect(st.kills).toBe(9);
    expect(st.coins).toBe(77);
    expect(st.totalActs).toBe(World.TOTAL_ACTS);
    expect(st.actReached).toBeGreaterThanOrEqual(1);
    expect(st.actReached).toBeLessThanOrEqual(World.TOTAL_ACTS);
  });

  it('续关次数来自 flow', () => {
    const w = new World({ seed: 7 });
    w.flow.onPlayerDead();
    w.flow.doContinue();
    expect(w.buildRunStats('gaveup').continues).toBe(1);
  });
});
