/**
 * 游戏渲染层。
 *
 * 只读 World 的状态，不做任何游戏逻辑判断。
 * 所有位置都在逻辑坐标系（384×448），由容器统一放大到屏幕。
 */

import { Application, Container, Graphics, Text } from 'pixi.js';
import type { World } from '../core/world';
import { FIELD_W, FIELD_H } from '../core/world';
import { PlayerShots } from '../core/shot/playerShots';

const COLORS = {
  bg: 0x0a0c16,
  shot: 0x9fe3ff,
  shotOrb: 0xffd98a,
  shotTalisman: 0xc79bff,
  enemy: 0xff6b8a,
  enemyFlash: 0xffffff,
  player: 0xff5f7e,
  playerCore: 0xffffff,
  hitbox: 0xff2222,
  enemyBullet: 0x7ec8ff,
} as const;

export class GameRenderer {
  readonly root: Container;
  private readonly shotLayer: Container;
  private readonly enemyLayer: Container;
  private readonly bulletLayer: Container;
  private readonly playerLayer: Container;

  /** 自机子弹：按 kind 分组复用 Graphics */
  private readonly shotGfx: Graphics[] = [];
  private readonly shotNeedleGfx: Graphics[] = [];
  private readonly shotOrbGfx: Graphics[] = [];
  private readonly shotTalismanGfx: Graphics[] = [];

  private enemyGfx: Graphics[] = [];
  private readonly bulletGfx: Graphics[] = [];

  private playerGfx!: Graphics;
  private hitboxGfx!: Graphics;
  private playerInvulnRing!: Graphics;
  /** 决死窗口的视觉提示（红色脉冲圆环） */
  private deathbombRing!: Graphics;
  /** 炸弹释放时的全屏白闪 */
  private bombFlash!: Graphics;
  private bombFlashAlpha = 0;
  /** 决死时的全屏红罩 */
  private deathbombVeil!: Graphics;

  private readonly SHOT_CAP = 1024;
  private readonly BULLET_CAP = 4096;

  private scoreText!: Text;
  private spellText!: Text;

  private readonly scale: number;

  constructor(app: Application, scale = 1.6) {
    this.scale = scale;

    this.root = new Container();
    this.root.scale.set(scale);

    // 背景
    const bg = new Graphics()
      .rect(0, 0, FIELD_W, FIELD_H)
      .fill(COLORS.bg);
    this.root.addChild(bg);

    // 场地边框
    const frame = new Graphics()
      .rect(0, 0, FIELD_W, FIELD_H)
      .stroke({ width: 1, color: 0x2a3350, alpha: 0.9 });
    this.root.addChild(frame);

    this.shotLayer = new Container();
    this.enemyLayer = new Container();
    this.bulletLayer = new Container();
    this.playerLayer = new Container();
    this.root.addChild(this.shotLayer, this.enemyLayer, this.bulletLayer, this.playerLayer);

    this.buildShotPool();
    this.buildBulletPool();
    this.buildPlayer();
    this.buildHud();

    app.stage.addChild(this.root);
  }

  private buildShotPool(): void {
    // needle：细长白针
    for (let i = 0; i < this.SHOT_CAP; i++) {
      const g = new Graphics()
        .roundRect(-1.2, -7, 2.4, 14, 1.2)
        .fill(COLORS.shot);
      g.visible = false;
      this.shotNeedleGfx.push(g);
      this.shotLayer.addChild(g);
      this.shotGfx.push(g);
    }
    // orb / talisman 共用一套，先用同一批 needle 占位（数量足够）
    for (let i = 0; i < this.SHOT_CAP; i++) {
      const g = new Graphics().circle(0, 0, 3.2).fill(COLORS.shotOrb);
      g.visible = false;
      this.shotOrbGfx.push(g);
      this.shotLayer.addChild(g);
    }
    for (let i = 0; i < this.SHOT_CAP; i++) {
      const g = new Graphics()
        .rect(-2, -6, 4, 12)
        .fill(COLORS.shotTalisman);
      g.visible = false;
      this.shotTalismanGfx.push(g);
      this.shotLayer.addChild(g);
    }
  }

  private buildBulletPool(): void {
    for (let i = 0; i < this.BULLET_CAP; i++) {
      const g = new Graphics().circle(0, 0, 4).fill(COLORS.enemyBullet);
      g.visible = false;
      this.bulletGfx.push(g);
      this.bulletLayer.addChild(g);
    }
  }

