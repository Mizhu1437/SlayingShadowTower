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
    });

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
          this.score += e.score;
          this.coins += e.coin;
          this.kills++;
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
            self.score += e.score;
            self.coins += e.coin;
            self.kills++;
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
          const killed = e.damage(req.damage);
          if (killed) {
            this.score += e.score;
            this.coins += e.coin;
            this.kills++;
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

        const killed = e.damage(this.cardShots.shots.damage[i]!);
        if (killed) {
          this.score += e.score;
          this.coins += e.coin;
          this.kills++;
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
  private applyMiss(): void {
    const took = this.player.hit();
    if (!took) return;

    // 正作规则：失去残机时符卡重置为初始数量
    this.spell.onPlayerMiss();

    // 残机耗尽 → 暂停游戏，等待玩家选择是否续关
    if (this.player.dead) this.flow.onPlayerDead();
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
    this.enemies.length = 0;
    this.pendingSpawns.length = 0;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.flow.reset();
  }
}
