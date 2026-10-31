/**
 * 验证蜃銭的下落与怪物爆钱。
 * 运行：node tests/e2e/p3-coin.mjs
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

// ── 1. 怪物死亡爆钱 ──
console.log('── 1. 怪物死亡爆钱（不再直接加数字）──');
const killResult = await page.evaluate(() => {
  const w = window.__world;
  w.coinDrops.length = 0;

  // 放一个敌人
  w.spawnEnemy({ hp: 1, radius: 14, score: 300, coin: 40 }, 192, 150);
  w.step();

  const coinsBefore = w.coins;
  const dropsBefore = w.coinDrops.length;

  // 用符卡击杀
  w.pressBomb();
  w.step();

  return {
    coinsBefore,
    coinsAfter: w.coins,
    dropsBefore,
    dropsAfter: w.coinDrops.length,
    dropTotal: w.coinDrops.reduce((s, c) => s + c.amount, 0),
    score: w.score,
  };
});
console.log(`  蜃銭数字 ${killResult.coinsBefore} → ${killResult.coinsAfter}（应不变）`);
console.log(`  掉落物 ${killResult.dropsBefore} → ${killResult.dropsAfter} 个，总额 ${killResult.dropTotal}`);
const noDirectAdd = killResult.coinsAfter === killResult.coinsBefore;
const hasDrops = killResult.dropsAfter > 0;
console.log(`  ${noDirectAdd ? '✓' : '✗'} 钱没有直接加进数字`);
console.log(`  ${hasDrops ? '✓' : '✗'} 爆出了实体掉落物`);

// ── 2. 金币会下落 ──
console.log('\n── 2. 蜃銭受重力下落 ──');
const yTrace = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(120);
  const ys = await page.evaluate(() =>
    window.__world.coinDrops.filter((c) => !c.collected).map((c) => Math.round(c.y)),
  );
  if (ys.length > 0) yTrace.push(Math.round(ys.reduce((a, b) => a + b, 0) / ys.length));
}
console.log(`  平均 y 轨迹：${yTrace.join(' → ')}`);

let descended = 0;
for (let i = 1; i < yTrace.length; i++) {
  if (yTrace[i] > yTrace[i - 1]) descended++;
}
console.log(`  下落次数 ${descended}/${yTrace.length - 1}`);
const falls = descended >= Math.floor((yTrace.length - 1) * 0.6);
console.log(`  ${falls ? '✓' : '✗'} 金币向下落`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-12-coinfall.png') });

// ── 3. 落地停住 ──
console.log('\n── 3. 落地后停住 ──');
await page.waitForTimeout(2500);
const resting = await page.evaluate(() => {
  const w = window.__world;
  const drops = w.coinDrops.filter((c) => !c.collected);
  return {
    count: drops.length,
    ys: drops.map((c) => Math.round(c.y)),
    fieldH: 448,
    vy: drops.map((c) => Math.round(c.vy)),
  };
});
console.log(`  剩余 ${resting.count} 个，y 值：${resting.ys.join(',')}`);
console.log(`  竖直速度：${resting.vy.join(',')}`);
const onFloor = resting.ys.filter((y) => y > resting.fieldH - 40).length;
console.log(`  ${onFloor > 0 ? '✓' : '✗'} 有金币落到底部区域（${onFloor}/${resting.count}）`);

// ── 4. 能捡起来 ──
console.log('\n── 4. 捡起金币 ──');
const pickup = await page.evaluate(async () => {
  const w = window.__world;
  const before = w.coins;
  const beforeCount = w.coinDrops.length;

  // 把自机挪到最近的掉落物上
  if (w.coinDrops.length > 0) {
    const d = w.coinDrops[0];
    w.player.x = d.x;
    w.player.y = d.y;
  }

  for (let i = 0; i < 240 && w.coinDrops.length > 0; i++) {
    const d = w.coinDrops[0];
    if (d) {
      w.player.x = d.x;
      w.player.y = d.y;
    }
    w.step();
  }

  return {
    before,
    after: w.coins,
    beforeCount,
    afterCount: w.coinDrops.length,
  };
});
console.log(`  蜃銭 ${pickup.before} → ${pickup.after}`);
console.log(`  掉落物 ${pickup.beforeCount} → ${pickup.afterCount}`);
const picked = pickup.after > pickup.before;
console.log(`  ${picked ? '✓' : '✗'} 能捡起并计入数字`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  蜃銭掉落验收');
console.log('════════════════════════════════════');
const checks = [
  ['怪物死亡爆钱而非直接加数字', noDirectAdd && hasDrops],
  ['金币受重力下落', falls],
  ['落地后停住', onFloor > 0],
  ['能捡起并计入数字', picked],
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
