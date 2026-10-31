/**
 * 游戏世界（World）
 *
 * 这是 pure logic 的顶层容器：所有游戏状态都在这里，不依赖任何渲染。
 * 渲染层只读它，UI 层只调它的方法。
 *
 * 固定逻辑步：所有 step* 方法都用 LOGIC_DT，不用真实帧时间。
 */

import { Player, type InputState } from './player';
import { CardShots } from './shot/cardShots';
import { BURN_CONFIG } from './status';
import { Shop } from './shop/shop';
import { Enemy, type EnemyConfig } from './enemy';
import { BulletField } from './danmaku/bulletField';
import { SpatialGrid } from './danmaku/spatialGrid';
import { Rng, derive } from './rng';
import { LOGIC_DT } from './loop';
import { GameFlow, type GamePhase } from './flow';
import { SpellSystem } from './spell/spellSystem';
import { Deck, type CardPower } from './cards/deck';
import { createStarterDeck } from './cards/library';
import { executeEffects, type EffectContext } from './cards/effects';
import { WaveRunner } from './stage/waveRunner';
import { generateStage } from './stage/generator';
import { ENEMY_POOL } from './stage/enemies';
import { ACT_STRUCTURE_1_TO_3, ACT_STRUCTURE_4 } from './stage/types';

/** 场地尺寸。逻辑坐标与渲染坐标 1:1，缩放交给渲染层 */
export const FIELD_W = 384;
export const FIELD_H = 448;

export interface WorldConfig {
  seed: number;
}

/**
 * MISS 惩罚参数（用户 2026-10-31 定稿）。
 *
 * 经济设计的核心：损失 40%，但爆出的一半可以捡回（= 总额 20%）。
 *   - 不捡：实际损失 40%，痛
 *   - 冲回去捡：实际损失 20%，但有迎着弹幕的风险
 * 这让"捡钱"本身成为一个风险决策。
 */
export const MISS_CONFIG = {
  /** 损失蜃銭的比例 */
  coinLossRatio: 0.4,
  /** 爆出的蜃銭占损失量的比例 */
  coinDropRatio: 0.5,
  /** MISS 后的无敌时间（秒） */
  invulnTime: 3.0,
  /** 重置位置周围清空敌人的半径（避免落地即死） */
  spawnClearRadius: 200,
  /** 单次最多爆出几个金币物件 */
  maxCoinDrops: 12,
  /** 金币物件的存活时间（秒） */
  coinDropLife: 8,
  /** 自机吸引金币的半径 */
  coinAttractRadius: 60,
  /** 吸引速度（像素/秒） */
  coinAttractSpeed: 260,
  /** 拾取判定半径 */
  coinPickRadius: 14,
  /** 刚爆出后多久才可拾取（秒），让金币先散开 */
  coinPickupDelay: 0.6,
  /**
   * 重力加速度（像素/秒²）。
   *
   * 金币要能"下落"：爆出时向上抛（负 vy），随后被重力拉下来，
   * 最后落到底部停住。数值参考自机移动速度（300 px/s）：
   * 让金币大约 0.6 秒落到屏幕下部，玩家有时间看清并冲过去。
   */
  coinGravity: 620,
  /** 落地后的水平摩擦（每秒衰减比例） */
  coinGroundFriction: 0.86,
  /** 落地反弹系数（0 = 不弹，1 = 完全反弹） */
  coinBounce: 0.32,
  /** 落入场地底部时的 y 位置偏移 */
  coinFloorOffset: 14,
} as const;

/** 掉落的蜃銭 */
export interface CoinDrop {
  x: number;
  y: number;
  amount: number;
  vx: number;
  vy: number;
  /** 剩余存活时间 */
  life: number;
  collected: boolean;
  /**
   * 刚爆出时的拾取冷却（秒）。
   *
   * 为什么需要：MISS 时自机重置点可能离撞弹点不远，
   * 若掉落物一生成就能捡，钱会在玩家看清之前被吸走 ——
   * 玩家只会感到"钱莫名其妙少了"，而看不到"爆出了一堆钱"。
   * 给 0.6 秒让金币先散开，之后才允许拾取。
   */
  pickupDelay: number;
}

interface SpawnRequest {
  cfg: EnemyConfig;
  x: number;
  y: number;
  /** 进场后悬停的 y 坐标（可选） */
  targetY?: number;
}

export class World {
  readonly player: Player;
  /** 卡牌驱动的自机子弹（穿透弹 + 持续射击窗口） */
  readonly cardShots: CardShots;
  readonly enemyBullets: BulletField;
  readonly enemies: Enemy[] = [];
  readonly rng: Rng;

