/**
 * 主程序：输入采集、渲染、HUD 与流程控制。
 *
 * 游戏逻辑全部在 World 内，这里只做三件事：
 *   1. 把键盘输入翻译成操作
 *   2. 每帧推进逻辑并渲染
 *   3. 同步 HUD 与弹窗
 */

import { Application } from 'pixi.js';
import { World } from './core/world';
import { FixedStep } from './core/loop';
import { Input } from './render/input';
import { GameRenderer } from './render/gameRenderer';
import { FrameStage } from './render/frameStage';
import { computeLayout } from './ui/layout';
import { HandUI } from './ui/handUI';
import { ShopUI } from './ui/shopUI';
import { DevConsole } from './ui/devConsole';
import { PileViewer } from './ui/pileViewer';
import { DeckOverlay } from './ui/deckOverlay';
import { PassiveSlotsUI } from './ui/passiveSlotsUI';

/**
 * 画面缩放（自适应全屏）。
 *
 * "对标标准全屏"：canvas 铺满整个窗口，
 * 战场按比例缩放后居中，两侧由背景延伸填满。
 *
 * 这样无论窗口多大，信息面板都贴在**屏幕左右边缘**，
 * 而不是像之前那样挤在战场两侧的一小块区域里。
 */

/** 战场逻辑宽度 */

/** 计算让战场刚好放进窗口的缩放倍数 */

