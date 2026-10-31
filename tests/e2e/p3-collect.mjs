/**
 * 验证吸取速度、自动收点、判定点可见性。
 * 运行：node tests/e2e/p3-collect.mjs
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

// ── 1. 判定点只在低速可见 ──
console.log('── 1. 判定点可见性 ──');

// 高速：不按 Shift。
// 注意必须用真实按键：主循环每帧都会用键盘状态覆盖 world.input，
// 直接改 world.input 会被立刻冲掉。
await page.keyboard.up('Shift');
await page.waitForTimeout(250);
const fastState = await page.evaluate(() => ({
  focusing: window.__world.player.focusing,
}));
console.log(`  高速（未按 Shift）：focusing = ${fastState.focusing}`);

// 低速：按住 Shift
await page.keyboard.down('Shift');
await page.waitForTimeout(250);
const slowState = await page.evaluate(() => ({
  focusing: window.__world.player.focusing,
}));
console.log(`  低速（按住 Shift）：focusing = ${slowState.focusing}`);
await page.keyboard.up('Shift');

const dotOk = !fastState.focusing && slowState.focusing;
console.log(`  ${dotOk ? '✓' : '✗'} 只有低速时判定点可见`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-17-focus.png') });

// ── 2. 吸取速度：高速移动不拖尾 ──
console.log('\n── 2. 高速移动时的吸取速度 ──');
const suction = await page.evaluate(async () => {
  const w = window.__world;
  w.input = { dx: 0, dy: 0, focus: false };
  w.coinDrops.length = 0;
  w.coins = 0;

  // 在自机右侧放一个金币
  w.coinDrops.push({
    x: w.player.x + 60, y: w.player.y, amount: 10,
    vx: 0, vy: 0, life: 99, collected: false, pickupDelay: 0,
  });

  // 自机持续向右跑
  w.input = { dx: 1, dy: 0, focus: false };

  let frames = 0;
  for (let i = 0; i < 60; i++) {
    w.step();
    frames++;
    if (w.coins > 0) break;
  }
  return { coins: w.coins, frames, dropsLeft: w.coinDrops.length };
});
console.log(`  ${suction.frames} 帧内捡到（${(suction.frames / 60).toFixed(2)} 秒）`);
const suctionOk = suction.coins > 0 && suction.frames < 20;
console.log(`  ${suctionOk ? '✓' : '✗'} 高速移动时金币能追上（不拖尾）`);

// ── 3. 自动收点 ──
console.log('\n── 3. 自动收点（自机到版顶 25% 内）──');
const autoCollect = await page.evaluate(async () => {
  const w = window.__world;
  w.coinDrops.length = 0;
  w.coins = 0;

  // 自机移到顶部
  w.player.x = 192;
  w.player.y = 448 * 0.15;   // 15% < 25%
  w.input = { dx: 0, dy: 0, focus: false };

  // 在远距离放几个金币（超出普通吸引半径 90）
  w.coinDrops.push({
    x: 40, y: 420, amount: 20, vx: 0, vy: 0,
    life: 99, collected: false, pickupDelay: 0,
  });
  w.coinDrops.push({
    x: 340, y: 400, amount: 20, vx: 0, vy: 0,
    life: 99, collected: false, pickupDelay: 0,
  });

  const before = w.coinDrops.length;

  for (let i = 0; i < 120; i++) {
    w.step();
    // 保持自机在顶部
    w.player.y = 448 * 0.15;
    if (w.coinDrops.length === 0) break;
  }

  return { before, coins: w.coins, left: w.coinDrops.length };
});
console.log(`  远处金币 ${autoCollect.before} 个 → 剩余 ${autoCollect.left} 个`);
console.log(`  收集到的蜃銭：${autoCollect.coins}`);
const autoOk = autoCollect.coins === 40 && autoCollect.left === 0;
console.log(`  ${autoOk ? '✓' : '✗'} 顶部自动收点生效`);

// ── 4. 不在顶部时不自动收 ──
console.log('\n── 4. 不在顶部时不自动收 ──');
const noAuto = await page.evaluate(async () => {
  const w = window.__world;
  w.coinDrops.length = 0;
  w.coins = 0;

  // 自机在下方
  w.player.x = 192;
  w.player.y = 448 * 0.8;
  w.input = { dx: 0, dy: 0, focus: false };

  // 远距离金币
  w.coinDrops.push({
    x: 40, y: 100, amount: 20, vx: 0, vy: 0,
    life: 99, collected: false, pickupDelay: 0,
  });

  for (let i = 0; i < 30; i++) {
    w.step();
    w.player.y = 448 * 0.8;
  }

  return { coins: w.coins, left: w.coinDrops.length };
});
console.log(`  远处金币仍剩 ${noAuto.left} 个，收到 ${noAuto.coins}`);
const noAutoOk = noAuto.coins === 0;
console.log(`  ${noAutoOk ? '✓' : '✗'} 不在顶部时不会被吸走`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  收点手感验收');
console.log('════════════════════════════════════');
const checks = [
  ['判定点只在低速可见', dotOk],
  ['高速移动不拖尾', suctionOk],
  ['顶部自动收点生效', autoOk],
  ['不在顶部时不自动收', noAutoOk],
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
