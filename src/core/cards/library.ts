/**
 * 初始卡组与卡池。
 *
 * 所有卡都是数据，引擎不按 id 分支。
 * 初始卡组按用户设计（大作业安排.md）实现：
 *
 *   藤原妹红：4 张符击 + 3 张防御 + 1 张凤翼天翔 = 8 张
 *
 * 注：卡组总数必须大于手牌上限（6），否则手牌攒满时
 * 抽牌堆与弃牌堆都会空掉，抽牌机制失效。8 张满足这个下限。
 */

import type { CardDef } from './def';

// ─────────────────────────────────────────────
// 初始主动卡组（藤原妹红）
// ─────────────────────────────────────────────
export const STARTER_CARDS: CardDef[] = [
  // ── 符击 ×4 ──
  // 1 费，在之后的 5 秒内，向机体前方持续发射 3 束符札。
  // 用 burst_fire 表达"持续射击窗口"：5 秒内每 0.25 秒一组、每组 3 发。
  ...Array.from({ length: 4 }, (_, i): CardDef => ({
    id: `hougeki_${i}`,
    name: '符击',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '在 5 秒内向前方持续发射 3 束符札。',
    effects: [
      {
        op: 'burst_fire',
        duration: 5,
        interval: 0.25,
        count: 3,
        damage: 25,
        speed: 620,
        pierce: 0,
      },
    ],
    tags: ['damage', 'sustained'],
  })),

  // ── 防御 ×3 ──
  // 1 费，清除周围一小部分弹幕，获得 2.5 秒无敌。
  ...Array.from({ length: 3 }, (_, i): CardDef => ({
    id: `bougyo_${i}`,
    name: '防御',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '清除周围弹幕，获得 2.5 秒无敌。',
    effects: [
      { op: 'clear_bullets', radius: 105 },
      { op: 'invuln', seconds: 2.5 },
    ],
    tags: ['defense', 'clear'],
  })),

  // ── 凤翼天翔 ×1 ──
  // 2 费，向前方发射可穿透的凤凰，高额伤害；
  // 命中敌人附加 10 秒「虚弱」与「燃烧」。
  {
    id: 'houyokutenshou',
    name: '不死「火鸟 -凤翼天翔-」',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 2,
    text: '发射穿透的凤凰造成高额伤害，命中者虚弱并燃烧 10 秒。',
    effects: [
      {
        op: 'pierce_shot',
        count: 1,
        damage: 400,
        speed: 380,
        pierce: 99,
        radius: 26,
        kind: 'firebird',
      },
      { op: 'apply_status', status: 'weak', seconds: 10 },
      { op: 'apply_status', status: 'burn', seconds: 10 },
    ],
    tags: ['damage', 'pierce', 'debuff'],
  },
];

// ─────────────────────────────────────────────
// 被动卡池
// ─────────────────────────────────────────────
export const PASSIVE_POOL: CardDef[] = [
  {
    id: 'p_sharp',
    name: '锋利符片',
    type: 'passive',
    rarity: 'common',
    price: 55,
    text: '卡牌伤害 +6%。',
    modifiers: [{ op: 'add', stat: 'damage', value: 3 }],
    tags: ['damage'],
  },
  {
    id: 'p_heavy',
    name: '重击符片',
    type: 'passive',
    rarity: 'uncommon',
    price: 90,
    text: '卡牌伤害 ×1.6。',
    modifiers: [{ op: 'mul', stat: 'damage', value: 1.6 }],
    tags: ['damage'],
  },
  {
    id: 'p_rapid',
    name: '疾射符片',
    type: 'passive',
    rarity: 'common',
    price: 60,
    text: '打出卡牌所需能量 -0.3。',
    modifiers: [{ op: 'mul', stat: 'interval', value: 0.85 }],
    tags: ['energy'],
  },
  {
    id: 'p_spell_wide',
    name: '广域符卡',
    type: 'passive',
    rarity: 'uncommon',
    price: 75,
    text: '符卡的无敌时间 +1 秒。',
    spellMods: [{ stat: 'invulnTime', op: 'add', value: 1.0 }],
    tags: ['spell', 'defense'],
  },
  {
    id: 'p_spell_bane',
    name: '破邪符卡',
    type: 'passive',
    rarity: 'rare',
    price: 120,
    text: '符卡释放时对全体敌人造成 400 伤害。',
    spellMods: [{ stat: 'damage', op: 'add', value: 400 }],
    tags: ['spell', 'damage'],
  },
];

// ─────────────────────────────────────────────
// 主动卡池（商店可买）
// ─────────────────────────────────────────────
export const ACTIVE_POOL: CardDef[] = [
  {
    id: 'a_meteor',
    name: '流星符',
    type: 'active',
    rarity: 'uncommon',
    price: 70,
    energy: 2,
    text: '对全体敌人造成 250 点伤害。',
    effects: [{ op: 'damage_all', value: 250 }],
    tags: ['damage'],
  },
  {
    id: 'a_focus',
    name: '心念符',
    type: 'active',
    rarity: 'common',
    price: 45,
    energy: 0,
    text: '抽 1 张牌，回复 1 点能量。',
    effects: [
      { op: 'draw', count: 1 },
      { op: 'gain_energy', value: 1 },
    ],
    tags: ['draw', 'energy'],
  },
  {
    id: 'a_cleanse',
    name: '净域符',
    type: 'active',
    rarity: 'common',
    price: 50,
    energy: 1,
    text: '清除全屏敌弹。',
    effects: [{ op: 'clear_bullets', radius: 9999 }],
    tags: ['defense', 'clear'],
  },
  {
    id: 'a_bounty',
    name: '丰收符',
    type: 'active',
    rarity: 'common',
    price: 40,
    energy: 1,
    text: '获得 30 蜃銭。',
    effects: [{ op: 'gain_coin', value: 30 }],
    tags: ['economy'],
  },
  {
    id: 'a_slow',
    name: '缓时符',
    type: 'active',
    rarity: 'uncommon',
    price: 80,
    energy: 2,
    text: '敌弹速度降为一半，持续 3 秒。',
    effects: [{ op: 'bullet_slow', seconds: 3, factor: 0.5 }],
    tags: ['defense', 'control'],
  },
  {
    id: 'a_restore',
    name: '复符',
    type: 'active',
    rarity: 'rare',
    price: 130,
    energy: 2,
    text: '恢复 1 张符卡。',
    effects: [{ op: 'restore_spell', value: 1 }],
    tags: ['spell'],
  },
];

/** 全部卡牌，供查找 */
export const ALL_CARDS: CardDef[] = [
  ...STARTER_CARDS,
  ...PASSIVE_POOL,
  ...ACTIVE_POOL,
];

const BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function getCard(id: string): CardDef | undefined {
  return BY_ID.get(id);
}

/** 玩家开局的完整卡组 */
export function createStarterDeck(): CardDef[] {
  return STARTER_CARDS.map((c) => ({ ...c }));
}