  /** 自机是否处于低速等状态，供渲染层读 */
  input: InputState = { dx: 0, dy: 0, focus: false };

  /** 得分与金钱 */
  score = 0;
  coins = 0;

  /** 已击破的敌人数 */
  kills = 0;

  /** 当前帧是否发生自机被击中（供 UI 播特效） */
  playerHitThisStep = false;

  /** 当前帧是否释放了符卡（供 UI 播白闪） */
  bombFlashThisStep = false;

  /** 游戏阶段状态机（含死亡暂停与续关） */
  readonly flow: GameFlow = new GameFlow(null);

  /** 符卡系统（X 键 Bomb + 决死） */
  readonly spell: SpellSystem = new SpellSystem(3);

  /** 是否处于 BOSS 符卡战（决死时间翻倍） */
  inBossSpell = false;

  /** 卡组（牌堆 + 能量 + 被动卡结算） */
  readonly deck: Deck;

  /** 敌弹减速剩余时间与倍率（由卡牌效果设置） */
  private bulletSlowLeft = 0;
  private bulletSlowFactor = 1;

  /** 最近一次出牌的效果日志（供 UI 显示） */
  lastEffectLog: { op: string; detail: string }[] = [];

  /** 波次运行器（P3） */
  readonly waves: WaveRunner = new WaveRunner();

  /** 幕间商店 */
  readonly shop: Shop = new Shop();

  /** 已通过的幕数 */
  actsCleared = 0;

  /** 本次运行使用的种子（供复现） */
  readonly seed: number;

  private shotGrid: SpatialGrid;
  private queryBuf = new Int32Array(512);
  private pendingSpawns: SpawnRequest[] = [];
  private elapsed = 0;

  constructor(cfg: WorldConfig = { seed: 1 }) {
    this.seed = cfg.seed;
    this.rng = new Rng(cfg.seed);
    this.player = new Player(FIELD_W / 2, FIELD_H * 0.82);
    this.cardShots = new CardShots(1024);
    this.enemyBullets = new BulletField(4096);
    this.shotGrid = new SpatialGrid(FIELD_W, FIELD_H, 32, 256);
    // 每局独立的 Rng 派生，保证洗牌顺序可复现且不影响波次生成
    this.deck = new Deck(new Rng(derive(cfg.seed, 'cards')), createStarterDeck());
  }

  get bounds() {
    return {
      left: 8,
      top: 8,
      right: FIELD_W - 8,
      bottom: FIELD_H - 8,
    };
  }

  /**
   * 重新结算被动卡 → 更新卡牌威力与符卡参数。
   *
   * 【设计变更】自动射击已移除，被动卡不再修改射击参数，
   * 而是修改卡牌威力（见 Deck.resolveCardPower）。
   */
  refreshFromPassives(): void {
    this.cardPower = this.deck.resolveCardPower();
    this.spell.def = this.deck.resolveSpell();
  }

  /** 当前卡牌威力（被动卡结算结果） */
  cardPower: CardPower = { damageMul: 1, energyDiscount: 0 };

  /** 最近一次出牌的伤害倍率（供 UI 显示"这一击被强化了多少"） */
  lastCardDamageMul = 1;

  /**
   * 排队生成一个敌人（下一逻辑步生效，避免在遍历中改数组）。
   *
   * @param targetY 进场后悬停的 y 坐标。省略时由 Enemy 自动推算
   *                （出生点在场上时用它自己，在场外时取场地上部）
   */
  spawnEnemy(cfg: EnemyConfig, x: number, y: number, targetY?: number): void {
    this.pendingSpawns.push({ cfg, x, y, targetY });
  }

  // ─────────────────────────────────────────────
  // 关卡流程（P3）
  // ─────────────────────────────────────────────

