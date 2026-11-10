/**
 * 游戏渲染层。
 *
 * 只读 World 的状态，不做任何游戏逻辑判断。
 * 所有位置都在逻辑坐标系（384×448），由容器统一放大到屏幕。
 */

import { Application, Container, Graphics, Text } from 'pixi.js';
import { StageBackdrop } from './stageBackdrop';
import type { World } from '../core/world';
import { FIELD_W, FIELD_H } from '../core/world';
import { PlayerShots } from '../core/shot/playerShots';

const COLORS = {
  bg: 0x0a0c16,
  shot: 0x9fe3ff,
  shotOrb: 0xffd98a,
  shotTalisman: 0xc79bff,
  fireCore: 0xfff2b0,
  coin: 0xffd479,
  fireMid: 0xffa63d,
  fireEdge: 0xff4d2e,
  enemy: 0xff6b8a,
  enemyFlash: 0xffffff,
  player: 0xff5f7e,
  playerCore: 0xffffff,
  hitbox: 0xff2222,
  enemyBullet: 0x7ec8ff,
} as const;

export class GameRenderer {
  readonly root: Container;

  /** 四幕背景与静止遮罩 */
  private backdrop: StageBackdrop | null = null;
  /** 素材加载前用的纯色底，加载完成后隐藏 */
  private fallbackBg: Graphics | null = null;

  /**
   * 战斗框内的波次倒计时。
   *
   * 为什么画在 canvas 里而不是用 DOM：
   * DOM 版本放在 body 上，会被 canvas 遮挡（层叠上下文问题，
   * 试过调 z-index / 移入 #stage 都不行）；
   * 而 canvas 内的 Text 天然处于场景图最上层，不受此影响。
   */
  private fieldTimerText!: Text;
  private lastTimerSec = -1;
  private readonly shotLayer: Container;
  private readonly enemyLayer: Container;
  private readonly bulletLayer: Container;
  private readonly playerLayer: Container;

  /** 自机子弹：按 kind 分组复用 Graphics */
  private readonly shotGfx: Graphics[] = [];
  private readonly shotNeedleGfx: Graphics[] = [];
  private readonly shotOrbGfx: Graphics[] = [];
  private readonly shotTalismanGfx: Graphics[] = [];
  /** 火鸟：每枚由多个 Graphics 组成的容器 */
  private readonly firebirdGfx: Container[] = [];
  /** 蜃銭掉落物 */
  private readonly coinGfx: Graphics[] = [];
  private readonly COIN_CAP = 64;
  private readonly FIREBIRD_CAP = 32;

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


  private readonly scale: number;

  constructor(app: Application, scale = 1.6) {
    this.scale = scale;

    this.root = new Container();
    this.root.scale.set(scale);

    // 兜底底色：素材加载完成前先垫一层，避免闪出画布底板色。
    // 加载完成后必须隐藏它 —— 它是最底层，背景图层插在它下面，
    // 如果留着会把背景完全挡住（第一次接入时就是这个原因导致背景看不见）。
    const bg = new Graphics()
      .rect(0, 0, FIELD_W, FIELD_H)
      .fill(COLORS.bg);
    this.root.addChild(bg);
    this.fallbackBg = bg;

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
    this.buildCoinPool();
    this.buildBulletPool();
    this.buildPlayer();

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

    // 火鸟：用图形拼成「由炎弹聚成的鸟」
    //
    // 形态说明（从这张参考图只能确认"密集橙色光点聚成一团"，
    // 具体轮廓由这里定义）：中央一个亮核，两侧各三片渐小的翼羽，
    // 后方拖一条逐渐变暗的尾焰。
    for (let i = 0; i < this.FIREBIRD_CAP; i++) {
      const c = new Container();

      // 尾焰（最暗，在最后面）
      for (let t = 0; t < 3; t++) {
        const tail = new Graphics()
          .ellipse(0, 12 + t * 9, 7 - t * 1.6, 12 - t * 2.5)
          .fill({ color: COLORS.fireEdge, alpha: 0.42 - t * 0.11 });
        c.addChild(tail);
      }

      // 双翼：左右各三片，逐渐变小、变暗
      for (let w = 0; w < 3; w++) {
        const len = 26 - w * 7;
        const wid = 9 - w * 2;
        const alpha = 0.75 - w * 0.18;
        const dy = 2 + w * 4;

        const right = new Graphics()
          .poly([0, 0, len, dy - wid, len * 0.75, dy + wid, 0, wid * 0.6])
          .fill({ color: w === 0 ? COLORS.fireMid : COLORS.fireEdge, alpha });
        right.position.set(3, dy);
        c.addChild(right);

        const left = new Graphics()
          .poly([0, 0, -len, dy - wid, -len * 0.75, dy + wid, 0, wid * 0.6])
          .fill({ color: w === 0 ? COLORS.fireMid : COLORS.fireEdge, alpha });
        left.position.set(-3, dy);
        c.addChild(left);
      }

      // 外焰
      const glow = new Graphics()
        .circle(0, 0, 15)
        .fill({ color: COLORS.fireEdge, alpha: 0.55 });
      c.addChild(glow);

      // 亮核
      const core = new Graphics()
        .circle(0, 0, 7)
        .fill({ color: COLORS.fireCore, alpha: 0.95 });
      c.addChild(core);

      c.visible = false;
      this.firebirdGfx.push(c);
      this.shotLayer.addChild(c);
    }
  }

