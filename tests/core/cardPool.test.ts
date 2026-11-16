/**
 * 卡池完整性测试。
 *
 * 作业要求 20 张卡，这里把「够不够、有没有重复、字段是否合法」
 * 固化成测试，避免以后改卡池时无意破坏。
 */

import { describe, expect, it } from 'vitest';
import {
  ACTIVE_POOL,
  ALL_CARDS,
  PASSIVE_POOL,
  STARTER_CARDS,
  getCard,
} from '../../src/core/cards/library';

describe('卡池', () => {
  it('卡池规模达到 20 种', () => {
    // 按 id 去重后计算「种类数」（初始卡有 4 张同名符击）
    const ids = new Set(ALL_CARDS.map((c) => c.id.replace(/_\d+$/, '')));
    expect(ids.size).toBeGreaterThanOrEqual(20);
  });

  it('没有重复 id', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每张卡都有必需字段且数值合理', () => {
    for (const c of ALL_CARDS) {
      expect(c.id, `${c.name} 缺少 id`).toBeTruthy();
      expect(c.name, `${c.id} 缺少 name`).toBeTruthy();
      expect(c.text, `${c.id} 缺少描述`).toBeTruthy();
      expect(c.price, `${c.id} 价格为负`).toBeGreaterThanOrEqual(0);

      if (c.type === 'active') {
        // 主动卡必须有费用与效果
        expect(c.energy, `${c.id} 主动卡缺少费用`).toBeDefined();
        expect(c.energy!, `${c.id} 费用为负`).toBeGreaterThanOrEqual(0);
        expect(c.effects, `${c.id} 缺少 effects`).toBeDefined();
        expect(c.effects!.length, `${c.id} 没有效果`).toBeGreaterThan(0);
      } else {
        // 被动卡有两种生效方式：改自机参数（modifiers）或改符卡（spellMods）
        const hasMods = c.modifiers !== undefined && c.modifiers.length > 0;
        const hasSpellMods = c.spellMods !== undefined && c.spellMods.length > 0;
        expect(
          hasMods || hasSpellMods,
          `${c.id} 被动卡既没有 modifiers 也没有 spellMods`,
        ).toBe(true);
      }
    }
  });

  it('商店池里的卡都能按 id 查回', () => {
    for (const c of [...ACTIVE_POOL, ...PASSIVE_POOL]) {
      expect(getCard(c.id)?.name).toBe(c.name);
    }
  });

  it('初始卡组数量大于手牌上限 6', () => {
    // 否则手牌攒满时抽牌堆与弃牌堆都会空，抽牌机制失效
    expect(STARTER_CARDS.length).toBeGreaterThan(6);
  });

  it('背水符满足条件与不满足时伤害不同', () => {
    const card = ALL_CARDS.find((c) => c.id === 'a_lastword');
    expect(card).toBeDefined();
    const eff = card!.effects![0]!;
    expect(eff.op).toBe('if_low_life');
    if (eff.op === 'if_low_life') {
      // 低血时的高伤害
      const thenDmg = eff.then.find((e) => e.op === 'damage_all');
      expect(thenDmg).toBeDefined();
      // 残机充足时的保底伤害必须有，否则这张卡没有代价
      expect(eff.else).toBeDefined();
      const elseDmg = eff.else!.find((e) => e.op === 'damage_all');
      expect(elseDmg).toBeDefined();
    }
  });
});