  /**
   * 启动一幕：生成波次并开始推进。
   * 生成失败（校验不通过）时返回 false，调用方应提示玩家。
   */
  startAct(actIndex: number): boolean {
    const structure = actIndex === 3
      ? { actId: 'act4', ...ACT_STRUCTURE_4 }
      : { actId: `act${actIndex + 1}`, ...ACT_STRUCTURE_1_TO_3 };

    const result = generateStage({
      masterSeed: this.seed,
      actIndex,
      pool: ENEMY_POOL,
      structure,
      // 经济下限：至少够买一张低价卡（约 40）
      minCoin: 40,
    });

    if (result.errors.length > 0) {
      this.lastStageError = result.errors.join('；');
      return false;
    }

    this.lastStageError = '';
    this.currentAct = actIndex;

    // 每幕开局：满能量、重洗牌堆
    this.deck.resetForNewAct(createStarterDeck());

    // 第四幕的商店插在道中BOSS 之后、关底BOSS 之前（DESIGN 4.1）
    // 结构：1 精英 + 道中BOSS + 关底BOSS → 索引 0/1/2，道中BOSS 是第 1 波
    const midwayPause = actIndex === 3 ? 1 : -1;

    this.waves.start(result.stage, {
      spawn: (typeId: string, nx: number, ny: number) => {
        const cfg = ENEMY_POOL[typeId];
        if (!cfg) return;

        // 归一化坐标 → 像素坐标
        const px = nx * FIELD_W;
        const py = ny * FIELD_H;

        // 进场后的悬停位置：落在场地上部 15%–40% 区间，
        // 让不同波次的敌人停在不同的高度，视觉上更有层次。
        const isBoss = typeId.startsWith('boss');
        const isMid = typeId.startsWith('midboss');
        const restY = isBoss || isMid
          ? FIELD_H * 0.18
          : FIELD_H * (0.15 + this.rng.next() * 0.22);

        this.spawnEnemy(cfg, px, py, restY);
      },
      aliveCount: () => this.aliveEnemyCount,
    }, midwayPause);

    return true;
  }

  /** 最近一次 startAct 的失败原因 */
  lastStageError = '';

  /**
   * 推进敌人状态：燃烧伤害与点燃传播。
   *
   * 点燃规则（按用户设计）：
   *   燃烧中的敌人会点燃附近的、尚未燃烧的敌人，
   *   使对方获得**与燃烧源等长**的燃烧时间。
   */
  private stepEnemyStatus(): void {
    const burningSources: { x: number; y: number; remain: number }[] = [];

    for (const e of this.enemies) {
      if (!e.targetable) continue;

      const burnDmg = e.status.step(LOGIC_DT, e.maxHp);
      if (burnDmg > 0) {
        e.hp = Math.max(0, e.hp - burnDmg);
        if (e.hp <= 0 && !e.dead) {
          e.dead = true;
          e.fadeOut = 0.25;
          this.onEnemyKilled(e);
        }
      }

      // 记录需要传播的燃烧源
      if (e.status.pendingSpread) {
        e.status.pendingSpread = false;
        burningSources.push({
          x: e.x, y: e.y, remain: e.status.remain('burn'),
        });
      }
    }

    // 点燃传播
    if (burningSources.length === 0) return;

    const r2 = BURN_CONFIG.spreadRadius * BURN_CONFIG.spreadRadius;
    for (const src of burningSources) {
      for (const e of this.enemies) {
        if (!e.targetable) continue;
        if (e.status.isBurning) continue;   // 已燃烧的不重复点燃
        const dx = e.x - src.x;
        const dy = e.y - src.y;
        if (dx * dx + dy * dy <= r2) {
          e.status.apply('burn', src.remain);
        }
      }
    }
  }

  /** 当前幕编号（0 起） */
  currentAct = 0;

  /** 本幕是否已经打完所有波次 */
  get actCleared(): boolean {
    return this.waves.phase === 'done';
  }

  /**
   * 调试/测试用：立即结束本幕所有波次。
   *
   * 供自动化测试跳过实际战斗（玩家在测试里不操作会中弹身亡），
   * 也供开发者快速验证幕间流程。生产环境不暴露给玩家。
   */
  debugClearAct(): void {
    let guard = 0;
    while (this.waves.phase !== 'done' && guard++ < 100) {
      if (this.waves.isPausedMidway) {
        // 中途商店点直接跳过（测试用）
        this.waves.resume();
        continue;
      }
      if (this.waves.phase === 'running') {
        this.waves.step(9999);
      } else {
        break;
      }
    }
  }

  // ─────────────────────────────────────────────
  // 幕间流程与商店
  // ─────────────────────────────────────────────

  /** 总幕数 */
  static readonly TOTAL_ACTS = 4;

  /**
   * 本幕打完后进入商店。
   * 返回是否成功进入（已经在商店或未打完时返回 false）。
   */
  enterShop(): boolean {
    // 允许两种情况：整幕打完，或第四幕在道中BOSS 后中途暂停
    const midway = this.waves.isPausedMidway;
    if (!this.actCleared && !midway) return false;
    if (!this.flow.enterShop()) return false;

    this.shopAfterMidway = midway;

    this.actsCleared = this.currentAct + 1;
    this.shop.roll(
      this.seed,
      this.currentAct,
      this.shop.state.visitCount,
      this.shopPriceMul,
    );
    return true;
  }