  private buildCoinPool(): void {
    for (let i = 0; i < this.COIN_CAP; i++) {
      const g = new Graphics()
        .circle(0, 0, 5)
        .fill(COLORS.coin)
        .circle(0, -1, 2)
        .fill({ color: 0xfff6cf, alpha: 0.85 });
      g.visible = false;
      this.coinGfx.push(g);
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
    // 本体（实心圆，不带白色核心）
    //
    // 为什么去掉白核心：自机本体原来中心有个半径 2 的白点，
    // 而判定点半径是 2.6，两者几乎一样大。
    // 结果高速状态下玩家会误以为"判定点一直显示着"，
    // 反而失去了"按住 Shift 才能确认判定位置"的信号意义。
    // 判定点必须是低速时唯一出现的那个点。
    const body = new Graphics().circle(0, 0, 5).fill(COLORS.player);

    this.playerGfx = new Container() as unknown as Graphics;
    const pc = this.playerGfx as unknown as Container;
    pc.addChild(halo, body);

    // 判定点（低速时显示）
    //
    // 只画一个实心小圆，不画外圈。
    // 外圈会让人以为"圈的边缘才是判定边界"，从而误判自己的位置。
    // 判定点的作用恰恰是告诉玩家"你实际只有这么小一点"，
    // 所以视觉上必须是一个干净的点。
    this.hitboxGfx = new Graphics();
    this.hitboxGfx
      .circle(0, 0, 2.6)
      .fill({ color: 0xffffff, alpha: 1 });
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

    // 添加顺序即渲染层级（后加的在上层）。
    //
    // 判定点必须在自机本体**之后**添加，否则会被自机盖住看不见 ——
    // 这正是之前"按住 Shift 却看不到判定点"的原因。
    // 但它又要在无敌环与决死环之下，避免挡住那些提示。
    this.playerLayer.addChild(pc);
    this.playerLayer.addChild(this.hitboxGfx);
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

  /** 每帧同步一次 */
  /**
   * 初始化四幕背景。必须在 preload 之后调用。
   *
   * 背景层要插在 root 的**最底部**（场地边框之前），
   * 否则会盖住弹幕。用 addChildAt(0) 而不是 addChild。
   */
  async initBackdrop(): Promise<void> {
    const bd = new StageBackdrop();
    await bd.preload();
    bd.build();
    this.root.addChildAt(bd.root, 0);
    // 背景层在最底层，兜底底色必须让位
    if (this.fallbackBg) this.fallbackBg.visible = false;
    this.backdrop = bd;
  }

  /** 当前背景的远景纹理（供横版外框做两侧延伸） */
  get backdropFarTexture() {
    return this.backdrop?.farTexture ?? null;
  }

  /** 创建战斗框内的倒计时 Text（放在最上层） */
  initFieldTimer(): void {
    this.fieldTimerText = new Text({
      text: '',
      style: {
        fontFamily: 'Consolas, Menlo, monospace',
        fontSize: 30,
        fontWeight: '700',
        fill: 0xffd479,
        stroke: { color: 0x000000, width: 4 },
        dropShadow: { color: 0x000000, blur: 6, distance: 2, alpha: 0.9 },
      },
    });
    this.fieldTimerText.anchor.set(1, 0);   // 右上角对齐
    // 贴在战场右上角内侧
    this.fieldTimerText.position.set(FIELD_W - 14, 12);
    this.fieldTimerText.visible = false;
    this.root.addChild(this.fieldTimerText);
  }

  /**
   * 更新战斗框内倒计时。
   *
   * @param sec 剩余整秒；null 表示隐藏
   * @param warn 是否进入警告状态（变红）
   */
  setFieldTimer(sec: number | null, warn: boolean): void {
    if (!this.fieldTimerText) return;

    if (sec === null) {
      this.fieldTimerText.visible = false;
      this.lastTimerSec = -1;
      return;
    }

    this.fieldTimerText.visible = true;
    if (sec !== this.lastTimerSec) {
      this.lastTimerSec = sec;
      this.fieldTimerText.text = String(sec);
    }
    this.fieldTimerText.style.fill = warn ? 0xff4d5e : 0xffd479;
    // 警告时轻微放大脉动
    const k = warn ? 1 + 0.06 * Math.sin(performance.now() / 160) : 1;
    this.fieldTimerText.scale.set(k);
  }

  /** 切幕：换背景纹理 */
  setAct(act: number): void {
    this.backdrop?.setAct(act);
  }

  /**
   * 每帧推进背景滚动。
   * @param dt 距上一帧的秒数
   */
  updateBackdrop(dt: number): void {
    this.backdrop?.update(dt);
  }

  render(world: World): void {
    this.renderPlayer(world);
    this.renderShots(world);
    this.renderCoinDrops(world);
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

  /** 蜃銭掉落物 */
  private renderCoinDrops(world: World): void {
    const drops = world.coinDrops;
    const n = Math.min(drops.length, this.coinGfx.length);

    const t = performance.now() / 260;
    for (let i = 0; i < n; i++) {
      const d = drops[i]!;
      const g = this.coinGfx[i]!;
      g.visible = true;
      g.position.set(d.x, d.y);
      // 呼吸式闪动，提示可以捡
      const pulse = 1 + 0.18 * Math.sin(t + i * 1.3);
      g.scale.set(pulse);
      // 快消失时变淡
      g.alpha = d.life < 2 ? 0.35 + 0.35 * Math.sin(t * 4 + i) : 1;
    }

    for (let i = n; i < this.coinGfx.length; i++) {
      this.coinGfx[i]!.visible = false;
    }
  }

  private renderShots(world: World): void {
    const s = world.cardShots.shots;
    const f = s.field;

    let nNeedle = 0;
    let nOrb = 0;
    let nTalisman = 0;
    let nFirebird = 0;

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
      } else if (kind === PlayerShots.KIND_FIREBIRD) {
        const c = this.firebirdGfx[nFirebird++];
        if (!c) continue;
        c.visible = true;
        c.position.set(x, y);
        // 火鸟朝飞行方向（默认向上），带一点呼吸式脉动
        c.rotation = Math.atan2(f.vy[i]!, f.vx[i]!) + Math.PI / 2;
        const pulse = 1 + 0.09 * Math.sin(performance.now() / 70 + i);
        c.scale.set(pulse);
        c.alpha = 0.92 + 0.08 * Math.sin(performance.now() / 45 + i * 2);
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
    for (let i = nFirebird; i < this.firebirdGfx.length; i++) {
      this.firebirdGfx[i]!.visible = false;
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

  /**
   * canvas 内的 HUD 文字已全部下放到 DOM。
   *
   * 为什么改：新布局要求右侧图标栏、战场内左上信息条，
   * 这些用 DOM 画更合适（图标贴图、对齐、可访问性都更好），
   * 而 canvas 文字会和它们重叠。这里只保留一个空实现占位，
   * 将来若需要重新在 canvas 内画东西（如幕次横幅）也有地方落。
   */
  private renderHud(_world: World): void {
    void _world;
  }

  /** 画布尺寸（含缩放） */
  get canvasWidth(): number {
    return FIELD_W * this.scale;
  }

  get canvasHeight(): number {
    return FIELD_H * this.scale;
  }
}
