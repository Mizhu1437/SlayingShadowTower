/**
 * P3 幕间商店端到端验证。
 * 运行：node tests/e2e/p3-shop.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, '../../docs/shots');
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 980 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.card', { timeout: 10000 });
console.log('✓ 页面已加载\n');

const read = () => page.evaluate(() => {
  const w = window.__world;
  return {
    phase: w.phase,
    act: w.currentAct,
    coins: w.coins,
    items: w.shop.state.items.map((i) => ({
      kind: i.kind, name: i.name, price: i.price, sold: i.sold,
    })),
    cards: w.deck.pile.totalCards,
    lives: w.player.lives,
    spell: w.spell.cards,
    pendingRemove: w.pendingRemoveCard,
  };
});

// ── 1. 快速打完第一幕进商店 ──
console.log('── 1. 打完第一幕自动进商店 ──');
await page.evaluate(() => {
  window.__world.debugClearAct();
});
await page.waitForTimeout(600);

let s = await read();
console.log(`  阶段 ${s.phase}，幕 ${s.act + 1}`);
console.log(`  商品 ${s.items.length} 件`);
const shopOk = s.phase === 'shop' && s.items.length === 8;
console.log(`  ${shopOk ? '✓' : '✗'} 已进入商店，8 件商品`);

const domVisible = await page.$eval('#shop-overlay', (el) => !el.classList.contains('hidden')).catch(() => false);
console.log(`  ${domVisible ? '✓' : '✗'} 商店界面可见`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-08-shop.png') });

// ── 2. 商品构成 ──
console.log('\n── 2. 商品构成 ──');
const kinds = s.items.map((i) => i.kind);
const nCard = kinds.filter((k) => k === 'card').length;
console.log(`  卡牌 ${nCard} 件，服务 ${8 - nCard} 件`);
console.log(`  商品列表：`);
for (const it of s.items) {
  console.log(`    [${it.kind}] ${it.name} — ${it.price} 蜃銭`);
}
const structOk = nCard === 5
  && kinds.includes('remove_card')
  && kinds.includes('heal_life')
  && kinds.includes('restore_spell');
console.log(`  ${structOk ? '✓' : '✗'} 结构正确（5 卡 + 删卡 + 买命 + 买符卡）`);

// ── 3. 钱不够时买不了 ──
console.log('\n── 3. 蜃銭不足时购买被拒 ──');
await page.evaluate(() => { window.__world.coins = 0; });
await page.waitForTimeout(200);
const poorResult = await page.evaluate(() => {
  const r = window.__world.buyShopItem(0);
  return { ok: r.ok, reason: r.reason, lives: window.__world.player.lives };
});
console.log(`  购买结果：ok=${poorResult.ok}，原因=${poorResult.reason}`);
const poorOk = !poorResult.ok && poorResult.reason === 'no_money';
console.log(`  ${poorOk ? '✓' : '✗'} 正确拒绝`);

// ── 4. 有钱了能买卡 ──
console.log('\n── 4. 购买卡牌 ──');
const buyResult = await page.evaluate(() => {
  const w = window.__world;
  w.coins = 5000;
  const before = w.deck.pile.totalCards;
  const coinsBefore = w.coins;

  const idx = w.shop.state.items.findIndex(
    (it) => it.kind === 'card' && it.card?.type === 'active',
  );
  if (idx < 0) return { skipped: true };

  const price = w.shop.state.items[idx].price;
  const r = w.buyShopItem(idx);
  return {
    ok: r.ok,
    before, after: w.deck.pile.totalCards,
    coinsBefore, coinsAfter: w.coins, price,
  };
});
if (!buyResult.skipped) {
  console.log(`  牌组 ${buyResult.before} → ${buyResult.after} 张`);
  console.log(`  蜃銭 ${buyResult.coinsBefore} → ${buyResult.coinsAfter}（花了 ${buyResult.price}）`);
}
const buyOk = !buyResult.skipped && buyResult.ok
  && buyResult.after === buyResult.before + 1
  && buyResult.coinsAfter === buyResult.coinsBefore - buyResult.price;
console.log(`  ${buyOk ? '✓' : '✗'} 买卡成功，牌组 +1，钱正确扣除`);

// ── 5. 买命 ──
console.log('\n── 5. 购买残机 ──');
const lifeResult = await page.evaluate(() => {
  const w = window.__world;
  w.coins = 5000;
  const before = w.player.lives;
  const idx = w.shop.state.items.findIndex((it) => it.kind === 'heal_life');
  if (idx < 0) return { skipped: true };
  w.buyShopItem(idx);
  return { before, after: w.player.lives };
});
if (!lifeResult.skipped) {
  console.log(`  残机 ${lifeResult.before} → ${lifeResult.after}`);
}
const lifeOk = !lifeResult.skipped && lifeResult.after === lifeResult.before + 1;
console.log(`  ${lifeOk ? '✓' : '✗'} 残机 +1`);

// ── 6. 删卡 ──
console.log('\n── 6. 删卡服务 ──');
const removeResult = await page.evaluate(async () => {
  const w = window.__world;
  w.coins = 5000;
  const idx = w.shop.state.items.findIndex((it) => it.kind === 'remove_card');
  if (idx < 0) return { skipped: true };

  const before = w.deck.pile.totalCards;
  w.buyShopItem(idx);
  const pending = w.pendingRemoveCard;

  await new Promise((r) => setTimeout(r, 400));

  const target = w.deck.pile.allCards()[0];
  const done = w.completeRemoveCard(target.id);

  return {
    before, after: w.deck.pile.totalCards,
    pending, done, pendingAfter: w.pendingRemoveCard,
  };
});
if (!removeResult.skipped) {
  console.log(`  买后待选=${removeResult.pending}，选卡后移除=${removeResult.done}`);
  console.log(`  牌组 ${removeResult.before} → ${removeResult.after} 张`);
}
const removeOk = !removeResult.skipped && removeResult.pending
  && removeResult.done && removeResult.after === removeResult.before - 1;
console.log(`  ${removeOk ? '✓' : '✗'} 删卡生效，牌组 -1`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-09-shop-bought.png') });

// ── 7. 离开商店进下一幕 ──
console.log('\n── 7. 离开商店进入下一幕 ──');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
s = await read();
console.log(`  阶段 ${s.phase}，当前幕 ${s.act + 1}`);
const advanceOk = s.phase === 'playing' && s.act === 1;
console.log(`  ${advanceOk ? '✓' : '✗'} 已进入第二幕`);

// ── 8. 第二幕能正常打 ──
console.log('\n── 8. 第二幕波次启动 ──');
await page.waitForTimeout(1500);
const wave = await page.evaluate(() => ({
  wavePhase: window.__world.waves.phase,
  wave: window.__world.waves.currentWave,
  total: window.__world.waves.totalWaves,
}));
console.log(`  波次 ${wave.wave}/${wave.total}，相位 ${wave.wavePhase}`);
const waveOk = wave.wavePhase === 'running' && wave.total === 12;
console.log(`  ${waveOk ? '✓' : '✗'} 第二幕波次正常运行`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  P3 幕间商店验收');
console.log('════════════════════════════════════');
const checks = [
  ['打完一幕自动进商店', shopOk],
  ['商店界面可见', domVisible],
  ['商品结构正确', structOk],
  ['钱不够时拒绝购买', poorOk],
  ['买卡生效', buyOk],
  ['买残机生效', lifeOk],
  ['删卡生效', removeOk],
  ['离开商店进下一幕', advanceOk],
  ['第二幕正常运行', waveOk],
];
let pass = 0;
for (const [n, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${n}`);
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
