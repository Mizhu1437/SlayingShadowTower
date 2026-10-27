/**
 * 初始卡组与卡池。
 *
 * 所有卡都是数据，引擎不按 id 分支。
 * 这里的定义将来会迁移到 data/cards/*.json。
 */

import type { CardDef } from './def';

// ─────────────────────────────────────────────
// 初始主动卡组：玩家开局就有的 10 张
//
// 为什么是 10 张而不是 5 张：
//   手牌上限 U = 6。如果卡组总数 <= U，手牌攒到接近上限时
//   抽牌堆和弃牌堆都会空掉，任何抽牌都拿不到牌 —— 机制死锁。
//   卡组必须明显大于手牌上限，才能让"抽牌堆耗尽→弃牌堆洗回"这个循环运转起来。
//
// 10 张 = 上限 6 + 余量 4，且与《杀戮尖塔》初始卡组规模一致。
// 必须包含至少 1 张保命卡（清弹/无敌）。
// ─────────────────────────────────────────────
export const STARTER_CARDS: CardDef[] = [
  {
    id: 'starter_barrier',
    name: '结界符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 2,
    text: '清除大范围内的敌弹，并获得 1 秒无敌。',
    effects: [
      { op: 'clear_bullets', radius: 110 },
      { op: 'invuln', seconds: 1.0 },
    ],
    tags: ['defense', 'clear'],
  },
  {
    id: 'starter_burst',
    name: '散弹符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '对全体敌人造成 60 点伤害。',
    effects: [{ op: 'damage_all', value: 60 }],
    tags: ['damage'],
  },
  {
    id: 'starter_focus',
    name: '凝神符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '立即抽 2 张牌。',
    effects: [{ op: 'draw', count: 2 }],
    tags: ['draw'],
  },
  {
    id: 'starter_ward',
    name: '护身符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '获得 1.5 秒无敌。',
    effects: [{ op: 'invuln', seconds: 1.5 }],
    tags: ['defense'],
  },
  {
    id: 'starter_strike',
    name: '斩击符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 2,
    text: '对全体敌人造成 150 点伤害。',
    effects: [{ op: 'damage_all', value: 150 }],
    tags: ['damage'],
  },
  // ── 以下 5 张补齐到 10，构成可循环的牌堆 ──
  {
    id: 'starter_needle',
    name: '针符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '对全体敌人造成 45 点伤害。',
    effects: [{ op: 'damage_all', value: 45 }],
    tags: ['damage'],
  },
  {
    id: 'starter_sweep',
    name: '扫符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '清除周围小范围的敌弹。',
    effects: [{ op: 'clear_bullets', radius: 80 }],
    tags: ['defense', 'clear'],
  },
  {
    id: 'starter_meditate',
    name: '静心符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 0,
    text: '抽 1 张牌。',
    effects: [{ op: 'draw', count: 1 }],
    tags: ['draw'],
  },
  {
    id: 'starter_talisman',
    name: '符札',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 1,
    text: '对全体敌人造成 70 点伤害。',
    effects: [{ op: 'damage_all', value: 70 }],
    tags: ['damage'],
  },
  {
    id: 'starter_veil',
    name: '幕符',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 2,
    text: '获得 2 秒无敌。',
    effects: [{ op: 'invuln', seconds: 2.0 }],
    tags: ['defense'],
  },
];

// ─────────────────────────────────────────────
// 被动卡池：决定自机火力形态
// ─────────────────────────────────────────────
export const PASSIVE_POOL: CardDef[] = [
  {
    id: 'p_double',
    name: '双发符片',
    type: 'passive',
    rarity: 'common',
    price: 50,
    text: '子弹数 +1，单发伤害 -10%。',
    modifiers: [
      { op: 'add', stat: 'count', value: 1 },
      { op: 'mul', stat: 'damage', value: 0.9 },
    ],
    tags: ['shot', 'spread'],
  },
  {
    id: 'p_sharp',
    name: '锋利符片',
    type: 'passive',
    rarity: 'common',
    price: 55,
    text: '单发伤害 +3。',
    modifiers: [{ op: 'add', stat: 'damage', value: 3 }],
    tags: ['shot', 'damage'],
  },
  {
    id: 'p_rapid',
    name: '疾射符片',
    type: 'passive',
    rarity: 'common',
    price: 60,
    text: '射击间隔 -15%，伤害 -10%。',
    modifiers: [
      { op: 'mul', stat: 'interval', value: 0.85 },
      { op: 'mul', stat: 'damage', value: 0.9 },
    ],
    tags: ['shot', 'speed'],
  },
  {
    id: 'p_pierce',
    name: '贯穿符片',
    type: 'passive',
    rarity: 'uncommon',
    price: 85,
    text: '子弹可穿透 +1 个敌人，射速略降。',
    modifiers: [
      { op: 'add', stat: 'pierce', value: 1 },
      { op: 'mul', stat: 'interval', value: 1.1 },
    ],
    tags: ['shot', 'pierce'],
  },
  {
    id: 'p_wide',
    name: '广域符片',
    type: 'passive',
    rarity: 'uncommon',
    price: 80,
    text: '扇形角 +8 度，命中范围更宽。',
    modifiers: [{ op: 'add', stat: 'spread', value: 0.14 }],
    tags: ['shot', 'spread'],
  },
  {
    id: 'p_heavy',
    name: '重击符片',
    type: 'passive',
    rarity: 'uncommon',
    price: 90,
    text: '伤害 ×1.6，射速降 20%。',
    modifiers: [
      { op: 'mul', stat: 'damage', value: 1.6 },
      { op: 'mul', stat: 'interval', value: 1.2 },
    ],
    tags: ['shot', 'damage'],
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
// 主动卡池：商店可买
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
    id: 'a_desperate',
    name: '绝境符',
    type: 'active',
    rarity: 'rare',
    price: 110,
    energy: 1,
    text: '若残机为 1，对全体敌人造成 500 伤害。',
    effects: [
      {
        op: 'if_low_life',
        threshold: 1,
        then: [{ op: 'damage_all', value: 500 }],
      },
    ],
    tags: ['damage', 'conditional'],
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

/** 玩家开局的完整卡组（目前只有主动卡） */
export function createStarterDeck(): CardDef[] {
  return STARTER_CARDS.map((c) => ({ ...c }));
}
