/**
 * 验证敌人进场修复。
 *
 * 运行：node tests/e2e/p3-enemy-entry.mjs
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

const readEnemies = () => page.evaluate(() => {
  const w = window.__world;
  return w.enemies.filter((e) => !e.dead).map((e) => ({
    y: Math.round(e.y),
    targetY: Math.round(e.targetY),
    x: Math.round(e.x),
  }));
});

// ── 1. 敌人会从场外移动到场内 ──
console.log('── 1. 敌人进场轨迹 ──');
const trace = [];
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(400);
  const es = await readEnemies();
  if (es.length > 0) {
    const minY = Math.min(...es.map((e) => e.y));
    trace.push(minY);
  }
}
console.log(`  敌人最小 y 坐标轨迹：${trace.join(' → ')}`);
const enteredField = trace.some((y) => y > 0);
console.log(`  ${enteredField ? '✓' : '✗'} 敌人已进入场内（y > 0）`);

// ── 2. 当前所有敌人都在场内 ──
console.log('\n── 2. 当前敌人位置 ──');
const now = await readEnemies();
console.log(`  场上 ${now.length} 个敌人`);
for (const e of now.slice(0, 5)) {
  const inside = e.y > 0 && e.y < 448;
  console.log(`    x=${e.x} y=${e.y} (目标 ${e.targetY}) ${inside ? '场内' : '场外'}`);
}
const allInside = now.length > 0 && now.every((e) => e.y > 0 && e.y < 448);
console.log(`  ${allInside ? '✓' : '✗'} 所有敌人都在场内`);

// ── 3. 敌人最终会到达目标位置 ──
console.log('\n── 3. 敌人是否停在目标位置 ──');
await page.waitForTimeout(2000);
const settled = await readEnemies();
let nearTarget = 0;
for (const e of settled) {
  if (Math.abs(e.y - e.targetY) < 30) nearTarget++;
}
console.log(`  ${settled.length} 个敌人中 ${nearTarget} 个接近目标位置`);
const settleOk = settled.length > 0 && nearTarget > 0;
console.log(`  ${settleOk ? '✓' : '✗'} 敌人会停在目标位置`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-03-enemies-in-field.png') });

// ── 4. 能打出弹幕（说明敌人真的在场上工作）──
console.log('\n── 4. 敌人是否在开火 ──');
const bullets = await page.evaluate(() => window.__world.enemyBullets.aliveCount);
console.log(`  场上敌弹 ${bullets} 颗`);
const firingOk = bullets > 0;
console.log(`  ${firingOk ? '✓' : '✗'} 敌人正在发射弹幕`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  敌人进场验收');
console.log('════════════════════════════════════');
const checks = [
  ['敌人从场外进入场内', enteredField],
  ['当前所有敌人都在场内', allInside],
  ['敌人停在目标位置', settleOk],
  ['敌人正在开火', firingOk],
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
