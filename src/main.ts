/**
 * 主程序：输入采集、渲染、HUD 与流程控制。
 *
 * 游戏逻辑全部在 World 内，这里只做三件事：
 *   1. 把键盘输入翻译成操作
 *   2. 每帧推进逻辑并渲染
 *   3. 同步 HUD 与弹窗
 */

import { Application } from 'pixi.js';
import { World, FIELD_W, FIELD_H } from './core/world';
import { FixedStep } from './core/loop';
import { Input } from './render/input';
import { GameRenderer } from './render/gameRenderer';
import { HandUI } from './ui/handUI';
import { ShopUI } from './ui/shopUI';
import { DevConsole } from './ui/devConsole';
import { PileViewer } from './ui/pileViewer';

const SCALE = 1.6;

async function main() {
  const app = new Application();
  await app.init({
    width: FIELD_W * SCALE,
    height: FIELD_H * SCALE,
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

  const renderer = new GameRenderer(app, SCALE);
  // 四幕背景需要先从 public/art 加载纹理
  await renderer.initBackdrop();
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
  const hudLives = document.getElementById('lives')!;
  const hudFps = document.getElementById('fps')!;
  const hudSpellSlots = document.getElementById('spell-slots')!;

  /**
   * 渲染符卡槽：每格一张图，满/空切换。
   * 只在数量变化时重建，避免每帧重排 DOM。
   */
  let lastSpellSig = '';
  function renderSpellSlots(cards: number, limit: number): void {
    const sig = `${cards}/${limit}`;
    if (sig === lastSpellSig) return;
    lastSpellSig = sig;

    hudSpellSlots.innerHTML = '';
    for (let i = 0; i < limit; i++) {
      const img = document.createElement('img');
      img.className = 'hud-spell-slot' + (i < cards ? '' : ' empty');
      img.src = i < cards ? '/art/ui/spell_full.png' : '/art/ui/spell_empty.png';
      img.alt = '';
      hudSpellSlots.appendChild(img);
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
    input.clearPressed();

    // 固定步推进
    loop.advance(realDt, () => {
      world.step();
    });

    renderer.updateBackdrop(realDt);
    renderer.setAct(world.currentAct);
    renderer.render(world);
    handUI.render(world.deck);
    pileViewer.syncCounts(world.deck.pile);

    // HUD
    hudKills.textContent = String(world.kills);
    hudScore.textContent = String(world.score);
    hudCoins.textContent = String(world.coins);
    hudLives.textContent = String(world.player.lives);
    renderSpellSlots(world.spell.cards, world.spell.cardsLimit);

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
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="color:#f66;padding:20px;font:13px monospace">启动失败：\n${String(err)}</pre>`;
});
