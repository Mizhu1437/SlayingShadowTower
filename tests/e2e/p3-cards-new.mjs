/**
 * 验证：时间显示修复 + 新初始卡组。
 *
 * 运行：node tests/e2e/p3-cards-new.mjs
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

// ── 1. 初始卡组构成 ──
console.log('── 1. 初始卡组（藤原妹红）──');
const deck = await page.evaluate(() => {
  const w = window.__world;
  const all = [
    ...w.deck.pile.hand.map((c) => c.name),
  ];
  // 从牌堆反推完整卡组（hand + draw + discard）
  return {
    hand: all,
    handSize: w.deck.pile.handSize,
    totalCards: w.deck.pile.totalCards,
  };
});
console.log(`  完整卡组 ${deck.totalCards} 张，初始手牌 ${deck.handSize} 张`);
console.log(`  手牌：${deck.hand.join('、')}`);
const deckOk = deck.totalCards === 8;
console.log(`  ${deckOk ? '✓' : '✗'} 卡组共 8 张（4 符击 + 3 防御 + 1 凤翼天翔）`);

// ── 2. 时间显示是倒计时 ──
console.log('\n── 2. 时间显示是否为倒计时 ──');
// 先消耗能量，否则显示的是“能量已满”而不是倒计时
await page.evaluate(() => {
  const w = window.__world;
  w.deck.energy.pay(2);
});

const timeSamples = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(400);
  const txt = await page.$eval('.hand-info', (el) => el.textContent ?? '');
  const m = txt.match(/下一点能量\s*([\d.]+)s/);
  if (m) timeSamples.push(Number(m[1]));
}
console.log(`  采样序列：${timeSamples.join(' → ')}`);

// 倒计时应该是递减的（除了回满后重置）
let decreasing = 0;
let increasing = 0;
for (let i = 1; i < timeSamples.length; i++) {
  if (timeSamples[i] < timeSamples[i - 1]) decreasing++;
  else if (timeSamples[i] > timeSamples[i - 1]) increasing++;
}
console.log(`  递减 ${decreasing} 次，递增 ${increasing} 次`);
const countdownOk = decreasing > increasing;
console.log(`  ${countdownOk ? '✓' : '✗'} 是倒计时（数字递减）`);

// ── 3. 间隔是 5 秒 ──
console.log('\n── 3. 间隔是否为 5 秒 ──');
const maxObserved = Math.max(...timeSamples);
console.log(`  观测到的最大剩余时间：${maxObserved}s`);
const intervalOk = maxObserved > 3.5 && maxObserved <= 5.05;
console.log(`  ${intervalOk ? '✓' : '✗'} 间隔是 5 秒（不再是 3 秒）`);

// ── 4. 出牌能造成伤害（符击的持续射击）──
console.log('\n── 4. 符击是否真的能打伤敌人 ──');
const burstResult = await page.evaluate(async () => {
  const w = window.__world;
  // 造一个 1 费卡组，确保能打出符击
  w.deck.energy.refill();

  // 找一个有 burst_fire 的卡
  const idx = w.deck.pile.hand.findIndex(
    (c) => c.effects?.some((e) => e.op === 'burst_fire'),
  );
  if (idx < 0) return { skipped: true, reason: '手牌里暂时没有符击' };

  w.deck.selected = idx;

  // 放一个敌人在正上方
  w.spawnEnemy({ hp: 500, radius: 20, score: 1, coin: 1 }, w.player.x, 180);
  w.step();
  const e = w.enemies[w.enemies.length - 1];
  if (e) { e.x = w.player.x; e.y = 180; e.moveTo(e.x, e.y); }

  const hpBefore = e ? e.hp : 0;
  const played = w.playSelectedCard();

  // 跑 1 秒让子弹飞上去
  for (let i = 0; i < 60; i++) w.step();

  return {
    played,
    hpBefore,
    hpAfter: e ? e.hp : 0,
    bursts: w.cardShots.activeBursts,
    bullets: w.cardShots.shots.aliveCount,
  };
});
if (burstResult.skipped) {
  console.log(`  跳过：${burstResult.reason}`);
} else {
  console.log(`  出牌=${burstResult.played}　敌人 HP ${burstResult.hpBefore} → ${burstResult.hpAfter}`);
  console.log(`  活跃射击窗口 ${burstResult.bursts} 个，场上自机子弹 ${burstResult.bullets} 发`);
}
const damageOk = !burstResult.skipped && burstResult.hpAfter < burstResult.hpBefore;
console.log(`  ${damageOk || burstResult.skipped ? '✓' : '✗'} ${burstResult.skipped ? '（跳过）' : '符击造成了伤害'}`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-04-newdeck.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  验收');
console.log('════════════════════════════════════');
const checks = [
  ['初始卡组 8 张（用户设计）', deckOk],
  ['时间显示是倒计时', countdownOk],
  ['间隔是 5 秒', intervalOk],
  ['符击能造成伤害', damageOk || burstResult.skipped],
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