  /**
   * 离开商店，进入下一幕。
   * 已是最后一幕时返回 false（应当走通关流程）。
   */
  leaveShopAndAdvance(): boolean {
    if (!this.flow.leaveShop()) return false;

    // 第四幕的中途商店：恢复波次，继续打关底BOSS
    if (this.shopAfterMidway) {
      this.shopAfterMidway = false;
      this.waves.resume();
      return true;
    }

    const next = this.currentAct + 1;
    if (next >= World.TOTAL_ACTS) {
      this.flow.phase = 'cleared';
      return false;
    }

    this.startAct(next);
    return true;
  }

  /**
   * 购买商店里的第 index 件商品。
   * 成功时扣除蜃銭并生效。
   */
  buyShopItem(index: number): { ok: boolean; reason?: string } {
    const item = this.shop.state.items[index];
    if (!item) return { ok: false, reason: 'no_item' };

    const r = this.shop.buy(index, this.coins);
    if (!r.ok) return { ok: false, reason: r.reason };

    this.coins -= r.cost;

    switch (item.kind) {
      case 'card':
        if (item.card) {
          if (item.card.type === 'passive') {
            this.deck.addPassive({ ...item.card });
            this.refreshFromPassives();
          } else {
            this.deck.pile.addCard({ ...item.card });
          }
        }
        break;
      case 'heal_life':
        this.player.lives++;
        break;
      case 'restore_spell':
        this.spell.cards = Math.min(this.spell.cardsLimit, this.spell.cards + 1);
        break;
      case 'remove_card':
        // 实际删卡由 UI 引导玩家选一张，这里只扣钱并标记
        this.pendingRemoveCard = true;
        break;
    }

    return { ok: true };
  }

  /**
   * 完成删卡：把指定卡从牌组移除。
   * 只有 pendingRemoveCard 为真时才有效。
   */
  completeRemoveCard(cardId: string): boolean {
    if (!this.pendingRemoveCard) return false;
    const ok = this.deck.pile.removeCardById(cardId);
    if (ok) this.pendingRemoveCard = false;
    return ok;
  }

  /** 是否正在等待玩家选择要删除的卡 */
  pendingRemoveCard = false;

  /** 难度导致的价格倍率（P4 接入难度表，现在固定 1） */
  shopPriceMul = 1;

  /** 本次商店是否是第四幕的中途商店（道中BOSS 后） */
  shopAfterMidway = false;

  // ─────────────────────────────────────────────
  // 卡牌效果
  // ─────────────────────────────────────────────

  /**
   * Z 键：打出选中的主动卡。返回是否成功。
   *
   * 能量在这里统一扣除（需要套用被动卡优惠），Deck.playSelected 不再扣费。
   */
  playSelectedCard(): boolean {
    if (this.flow.paused) return false;

    const card = this.deck.selectedCard;
    if (!card || card.type !== 'active') return false;

    // 被动卡提供能量优惠
    const baseCost = card.energy ?? 0;
    const cost = Math.max(0, baseCost - this.cardPower.energyDiscount);
    if (!this.deck.energy.canPay(cost)) return false;

    // 先从手牌移除，成功后才扣能量（避免"扣了费却没出牌"）
    const played = this.deck.playSelected();
    if (!played) return false;

    this.deck.energy.pay(cost);

    this.lastEffectLog = [];
    if (played.effects) {
      // 被动卡加成：伤害类效果按 damageMul 放大
      const boosted = played.effects.map((e) =>
        e.op === 'damage_all'
          ? { ...e, value: Math.round(e.value * this.cardPower.damageMul) }
          : e,
      );
      const ctx = this.buildEffectContext();
      executeEffects(boosted, ctx, this.lastEffectLog);
      this.lastCardDamageMul = this.cardPower.damageMul;
    }
    return true;
  }

