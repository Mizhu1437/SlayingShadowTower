/**
 * 验证商店显示耗能 + 买卡跨幕保留。
 * 运行：node tests/e2e/p3-shopcard.mjs
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

// 进商店
await page.evaluate(() => {
  const w = window.__world;
  w.debugClearAct();
  w.coins = 5000;
});
await page.waitForTimeout(1000);

// ── 1. 卡牌显示耗能 ──
console.log('── 1. 商店卡牌显示耗能 ──');
const cards = await page.$$eval('.shop-item', (els) =>
  els.map((el) => ({
    kind: el.querySelector('.si-kind')?.textContent,
    name: el.querySelector('.si-name')?.textContent,
    energy: el.querySelector('.si-energy')?.textContent ?? null,
    price: el.querySelector('.si-price')?.textContent,
  })),
);

console.log('  商品列表：');
for (const c of cards) {
  console.log(`    [${c.kind}] ${c.name}  ${c.energy ?? '（无耗能）'}  ${c.price}`);
}

const activeCards = cards.filter((c) => c.kind === '主动符');
const withEnergy = activeCards.filter((c) => c.energy && /\d+ 费/.test(c.energy));
console.log(`  主动卡 ${activeCards.length} 张，其中 ${withEnergy.length} 张有耗能标注`);
checks.push(['主动卡显示耗能', activeCards.length > 0 && withEnergy.length === activeCards.length]);

// 被动卡不应有耗能标注
const passiveCards = cards.filter((c) => c.kind === '被动符片');
if (passiveCards.length > 0) {
  const noEnergy = passiveCards.every((c) => !c.energy);
  console.log(`  被动卡 ${passiveCards.length} 张，均无耗能标注：${noEnergy}`);
  checks.push(['被动卡不显示耗能', noEnergy]);
}

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-31-shop-energy.png') });

// ── 2. 买卡后立即出现在牌组 ──
console.log('\n── 2. 买卡后进入牌组 ──');
const idx = await page.evaluate(() =>
  window.__world.shop.state.items.findIndex(
    (i) => i.kind === 'card' && i.card?.type === 'active'));

const before = await page.evaluate(() => ({
  total: window.__world.deck.pile.totalCards,
  names: window.__world.deck.pile.allCards().map((c) => c.name),
}));

await page.click(`.shop-item >> nth=${idx}`);
await page.waitForTimeout(600);

const afterBuy = await page.evaluate(() => ({
  total: window.__world.deck.pile.totalCards,
  names: window.__world.deck.pile.allCards().map((c) => c.name),
}));
console.log(`  牌组 ${before.total} → ${afterBuy.total} 张`);
checks.push(['买卡后牌组 +1', afterBuy.total === before.total + 1]);

// 新卡应该出现在卡组里
const newCard = afterBuy.names.find((n) => !before.names.includes(n));
console.log(`  新增卡牌：${newCard ?? '（未找到）'}`);
checks.push(['新卡进入卡组', !!newCard]);

// ── 3. 离开商店后仍保留 ──
console.log('\n── 3. 进入下一幕后仍保留 ──');
await page.click('#shop-leave');
await page.waitForTimeout(1500);

const afterAdvance = await page.evaluate(() => ({
  act: window.__world.currentAct,
  total: window.__world.deck.pile.totalCards,
  names: window.__world.deck.pile.allCards().map((c) => c.name),
}));
console.log(`  当前第 ${afterAdvance.act + 1} 幕，牌组 ${afterAdvance.total} 张`);
const stillThere = newCard ? afterAdvance.names.includes(newCard) : false;
console.log(`  买来的「${newCard}」仍在：${stillThere}`);
checks.push(['跨幕保留', afterAdvance.total === afterBuy.total && stillThere]);

// ── 4. 牌堆面板能看到新卡 ──
console.log('\n── 4. 牌堆面板显示新卡 ──');
await page.click('.pv-btn[data-tab="all"]');
await page.waitForTimeout(400);
const listNames = await page.$$eval('.pv-card .pv-name', (els) =>
  els.map((e) => e.textContent));
const inList = newCard ? listNames.some((n) => n?.includes(newCard)) : false;
console.log(`  面板中${inList ? '有' : '没有'}「${newCard}」`);
checks.push(['牌堆面板可见', inList]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-32-cardkept.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  商店耗能与买卡入库验收');
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
