/**
 * 验证倒计时显示与牌堆面板实时更新。
 * 运行：node tests/e2e/p3-liveui.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, '../../docs/shots');
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 980 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.card');
console.log('✓ 页面已加载\n');

const checks = [];

// 开无敌，避免自机被打死导致游戏暂停
await page.evaluate(() => window.__world.debug.set('invincible', true));

// ── 1. HUD 倒计时 ──
console.log('── 1. HUD 倒计时显示 ──');
const t0 = await page.$eval('#wave-timer', (el) => el.textContent);
console.log(`  初始显示：${t0}`);

await page.waitForTimeout(2200);
const t1 = await page.$eval('#wave-timer', (el) => el.textContent);
console.log(`  2 秒后：${t1}`);

const hasTimer = /\d+\.\d+s/.test(t0 ?? '');
const counting = parseFloat(t1) < parseFloat(t0);
console.log(`  ${hasTimer ? '✓' : '✗'} 显示为秒数格式`);
console.log(`  ${counting ? '✓' : '✗'} 数字在递减`);
checks.push(['HUD 显示倒计时', hasTimer]);
checks.push(['倒计时实时递减', counting]);

// ── 2. 倒计时低位变红 ──
console.log('\n── 2. 剩余 10 秒内变红 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.debugJumpToWave(0, 1);
  // 快进到剩余约 8 秒
  for (let i = 0; i < 60 * 22; i++) w.step();
});
await page.waitForTimeout(400);
const timerState = await page.$eval('#wave-timer', (el) => ({
  text: el.textContent,
  urgent: el.classList.contains('urgent'),
  color: getComputedStyle(el).color,
}));
console.log(`  显示 ${timerState.text}，urgent=${timerState.urgent}，颜色=${timerState.color}`);
checks.push(['低位变红提示', timerState.urgent]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-29-timer.png') });

// ── 3. 牌堆面板实时更新 ──
console.log('\n── 3. 牌堆面板实时更新 ──');
await page.click('.pv-btn[data-tab="draw"]');
await page.waitForTimeout(300);

const before = await page.$eval('#pv-title', (el) => el.textContent);
console.log(`  打开时：${before}`);

// 抽一张牌，牌堆应该减少
const changed = await page.evaluate(async () => {
  const w = window.__world;
  const beforeCount = w.deck.pile.drawCount;
  w.debugDraw(1);
  const afterCount = w.deck.pile.drawCount;
  await new Promise((r) => setTimeout(r, 400));
  return { beforeCount, afterCount };
});
await page.waitForTimeout(500);
const after = await page.$eval('#pv-title', (el) => el.textContent);
console.log(`  抽牌后（${changed.beforeCount} → ${changed.afterCount}）：${after}`);
const updated = before !== after;
console.log(`  ${updated ? '✓' : '✗'} 面板标题实时更新`);
checks.push(['面板标题实时更新', updated]);

// ── 4. 弃牌堆也会实时更新 ──
console.log('\n── 4. 切到弃牌堆后弃一张牌 ──');
await page.click('.pv-btn[data-tab="discard"]');
await page.waitForTimeout(300);
const discardBefore = await page.$eval('#pv-title', (el) => el.textContent);
console.log(`  切换时：${discardBefore}`);

await page.evaluate(async () => {
  const w = window.__world;
  w.debugDiscard(0);
  await new Promise((r) => setTimeout(r, 400));
});
await page.waitForTimeout(500);
const discardAfter = await page.$eval('#pv-title', (el) => el.textContent);
console.log(`  弃牌后：${discardAfter}`);
const discardUpdated = discardBefore !== discardAfter;
console.log(`  ${discardUpdated ? '✓' : '✗'} 弃牌堆实时更新`);
checks.push(['弃牌堆实时更新', discardUpdated]);

// ── 5. 卡牌列表内容也更新 ──
console.log('\n── 5. 列表内容同步 ──');
await page.click('.pv-btn[data-tab="all"]');
await page.waitForTimeout(300);
const listBefore = await page.$$eval('.pv-card .pv-name', (els) =>
  els.map((e) => e.textContent));

await page.evaluate(async () => {
  const w = window.__world;
  // 往牌组加一张新卡
  w.deck.pile.addCard({
    id: 'test_new_card', name: '测试新卡', type: 'active',
    rarity: 'common', price: 1, energy: 1,
    effects: [{ op: 'gain_coin', value: 1 }],
  });
  await new Promise((r) => setTimeout(r, 400));
});
await page.waitForTimeout(500);
const listAfter = await page.$$eval('.pv-card .pv-name', (els) =>
  els.map((e) => e.textContent));

console.log(`  加卡前 ${listBefore.length} 种，加卡后 ${listAfter.length} 种`);
const listUpdated = listAfter.some((n) => n?.includes('测试新卡'));
console.log(`  ${listUpdated ? '✓' : '✗'} 新卡出现在列表中`);
checks.push(['列表内容同步', listUpdated]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-30-pilelive.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  倒计时与牌堆面板验收');
console.log('════════════════════════════════════');
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
