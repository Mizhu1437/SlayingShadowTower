/**
 * 卡牌数据定义。
 *
 * 硬约束：所有卡牌都是 JSON 数据，不是代码分支。
 * 这张卡做什么，由 effects 数组里的原子操作描述，
 * 而不是在引擎里写 `if (card.id === 'xxx')`。
 */

import type { ShotModifier } from '../shot/profile';

/** 卡牌类型 */
export type CardType = 'active' | 'passive';

/** 稀有度（影响商店出现权重与价格） */
export type Rarity = 'starter' | 'common' | 'uncommon' | 'rare';

/**
 * 原子效果操作。
 *
 * 每种 op 对应解释器里的一个 case。
 * 新增一种卡只需新增一种 op，不需要改战斗流程。
 */
export type EffectOp =
  | { op: 'damage_all'; value: number }
  | { op: 'damage_boss'; value: number }
  | { op: 'clear_bullets'; radius: number }
  | { op: 'gain_energy'; value: number }
  | { op: 'gain_coin'; value: number }
  | { op: 'heal_life'; value: number }
  | { op: 'restore_spell'; value: number }
  | { op: 'draw'; count: number }
  | { op: 'invuln'; seconds: number }
  | { op: 'bullet_slow'; seconds: number; factor: number }
  | { op: 'if_low_life'; threshold: number; then: EffectOp[] };

/** 卡牌定义 */
export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: Rarity;
  /** 商店基础售价 */
  price: number;

  // ── 主动卡字段 ──
  /** 耗能 */
  energy?: number;
  /** 效果序列，按顺序执行 */
  effects?: EffectOp[];
  /** 描述文本（给 UI 显示） */
  text?: string;

  // ── 被动卡字段 ──
  /** 对 ShotProfile 的修改 */
  modifiers?: ShotModifier[];
  /** 对符卡的修改（P2 末尾接入） */
  spellMods?: SpellModifier[];

  /** 标签，用于协同检索 */
  tags?: string[];
}

/** 符卡修改器（被动卡改造符卡用） */
export interface SpellModifier {
  /** 字段名 */
  stat: 'clearRadius' | 'invulnTime' | 'damage' | 'freezeTime';
  op: 'add' | 'mul' | 'set';
  value: number;
}

/** 校验：卡牌定义是否合法 */
export function validateCard(c: unknown): string[] {
  const errs: string[] = [];
  const o = c as Partial<CardDef>;

  if (!o || typeof o !== 'object') return ['不是对象'];
  if (!o.id) errs.push('缺少 id');
  if (!o.name) errs.push('缺少 name');
  if (o.type !== 'active' && o.type !== 'passive') errs.push('type 必须是 active 或 passive');
  if (!['starter', 'common', 'uncommon', 'rare'].includes(o.rarity as string)) {
    errs.push('rarity 非法');
  }
  if (typeof o.price !== 'number' || o.price < 0) errs.push('price 必须是非负数');

  if (o.type === 'active') {
    if (typeof o.energy !== 'number') errs.push('主动卡必须有 energy');
    if (!Array.isArray(o.effects) || o.effects.length === 0) {
      errs.push('主动卡必须有 effects');
    }
  }

  if (o.type === 'passive') {
    const hasMods = Array.isArray(o.modifiers) && o.modifiers.length > 0;
    const hasSpell = Array.isArray(o.spellMods) && o.spellMods.length > 0;
    if (!hasMods && !hasSpell) errs.push('被动卡必须有 modifiers 或 spellMods');
  }

  return errs;
}