  private buildEffectContext(): EffectContext {
    const self = this;
    return {
      damageAll: (v: number) => {
        let kills = 0;
        for (const e of self.enemies) {
          if (!e.targetable) continue;
          if (e.damage(v)) {
            self.onEnemyKilled(e);
            kills++;
          }
        }
        return kills;
      },
      clearBullets: (radius: number) => {
        if (radius >= 9999) {
          const n = self.enemyBullets.aliveCount;
          self.enemyBullets.clear();
          return n;
        }
        const before = self.enemyBullets.aliveCount;
        self.clearNearbyBullets(self.player.x, self.player.y, radius);
        return before - self.enemyBullets.aliveCount;
      },
      gainEnergy: (v: number) => self.deck.energy.gain(v),
      gainCoin: (v: number) => { self.coins += v; return v; },
      restoreSpell: (v: number) => {
        const before = self.spell.cards;
        self.spell.cards = Math.min(self.spell.cardsLimit, self.spell.cards + v);
        return self.spell.cards - before;
      },
      drawCards: (n: number) => self.deck.drawNow(n).drawn,
      grantInvuln: (s: number) => {
        self.player.invuln = Math.max(self.player.invuln, s);
      },
      slowBullets: (s: number, f: number) => {
        self.bulletSlowLeft = Math.max(self.bulletSlowLeft, s);
        self.bulletSlowFactor = Math.min(self.bulletSlowFactor, f);
      },
      firePierce: (count, damage, speed, pierce, radius, kind) =>
        self.cardShots.firePierce(
          self.player, count, damage, speed, pierce, radius, kind,
        ),
      startBurst: (duration, interval, count, damage, speed, pierce) =>
        self.cardShots.startBurst(duration, interval, count, damage, speed, pierce),
      applyStatus: (status, seconds) => {
        let n = 0;
        for (const e of self.enemies) {
          if (!e.targetable) continue;
          e.status.apply(status, seconds);
          n++;
        }
        return n;
      },
      get currentLives() {
        return self.player.lives;
      },
    };
  }

  /** 推进一个固定逻辑步 */
  step(): void {
    this.playerHitThisStep = false;
    this.bombFlashThisStep = false;

    // 死亡或结束后不再推进任何游戏逻辑
    if (this.flow.paused) return;

    this.elapsed += LOGIC_DT;

    // 卡组推进（能量回复、自动抽牌、过载停顿）
    this.deck.step(LOGIC_DT);

    // 波次推进（P3）：按时间轴生成敌人、判断本波是否结束
    this.waves.step(LOGIC_DT);

    // 敌弹减速计时
    if (this.bulletSlowLeft > 0) {
      this.bulletSlowLeft = Math.max(0, this.bulletSlowLeft - LOGIC_DT);
      if (this.bulletSlowLeft === 0) this.bulletSlowFactor = 1;
    }

    // 0. 符卡系统（决死倒计时、无敌、冻结）
    const deathbombResult = this.spell.step(LOGIC_DT);
    const req = this.spell.consumeRequests();

    // 炸弹释放瞬间：清屏 + 对敌伤害 + 无敌
    if (req.clear) {
      this.enemyBullets.clear();
      this.player.invuln = Math.max(this.player.invuln, this.spell.def.invulnTime);
      if (req.damage > 0) {
        for (const e of this.enemies) {
          if (!e.targetable) continue;
          if (e.damage(req.damage)) {
            this.onEnemyKilled(e);
          }
        }
      }
      this.bombFlashThisStep = true;
    }

    // 决死窗口耗尽 → MISS
    if (deathbombResult === 'miss') {
      this.resolveMiss();
    }

    // 1. 生成排队中的敌人
    if (this.pendingSpawns.length) {
      for (const s of this.pendingSpawns) {
        this.enemies.push(new Enemy(s.cfg, s.x, s.y, s.targetY));
      }
      this.pendingSpawns.length = 0;
    }

    // 2. 自机移动（决死期间冻结）
    if (this.spell.phase !== 'deathbomb') {
      this.player.step(this.input, this.bounds);
    }

    // 3. 【已移除】自动射击
    //
    // 设计决定：抛弃传统 STG 的常驻射击，**所有输出只能通过卡牌实现**。
    // 这与「淘汰 P 点、火力成长完全由符片决定」是同一套思路：
    // 让玩家唯一的手部动作是「在正确时机做出正确的选择」。
    //
    // 影响：被动卡不再修改自动射击，而是修改**主动卡的效果**（见 Deck.resolveCardPower）。

    // 4. 自机子弹推进（卡牌驱动的穿透弹与持续射击）
    this.cardShots.step(this.player);
    this.cardShots.shots.integrate(LOGIC_DT);

    // 5. 敌人移动与开火（符卡冻结时暂停开火）
    for (const e of this.enemies) {
      e.step(LOGIC_DT, this.spell.frozen ? null : this.enemyBullets);
    }

    // 5.5 敌人状态推进（燃烧伤害 + 点燃传播）
    this.stepEnemyStatus();

    // 6. 自机子弹 vs 敌人
    this.resolveShotHits();

    // 7. 敌弹推进
    this.enemyBullets.integrate(LOGIC_DT);

    // 8. 敌弹 vs 自机
    this.resolvePlayerHits();

    // 8.5 蜃銭掉落物：飘动、吸引、拾取
    this.stepCoinDrops();

    // 9. 清理已消散的敌人
    this.cleanupEnemies();
  }

