/**
 * 关卡与波次的数据定义。
 *
 * 原则（DESIGN.md 4.7）：**节奏固定，内容随机**。
 *   - 波次的数量与种类由「结构模板」写死 → 每局节奏一致
 *   - 每波具体出什么敌人、什么配比，由种子决定 → 每局内容不同
 *
 * 为什么节奏必须固定：
 *   若波数也随机，一局可能只有 2 波精英（钱太少、构筑不起来），
 *   也可能 6 波（钱多到失衡）。节奏一变，平衡就崩。
 */

import type { EnemyConfig } from '../enemy';

/** 波次种类 */
export type WaveKind =
  | 'normal'   // 普通波
  | 'elite'    // 精英波
  | 'midboss'  // 道中 BOSS
  | 'boss';    // 关底 BOSS

/** 单个敌人的生成指令 */
export interface EnemySpawn {
  /** 敌人模板 id（对应 EnemyPool 的键） */
  typeId: string;
  /** 生成位置，归一化坐标 0–1（x 为横轴，y 通常为负表示从上方场外进场） */
  x: number;
  y: number;
  /** 相对波次开始的延迟（秒） */
  delay: number;
}

/** 一个波次 */
export interface WaveDef {
  id: string;
  kind: WaveKind;
  /** 有序的生成指令 */
  spawns: EnemySpawn[];
  /** 波次最长时长（秒）。超时后强制推进，避免卡关 */
  duration: number;
  /**
   * 推进条件：
   *   all_dead — 全部敌人生成完并清空才推进（旧行为，现已不用作普通波）
   *   timeout  — 到时即推进（BOSS 战用）
   *   either   — 全灭 **或** 到时，满足其一即推进
   *
   * 为什么普通波用 either 而不是 all_dead：
   *   本作的输出完全依赖卡牌，而能量回复有限（T=5s、上限 3）。
   *   若要求"全灭才推进"，玩家打不动时会被永久卡在这一波。
   *   either 保证：打得快就快进，打不动也能按时推进，不会卡关。
   */
  clearOn: 'all_dead' | 'timeout' | 'either';
}

/** 一整幕 */
export interface StageDef {
  actId: string;
  waves: WaveDef[];
}

/** 敌人模板池：id → 配置 */
export type EnemyPool = Record<string, EnemyConfig>;

/**
 * 波次槽位：结构模板的最小单元。
 * 只描述「这里应该有一个什么种类的波、大概几个敌人」，不含具体内容。
 */
export interface WaveSlot {
  kind: WaveKind;
  /** 波内敌人数量下限 */
  countMin: number;
  /** 波内敌人数量上限 */
  countMax: number;
  /** 波次时长（秒） */
  duration: number;
  /** 本槽位可用的敌人模板 id 列表（为空则用全池） */
  allow?: string[];
}

/** 一幕的结构模板 */
export interface ActStructure {
  actId: string;
  slots: WaveSlot[];
}

/**
 * 预设结构（对应 DESIGN.md 4.2 的波次排布）。
 *
 * 第一至三幕：4 普通 → 1 精英 → 道中BOSS → 2 普通 → 3 精英 → 关底BOSS
 * 第四幕：    1 精英 → 道中BOSS → 商店 → 关底BOSS
 *
 * 注：商店不是波次，由流程层处理，这里只排战斗波。
 */
export const ACT_STRUCTURE_1_TO_3: Omit<ActStructure, 'actId'> = {
  slots: [
    { kind: 'normal', countMin: 2, countMax: 3, duration: 8 },
    { kind: 'normal', countMin: 2, countMax: 3, duration: 8 },
    { kind: 'normal', countMin: 2, countMax: 4, duration: 8 },
    { kind: 'normal', countMin: 2, countMax: 4, duration: 8 },
    { kind: 'elite', countMin: 1, countMax: 2, duration: 12 },
    { kind: 'midboss', countMin: 1, countMax: 1, duration: 40 },
    { kind: 'normal', countMin: 2, countMax: 3, duration: 8 },
    { kind: 'normal', countMin: 3, countMax: 4, duration: 8 },
    { kind: 'elite', countMin: 1, countMax: 2, duration: 12 },
    { kind: 'elite', countMin: 1, countMax: 2, duration: 12 },
    { kind: 'elite', countMin: 1, countMax: 2, duration: 12 },
    { kind: 'boss', countMin: 1, countMax: 1, duration: 120 },
  ],
};

export const ACT_STRUCTURE_4: Omit<ActStructure, 'actId'> = {
  slots: [
    { kind: 'elite', countMin: 1, countMax: 2, duration: 12 },
    { kind: 'midboss', countMin: 1, countMax: 1, duration: 40 },
    { kind: 'boss', countMin: 1, countMax: 1, duration: 180 },
  ],
};

/** 生成结果 + 校验信息 */
export interface StageGenResult {
  stage: StageDef;
  /** 生成时的重试次数（0 表示一次通过） */
  retries: number;
  /** 本幕可获得的蜃銭总量 */
  coinTotal: number;
  /** 校验失败原因（为空表示通过） */
  errors: string[];
}
