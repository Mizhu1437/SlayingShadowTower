/**
 * 波次生成器：把「结构模板」+「种子」变成具体的一幕。
 *
 * 核心思想（DESIGN.md 4.7–4.9）：
 *   结构固定（波数与种类不随机）→ 节奏可控
 *   内容随机（敌人组合、位置、延迟）→ 每局不同
 *
 * 生成后必须校验，不通过就换种子重试 —— 不能让玩家遇到死局。
 */

import { derive, Rng } from '../rng';
import type {
  ActStructure,
  EnemyPool,
  EnemySpawn,
  StageDef,
  StageGenResult,
  WaveDef,
  WaveSlot,
} from './types';

/** 生成参数 */
export interface GenOptions {
  /** 主种子 */
  masterSeed: number;
  /** 幕编号（用于派生该幕专属的子种子） */
  actIndex: number;
  /** 敌池 */
  pool: EnemyPool;
  /** 结构模板 */
  structure: ActStructure;
  /**
   * 本幕最低经济保障：生成的敌人掉落总额应 >= 此值。
   * 0 表示不检查。
   */
  minCoin?: number;
  /** 失败时的最大重试次数 */
  maxRetries?: number;
}

/** 单波生成：为某个槽位产出具体的 spawn 列表 */
function genWave(
  slot: WaveSlot,
  rng: Rng,
  pool: EnemyPool,
  waveIndex: number,
): WaveDef {
  // 候选敌人列表
  const candidates = slot.allow && slot.allow.length > 0
    ? slot.allow.filter((id) => pool[id])
    : Object.keys(pool);

  // 若允许列表全无效，退回全池
  const usable = candidates.length > 0 ? candidates : Object.keys(pool);

  // 数量：[countMin, countMax]
  const span = Math.max(0, slot.countMax - slot.countMin);
  const count = slot.countMin + (span > 0 ? rng.int(span + 1) : 0);

  const spawns: EnemySpawn[] = [];
  for (let i = 0; i < count; i++) {
    const typeId = usable[rng.int(usable.length)]!;
    // 横向位置：均匀分布但留出边距
    const x = 0.12 + rng.next() * 0.76;
    // 纵向：从上方场外进场
    const y = -0.08 - rng.next() * 0.06;
    // 错开生成时间，避免所有敌人同时出现
    const delay = i * (slot.duration / Math.max(1, count)) * 0.7
      + rng.next() * 0.3;

    spawns.push({
      typeId,
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      delay: Math.round(delay * 100) / 100,
    });
  }

  // BOSS / 道中 BOSS 只有一个，位置固定居中上方
  if (slot.kind === 'boss' || slot.kind === 'midboss') {
    spawns.length = 0;
    spawns.push({
      typeId: usable[0]!,
      x: 0.5,
      y: -0.1,
      delay: 0,
    });
  }

  return {
    id: `wave_${waveIndex}_${slot.kind}`,
    kind: slot.kind,
    spawns,
    duration: slot.duration,
    clearOn: slot.kind === 'boss' || slot.kind === 'midboss'
      ? 'timeout'
      : 'either',
  };
}

/** 计算一幕的蜃銭总额 */
function calcCoins(stage: StageDef, pool: EnemyPool): number {
  let total = 0;
  for (const w of stage.waves) {
    for (const s of w.spawns) {
      total += pool[s.typeId]?.coin ?? 0;
    }
  }
  return total;
}

/**
 * 生成一幕。
 *
 * 若校验失败会用派生种子重试，最多 maxRetries 次。
 * 全部失败时返回最后一次的结果，并在 errors 中带上原因。
 */
export function generateStage(opts: GenOptions): StageGenResult {
  const {
    masterSeed, actIndex, pool, structure,
    minCoin = 0, maxRetries = 8,
  } = opts;

  let lastResult: StageGenResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 每次重试换一个派生种子：同一幕的「第 n 次尝试」可复现
    const seed = derive(masterSeed, 'stage', actIndex, attempt);
    const rng = new Rng(seed);

    const waves: WaveDef[] = structure.slots.map((slot, i) =>
      genWave(slot, rng, pool, i),
    );

    const stage: StageDef = { actId: `act${actIndex + 1}`, waves };
    const coinTotal = calcCoins(stage, pool);

    const errors: string[] = [];

    // 校验 1：经济可达性
    if (minCoin > 0 && coinTotal < minCoin) {
      errors.push(`蜃銭不足：${coinTotal} < ${minCoin}`);
    }

    // 校验 2：波次完整性
    if (waves.length !== structure.slots.length) {
      errors.push(`波次数不符：${waves.length} != ${structure.slots.length}`);
    }

    // 校验 3：每波至少有一个敌人
    for (const w of waves) {
      if (w.spawns.length === 0) {
        errors.push(`空波次：${w.id}`);
      }
    }

    lastResult = { stage, retries: attempt, coinTotal, errors };

    if (errors.length === 0) {
      return lastResult;
    }
  }

  // 全部重试失败：返回最后结果（errors 非空，由调用方决定如何处理）
  return lastResult!;
}