  private buildPlayer(): void {
    // 外圈光晕
    const halo = new Graphics().circle(0, 0, 9).fill({ color: COLORS.player, alpha: 0.28 });
    // 本体
    const body = new Graphics().circle(0, 0, 5).fill(COLORS.player);
    // 核心白点
    const core = new Graphics().circle(0, 0, 2).fill(COLORS.playerCore);

    this.playerGfx = new Container() as unknown as Graphics;
    const pc = this.playerGfx as unknown as Container;
    pc.addChild(halo, body, core);

    // 判定点（低速时显示）
    this.hitboxGfx = new Graphics();
    this.hitboxGfx
      .circle(0, 0, 3.2)
      .fill({ color: COLORS.hitbox, alpha: 0.95 })
      .circle(0, 0, 5.6)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
    this.hitboxGfx.visible = false;

    // 无敌闪烁环
    this.playerInvulnRing = new Graphics()
      .circle(0, 0, 12)
      .stroke({ width: 1.5, color: 0xffd166, alpha: 0.8 });
    this.playerInvulnRing.visible = false;

    // 决死窗口提示：三层同心红环
    this.deathbombRing = new Graphics();
    this.deathbombRing
      .circle(0, 0, 16)
      .stroke({ width: 2, color: 0xff3b5c, alpha: 0.95 })
      .circle(0, 0, 24)
      .stroke({ width: 1.5, color: 0xff3b5c, alpha: 0.55 })
      .circle(0, 0, 34)
      .stroke({ width: 1, color: 0xff3b5c, alpha: 0.28 });
    this.deathbombRing.visible = false;

    this.playerLayer.addChild(this.hitboxGfx, pc);
    this.playerLayer.addChild(this.playerInvulnRing);
    this.playerLayer.addChild(this.deathbombRing);

    // 全屏白闪（覆盖在最上层，初始透明）
    this.bombFlash = new Graphics()
      .rect(0, 0, FIELD_W, FIELD_H)
      .fill(0xffffff);
    this.bombFlash.alpha = 0;
    this.bombFlash.visible = false;

    // 决死时的全屏红罩（在白闪之下）
    this.deathbombVeil = new Graphics()
      .rect(0, 0, FIELD_W, FIELD_H)
      .fill(0xff1025);
    this.deathbombVeil.alpha = 0;
    this.deathbombVeil.visible = false;

    this.root.addChild(this.deathbombVeil);
    this.root.addChild(this.bombFlash);
  }

  private buildHud(): void {
    this.scoreText = new Text({
      text: '',
      style: {
        fontFamily: 'Consolas, monospace',
        fontSize: 9,
        fill: 0x7d8aa8,
      },
    });
    this.scoreText.position.set(6, 4);
    this.root.addChild(this.scoreText);

    // 符卡数量：放在得分文字右侧，避免与下方手牌区视觉冲突
    this.spellText = new Text({
      text: '',
      style: {
        fontFamily: 'Consolas, monospace',
        fontSize: 9,
        fill: 0xc79bff,
      },
    });
    this.spellText.anchor.set(1, 0);
    this.spellText.position.set(FIELD_W - 6, 4);
    this.root.addChild(this.spellText);
  }

  /** 符卡上限，用于绘制未填充的格子 */
  private cardsLimit = 3;

  /** 每帧同步一次 */
  render(world: World): void {
    this.renderPlayer(world);
    this.renderShots(world);
    this.renderEnemies(world);
    this.renderBullets(world);
    this.renderBombFlash(world);
    this.renderHud(world);
  }

  /** 炸弹释放时的全屏白闪 */
  private renderBombFlash(world: World): void {
    if (world.bombFlashThisStep) {
      this.bombFlashAlpha = 0.85;
      this.bombFlash.visible = true;
    }
    if (this.bombFlashAlpha > 0) {
      this.bombFlashAlpha = Math.max(0, this.bombFlashAlpha - 0.09);
      this.bombFlash.alpha = this.bombFlashAlpha;
      if (this.bombFlashAlpha === 0) this.bombFlash.visible = false;
    }

    // 决死时的全屏红罩：脉冲闪烁，极短时间内必须抓住玩家的注意。
    // 注意：透明度必须克制——玩家仍要能看清弹幕，否则等于致盲。
    if (world.spell.phase === 'deathbomb') {
      const left = world.spell.deathbombLeftSeconds;
      this.deathbombVeil.visible = true;
      this.deathbombVeil.alpha = 0.05 + 0.055 * Math.abs(Math.sin(left * 55));
    } else if (this.deathbombVeil.visible) {
      this.deathbombVeil.visible = false;
      this.deathbombVeil.alpha = 0;
    }
  }

  private renderPlayer(world: World): void {
    const p = world.player;
    const pc = this.playerGfx as unknown as Container;
    pc.position.set(p.x, p.y);
    this.hitboxGfx.position.set(p.x, p.y);
    this.playerInvulnRing.position.set(p.x, p.y);
    this.deathbombRing.position.set(p.x, p.y);

    // 低速时显示判定点
    this.hitboxGfx.visible = p.focusing && !p.dead;

    // 决死窗口：只剩一点时间，必须让玩家看见
    const inDeathbomb = world.spell.phase === 'deathbomb';
    if (inDeathbomb) {
      this.deathbombRing.visible = true;
      // 快速脉冲：越接近结束闪得越快
      const left = world.spell.deathbombLeftSeconds;
      const pulse = 0.55 + 0.45 * Math.sin(left * 90);
      this.deathbombRing.alpha = pulse;
      // 轻微放大，强化"要炸了"的感觉
      const k = 1 + (1 - Math.min(1, left / 0.5)) * 0.35;
      this.deathbombRing.scale.set(k);
    } else {
      this.deathbombRing.visible = false;
      this.deathbombRing.scale.set(1);
    }

    // 无敌时闪烁
    if (p.invuln > 0 && !inDeathbomb) {
      const blink = Math.floor(p.invuln * 12) % 2 === 0;
      pc.alpha = blink ? 0.35 : 1;
      this.playerInvulnRing.visible = true;
      this.playerInvulnRing.alpha = 0.4 + 0.4 * Math.sin(p.invuln * 18);
    } else {
      pc.alpha = p.dead ? 0 : 1;
      this.playerInvulnRing.visible = false;
    }
  }

