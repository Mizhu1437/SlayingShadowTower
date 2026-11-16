/**
 * 敌人模板池。
 *
 * 每个模板是一个「原型」，波次生成器从中挑选并摆位置。
 * 现在只做基础三种，覆盖三种弹型；P4 再扩充。
 */

import type { EnemyPool } from './types';
import { PATTERNS } from '../danmaku/emitter';
import { DEG } from '../vec';

export const ENEMY_POOL: EnemyPool = {
  // ── 普通杂兵 ──
  grunt: {
    hp: 12,
    radius: 11,
    score: 100,
    coin: 5,
    emitter: PATTERNS.single(Math.PI / 2, 110),
    fireInterval: 2.2,
  },

  fan: {
    hp: 20,
    radius: 13,
    score: 200,
    coin: 8,
    emitter: PATTERNS.fan3(Math.PI / 2, 130),
    fireInterval: 2.6,
  },

  ring: {
    hp: 40,
    radius: 17,
    score: 300,
    coin: 15,
    emitter: PATTERNS.ring(14, 95),
    fireInterval: 2.0,
  },

  // ── 精英 ──
  elite_spiral: {
    hp: 120,
    radius: 20,
    score: 800,
    coin: 40,
    emitter: {
      count: 2,
      angle: -Math.PI / 2,
      spread: Math.PI * 2,
      speed: 120,
      radius: 5,
      life: 6,
      nested: { interval: 0.12, repeat: 24, stepDeg: 17 },
    },
    fireInterval: 2.4,
  },

  elite_burst: {
    hp: 150,
    radius: 22,
    score: 900,
    coin: 45,
    emitter: {
      count: 18,
      angle: 0,
      spread: Math.PI * 2,
      speed: 150,
      radius: 5,
      life: 5,
      nested: { interval: 0.35, repeat: 5, stepDeg: 10 },
    },
    fireInterval: 2.8,
  },

  // ── 道中 BOSS（占位，具体符卡 P4 再做）──
  midboss_placeholder: {
    hp: 600,
    radius: 30,
    score: 3000,
    coin: 120,
    emitter: {
      count: 3,
      angle: -Math.PI / 2,
      spread: 40 * DEG,
      speed: 140,
      radius: 6,
      life: 6,
      nested: { interval: 0.25, repeat: 12, stepDeg: 8 },
    },
    fireInterval: 1.6,
  },

  // ── 关底 BOSS：三阶段 ──
  //
  // 设计意图：1800 血只打一种弹幕会变成"血条在掉但没有新东西"。
  // 按 66% / 33% 切成三段，弹幕从"可读的环形"逐步升级到
  // "密集螺旋"，让战斗有明显的推进感。
  //
  // 每段切换后停火 0.9–1.2 秒：血量刚破线就被新弹幕糊脸会很突兀，
  // 这个窗口让玩家重新定位。
  //
  // 难度曲线：第 1 段让玩家熟悉节奏，第 2 段加入旋转压迫，
  // 第 3 段用高频螺旋 + 加速嵌套制造真正的高潮。
  boss_placeholder: {
    hp: 1800,
    radius: 38,
    score: 10000,
    coin: 300,
    phases: [
      // 第一阶段（100%–66%）：宽环形，节奏慢，留出躲位空间
      {
        hpAbove: 0.66,
        fireInterval: 2.0,
        emitter: {
          count: 16,
          angle: 0,
          spread: Math.PI * 2,
          speed: 115,
          radius: 6,
          life: 7,
          nested: { interval: 0.55, repeat: 18, stepDeg: 11 },
        },
      },
      // 第二阶段（66%–33%）：双层旋转环，速度提升
      {
        hpAbove: 0.33,
        fireInterval: 1.5,
        pauseSeconds: 0.9,
        emitter: {
          count: 20,
          angle: 0,
          spread: Math.PI * 2,
          speed: 135,
          radius: 6,
          life: 7,
          nested: { interval: 0.42, repeat: 26, stepDeg: 13, speedStep: 1.5 },
        },
      },
      // 第三阶段（33%–0）：密集螺旋 + 加速，收尾高潮
      {
        hpAbove: 0,
        fireInterval: 1.0,
        pauseSeconds: 1.2,
        emitter: {
          count: 24,
          angle: 0,
          spread: Math.PI * 2,
          speed: 120,
          radius: 5,
          life: 6,
          nested: { interval: 0.3, repeat: 36, stepDeg: 7, speedStep: 2.5 },
        },
      },
    ],
  },
};

/**
 * 每一幕的敌人池划分。
 * 第一幕最浅（只有基础杂兵 + 少量精英），越往后越复杂。
 */
export const ACT_POOLS: Record<number, string[]> = {
  0: ['grunt', 'fan', 'ring', 'elite_spiral', 'midboss_placeholder', 'boss_placeholder'],
  1: ['grunt', 'fan', 'ring', 'elite_spiral', 'elite_burst', 'midboss_placeholder', 'boss_placeholder'],
  2: ['fan', 'ring', 'elite_spiral', 'elite_burst', 'midboss_placeholder', 'boss_placeholder'],
  3: ['elite_burst', 'midboss_placeholder', 'boss_placeholder'],
};
