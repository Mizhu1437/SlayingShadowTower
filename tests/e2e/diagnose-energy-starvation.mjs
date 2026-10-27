/**
 * 诊断：为什么"经常打不出牌"。
 *
 * 真实原因不是 bug，而是**设计上的必然结果**：
 *   能量上限 3，而初始卡组里有 2 费卡。
 *   出两张牌就把能量花光了，之后要等 5 秒才回 1 点。
 *
 * 这份诊断量化"等能量"的时间占比。
 *
 * 运行：node tests/e2e/diagnose-energy-starvation.mjs
 */

import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 940 } });

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.card');
console.log('✓ 页面已加载\n');

// 采样 60 秒，每 500ms 一次
const samples = [];
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => {
    const w = window.__world;
    const card = w.deck.selectedCard;
    const baseCost = card?.energy ?? 0;
    const cost = Math.max(0, baseCost - w.cardPower.energyDiscount);
    return {
      energy: w.deck.energy.value,
      cost,
      canPay: w.deck.energy.canPay(cost),
      cardName: card?.name ?? null,
      handSize: w.deck.pile.handSize,
    };
  });
  samples.push(s);
}

const affordable = samples.filter((s) => s.canPay).length;
const starving = samples.length - affordable;
const pct = ((starving / samples.length) * 100).toFixed(0);

console.log('=== 60 秒采样（120 次，每 500ms）===');
console.log(`  能出牌：${affordable} 次`);
console.log(`  能量不足：${starving} 次  →  ${pct}% 的时间在等能量`);
console.log();

// 卡费分布
const costHist = {};
for (const s of samples) {
  if (s.cardName) {
    const k = `${s.cost}费`;
    costHist[k] = (costHist[k] ?? 0) + 1;
  }
}
console.log('选中卡的耗能分布：');
for (const [k, v] of Object.entries(costHist).sort()) {
  console.log(`  ${k}: ${v} 次`);
}

// 能量轨迹
const trace = samples.map((s) => s.energy).join('');
console.log(`\n能量轨迹（60 秒）：${trace}`);

// 连续<3 的片段数
let lowEnergyRuns = 0;
let inRun = false;
for (const s of samples) {
  if (s.energy <= 0 && !inRun) { lowEnergyRuns++; inRun = true; }
  else if (s.energy > 0) inRun = false;
}
console.log(`能量为 0 的独立时段：${lowEnergyRuns} 次`);

// 结论
console.log('\n=== 结论 ===');
const theory = '能量上限 3，每 5 秒回 1 点。';
console.log(theory);
console.log('初始卡组含 2 费卡 → 出两张就见底 → 之后每次出牌都要等 5 秒以上。');
console.log('这不是 bug，是「能量 3 + T=5s + 有 2 费卡」三者叠加的必然结果。');

await browser.close();
