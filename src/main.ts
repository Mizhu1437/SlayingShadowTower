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
import { FrameStage, FRAME_W, FIELD_H as FH } from './render/frameStage';
import { HandUI } from './ui/handUI';
import { ShopUI } from './ui/shopUI';
import { DevConsole } from './ui/devConsole';
import { PileViewer } from './ui/pileViewer';
import { DeckOverlay } from './ui/deckOverlay';
import { PassiveSlotsUI } from './ui/passiveSlotsUI';

/**
 * 画面缩放。
 *
 * 从 1.6 降到 1.35：横版布局下画布宽 684 逻辑像素，
 * 1.6 倍是 1094，加上两侧各 168 的面板就是 1430，
 * 在 1400 宽窗口里会挤出屏幕。
 * 1.35 倍得到 923，加面板 1251，1600×900 常见分辨率下放得开。
 */
const SCALE = 1.35;

async function main() {
  const app = new Application();
  await app.init({
    // 横版画面：战场 384 + 两侧各 150，共 684 逻辑宽
    width: FRAME_W * SCALE,
    height: FH * SCALE,
    background: '#05060c',
    antialias: false,
    preference: 'webgl',
  });

  const stageEl = document.getElementById('stage')!;
  stageEl.appendChild(app.canvas);

  // 把 HUD 元素搬进 #stage，这样它们的 absolute 定位能对齐画布。
  // 留在 body 上会跑到页面角落，和战场错位。
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
  frame.root.scale.set(SCALE);

  const renderer = new GameRenderer(app, 1);
  frame.fieldHost.addChild(renderer.root);
  // 四幕背景需要先从 public/art 加载纹理
  await renderer.initBackdrop();
  // 用背景近景的边缘生成两侧虚化延伸，让横版画面连成一片
  const farTex = renderer.backdropFarTexture;
  if (farTex) {
    frame.setEdgeSource(farTex);
    frame.buildFieldBorder();
  }
  const loop = new FixedStep();
  const handUI = new HandUI(document.getElementById('hand-area')!);

  // 操作提示折叠
  const helpEl = document.getElementById('help');
  document.getElementById('help-toggle')?.addEventListener('click', () => {
    helpEl?.classList.toggle('collapsed');
  });

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
  const hudWave = document.getElementById('wave')!;
  const hudAct = document.getElementById('act')!;
  const hudTimer = document.getElementById('wave-timer')!;

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
    if (input.consume('e')) pileViewer.toggle('draw', world.deck.pile);
    if (input.consume('q')) pileViewer.toggle('discard', world.deck.pile);
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
    passiveUI.render(world.deck.passives, world.deck.passiveSlots);

    // HUD
    hudKills.textContent = String(world.kills);
    hudScore.textContent = String(world.score);
    hudCoins.textContent = String(world.coins);
    renderLives(world.player.lives);
    renderSpellSlots(world.spell.cards);

    const wv = world.waves;
    const actNames = ['一', '二', '三', '四'];
    hudAct.textContent = actNames[world.currentAct] ?? String(world.currentAct + 1);
    hudWave.textContent =
      wv.phase === 'running' ? `${wv.currentWave}/${wv.totalWaves}`
        : wv.phase === 'done' ? '完成'
          : wv.isPausedMidway ? '整备' : '—';

    // 本波倒计时。剩余不足 10 秒时变红，提示即将超时清场。
    if (wv.phase === 'running') {
      const remain = wv.waveRemainSeconds;
      hudTimer.textContent = `${remain.toFixed(1)}s`;
      hudTimer.classList.toggle('urgent', remain <= 10 && remain > 0);
    } else {
      hudTimer.textContent = '—';
      hudTimer.classList.remove('urgent');
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