  /** 自机子弹打敌人 */
  private resolveShotHits(): void {
    const s = this.cardShots.shots.field;
    if (s.aliveCount === 0) return;

    const limit = s.scanLimit;
    for (let i = 0; i < limit; i++) {
      if (s.state[i] !== 1) continue;

      const sx = s.x[i]!;
      const sy = s.y[i]!;

      for (const e of this.enemies) {
        if (!e.targetable) continue;

        const dx = sx - e.x;
        const dy = sy - e.y;
        const rr = e.radius + s.radius[i]!;
        if (dx * dx + dy * dy > rr * rr) continue;

        if (e.damage(this.cardShots.shots.damage[i]!)) {
          this.onEnemyKilled(e);
        }

        // 穿透：还有剩余次数就继续飞，否则消失
        if (!this.cardShots.consumePierce(i)) {
          s.state[i] = 0;
          s.aliveCount--;
          break;
        }
        // 还能穿透时，继续对下一个敌人判定（不 break）
      }
    }
  }

  /** 敌弹 vs 自机：只判定圆心距离，判定半径极小 */
  private resolvePlayerHits(): void {
    // 符卡生效期间自机必定无敌。
    //
    // 为什么要在守卫里额外判一次 spell.phase：
    //   中弹判定原本只看 player.invuln，而符卡的无敌期是
    //   SpellSystem 的 active 状态 —— 两个独立状态源。
    //   如果它们不同步（例如代码里手动改 invuln，或将来某个卡牌效果），
    //   就会出现"通过守卫 -> enterDeathbomb 因 active 而拒绝 ->
    //   兜底条件也不成立"的漏洞，中弹被静默吞掉。
    //   这道守卫让两者含义一致：符卡生效 = 打不到。
    if (this.spell.phase === 'active') return;
    if (!this.player.vulnerable) return;

    const px = this.player.x;
    const py = this.player.y;
    const pr = this.player.cfg.hitRadius;

    // 先重建网格，只查自机附近 3×3 格
    this.shotGrid.rebuild(
      this.enemyBullets.x, this.enemyBullets.y,
      this.enemyBullets.state, this.enemyBullets.scanLimit,
    );
    const n = this.shotGrid.queryNeighbors(px, py, this.queryBuf);

    for (let k = 0; k < n; k++) {
      const j = this.queryBuf[k]!;
      if (this.enemyBullets.state[j] !== 1) continue;

      const dx = px - this.enemyBullets.x[j]!;
      const dy = py - this.enemyBullets.y[j]!;
      const rr = pr + this.enemyBullets.radius[j]!;
      if (dx * dx + dy * dy <= rr * rr) {
        // 不立即扣命——先进入决死窗口，给玩家按 X 的机会
        this.playerHitThisStep = true;
        this.clearNearbyBullets(px, py, 72);
        const win = this.spell.enterDeathbomb(this.inBossSpell);
        // 若符卡系统不在 idle（已在决死或无敌中），说明这次不该再触发
        if (win === 0 && this.spell.phase === 'idle') {
          // 兜底：直接扣命
          this.applyMiss();
        }
        break;
      }
    }
  }

  /**
   * 决死窗口走完仍未按 X → 真正的 MISS。
   */
  private resolveMiss(): void {
    this.applyMiss();
  }

