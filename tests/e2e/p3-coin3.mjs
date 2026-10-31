/**
 * 验证蜃銭竖直下落（无横向速度）。
 * 运行：node tests/e2e/p3-coin3.mjs
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

// ── 1. x 坐标恒定 ──
console.log('── 1. 下落时横向位置是否恒定 ──');
const trace = await page.evaluate(() => {
  const w = window.__world;
  w.coinDrops.length = 0;

  // 手放三个金币，位置互不相同
  for (const x of [100, 200, 300]) {
    w.coinDrops.push({
      x, y: 60, amount: 10, vx: 0, vy: 0,
      life: 99, collected: false, pickupDelay: 9999,
    });
  }

  const snaps = [];
  for (let i = 0; i < 90; i++) {
    w.step();
    if (i % 15 === 0) {
      snaps.push(w.coinDrops.map((c) => ({
        x: +c.x.toFixed(4),
        y: +c.y.toFixed(1),
      })));
    }
  }
  return snaps;
});

console.log('  各时刻的金币 (x, y)：');
for (let i = 0; i < trace.length; i++) {
  console.log(`    t=${i * 0.25}s  ${trace[i].map((c) => `(${c.x},${c.y})`).join('  ')}`);
}

// 每个金币的 x 应该在所有时刻完全相同
let xDrift = 0;
for (let col = 0; col < 3; col++) {
  const xs = trace.map((snap) => snap[col]?.x).filter((v) => v !== undefined);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  xDrift = Math.max(xDrift, maxX - minX);
}
console.log(`\n  最大横向漂移：${xDrift.toFixed(6)} px`);
const noDrift = xDrift < 0.0001;
console.log(`  ${noDrift ? '✓' : '✗'} 横向位置完全不变（纯竖直下落）`);

// ── 2. y 匀速 ──
console.log('\n── 2. 竖直方向是否匀速 ──');
const ys = trace.map((snap) => snap[0]?.y).filter((v) => v !== undefined);
const dy = [];
for (let i = 1; i < ys.length; i++) dy.push(+(ys[i] - ys[i - 1]).toFixed(3));
console.log(`  每 0.25 秒的位移：${dy.join(', ')}`);
const uniform = dy.every((d) => Math.abs(d - dy[0]) < 0.01);
console.log(`  ${uniform ? '✓' : '✗'} 匀速下落`);

// ── 3. 实际画面 ──
console.log('\n── 3. 实际画面 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.coinDrops.length = 0;
  w.spawnEnemy({ hp: 1, radius: 14, score: 100, coin: 60 }, 192, 110);
  w.step();
  w.pressBomb();
  w.step();
});
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-15-straight-a.png') });
console.log('  截图 1');

await page.waitForTimeout(900);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-16-straight-b.png') });
console.log('  截图 2');

const final = await page.evaluate(() => {
  const w = window.__world;
  return {
    count: w.coinDrops.length,
    xs: w.coinDrops.map((c) => Math.round(c.x)),
    ys: w.coinDrops.map((c) => Math.round(c.y)),
  };
});
console.log(`  剩余 ${final.count} 个`);
console.log(`  x: ${final.xs.join(',')}`);
console.log(`  y: ${final.ys.join(',')}`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  竖直下落验收');
console.log('════════════════════════════════════');
const checks = [
  ['横向位置完全不变', noDrift],
  ['竖直匀速下落', uniform],
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
