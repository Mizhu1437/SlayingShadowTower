import { describe, it, expect } from 'vitest';
import {
  SpellSystem,
  deathbombFrames,
  deathbombSeconds,
  DEFAULT_SPELL,
  FRAMES_PER_SEC,
} from '../../src/core/spell/spellSystem';
import { World } from '../../src/core/world';

describe('决死时间公式', () => {
  it('基础值符合永夜抄公式：8 + 符卡数 × 6', () => {
    expect(deathbombFrames(0)).toBe(4);   // 特例
    expect(deathbombFrames(1)).toBe(14);
    expect(deathbombFrames(2)).toBe(20);
    expect(deathbombFrames(3)).toBe(26);
  });

  it('上限为 30 帧', () => {
    expect(deathbombFrames(4)).toBe(30);  // 8 + 24 = 32 → 截到 30
    expect(deathbombFrames(10)).toBe(30);
  });

  it('BOSS 符卡战中翻倍', () => {
    expect(deathbombFrames(3, true)).toBe(52);
    expect(deathbombFrames(0, true)).toBe(8);
  });

  it('换算成秒正确（60 帧 = 1 秒）', () => {
    expect(FRAMES_PER_SEC).toBe(60);
    expect(deathbombSeconds(3)).toBeCloseTo(26 / 60, 5);
  });

  it('符卡越多，容错时间越长（单调）', () => {
    let prev = deathbombFrames(0);
    for (let n = 1; n <= 3; n++) {
      const cur = deathbombFrames(n);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe('SpellSystem 基础', () => {
  it('初始 3 张符卡', () => {
    const s = new SpellSystem();
    expect(s.cards).toBe(3);
    expect(s.initialCards).toBe(3);
    expect(s.hasCard).toBe(true);
  });

  it('主动释放消耗 1 张并进入无敌', () => {
    const s = new SpellSystem();
    expect(s.tryCast()).toBe(true);
    expect(s.cards).toBe(2);
    expect(s.phase).toBe('active');
    expect(s.invulnerable).toBe(true);
  });

  it('没符卡时无法释放', () => {
    const s = new SpellSystem(0);
    expect(s.tryCast()).toBe(false);
    expect(s.cards).toBe(0);
  });

  it('无敌时间走完回到 idle', () => {
    const s = new SpellSystem();
    s.tryCast();
    expect(s.phase).toBe('active');

    // 推进超过无敌时长
    const steps = Math.ceil(DEFAULT_SPELL.invulnTime * 60) + 2;
    for (let i = 0; i < steps; i++) s.step(1 / 60);

    expect(s.phase).toBe('idle');
    expect(s.invulnerable).toBe(false);
  });
});

describe('SpellSystem 决死', () => {
  it('中弹进入决死窗口，不立即扣命', () => {
    const s = new SpellSystem();
    const win = s.enterDeathbomb();
    expect(win).toBeGreaterThan(0);
    expect(s.phase).toBe('deathbomb');
    expect(s.cards).toBe(3); // 还没扣
  });

  it('决死窗口内按 X 成功救场', () => {
    const s = new SpellSystem();
    s.enterDeathbomb();
    const ok = s.tryBombDuringDeathbomb();
    expect(ok).toBe(true);
    expect(s.phase).toBe('active');
    expect(s.cards).toBe(2);   // 消耗 1 张
  });

  it('决死窗口走完仍未按 → MISS', () => {
    const s = new SpellSystem();
    s.enterDeathbomb();
    const win = deathbombSeconds(3);
    const steps = Math.ceil(win * 60) + 2;
    let miss = null;
    for (let i = 0; i < steps; i++) {
      miss = s.step(1 / 60);
      if (miss) break;
    }
    expect(miss).toBe('miss');
    expect(s.phase).toBe('idle');
    expect(s.cards).toBe(3); // 未消耗
  });

  it('没符卡时决死窗口极短且按 X 无效', () => {
    const s = new SpellSystem(0);
    const win = s.enterDeathbomb();
    expect(win).toBeCloseTo(4 / 60, 5);
    expect(s.tryBombDuringDeathbomb()).toBe(false);
  });

  it('符卡越多，决死窗口越长', () => {
    for (let n = 1; n <= 3; n++) {
      const s = new SpellSystem(n);
      const win = s.enterDeathbomb();
      expect(win).toBeCloseTo(deathbombSeconds(n), 5);
    }
  });
});

describe('SpellSystem 失残机重置', () => {
  it('失去残机时符卡回满', () => {
    const s = new SpellSystem();
    s.tryCast();
    s.tryCast();
    expect(s.cards).toBe(1);

    s.onPlayerMiss();
    expect(s.cards).toBe(3);
  });
  it('重置会清掉决死与无敌状态', () => {
    const s = new SpellSystem();
    s.enterDeathbomb();
    s.onPlayerMiss();
    expect(s.phase).toBe('idle');
  });
});

describe('World 符卡整合', () => {
  it('按 X 清屏并进入无敌', () => {
    const w = new World({ seed: 1 });
    // 塞一堆敌弹
    for (let i = 0; i < 30; i++) {
      w.enemyBullets.spawn(20 + i * 10, 100, 0, 0, 4, 10);
    }
    expect(w.enemyBullets.aliveCount).toBe(30);

    w.pressBomb();
    w.step();  // 让 World 处理清屏请求

    expect(w.enemyBullets.aliveCount).toBe(0);
    expect(w.player.invuln).toBeGreaterThan(0);
    expect(w.spell.cards).toBe(2);
    expect(w.bombFlashThisStep).toBe(true);
  });

  it('中弹先进入决死而不是直接扣命', () => {
    const w = new World({ seed: 1 });
    const livesBefore = w.player.lives;

    // 在自机位置放一颗弹
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();

    // 应该进入决死，残机还没扣
    expect(w.spell.phase).toBe('deathbomb');
    expect(w.player.lives).toBe(livesBefore);
  });

  it('决死中按 X 救场，残机不减', () => {
    const w = new World({ seed: 1 });
    const livesBefore = w.player.lives;

    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    expect(w.spell.phase).toBe('deathbomb');

    expect(w.pressBomb()).toBe(true);
    w.step();

    expect(w.player.lives).toBe(livesBefore);
    expect(w.spell.phase).toBe('active');
  });

  it('决死不按 X 则扣命并重置符卡', () => {
    const w = new World({ seed: 1 });

    // 先用掉一张符卡
    w.pressBomb();
    w.step();
    expect(w.spell.cards).toBe(2);

    // 等无敌结束
    const wait = Math.ceil(DEFAULT_SPELL.invulnTime * 60) + 5;
    for (let i = 0; i < wait; i++) w.step();

    const livesBefore = w.player.lives;

    // 中弹，然后一直不按 X
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    expect(w.spell.phase).toBe('deathbomb');

    // 推进直到 MISS
    for (let i = 0; i < 60; i++) {
      w.step();
      if (w.player.lives < livesBefore) break;
    }

    expect(w.player.lives).toBe(livesBefore - 1);
    expect(w.spell.cards).toBe(3);  // 重置为初始值
  });

  it('决死期间自机无法移动', () => {
    const w = new World({ seed: 1 });
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    expect(w.spell.phase).toBe('deathbomb');

    const x0 = w.player.x;
    w.input = { dx: 1, dy: 0, focus: false };
    for (let i = 0; i < 5; i++) w.step();

    expect(w.player.x).toBe(x0);
  });
});