  private renderShots(world: World): void {
    const s = world.playerShots;
    const f = s.field;

    let nNeedle = 0;
    let nOrb = 0;
    let nTalisman = 0;

    const limit = f.scanLimit;
    for (let i = 0; i < limit; i++) {
      if (f.state[i] !== 1) continue;

      const x = f.x[i]!;
      const y = f.y[i]!;
      const kind = s.kind[i];

      if (kind === PlayerShots.KIND_ORB) {
        const g = this.shotOrbGfx[nOrb++];
        if (!g) continue;
        g.visible = true;
        g.position.set(x, y);
      } else if (kind === PlayerShots.KIND_TALISMAN) {
        const g = this.shotTalismanGfx[nTalisman++];
        if (!g) continue;
        g.visible = true;
        g.position.set(x, y);
      } else {
        const g = this.shotNeedleGfx[nNeedle++];
        if (!g) continue;
        g.visible = true;
        g.position.set(x, y);
        // 让针头朝向飞行方向
        g.rotation = Math.atan2(f.vy[i]!, f.vx[i]!) + Math.PI / 2;
      }
    }

    for (let i = nNeedle; i < this.shotNeedleGfx.length; i++) {
      this.shotNeedleGfx[i]!.visible = false;
    }
    for (let i = nOrb; i < this.shotOrbGfx.length; i++) {
      this.shotOrbGfx[i]!.visible = false;
    }
    for (let i = nTalisman; i < this.shotTalismanGfx.length; i++) {
      this.shotTalismanGfx[i]!.visible = false;
    }
  }

  private renderEnemies(world: World): void {
    const enemies = world.enemies;

    // 池子按需增长
    while (this.enemyGfx.length < enemies.length) {
      const g = new Graphics()
        .circle(0, 0, 1)
        .fill(COLORS.enemy);
      g.visible = false;
      this.enemyGfx.push(g);
      this.enemyLayer.addChild(g);
    }

    for (let i = 0; i < this.enemyGfx.length; i++) {
      const g = this.enemyGfx[i]!;
      const e = enemies[i];
      if (!e) {
        g.visible = false;
        continue;
      }

      g.visible = true;
      g.position.set(e.x, e.y);

      // 用半径重建外观（敌人类型少，重建代价可接受）
      const r = e.radius;
      g.clear();
      if (e.dead) {
        // 消散：放大 + 变淡
        const t = e.fadeOut / 0.25;
        g.circle(0, 0, r * (1 + (1 - t) * 0.8))
          .fill({ color: COLORS.enemy, alpha: t * 0.6 });
      } else if (e.hitFlash > 0) {
        g.circle(0, 0, r).fill(COLORS.enemyFlash);
      } else {
        g.circle(0, 0, r).fill(COLORS.enemy);
        // 血条
        if (e.maxHp > 1 && e.hp < e.maxHp) {
          const w = r * 2;
          const ratio = e.hp / e.maxHp;
          g.rect(-r, -r - 5, w, 2.4).fill({ color: 0x1a2135, alpha: 0.9 });
          g.rect(-r, -r - 5, w * ratio, 2.4).fill(0xffd166);
        }
      }
    }
  }

  private renderBullets(world: World): void {
    const f = world.enemyBullets;
    const limit = f.scanLimit;
    let n = 0;

    for (let i = 0; i < limit; i++) {
      if (f.state[i] !== 1) continue;
      const g = this.bulletGfx[n++];
      if (!g) break;
      g.visible = true;
      g.position.set(f.x[i]!, f.y[i]!);
    }

    for (let i = n; i < this.bulletGfx.length; i++) {
      this.bulletGfx[i]!.visible = false;
    }
  }

  private renderHud(world: World): void {
    this.scoreText.text =
      `SCORE ${world.score}   COIN ${world.coins}   KILL ${world.kills}`;

    // 符卡指示移到 HUD 左上角区域（右下角会与手牌区视觉重叠）
    const n = world.spell.cards;
    if (n > 0) {
      this.spellText.text = 'X ' + '◆'.repeat(n) + '◇'.repeat(Math.max(0, this.cardsLimit - n));
      this.spellText.style.fill = world.spell.phase === 'deathbomb'
        ? 0xff3b5c   // 决死时变红
        : 0xc79bff;
    } else {
      this.spellText.text = '◇'.repeat(this.cardsLimit) + ' 无符卡';
      this.spellText.style.fill = 0x55648a;
    }
  }

  /** 画布尺寸（含缩放） */
  get canvasWidth(): number {
    return FIELD_W * this.scale;
  }

  get canvasHeight(): number {
    return FIELD_H * this.scale;
  }
}
