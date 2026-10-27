/**
 * P0 性能验证 demo
 *
 * 目的：实测「2000 颗子弹 + 渲染」在 Web 栈上的真实表现。
 * 这是整个技术选型的唯一未知量——如果这里顶不住，方案要重来。
 *
 * 验收方式：双击打开，看左上角数字，判断流畅还是卡顿。
 */

import { Application, Container, Graphics } from 'pixi.js';
import { BulletField } from './core/danmaku/bulletField';
import { SpatialGrid, naiveGrazeCheck } from './core/danmaku/spatialGrid';
import { Rng } from './core/rng';
import { FrameTimer, benchIntegrate } from './core/bench';

const W = 384 * 1.6;
const H = 448 * 1.6;

const PLAYER_BULLETS = 240;
const ENEMY_BULLETS_DEFAULT = 2000;

async function main() {
  const app = new Application();
  await app.init({
    width: W,
    height: H,
    background: '#0b0d18',
    antialias: false,
    preference: 'webgl',
  });

  document.getElementById('stage')!.appendChild(app.canvas);

  // ---------- 数据层 ----------
  const enemyField = new BulletField(4096);
  const playerField = new BulletField(1024);
  const rng = new Rng(20261026);

  let enemyCount = ENEMY_BULLETS_DEFAULT;

  function spawnEnemies(n: number) {
    enemyField.clear();
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const speed = rng.range(40, 140);
      enemyField.spawn(
        rng.range(0, W),
        rng.range(0, H),
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        4,
        1e9,
      );
    }
  }

  function spawnPlayers(n: number) {
    playerField.clear();
    for (let i = 0; i < n; i++) {
      playerField.spawn(
        rng.range(0, W),
        rng.range(0, H * 0.6),
        rng.range(-20, 20),
        rng.range(-120, -40),
        3,
        4,
      );
    }
  }

  spawnEnemies(enemyCount);
  spawnPlayers(PLAYER_BULLETS);

  // ---------- 渲染层 ----------
  const bulletLayer = new Container();
  app.stage.addChild(bulletLayer);

  // 复用同一批 Graphics：每帧只改位置，不重建对象
  const enemyGfx: Graphics[] = [];
  for (let i = 0; i < 4096; i++) {
    const g = new Graphics().circle(0, 0, 4).fill(0x6fd3ff);
    g.visible = false;
    enemyGfx.push(g);
    bulletLayer.addChild(g);
  }

  const playerGfx: Graphics[] = [];
  for (let i = 0; i < 1024; i++) {
    const g = new Graphics().circle(0, 0, 3).fill(0xffffff);
    g.visible = false;
    playerGfx.push(g);
    bulletLayer.addChild(g);
  }

  // 自机
  const player = new Graphics()
    .circle(0, 0, 6)
    .fill(0xff5f7e)
    .circle(0, 0, 2)
    .fill(0xffffff);
  player.position.set(W / 2, H * 0.82);
  app.stage.addChild(player);

  // ---------- 空间哈希 ----------
  const cellSize = 32;
  const grid = new SpatialGrid(W, H, cellSize, 4096);
  const queryBuf = new Int32Array(512);

  // ---------- 计时 ----------
  const logicTimer = new FrameTimer(600);
  const gridTimer = new FrameTimer(600);
  let useGrid = true;
  /** 是否真的消灭敌弹。默认关闭，保持压测量级恒定 */
  let actuallyKill = false;

  // ---------- HUD ----------
  const hud = document.getElementById('hud')!;
  const fpsEl = document.getElementById('fps')!;
  const bulletEl = document.getElementById('bullets')!;
  const logicEl = document.getElementById('logic')!;
  const gridEl = document.getElementById('grid')!;
  const hitEl = document.getElementById('hits')!;
  const modeEl = document.getElementById('mode')!;
  const benchEl = document.getElementById('bench')!;

  let lastTime = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let lastHits = 0;

  // ---------- 主循环 ----------
  app.ticker.add(() => {
    const now = performance.now();
    const frameMs = now - lastTime;
    lastTime = now;

    // FPS 统计（每 500ms 更新一次显示）
    fpsAccum += frameMs;
    fpsFrames++;
    if (fpsAccum >= 500) {
      const fps = (fpsFrames * 1000) / fpsAccum;
      fpsEl.textContent = fps.toFixed(1);
      fpsAccum = 0;
      fpsFrames = 0;
    }

    const dt = Math.min(frameMs / 1000, 1 / 30);

    // --- 逻辑：子弹积分 ---
    const t0 = performance.now();
    enemyField.integrate(dt);
    playerField.integrate(dt);

    // 出界循环（保持数量恒定，便于稳定压测）
    wrapField(enemyField, W, H);
    respawnPlayers(playerField, W, H);
    const logicMs = performance.now() - t0;
    logicTimer.push(logicMs);

    // --- 逻辑：消弹碰撞 ---
    //
    // 压测注意：默认【不真正消灭敌弹】，只统计命中次数。
    // 否则自机子弹会把敌弹打光（2000 → 185），压测量级不断衰减，
    // 测出来的帧率就没有意义了。
    // 想看真实消弹效果，按 E 键打开。
    const t1 = performance.now();
    if (useGrid) {
      grid.rebuild(enemyField.x, enemyField.y, enemyField.state, enemyField.scanLimit);
      let hits = 0;
      const { x, y, state } = playerField;
      for (let i = 0; i < playerField.scanLimit; i++) {
        if (state[i] !== 1) continue;
        const n = grid.queryNeighbors(x[i]!, y[i]!, queryBuf);
        for (let k = 0; k < n; k++) {
          const idx = queryBuf[k]!;
          if (enemyField.state[idx] !== 1) continue;
          const dx = x[i]! - enemyField.x[idx]!;
          const dy = y[i]! - enemyField.y[idx]!;
          if (dx * dx + dy * dy <= 49) {
            hits++;
            if (actuallyKill) enemyField.kill(idx);
          }
        }
      }
      lastHits = hits;
    } else {
      lastHits = naiveGrazeCheck(
        playerField.x, playerField.y, playerField.state, playerField.scanLimit,
        enemyField.x, enemyField.y, enemyField.state, enemyField.scanLimit,
        7,
      );
    }
    const gridMs = performance.now() - t1;
    gridTimer.push(gridMs);

    // 补足：如果开启了真实消弹，把数量补回目标值，保持压测量级恒定
    if (actuallyKill) {
      const deficit = enemyCount - enemyField.aliveCount;
      for (let i = 0; i < deficit; i++) {
        const a = rng.next() * Math.PI * 2;
        const speed = rng.range(40, 140);
        enemyField.spawn(
          rng.range(0, W), rng.range(0, H),
          Math.cos(a) * speed, Math.sin(a) * speed,
          4, 1e9,
        );
      }
    }

    // --- 渲染：同步位置到 Graphics ---
    syncGfx(enemyGfx, enemyField);
    syncGfx(playerGfx, playerField);

    // --- HUD ---
    bulletEl.textContent = String(enemyField.aliveCount);
    logicEl.textContent = logicTimer.avg().toFixed(2);
    gridEl.textContent = gridTimer.avg().toFixed(2);
    hitEl.textContent = String(lastHits);
    modeEl.textContent = (useGrid ? '空间哈希' : '朴素遍历') + (actuallyKill ? ' / 真实消弹' : '');

    // --- 自机跟随鼠标 ---
    const pointer = app.renderer.events.pointer;
    player.position.set(
      Math.max(8, Math.min(W - 8, pointer.global.x)),
      Math.max(8, Math.min(H - 8, pointer.global.y)),
    );
  });

  // ---------- 交互 ----------
  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'g':
        useGrid = !useGrid;
        break;
      case '1':
        enemyCount = 500;
        spawnEnemies(enemyCount);
        break;
      case '2':
        enemyCount = 1000;
        spawnEnemies(enemyCount);
        break;
      case '3':
        enemyCount = 2000;
        spawnEnemies(enemyCount);
        break;
      case '4':
        enemyCount = 3000;
        spawnEnemies(enemyCount);
        break;
      case '5':
        enemyCount = 4000;
        spawnEnemies(enemyCount);
        break;
      case 'r':
        logicTimer.reset();
        gridTimer.reset();
        spawnEnemies(enemyCount);
        spawnPlayers(PLAYER_BULLETS);
        break;
      case 'b':
        runPureBench();
        break;
      case 'e':
        actuallyKill = !actuallyKill;
        break;
      case 'h':
        hud.classList.toggle('hidden');
        break;
    }
  });

  // ---------- 纯逻辑基准（不渲染） ----------
  function runPureBench() {
    benchEl.textContent = '跑基准中…';
    // 让浏览器先画出这一帧
    setTimeout(() => {
      const rows: string[] = [];
      for (const n of [500, 1000, 2000, 3000, 4000]) {
        const r = benchIntegrate(n, 300, 90);
        rows.push(
          `${n} 颗：平均 ${r.avgMs.toFixed(2)}ms  P99 ${r.p99Ms.toFixed(2)}ms  ` +
          `最大 ${r.maxMs.toFixed(2)}ms  占预算 ${r.budgetPct.toFixed(0)}%`,
        );
      }
      benchEl.innerHTML = rows
        .map((r) => `<div>${r}</div>`)
        .join('');
    }, 50);
  }

  (window as unknown as { runPureBench: () => void }).runPureBench = runPureBench;
}