  /** 扣残机、重置符卡、检查是否进入死亡流程 */
  /**
   * MISS 处理（撞弹且决死失败）。
   *
   * 用户 2026-10-31 明确的完整规则：
   *   1. 自机重置到初始位置
   *   2. 损失 40% 蜃銭
   *   3. 在撞弹位置爆出「损失量的一半」蜃銭（类比原作的 P 点爆出）
   *   4. 获得一段时间的无敌
   *   5. 失去一张残机、符卡重置（正作规则）
   *
   * 关于第 2、3 条的经济设计：
   *   损失 40%，但可以在原地捡回其中一半（= 总额的 20%），
   *   所以"立刻冲回去捡"能把实际损失从 40% 压到 20%。
   *   这让 MISS 同时惩罚操作失误与奖励风险决策 —— 捡钱要迎着弹幕冲。
   */
  private applyMiss(): void {
    // 记录撞弹位置（重置前）
    const hitX = this.player.x;
    const hitY = this.player.y;

    const took = this.player.hit();
    if (!took) return;

    // ── 1. 损失 40% 蜃銭，并在撞弹处爆出一半 ──
    const lost = Math.floor(this.coins * MISS_CONFIG.coinLossRatio);
    if (lost > 0) {
      this.coins -= lost;
      const dropped = Math.floor(lost * MISS_CONFIG.coinDropRatio);
      if (dropped > 0) {
        this.spawnCoinDrop(hitX, hitY, dropped);
      }
    }

    // ── 2. 自机重置到初始位置 ──
    this.player.x = FIELD_W / 2;
    this.player.y = FIELD_H * 0.82;

    // ── 3. 一段时间无敌 ──
    this.player.invuln = Math.max(this.player.invuln, MISS_CONFIG.invulnTime);

    // ── 4. 正作规则：失去残机时符卡重置为初始数量 ──
    this.spell.onPlayerMiss();

    // ── 5. 清掉出生点附近的敌人，避免落地即死 ──
    this.clearNearbyEnemies(this.player.x, this.player.y, MISS_CONFIG.spawnClearRadius);

    // 残机耗尽 → 暂停游戏，等待玩家选择是否续关
    if (this.player.dead) this.flow.onPlayerDead();
  }

  /**
   * 统一的击杀结算。
   *
   * 为什么抽成一个方法：之前四个地方（燃烧、卡牌、符卡、子弹）
   * 各自写了「加分 + 加钱 + 计数」三行，容易漏改。
   * 现在钱不再是直接加数字，而是爆成掉落物 —— 只改一处就够。
   */
  private onEnemyKilled(e: Enemy): void {
    this.score += e.score;
    this.kills++;
    // 蜃銭不再是直接加进数字，而是在敌人位置爆出来让玩家去捡
    if (e.coin > 0) {
      this.spawnCoinDrop(e.x, e.y, e.coin);
    }
  }

  /**
   * 在指定位置生成一堆可拾取的蜃銭。
   *
   * 用「一簇多个小金币」而不是单个大金币：
   * 撒开的形状让玩家能看清哪里掉了钱，视觉上更像原作爆出的 P 点。
   */
  private spawnCoinDrop(x: number, y: number, totalAmount: number): void {
    if (totalAmount <= 0) return;

    // 面额 → 物件数：小钱 1-2 个，大钱散成一簇
    const n = Math.min(
      MISS_CONFIG.maxCoinDrops,
      Math.max(1, Math.round(totalAmount / 6)),
    );
    const per = Math.max(1, Math.floor(totalAmount / n));

    for (let i = 0; i < n; i++) {
      // 以撞弹点为中心的圆形散开
      const angle = (Math.PI * 2 * i) / n + this.rng.next() * 0.6;
      const dist = 8 + this.rng.next() * 26;
      this.coinDrops.push({
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        amount: per,
        // 向上抛 + 横向散开，之后由重力拉下来
        vx: Math.cos(angle) * (55 + this.rng.next() * 45),
        vy: Math.sin(angle) * 30 - (110 + this.rng.next() * 70),
        life: MISS_CONFIG.coinDropLife,
        collected: false,
        pickupDelay: MISS_CONFIG.coinPickupDelay,
      });
    }
  }

