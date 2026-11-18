/**
 * 机体（自机角色）。
 *
 * 设计意图：东方正作的机体选择不是"换个皮肤"，而是**换一套打法**。
 * 本作的自机火力全部来自卡牌，所以机体差异必须落在
 * 「初始卡组 + 自机运动参数」上，而不是射击方式。
 *
 * 当前只有一个机体（藤原妹红，按用户设计文档确定）。
 * 数据结构按多机体的方式来设计，将来加人只需往列表里追加，
 * 不用改流程与 UI。
 */

import type { PlayerConfig } from './player';
import type { CardDef } from './cards/def';
import { STARTER_CARDS } from './cards/library';

export interface ShotType {
  id: string;
  /** 显示名 */
  name: string;
  /** 一句话说明这套卡组的打法 */
  desc: string;
}

export interface CharacterDef {
  id: string;
  /** 显示名 */
  name: string;
  /** 英文名，用于标题排版 */
  nameEn: string;
  /** 称号（东方正作那种一句描述） */
  title: string;
  /** 简介：两三行，说明这个机体怎么玩 */
  bio: string;

  /** 自机运动参数 */
  player: PlayerConfig;

  /** 初始卡组 */
  deck: CardDef[];

  /** 可选的射击类型（本作中对应不同的初始卡组配比） */
  shotTypes: ShotType[];
}

/**
 * 按用户设计文档（大作业安排.md）：藤原妹红
 * 4 张符击 + 3 张防御 + 1 张凤翼天翔 = 8 张
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'mokou',
    name: '藤原妹红',
    nameEn: 'Fujiwara no Mokou',
    title: '不死之烟，蓬莱之人',
    bio:
      '不会死的蓬莱人。以符札为火力，靠"不死"硬吃伤害换输出窗口。\n' +
      '初始卡组偏进攻：符击数量多，防御够用但不宽裕。\n' +
      '适合喜欢正面压制、用走位换取输出时间的玩家。',
    player: {
      hitRadius: 2.4,
      speedHigh: 300,
      speedLow: 130,
      invulnTime: 2.0,
      lives: 3,
    },
    deck: STARTER_CARDS.map((c) => ({ ...c })),
    shotTypes: [
      {
        id: 'a',
        name: '符札型',
        desc: '符击 4 · 防御 3 · 凤翼天翔 1 —— 均衡偏攻',
      },
    ],
  },
];

export const DEFAULT_CHARACTER: CharacterDef = CHARACTERS[0]!;

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? DEFAULT_CHARACTER;
}