function wrapField(f: BulletField, w: number, h: number): void {
  const { x, y, state } = f;
  for (let i = 0; i < f.capacity; i++) {
    if (state[i] !== 1) continue;
    if (x[i]! < 0) x[i] = w;
    else if (x[i]! > w) x[i] = 0;
    if (y[i]! < 0) y[i] = h;
    else if (y[i]! > h) y[i] = 0;
  }
}

function respawnPlayers(f: BulletField, w: number, h: number): void {
  const { y, state } = f;
  const rng = new Rng(Math.floor(performance.now()) ^ 0x1234);
  for (let i = 0; i < f.capacity; i++) {
    if (state[i] !== 1) continue;
    if (y[i]! < -20) {
      f.kill(i);
      f.spawn(rng.range(0, w), h + 10, rng.range(-20, 20), rng.range(-160, -80), 3, 6);
    }
  }
}

function syncGfx(gfx: Graphics[], field: BulletField): void {
  const { x, y, state } = field;
  const n = gfx.length;
  for (let i = 0; i < n; i++) {
    const g = gfx[i]!;
    if (i < field.capacity && state[i] === 1) {
      g.visible = true;
      g.position.set(x[i]!, y[i]!);
    } else {
      g.visible = false;
    }
  }
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="color:#f66;padding:20px;font:13px monospace">启动失败：\n${String(err)}</pre>`;
});
