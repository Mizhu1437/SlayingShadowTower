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

  // ── 关底 BOSS（占位）──
  boss_placeholder: {
    hp: 1800,
    radius: 38,
    score: 10000,
    coin: 300,
    emitter: {
      count: 20,
      angle: 0,
      spread: Math.PI * 2,
      speed: 130,
      radius: 6,
      life: 7,
      nested: { interval: 0.5, repeat: 30, stepDeg: 9, speedStep: 2 },
    },
    fireInterval: 2.2,
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
