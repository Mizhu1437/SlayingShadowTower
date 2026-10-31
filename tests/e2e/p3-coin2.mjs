/**
 * 验证蜃銭匀速下落。
 * 运行：node tests/e2e/p3-coin2.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, '../../docs/shots');
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 940 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.card', { timeout: 10000 });
console.log('✓ 页面已加载\n');

// ── 1. 匀速验证：逐帧记录位移 ──
console.log('── 1. 是否匀速（每帧位移应相等）──');
const uniform = await page.evaluate(() => {
  const w = window.__world;
  w.coinDrops.length = 0;
  w.coinDrops.push({
    x: 200, y: 50, amount: 10, vx: 0, vy: 0,
    life: 99, collected: false, pickupDelay: 999,  // 冷却拉长，防止被捡
  });

  const ys = [];
  for (let i = 0; i < 60; i++) {
    w.step();
    const d = w.coinDrops[0];
    if (!d) break;
    ys.push(d.y);
  }

  // 逐帧位移
  const deltas = [];
  for (let i = 1; i < ys.length; i++) {
    deltas.push(ys[i] - ys[i - 1]);
  }
  return { ys: ys.slice(0, 6).map((y) => +y.toFixed(3)), deltas: deltas.slice(0, 8).map((d) => +d.toFixed(4)) };
});
console.log(`  y 前几帧：${uniform.ys.join(', ')}`);
console.log(`  逐帧位移：${uniform.deltas.join(', ')}`);

const allSame = uniform.deltas.every(
  (d) => Math.abs(d - uniform.deltas[0]) < 0.001,
);
console.log(`  ${allSame ? '✓' : '✗'} 每帧位移完全相等（匀速）`);

// ── 2. 落出底部消失 ──
console.log('\n── 2. 落出场地底部后消失 ──');
const fallOut = await page.evaluate(() => {
  const w = window.__world;
  w.coinDrops.length = 0;

  // 从场地中部开始
  w.coinDrops.push({
    x: 200, y: 200, amount: 10, vx: 0, vy: 0,
    life: 99, collected: false, pickupDelay: 9999,
  });

  const trace = [];
  let frames = 0;
  for (let i = 0; i < 600; i++) {
    w.step();
    frames++;
    if (i % 60 === 0) {
      const d = w.coinDrops[0];
      trace.push(d ? Math.round(d.y) : 'gone');
    }
    if (w.coinDrops.length === 0) break;
  }

  return { trace, frames, gone: w.coinDrops.length === 0 };
});
console.log(`  y 轨迹（每秒采样）：${fallOut.trace.join(' → ')}`);
console.log(`  消失用时 ${(fallOut.frames / 60).toFixed(1)} 秒`);
console.log(`  ${fallOut.gone ? '✓' : '✗'} 落出底部后消失`);

// ── 3. 理论落底时间 ──
const fallSpeed = await page.evaluate(() => window.__world.constructor);
console.log('\n── 3. 落底时间是否合理 ──');
// (448-200)/70 ≈ 3.5 秒
const expectedSec = (448 - 200) / 70;
console.log(`  理论值 (448-200)/70 = ${expectedSec.toFixed(1)} 秒`);
const timeOk = Math.abs(fallOut.frames / 60 - expectedSec) < 0.3;
console.log(`  ${timeOk ? '✓' : '✗'} 与理论值一致`);

// ── 4. 实际画面 ──
console.log('\n── 4. 实际画面 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.coinDrops.length = 0;
  // 在敌人位置爆一堆钱
  w.spawnEnemy({ hp: 1, radius: 14, score: 100, coin: 50 }, 192, 120);
  w.step();
  w.pressBomb();
  w.step();
});
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-13-coinfall-a.png') });
console.log('  截图 1（刚爆出）');

await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-14-coinfall-b.png') });
console.log('  截图 2（下落中）');

const state = await page.evaluate(() => {
  const w = window.__world;
  return {
    drops: w.coinDrops.length,
    ys: w.coinDrops.map((c) => Math.round(c.y)),
    coins: w.coins,
  };
});
console.log(`  当前 ${state.drops} 个掉落物，y=${state.ys.join(',')}`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  匀速下落验收');
console.log('════════════════════════════════════');
const checks = [
  ['每帧位移相等（匀速）', allSame],
  ['落出底部后消失', fallOut.gone],
  ['落底时间符合理论值', timeOk],
];
let pass = 0;
for (const [n, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${n}`);
  if (ok) pass++;
}
console.log(`\n  ${pass}/${checks.length} 项通过`);

if (errors.length) {
  console.log('\n⚠ 控制台错误：');
  for (const e of errors.slice(0, 6)) console.log('  ' + e);
} else {
  console.log('\n✓ 无控制台错误');
}

await browser.close();
process.exit(pass === checks.length && errors.length === 0 ? 0 : 1);
