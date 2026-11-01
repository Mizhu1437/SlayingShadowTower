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

await page.evaluate(() => {
  const w = window.__world;
  w.debugClearAct();
  w.coins = 5000;
});
await page.waitForTimeout(1200);

const checks = [];

// ── 1. 点买卡 ──
console.log('── 1. 点击购买卡牌 ──');
let before = await page.evaluate(() => ({
  coins: window.__world.coins,
  cards: window.__world.deck.pile.totalCards,
  passives: window.__world.deck.passives.length,
}));
await page.click('.shop-item >> nth=0');
await page.waitForTimeout(600);
let after = await page.evaluate(() => ({
  coins: window.__world.coins,
  cards: window.__world.deck.pile.totalCards,
  passives: window.__world.deck.passives.length,
  sold: window.__world.shop.state.items.filter((i) => i.sold).length,
}));
console.log(`  蜃銭 ${before.coins} → ${after.coins}`);
console.log(`  牌组 ${before.cards} → ${after.cards}`);
console.log(`  被动 ${before.passives} → ${after.passives}`);
console.log(`  售出 ${after.sold} 件`);
checks.push(['点击买卡', after.coins < before.coins && after.sold === 1]);

// ── 2. 点买命 ──
console.log('\n── 2. 点击购买残机 ──');
const lifeIdx = await page.evaluate(() =>
  window.__world.shop.state.items.findIndex((i) => i.kind === 'heal_life'));
const livesBefore = await page.evaluate(() => window.__world.player.lives);
await page.click(`.shop-item >> nth=${lifeIdx}`);
await page.waitForTimeout(600);
const livesAfter = await page.evaluate(() => window.__world.player.lives);
console.log(`  残机 ${livesBefore} → ${livesAfter}`);
checks.push(['点击买残机', livesAfter === livesBefore + 1]);

// ── 3. 点删卡，然后选一张卡删掉 ──
console.log('\n── 3. 删卡流程 ──');
const removeIdx = await page.evaluate(() =>
  window.__world.shop.state.items.findIndex((i) => i.kind === 'remove_card'));
const cardsBefore = await page.evaluate(() => window.__world.deck.pile.totalCards);
await page.click(`.shop-item >> nth=${removeIdx}`);
await page.waitForTimeout(700);

const pending = await page.evaluate(() => window.__world.pendingRemoveCard);
console.log(`  待选状态：${pending}`);

const removePanelVisible = await page.$eval('#shop-remove', (el) =>
  !el.classList.contains('hidden')).catch(() => 'no-el');
console.log(`  删卡面板可见：${removePanelVisible}`);

const removeBtnCount = await page.$$eval('.shop-remove-item', (els) => els.length);
console.log(`  可选卡牌数：${removeBtnCount}`);

if (removeBtnCount > 0) {
  await page.click('.shop-remove-item >> nth=0');
  await page.waitForTimeout(700);
  const cardsAfter = await page.evaluate(() => window.__world.deck.pile.totalCards);
  const pendingAfter = await page.evaluate(() => window.__world.pendingRemoveCard);
  console.log(`  牌组 ${cardsBefore} → ${cardsAfter}`);
  console.log(`  待选状态：${pendingAfter}`);
  checks.push(['删卡生效', cardsAfter === cardsBefore - 1 && !pendingAfter]);
} else {
  checks.push(['删卡生效', false]);
}

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-25-shop-work.png') });

// ── 4. 点离开按钮 ──
console.log('\n── 4. 点击离开商店 ──');
const actBefore = await page.evaluate(() => window.__world.currentAct);
await page.click('#shop-leave');
await page.waitForTimeout(1200);
const afterLeave = await page.evaluate(() => ({
  phase: window.__world.phase,
  act: window.__world.currentAct,
}));
console.log(`  阶段：${afterLeave.phase}，幕 ${actBefore + 1} → ${afterLeave.act + 1}`);
checks.push(['离开商店', afterLeave.phase === 'playing' && afterLeave.act === actBefore + 1]);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  商店界面验收');
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
