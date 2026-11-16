/**
 * 难度表。
 *
 * 核心约束（见 docs/DESIGN.md 第五节）：
 * **自机侧的节奏参数全难度完全一致** —— 抽牌间隔 T、能量上限、
 * 初始手牌、初始残机一律不变。难度差异只来自三条轴：
 *
 *   ① 弹幕密度  —— 玩家要躲什么
 *   ② BOSS 符卡 —— 玩家要面对什么机制
 *   ③ 经济      —— 玩家能构筑成什么样
 *
 * 为什么这样设计：
 *   - 起跑线相同，跨难度的分数才可比
 *   - 只需要平衡一套自机数值，不用四套
 *   - 调难度只改这张表，不动任何逻辑代码
 */

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'lunatic';

export interface DifficultyDef {
  id: DifficultyId;
  /** 显示名 */
  name: string;
  /** 一句话说明，用于选难度界面 */
  desc: string;

  /** ── 轴① 弹幕密度 ── */

  /** 敌人开火间隔倍率。>1 表示更慢（更简单） */
  fireIntervalMul: number;
  /** 每次开火的弹数倍率 */
  bulletCountMul: number;
  /** 弹速倍率 */
  bulletSpeedMul: number;

  /** ── 轴③ 经济 ── */

  /** 敌人掉落蜃銭倍率 */
  coinDropMul: number;
  /** 商店卡牌价格倍率 */
  priceMul: number;
}

/**
 * 四档难度。
 *
 * 数值取向：以 normal 为基准 1.0。
 * easy 让玩家有余裕看清弹幕；lunatic 的弹速与密度都要逼出最优解，
 * 但**不缩短 T、不扣初始资源** —— 那是设计红线。
 */
export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy',
    name: 'Easy',
    desc: '弹幕稀疏、经济宽裕，适合熟悉机制',
    fireIntervalMul: 1.45,
    bulletCountMul: 0.7,
    bulletSpeedMul: 0.85,
    coinDropMul: 1.4,
    priceMul: 0.8,
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    desc: '标准体验，设计基准',
    fireIntervalMul: 1.0,
    bulletCountMul: 1.0,
    bulletSpeedMul: 1.0,
    coinDropMul: 1.0,
    priceMul: 1.0,
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    desc: '弹幕加密，每次购买都要取舍',
    fireIntervalMul: 0.8,
    bulletCountMul: 1.25,
    bulletSpeedMul: 1.12,
    coinDropMul: 0.75,
    priceMul: 1.25,
  },
  lunatic: {
    id: 'lunatic',
    name: 'Lunatic',
    desc: '弹幕极密、资源极紧，构筑必须精准',
    fireIntervalMul: 0.65,
    bulletCountMul: 1.5,
    bulletSpeedMul: 1.25,
    coinDropMul: 0.55,
    priceMul: 1.55,
  },
};

/** 难度顺序，供选难度界面按序展示 */
export const DIFFICULTY_ORDER: DifficultyId[] = [
  'easy', 'normal', 'hard', 'lunatic',
];

export const DEFAULT_DIFFICULTY: DifficultyId = 'normal';

/** 按 id 取难度定义，非法 id 回落到 normal */
export function getDifficulty(id: string): DifficultyDef {
  return DIFFICULTIES[id as DifficultyId] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}
