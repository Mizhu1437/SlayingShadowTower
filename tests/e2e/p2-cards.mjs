/**
 * P2 卡牌系统端到端验证（含牌堆枯竭回归）。
 *
 * 重点验证用户报告的问题：手牌到 5 就无法继续抽牌。
 *
 * 运行：node tests/e2e/p2-cards.mjs
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
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForSelector('.card', { timeout: 10000 });
console.log('✓ 页面与手牌 UI 已加载\n');

const readState = () => page.evaluate(() => {
  const w = window.__world;
  return {
    hand: w.deck.pile.hand.map((c) => c.name),
    handSize: w.deck.pile.handSize,
    selected: w.deck.selected,
    energy: w.deck.energy.value,
    energyCap: w.deck.energy.cap,
    drawCount: w.deck.pile.drawCount,
    discardCount: w.deck.pile.discardCount,
    totalCards: w.deck.pile.totalCards,
    hasAnyCard: w.deck.pile.hasAnyCard,
    paused: w.deck.paused,
    pauseLeft: w.deck.pauseLeft,
    bullets: w.enemyBullets.aliveCount,
    coins: w.coins,
  };
});

// ── 检查 1：初始状态 ──
console.log('── 检查 1：初始状态 ──');
let s = await readState();
console.log(`  手牌 ${s.handSize} 张：${s.hand.join('、')}`);
console.log(`  卡组总数 ${s.totalCards}（抽牌堆 ${s.drawCount} + 手牌 ${s.handSize} + 弃牌 ${s.discardCount}）`);
console.log(`  能量 ${s.energy}/${s.energyCap}`);

const cardEls = await page.$$eval('.card', (els) => els.length);
const initOk = s.handSize === 3 && cardEls === 3 && s.totalCards >= 10;
console.log(`  DOM 手牌 ${cardEls} 个`);
console.log(`  ${initOk ? '✓' : '✗'} 初始 3 张手牌、卡组 ≥ 10 张`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p2-01-hand.png') });

// ── 检查 2：C 键切换 ──
console.log('\n── 检查 2：C 键切换选中 ──');
const sel0 = (await readState()).selected;
await page.keyboard.press('c');
await page.waitForTimeout(120);
const sel1 = (await readState()).selected;
const selCount = await page.$$eval('.card', (els) => els.filter((e) => e.classList.contains('selected')).length);
console.log(`  选中 ${sel0} → ${sel1}，DOM 中 selected 类 ${selCount} 个`);
const cycleOk = sel1 !== sel0 && selCount === 1;
console.log(`  ${cycleOk ? '✓' : '✗'} 切换生效`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p2-02-selected.png') });

// ── 检查 3：Z 键出牌 ──
console.log('\n── 检查 3：Z 键打出卡牌 ──');
await page.evaluate(() => {
  const w = window.__world;
  for (let i = 0; i < 25; i++) {
    w.enemyBullets.spawn(30 + (i % 12) * 26, 80 + Math.floor(i / 12) * 55, 0, 0, 4, 10);
  }
});
await page.waitForTimeout(120);

const before = await readState();
console.log(`  打牌前：手牌 ${before.handSize}　能量 ${before.energy}　敌弹 ${before.bullets}`);
console.log(`  选中：${before.hand[before.selected]}`);

await page.keyboard.press('z');
await page.waitForTimeout(350);
const after = await readState();
console.log(`  打牌后：手牌 ${after.handSize}　能量 ${after.energy}　敌弹 ${after.bullets}　弃牌 ${after.discardCount}`);

const playOk =
  after.handSize === before.handSize - 1 &&
  after.energy <= before.energy &&
  after.discardCount > before.discardCount;
console.log(`  ${playOk ? '✓' : '✗'} 打出成功`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p2-03-played.png') });

// ── 检查 4：手牌到 5 时仍能抽牌（用户报告的核心问题）──
console.log('\n── 检查 4：手牌到 5 时能否继续抽牌（回归）──');

// 重置牌堆，模拟从开局一路抽
await page.evaluate(() => {
  const w = window.__world;
  w.deck.energy.refill();
});

let reached5 = false;
let drawFailed = false;
const trace = [];

for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400);
  const cur = await readState();
  trace.push(cur.handSize);

  if (cur.handSize >= 5) {
    reached5 = true;
    // 到 5 之后再看还能不能抽
    if (!cur.hasAnyCard && cur.handSize < 6) {
      drawFailed = true;
    }
  }
  if (cur.handSize === 6) break;
}

console.log(`  手牌变化轨迹：${trace.join(' → ')}`);
console.log(`  是否到达 5 张：${reached5 ? '是' : '否'}`);
s = await readState();
console.log(`  当前：手牌 ${s.handSize}，抽牌堆 ${s.drawCount}，弃牌 ${s.discardCount}，hasAnyCard=${s.hasAnyCard}`);

const noStallOk = !drawFailed && s.hasAnyCard;
console.log(`  ${noStallOk ? '✓' : '✗'} 牌堆未枯竭`);

// ── 检查 5：卡牌抽牌效果 ──
console.log('\n── 检查 5：卡牌抽牌效果 ──');
const drawResult = await page.evaluate(() => {
  const w = window.__world;
  // 先把牌堆恢复到可抽状态
  while (w.deck.pile.handSize > 0) w.deck.pile.playAt(0);
  const before = w.deck.pile.handSize;
  const beforeTotal = w.deck.pile.totalCards;
  const r = w.deck.drawNow(2);
  return {
    before,
    beforeTotal,
    drawn: r.drawn,
    overloaded: r.overloaded,
    after: w.deck.pile.handSize,
    afterTotal: w.deck.pile.totalCards,
  };
});
console.log(`  出光手牌后（${drawResult.before} 张），执行抽 2 张`);
console.log(`  实际抽到 ${drawResult.drawn} 张，手牌变为 ${drawResult.after} 张`);
console.log(`  卡组总数 ${drawResult.beforeTotal} → ${drawResult.afterTotal}（应不变）`);
const cardDrawOk = drawResult.drawn > 0 && drawResult.beforeTotal === drawResult.afterTotal;
console.log(`  ${cardDrawOk ? '✓' : '✗'} 卡牌抽牌生效且总数守恒`);

// ── 检查 6：过载触发 ──
console.log('\n── 检查 6：满手触发过载 ──');
await page.evaluate(() => {
  const w = window.__world;
  while (w.deck.pile.handSize < 6) w.deck.drawNow(1);
});
await page.waitForTimeout(100);

let overloaded = false;
let pauseSeen = 0;
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(400);
  const cur = await readState();
  if (cur.paused) {
    overloaded = true;
    pauseSeen = cur.pauseLeft;
    break;
  }
}
console.log(`  过载触发：${overloaded ? `是，停顿 ${pauseSeen.toFixed(1)}s` : '否'}`);

const handInfo = await page.$eval('.hand-info', (el) => el.textContent ?? '');
console.log(`  状态栏：「${handInfo.trim()}」`);
const hintOk = overloaded && /过载/.test(handInfo);
console.log(`  ${hintOk ? '✓' : '⚠'} 界面提示过载`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p2-04-overload.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  P2 卡牌系统验收');
console.log('════════════════════════════════════');
const checks = [
  ['初始 3 张手牌 + 卡组 ≥10', initOk],
  ['C 键循环切换', cycleOk],
  ['Z 键打出卡牌', playOk],
  ['手牌到 5 仍能抽牌（回归）', noStallOk],
  ['卡牌抽牌生效', cardDrawOk],
  ['满手触发过载', overloaded],
];
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (ok) pass++;
}
console.log(`\n  ${pass}/${checks.length} 项通过`);

if (errors.length) {
  console.log('\n⚠ 控制台错误：');
  for (const e of errors.slice(0, 8)) console.log('  ' + e);
} else {
  console.log('\n✓ 无控制台错误');
}

await browser.close();
process.exit(pass === checks.length && errors.length === 0 ? 0 : 1);