async function main() {
  const L = computeLayout();

  const app = new Application();
  await app.init({
    // 铺满整个窗口
    width: L.vw,
    height: L.vh,
    background: '#05060c',
    antialias: false,
    preference: 'webgl',
    resizeTo: window,
  });

  const stageEl = document.getElementById('stage')!;
  stageEl.appendChild(app.canvas);

  // HUD 元素搬进 #stage。
  //
  // 为什么必须搬：canvas 在 #stage 里，而 #stage 是 position:relative
  // 会形成层叠上下文。留在 body 上的元素即使 z-index 更高，
  // 也可能被 canvas 盖住（field-timer 就踩过这个坑：DOM 存在、
  // 计算样式可见，但画面上看不到）。
  for (const id of ['hud-top', 'hud-stage']) {
    const el = document.getElementById(id);
    if (el) stageEl.appendChild(el);
  }

  const world = new World({ seed: 20261026 });
  const input = new Input();
  input.attach();

  const frame = new FrameStage();
  app.stage.addChild(frame.root);
  // 外框整体缩放，战场就在 frame.fieldHost 里
  frame.root.scale.set(L.scale);

  // 战场位置由 computeLayout 统一给出（按视口比例，不用固定像素）
  frame.root.position.set(L.fieldX, L.fieldY);

  /**
   * 按战场矩形摆放 DOM 元素。
   *
   * 竖直方向（自上而下）：
   *   战场
   *   灵力 / 符卡     ← 手牌区正上方
   *   手牌卡片
   *   手牌数量 / 状态
   *   牌堆按钮        ← 贴窗口底
   *
   * 全部用 fixed + 计算出的坐标，窗口缩放时重新算一次。
   */
  function syncLayout(): void {
    const v = computeLayout();
    const fBottom = v.fieldY + v.fieldH;

    // 灵力/符卡：紧贴战场底边
    const bl = document.getElementById('bottom-left');
    if (bl) {
      bl.style.top = `${fBottom + Math.round(6 * v.uiScale)}px`;
      bl.style.transformOrigin = 'top center';
      bl.style.fontSize = `${12 * v.uiScale}px`;
    }

    // 手牌区：灵力下方
    const hand = document.getElementById('hand-area');
    if (hand) {
      hand.style.top = `${fBottom + Math.round(46 * v.uiScale)}px`;
      hand.style.width = `${v.handW}px`;
    }

    // 手牌卡片整体缩放，跟随 uiScale
    document.documentElement.style.setProperty('--ui-scale', String(v.uiScale));

    /*
     * 两个牌堆按钮：贴在战斗框**左右两侧的外面**，与手牌同一水平带。
     *
     * 为什么不放在战斗框宽度内：手牌区占了中间 600px，
     * 按钮放在框内两侧仍会压到最左/最右的卡片。
     * 移到框外，左手边放弃牌堆、右手边放抽牌堆，互不干扰。
     */
    const bar = document.getElementById('pile-bar');
    if (bar) {
      const handTop = document.getElementById('hand-area')?.getBoundingClientRect().top;
      const rowY = handTop
        ? handTop
        : fBottom + Math.round(46 * v.uiScale);
      bar.style.left = '0';
      bar.style.width = '100vw';
      bar.style.top = `${Math.round(rowY + 40 * v.uiScale)}px`;
      bar.style.bottom = 'auto';
      bar.style.justifyContent = 'space-between';
      bar.style.paddingLeft = `${Math.round(24 * v.uiScale)}px`;
      bar.style.paddingRight = `${Math.round(24 * v.uiScale)}px`;
      bar.style.boxSizing = 'border-box';
    }

    // 卡组按钮：贴手牌数右侧
    const deckBtn = document.getElementById('deck-btn');
    if (deckBtn) {
      const handEl = document.getElementById('hand-area');
      const hr = handEl?.getBoundingClientRect();
      if (hr) {
        deckBtn.style.left = `${Math.round(hr.right + 10 * v.uiScale)}px`;
        deckBtn.style.top = `${Math.round(hr.top + 2 * v.uiScale)}px`;
      }
    }

    // 状态栏：贴在战场右缘外，垂直居中偏上
    const status = document.getElementById('top-status');
    if (status) {
      const gap = Math.round(28 * v.uiScale);
      status.style.left = `${v.fieldX + v.fieldW + gap}px`;
      status.style.right = 'auto';
      status.style.top = `${Math.round(v.fieldY + v.fieldH * 0.28)}px`;
    }
  }
  syncLayout();
  window.addEventListener('resize', syncLayout);

  const renderer = new GameRenderer(app, 1);
  frame.fieldHost.addChild(renderer.root);
  // 四幕背景需要先从 public/art 加载纹理
  await renderer.initBackdrop();
  renderer.initFieldTimer();
  // 两侧延伸铺满窗口剩余空间
  const farTex = renderer.backdropFarTexture;
  // 视口剩余宽度 / 2，再除以缩放 = 单侧逻辑宽度
  const sideLogical = (L.vw - L.fieldW) / 2 / L.scale;
  if (farTex) {
    frame.setEdgeSource(farTex, sideLogical);
    frame.buildFieldBorder();
  }
  const loop = new FixedStep();
  const handUI = new HandUI(document.getElementById('hand-area')!);

  const shopUI = new ShopUI(document.body, {
    onBuy: (index) => {
      const r = world.buyShopItem(index);
      if (!r.ok) {
        // 钱不够或已售出，给个短暂提示
        shopHint = r.reason === 'no_money' ? '蜃銭不足' : '无法购买';
        shopHintTimer = 1.6;
      }
    },
    onRemoveCard: (cardId) => {
      world.completeRemoveCard(cardId);
    },
    onLeave: () => {
      leaveShop();
    },
  });

  // 牌堆查看（右下角三个按钮）
  const pileViewer = new PileViewer(document.body);
  const deckOverlay = new DeckOverlay(document.body);
  const passiveUI = new PassiveSlotsUI(document.body);

  // 这些 UI 模块会把元素动态插进 body，必须等它们创建完再定位一次，
  // 否则 syncLayout 找不到 #pile-bar 等节点（早期就是因此漏掉了按钮定位）。
  syncLayout();

  // 卡组按钮（在手牌数右侧）也能打开卡组总览
  document.getElementById('deck-btn')?.addEventListener('click', () => {
    deckOverlay.toggle(
      world.deck.pile.allCards(),
      world.deck.passiveSlots,
      world.deck.passives.length,
    );
  });

  // 开发者控制台：按 ~ 打开
  let consoleOpen = false;
  const devConsole = new DevConsole(document.body, world, (open) => {
    consoleOpen = open;
  });

  window.addEventListener('keydown', (e) => {
    // 反引号键：不同键盘布局的 key 值可能是 ` 或 ~
    if (e.key === '`' || e.key === '~' || e.code === 'Backquote') {
      // 不能因为焦点在输入框里就跳过：
      // 控制台打开时焦点总在它自己的输入框上，那样就永远关不掉。
      // 只排除"其他"输入框（将来可能加搜索框之类）。
      const el = e.target as HTMLElement | null;
      const isConsoleInput = el?.id === 'dc-input';
      const inOtherInput = (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA')
        && !isConsoleInput;
      if (inOtherInput) return;
      e.preventDefault();
      devConsole.toggle();
    }
  });

  let shopHint = '';
  let shopHintTimer = 0;

  /** 离开商店并进入下一幕；最后一幕则结算 */
  function leaveShop(): void {
    const advanced = world.leaveShopAndAdvance();
    if (!advanced && world.phase === 'cleared') {
      syncOverlay();
    }
  }

  // 启动第一幕
  if (!world.startAct(0)) {
    console.error('关卡生成失败：', world.lastStageError);
  }

  // ---------- HUD ----------
  const hudKills = document.getElementById('kills')!;
  const hudScore = document.getElementById('score')!;
  const hudCoins = document.getElementById('coins')!;
  const hudLivesRow = document.getElementById('lives-row')!;
  const hudFps = document.getElementById('fps')!;
  const hudSpellRow = document.getElementById('spell-row')!;

  /**
   * 残机：东方正作式的星形，每台一个。
   * 不用"图标 + 数字"，因为一眼扫过就知道还剩几条命，
   * 比读数字快得多 —— 这是弹幕游戏里生死攸关的信息。
   */
  let lastLivesSig = '';
  function renderLives(lives: number): void {
    // 星数 = 残机数 - 1。
    //
    // 为什么：残机 0 时你还在场上打（那是最后一条命），
    // 所以 3 残机只该显示 2 颗星 —— 星星表示"还能死几次"。
    // 这和东方正作一致：★ 是备用的命，不是当前这条。
    const stars = Math.max(0, lives - 1);
    const sig = String(stars);
    if (sig === lastLivesSig) return;
    lastLivesSig = sig;

    hudLivesRow.innerHTML = '';
    for (let i = 0; i < stars; i++) {
      const d = document.createElement('div');
      d.className = 'life-star';
      hudLivesRow.appendChild(d);
    }
  }

  /**
   * 符卡：竖长符札形，已用掉的变暗但仍占位。
   * 同样不用数字 —— 符卡是稀缺资源，需要一眼看清还剩几张。
   */
  let lastSpellSig = '';
  function renderSpellSlots(cards: number): void {
    // 只画剩余的符卡，不保留空槽。
    //
    // 为什么：符卡在游戏过程中可以补充（买道具、被动效果），
    // 留空槽会让人以为"这些位置以后还能填"，但实际数量是浮动的。
    // 直接删掉用尽的，数量就是数量。
    const sig = String(cards);
    if (sig === lastSpellSig) return;
    lastSpellSig = sig;

    hudSpellRow.innerHTML = '';
    for (let i = 0; i < cards; i++) {
      const d = document.createElement('div');
      d.className = 'spell-tag';
      hudSpellRow.appendChild(d);
    }
  }
  /**
   * 灵力（能量）：用 energy_full/empty 素材排成一行菱形。
   * 素材本身就是参考图里那种「灵力」图标，直接复用。
   */
  let lastEnergySig = '';
  function renderEnergy(value: number, cap: number): void {
    const sig = `${value}/${cap}`;
    if (sig === lastEnergySig) return;
    lastEnergySig = sig;

    hudEnergyPips.innerHTML = '';
    for (let i = 0; i < cap; i++) {
      const img = document.createElement('img');
      img.src = i < value
        ? './art/ui/energy_full.png'
        : './art/ui/energy_empty.png';
      img.alt = '';
      hudEnergyPips.appendChild(img);
    }
  }

  const hudWave = document.getElementById('wave')!;
  const hudWaveBar = document.getElementById('wave-bar')!;
  const blStatus = document.getElementById('bl-status')!;
  let lastBlStatus = '';
  /** 上一次播放警告音时的整秒数，避免同一秒重复响 */
  let lastWarnSecond = -1;

  /**
   * 倒计时警告音。
   *
   * 用 WebAudio 现场合成，不依赖音频素材：
   * 一个短促的方波「嘀」，音量压得很低（0.06），
   * 只作为节奏提示，不该盖过玩家注意力。
   */
  let audioCtx: AudioContext | null = null;
  function playWarningBeep(): void {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext
          || (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
      }
      const ctx = audioCtx;
      if (ctx.state === 'suspended') void ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;

      // 极短包络，避免爆音
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.06, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    } catch {
      // 音频不可用（浏览器策略/无设备）时静默跳过，不影响游戏
    }
  }
  const hudActName = document.getElementById('act-name')!;
  const hudActBanner = document.getElementById('act-banner-img') as HTMLImageElement;
  const hudEnergyPips = document.getElementById('energy-pips')!;

  /** 四幕场景名（用于幕次横幅） */
  const ACT_SCENES = [
    '妖怪之山 · 流言',
    '塔内 · 影像',
    '塔内 · 伪真',
    '塔顶 · 剥落',
  ];

  // ---------- 续关 / 结算面板 ----------
  const overlay = document.getElementById('overlay')!;
  const overlayTitle = document.getElementById('overlay-title')!;
  const overlayStats = document.getElementById('overlay-stats')!;
  const btnContinue = document.getElementById('btn-continue')!;
  const btnGiveUp = document.getElementById('btn-giveup')!;

  let overlayShown = false;

  function syncOverlay(): void {
    const phase = world.phase;
    const shouldShow = phase === 'dead' || phase === 'cleared';

    if (shouldShow && !overlayShown) {
      overlayShown = true;
      overlay.classList.remove('hidden');
      if (phase === 'cleared') {
        overlayTitle.textContent = '结束';
        overlayStats.innerHTML =
          `得分 <b>${world.score}</b>　击破 <b>${world.kills}</b>` +
          `　蜃銭 <b>${world.coins}</b>`;
        btnContinue.textContent = '重新开始';
        btnContinue.dataset.action = 'restart';
        btnGiveUp.textContent = '关闭';
        btnGiveUp.dataset.action = 'close';
      } else {
        overlayTitle.textContent = '残机耗尽';
        overlayStats.innerHTML =
          `得分 <b>${world.score}</b>　击破 <b>${world.kills}</b>` +
          `<br>是否续关？`;
        btnContinue.textContent = '续关';
        btnContinue.dataset.action = 'continue';
        btnGiveUp.textContent = '放弃';
        btnGiveUp.dataset.action = 'giveup';
      }
    } else if (!shouldShow && overlayShown) {
      overlayShown = false;
      overlay.classList.add('hidden');
    }
  }

  function restart(): void {
    world.reset();
    world.startAct(0);
  }

  btnContinue.addEventListener('click', () => {
    const action = btnContinue.dataset.action;
    if (action === 'continue') world.doContinue();
    else if (action === 'restart') restart();
    syncOverlay();
  });

  btnGiveUp.addEventListener('click', () => {
    if (btnGiveUp.dataset.action === 'giveup') world.giveUp();
    else restart();
    syncOverlay();
  });

  window.addEventListener('keydown', (e) => {
    if (world.phase === 'shop') {
      // 商店里 Enter 直接离开（删卡待选时先进效删卡，不离开）
      if (e.key === 'Enter' && !world.pendingRemoveCard) {
        leaveShop();
        e.preventDefault();
      }
    } else if (world.phase === 'dead') {
      if (e.key === 'Enter') { btnContinue.click(); e.preventDefault(); }
      else if (e.key === 'Escape') { btnGiveUp.click(); e.preventDefault(); }
    } else if (world.phase === 'cleared') {
      if (e.key === 'Enter' || e.key === 'Escape') {
        btnContinue.click();
        e.preventDefault();
      }
    }
  });

  let fpsAcc = 0;
  let fpsFrames = 0;
  let lastT = performance.now();

  // ---------- 主循环 ----------
  app.ticker.add(() => {
    const now = performance.now();
    const realDt = (now - lastT) / 1000;
    lastT = now;

    fpsAcc += realDt;
    fpsFrames++;
    if (fpsAcc >= 0.4) {
      hudFps.textContent = (fpsFrames / fpsAcc).toFixed(0);
      fpsAcc = 0;
      fpsFrames = 0;
    }

    // 控制台打开时冻结游戏输入，避免打字时自机乱跑
    if (consoleOpen) {
      world.input = { dx: 0, dy: 0, focus: false };
      input.clearPressed();
      renderer.render(world);
      handUI.render(world.deck);
      syncOverlay();
      return;
    }

    // 输入 → 逻辑
    world.input = input.toInput();
    if (input.consume('x')) world.pressBomb();
    if (input.consume('c')) world.deck.cycleSelection();
    if (input.consume('z')) world.playSelectedCard();

    // 牌堆查看：E 抽牌堆 / Q 弃牌堆 / Tab 卡组总览
    if (input.consume('e')) {
      pileViewer.setAnchor('right');
      pileViewer.toggle('draw', world.deck.pile);
    }
    if (input.consume('q')) {
      pileViewer.setAnchor('left');
      pileViewer.toggle('discard', world.deck.pile);
    }
    if (input.consume('tab')) {
      deckOverlay.toggle(
        world.deck.pile.allCards(),
        world.deck.passiveSlots,
        world.deck.passives.length,
      );
    }

    input.clearPressed();

    // 固定步推进。卡组总览打开时暂停 —— 那是玩家做长期规划的时刻，
    // 需要完整注意力，不能边躲弹边看牌组。
    if (!deckOverlay.isOpen) {
      loop.advance(realDt, () => {
        world.step();
      });
    } else {
      lastT = performance.now();   // 避免关闭后一次性补很多帧
    }

    renderer.updateBackdrop(realDt);
    renderer.setAct(world.currentAct);
    renderer.render(world);
    handUI.render(world.deck);
    pileViewer.syncCounts(world.deck.pile);
    {
      const all = document.getElementById('pv-count-all');
      const total = world.deck.pile.totalCards;
      if (all && all.textContent !== String(total)) all.textContent = String(total);
    }

    // 灵力右侧的状态提示（满能量 / 过载停顿 / 下一点能量）
    {
      const e = world.deck.energy;
      let txt = '';
      let warn = false;
      if (world.deck.paused) {
        txt = `过载 · 停顿 ${world.deck.pauseLeft.toFixed(1)}s`;
        warn = true;
      } else if (e.full) {
        txt = '能量已满';
      } else {
        const remain = (1 - e.progress) * e.interval;
        txt = `下一点 ${remain.toFixed(1)}s`;
      }
      if (txt !== lastBlStatus) {
        lastBlStatus = txt;
        blStatus.textContent = txt;
        blStatus.classList.toggle('warn', warn);
      } else {
        blStatus.classList.toggle('warn', warn);
      }
    }
    passiveUI.render(world.deck.passives, world.deck.passiveSlots);

    // HUD
    hudKills.textContent = String(world.kills);
    hudScore.textContent = String(world.score);
    hudCoins.textContent = String(world.coins);
    renderLives(world.player.lives);
    renderSpellSlots(world.spell.cards);
    renderEnergy(world.deck.energy.value, world.deck.energy.cap);

    const wv = world.waves;
    const actNames = ['一', '二', '三', '四'];
    const actName = actNames[world.currentAct] ?? String(world.currentAct + 1);

    // 幕次横幅：换文案 + 换横幅图（四幕配色不同）
    const bannerText = `第${actName}幕　${ACT_SCENES[world.currentAct] ?? ''}`;
    if (hudActName.textContent !== bannerText) {
      hudActName.textContent = bannerText;
      const idx = Math.min(4, world.currentAct + 1);
      hudActBanner.src = `./art/ui/act_banner_${idx}.png`;
    }

    hudWave.textContent =
      wv.phase === 'running' ? `WAVE ${wv.currentWave} / ${wv.totalWaves}`
        : wv.phase === 'done' ? 'WAVE 完成'
          : wv.isPausedMidway ? 'WAVE 整备' : 'WAVE —';

    // 波次进度条（右侧状态栏里的细条，始终显示）
    if (wv.phase === 'running') {
      const remain = wv.waveRemainSeconds;
      const total = wv.currentWaveDef?.duration ?? 30;
      hudWaveBar.style.width = `${Math.max(0, Math.min(100, (1 - remain / total) * 100))}%`;
    } else {
      hudWaveBar.style.width = '0%';
    }

    /*
     * 战斗框内倒计时：只在两种情况下出现
     *   1. 道中/精英波，剩余 ≤ 10 秒（即将超时清场）
     *   2. BOSS / 道中 BOSS 波，全程显示
     *
     * 精确到 1 秒（向上取整），≤10 秒时变红并每秒响一声警告。
     * 常规波次不显示 —— 平时的战斗节奏不该被倒计时干扰。
     */
    const waveDef = wv.currentWaveDef;
    const isBossWave = waveDef?.kind === 'boss' || waveDef?.kind === 'midboss';
    const remainSec = wv.waveRemainSeconds;

    if (wv.phase === 'running' && waveDef) {
      const showTimer = isBossWave || remainSec <= 10;
      if (showTimer) {
        const sec = Math.max(0, Math.ceil(remainSec));
        const warn = remainSec <= 10;
        renderer.setFieldTimer(sec, warn);

        // 每秒一声警告（只在 ≤10 秒时）
        if (warn && sec !== lastWarnSecond) {
          lastWarnSecond = sec;
          playWarningBeep();
        }
      } else {
        renderer.setFieldTimer(null, false);
        lastWarnSecond = -1;
      }
    } else {
      renderer.setFieldTimer(null, false);
      lastWarnSecond = -1;
    }

    // ── 幕间商店 ──
    // 一幕打完后自动进入商店（只触发一次：enterShop 内部会拒绝重复进入）
    if (world.phase === 'playing' && world.actCleared) {
      world.enterShop();
    }

    if (shopHintTimer > 0) {
      shopHintTimer -= realDt;
      if (shopHintTimer <= 0) shopHint = '';
    }

    if (world.phase === 'shop') {
      shopUI.show(
        world.shop,
        world.coins,
        world.deck.pile.allCards(),
        world.pendingRemoveCard,
      );
      if (shopHint) {
        const hintEl = document.getElementById('shop-hint');
        if (hintEl) {
          hintEl.textContent = shopHint;
          hintEl.classList.add('warn');
        }
      }
    } else if (shopUI.isVisible) {
      shopUI.hide();
    }

    syncOverlay();
  });

  (window as unknown as { __world: World }).__world = world;
  (window as unknown as { __pixiApp: unknown }).__pixiApp = app;
  (window as unknown as { __frame: unknown }).__frame = frame;
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="color:#f66;padding:20px;font:13px monospace">启动失败：\n${String(err)}</pre>`;
});
