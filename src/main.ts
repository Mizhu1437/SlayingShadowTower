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

  const world = new World({ seed: 20261026 });
  const input = new Input();
  input.attach();

  const renderer = new GameRenderer(app, SCALE);
  const loop = new FixedStep();
  const handUI = new HandUI(document.getElementById('hand-area')!);

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
  const hudSpell = document.getElementById('spell')!;
  const hudWave = document.getElementById('wave')!;

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
    if (world.phase === 'dead') {
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

    renderer.render(world);
    handUI.render(world.deck);

    // HUD
    hudKills.textContent = String(world.kills);
    hudScore.textContent = String(world.score);
    hudCoins.textContent = String(world.coins);
    hudLives.textContent = String(world.player.lives);
    hudSpell.textContent = String(world.spell.cards);

    const wv = world.waves;
    hudWave.textContent =
      wv.phase === 'running' ? `${wv.currentWave}/${wv.totalWaves}`
        : wv.phase === 'done' ? '完成'
          : '—';

    syncOverlay();
  });

  (window as unknown as { __world: World }).__world = world;
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="color:#f66;padding:20px;font:13px monospace">启动失败：\n${String(err)}</pre>`;
});
