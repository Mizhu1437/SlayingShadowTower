/**
 * 验证双重扣费修复 + 出牌成功率。
 *
 * 运行：node tests/e2e/p2-fix-energy.mjs
 */

import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 940 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.card', { timeout: 10000 });
console.log('✓ 页面已加载\n');

// ── 1. 单次出牌的能量扣费 ──
console.log('── 1. 出 1 费卡只扣 1 点能量 ──');
const single = await page.evaluate(() => {
  const w = window.__world;
  w.deck.energy.refill();
  w.deck.pile.reset(
    Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`, name: `1费卡${i}`, type: 'active', rarity: 'common',
      price: 1, energy: 1, effects: [{ op: 'gain_coin', value: 1 }],
    })),
  );
  w.deck.selected = 0;
  const before = w.deck.energy.value;
  const ok = w.playSelectedCard();
  return { before, after: w.deck.energy.value, ok };
});
console.log(`  能量 ${single.before} → ${single.after}（出牌成功=${single.ok}）`);
const deductOk = single.ok && single.after === single.before - 1;
console.log(`  ${deductOk ? '✓' : '✗'} 只扣 1 点`);

// ── 2. 连续出牌：能量够就应该每次都成功 ──
console.log('\n── 2. 连续出牌：能量够就成功，不够就失败 ──');
const streak = await page.evaluate(() => {
  const w = window.__world;
  w.deck.energy.refill();   // 3 点
  const results = [];
  // 能量 3，每次耗 1 -> 应该能出 3 次
  for (let i = 0; i < 5; i++) {
    const e0 = w.deck.energy.value;
    const ok = w.playSelectedCard();
    results.push({ e0, e1: w.deck.energy.value, ok });
  }
  return results;
});
console.log('  每次：能量前→后，成功与否');
for (const r of streak) {
  console.log(`    ${r.e0} → ${r.e1}  成功=${r.ok}`);
}
// 前 3 次应成功（能量 3→2→1→0），后 2 次应失败
const first3 = streak.slice(0, 3).every((r) => r.ok);
const last2 = streak.slice(3).every((r) => !r.ok);
const streakOk = first3 && last2;
console.log(`  ${streakOk ? '✓' : '✗'} 能量 3 点正好出 3 次，之后正确失败`);

// ── 3. 能量耗尽后确实打不出 ──
console.log('\n── 3. 能量真的没了就打不出 ──');
await page.waitForTimeout(200);
const exhausted = await page.evaluate(() => {
  const w = window.__world;
  while (w.deck.energy.value > 0) w.deck.energy.pay(1);
  const before = w.deck.energy.value;
  const handBefore = w.deck.pile.handSize;
  const ok = w.playSelectedCard();
  return { ok, before, after: w.deck.energy.value, handBefore, handAfter: w.deck.pile.handSize };
});
console.log(`  能量 ${exhausted.before}，出牌=${exhausted.ok}，能量变为 ${exhausted.after}`);
const guardOk = !exhausted.ok && exhausted.after === 0 && exhausted.handAfter === exhausted.handBefore;
console.log(`  ${guardOk ? '✓' : '✗'} 正确拒绝且不扣能量、不减手牌`);

// ── 4. 30 秒实战采样：可出牌率 ──
console.log('\n── 4. 30 秒实战：能量充足时能出牌的比例 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.deck.pile.reset(
    Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, name: `测试卡${i}`, type: 'active', rarity: 'common',
      price: 1, energy: 1, effects: [{ op: 'gain_coin', value: 1 }],
    })),
  );
  w.deck.energy.refill();
});

let canPlayCount = 0;
let totalCount = 0;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => {
    const w = window.__world;
    const card = w.deck.selectedCard;
    const cost = Math.max(0, (card?.energy ?? 0) - w.cardPower.energyDiscount);
    return { canPay: w.deck.energy.canPay(cost), energy: w.deck.energy.value, card: card?.name ?? null };
  });
  totalCount++;
  if (s.canPay) canPlayCount++;
}
console.log(`  ${totalCount} 次采样中 ${canPlayCount} 次能量充足`);
console.log(`  ${canPlayCount > 0 ? '✓' : '✗'} 能量能够支撑出牌`);

// ── 5. 真实按键出牌 ──
console.log('\n── 5. 真实按 Z 出牌 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.deck.energy.refill();
});
const beforeZ = await page.evaluate(() => ({
  hand: window.__world.deck.pile.handSize,
  energy: window.__world.deck.energy.value,
}));
await page.keyboard.press('z');
await page.waitForTimeout(300);
const afterZ = await page.evaluate(() => ({
  hand: window.__world.deck.pile.handSize,
  energy: window.__world.deck.energy.value,
}));
console.log(`  手牌 ${beforeZ.hand} → ${afterZ.hand}，能量 ${beforeZ.energy} → ${afterZ.energy}`);
const zOk = afterZ.hand === beforeZ.hand - 1 && afterZ.energy === beforeZ.energy - 1;
console.log(`  ${zOk ? '✓' : '✗'} Z 键出牌正常，只扣 1 点`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  双重扣费修复验收');
console.log('════════════════════════════════════');
const checks = [
  ['出 1 费卡只扣 1 点', deductOk],
  ['连续 3 次出牌全部成功', streakOk],
  ['能量耗尽时正确拒绝', guardOk],
  ['能量能支撑出牌', canPlayCount > 0],
  ['Z 键实际出牌正常', zOk],
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