  /** 清掉半径内的敌人（MISS 复活保护） */
  private clearNearbyEnemies(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    for (const e of this.enemies) {
      if (!e.targetable) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2) {
        // 只清场，不给分不给钱（避免玩家故意自杀刷分）
        e.dead = true;
        e.fadeOut = 0.2;
      }
    }
  }

  /** 场上的蜃銭掉落物 */
  readonly coinDrops: CoinDrop[] = [];

  /**
   * 推进掉落物：飘动、衰减、被自机吸引并拾取。
   */
  private stepCoinDrops(): void {
    for (let i = this.coinDrops.length - 1; i >= 0; i--) {
      const c = this.coinDrops[i]!;
      if (c.collected) {
        this.coinDrops.splice(i, 1);
        continue;
      }

      // ── 物理：重力下落 + 落地反弹 + 摩擦 ──
      c.vy += MISS_CONFIG.coinGravity * LOGIC_DT;

      c.x += c.vx * LOGIC_DT;
      c.y += c.vy * LOGIC_DT;

      const floorY = FIELD_H - MISS_CONFIG.coinFloorOffset;
      if (c.y >= floorY) {
        // 触底：反弹一次，速度衰减
        c.y = floorY;
        if (Math.abs(c.vy) > 40) {
          c.vy = -c.vy * MISS_CONFIG.coinBounce;
        } else {
          c.vy = 0;
        }
        // 地面摩擦
        c.vx *= MISS_CONFIG.coinGroundFriction;
      }

      // 左右边界：碰壁反弹，避免钱飞出场地
      if (c.x < 6) {
        c.x = 6;
        c.vx = Math.abs(c.vx) * 0.5;
      } else if (c.x > FIELD_W - 6) {
        c.x = FIELD_W - 6;
        c.vx = -Math.abs(c.vx) * 0.5;
      }

      // 刚爆出时不可拾取，也不被吸引，让金币先散开
      if (c.pickupDelay > 0) {
        c.pickupDelay -= LOGIC_DT;
        c.life -= LOGIC_DT;
        if (c.life <= 0) this.coinDrops.splice(i, 1);
        continue;
      }

      // 自机靠近时被吸引
      const dx = this.player.x - c.x;
      const dy = this.player.y - c.y;
      const d2 = dx * dx + dy * dy;
      const attract = MISS_CONFIG.coinAttractRadius;
      if (d2 < attract * attract) {
        const d = Math.sqrt(d2) || 1;
        const pull = MISS_CONFIG.coinAttractSpeed * LOGIC_DT;
        c.x += (dx / d) * pull;
        c.y += (dy / d) * pull;
      }

      // 拾取判定
      if (d2 < MISS_CONFIG.coinPickRadius * MISS_CONFIG.coinPickRadius) {
        this.coins += c.amount;
        c.collected = true;
        this.coinDrops.splice(i, 1);
        continue;
      }

      // 超时消失
      c.life -= LOGIC_DT;
      if (c.life <= 0) this.coinDrops.splice(i, 1);
    }
  }

  /**
   * 玩家按 X（由输入层调用）。
   * 若在决死窗口中则救场，否则正常释放。
   * 返回是否成功消耗了一张符卡。
   */
  pressBomb(): boolean {
    if (this.flow.paused) return false;

    if (this.spell.phase === 'deathbomb') {
      if (this.spell.tryBombDuringDeathbomb()) {
        // 决死成功：不进 MISS，无敌已由 SpellSystem 给出
        this.player.invuln = Math.max(this.player.invuln, this.spell.def.invulnTime);
        return true;
      }
      return false;
    }

    return this.spell.tryCast();
  }

  private clearNearbyBullets(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    const f = this.enemyBullets;
    const limit = f.scanLimit;
    for (let i = 0; i < limit; i++) {
      if (f.state[i] !== 1) continue;
      const dx = f.x[i]! - x;
      const dy = f.y[i]! - y;
      if (dx * dx + dy * dy <= r2) f.kill(i);
    }
  }

  private cleanupEnemies(): void {
    let w = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (e.dead && e.fadeOut <= 0) continue;
      this.enemies[w++] = e;
    }
    this.enemies.length = w;
  }

  /** 供测试与调试：当前存活敌人数 */
  get aliveEnemyCount(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  /**
   * 续关：清屏、满血复活，得分与金钱保留。
   * 返回是否续关成功（阶段不对或已达上限时返回 false）。
   */
  doContinue(): boolean {
    if (!this.flow.doContinue()) return false;

    // 清掉场上所有敌弹，避免刚复活就被打
    this.enemyBullets.clear();
    this.cardShots.clear();

    // 清掉排队中还没生成的敌人，以及自机周围 200px 内的敌人
    this.pendingSpawns.length = 0;

    const px = FIELD_W / 2;
    const py = FIELD_H * 0.82;
    let w = 0;
    for (const e of this.enemies) {
      const dx = e.x - px;
      const dy = e.y - py;
      if (dx * dx + dy * dy > 200 * 200) this.enemies[w++] = e;
    }
    this.enemies.length = w;

    // 复活：满残机、回中央、给足无敌
    this.player.reset(px, py);
    this.player.invuln = 3.0;

    return true;
  }

  /** 放弃续关，进入结算 */
  giveUp(): void {
    this.flow.giveUp();
  }

  /** 当前阶段 */
  get phase(): GamePhase {
    return this.flow.phase;
  }

  reset(): void {
    this.player.reset(FIELD_W / 2, FIELD_H * 0.82);
    this.cardShots.clear();
    this.enemyBullets.clear();
    this.coinDrops.length = 0;
    this.enemies.length = 0;
    this.pendingSpawns.length = 0;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.flow.reset();
  }
}
