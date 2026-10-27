/**
 * 验证：无自动射击 + T=5 秒。
 *
 * 运行：node tests/e2e/p2-noautoshoot.mjs
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

const read = () => page.evaluate(() => {
  const w = window.__world;
  return {
    playerShots: w.playerShots.aliveCount,
    kills: w.kills,
    enemies: w.enemies.length,
    bullets: w.enemyBullets.aliveCount,
    energy: w.deck.energy.value,
    handSize: w.deck.pile.handSize,
    cardPower: w.cardPower,
    hand: w.deck.pile.hand.map((c) => ({ name: c.name, energy: c.energy })),
  };
});

// ── 1. 无自动射击 ──
console.log('── 1. 自机不发射任何子弹 ──');
await page.waitForTimeout(2500);
let s = await read();
console.log(`  玩家子弹数 ${s.playerShots}（应为 0）`);
const noShootOk = s.playerShots === 0;
console.log(`  ${noShootOk ? '✓' : '✗'} 无自动射击`);

// ── 2. 敌人不会自动死亡 ──
console.log('\n── 2. 不出牌则敌人不会死 ──');
const killsBefore = s.kills;
await page.waitForTimeout(4000);
s = await read();
console.log(`  击破数 ${killsBefore} → ${s.kills}（应不变）`);
console.log(`  场上敌人 ${s.enemies} 个`);
const noAutoKillOk = s.kills === killsBefore;
console.log(`  ${noAutoKillOk ? '✓' : '✗'} 没有自动击杀`);

// ── 3. 用卡牌击杀 ──
console.log('\n── 3. 出牌才能造成伤害 ──');
const killResult = await page.evaluate(() => {
  const w = window.__world;
  // 放一个弱小敌人
  w.spawnEnemy({ hp: 10, radius: 12, score: 500, coin: 20 }, w.player.x, w.player.y - 150);
  w.step();
  const before = w.kills;

  // 选一张伤害卡
  const idx = w.deck.pile.hand.findIndex((c) =>
    c.effects?.some((e) => e.op === 'damage_all'));
  if (idx < 0) return { ok: false, reason: '手牌里没有伤害卡' };

  w.deck.selected = idx;
  w.deck.energy.refill();
  const played = w.playSelectedCard();
  return { ok: played && w.kills > before, kills: w.kills, before, played };
});
console.log(`  出牌结果：${JSON.stringify(killResult)}`);
console.log(`  ${killResult.ok ? '✓' : '✗'} 卡牌造成伤害并击杀`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p2-06-noshoot.png') });

// ── 4. T = 5 秒 ──
console.log('\n── 4. 抽牌间隔是否为 5 秒 ──');
const timing = await page.evaluate(() => {
  const w = window.__world;
  return { drawInterval: 5.0, energyInterval: w.deck.energy.interval };
});
console.log(`  能量间隔 ${timing.energyInterval}s（应为 5）`);
const tOk = timing.energyInterval === 5.0;
console.log(`  ${tOk ? '✓' : '✗'} T = 5 秒`);

// 实测一次抽牌间隔
console.log('  实测抽牌间隔（等待约 11 秒观察两次抽牌）…');
const samples = [];
let lastHand = (await read()).handSize;
const t0 = Date.now();
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(100);
  const cur = (await read()).handSize;
  if (cur !== lastHand) {
    samples.push({ t: ((Date.now() - t0) / 1000).toFixed(1), from: lastHand, to: cur });
    lastHand = cur;
    if (samples.length >= 2) break;
  }
}
console.log(`  抽牌发生时刻：${samples.map((x) => `${x.t}s`).join('、')}`);
const intervals = [];
for (let i = 1; i < samples.length; i++) {
  intervals.push(Number(samples[i].t) - Number(samples[i - 1].t));
}
if (intervals.length > 0) {
  const avgInt = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  console.log(`  平均间隔 ${avgInt.toFixed(1)}s`);
}
const measuredOk = samples.length >= 1;
console.log(`  ${measuredOk ? '✓' : '⚠'} 抽牌节奏可观测`);

// ── 5. 卡牌威力结算 ──
console.log('\n── 5. 被动卡 → 卡牌威力 ──');
const powerResult = await page.evaluate(() => {
  const w = window.__world;
  const before = { ...w.cardPower };
  // 加一张锋利符片（damage +3）
  const sharp = {
    id: 'p_sharp', name: '锋利符片', type: 'passive', rarity: 'common',
    price: 55, modifiers: [{ op: 'add', stat: 'damage', value: 3 }],
  };
  w.deck.addPassive(sharp);
  w.refreshFromPassives();
  return { before, after: { ...w.cardPower } };
});
console.log(`  加被动卡前：${JSON.stringify(powerResult.before)}`);
console.log(`  加被动卡后：${JSON.stringify(powerResult.after)}`);
const powerOk = powerResult.after.damageMul > powerResult.before.damageMul;
console.log(`  ${powerOk ? '✓' : '✗'} 被动卡提升卡牌威力`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  无自动射击 + T=5 验收');
console.log('════════════════════════════════════');
const checks = [
  ['自机不发射子弹', noShootOk],
  ['不出牌则敌人不死', noAutoKillOk],
  ['出牌才能造成伤害', killResult.ok],
  ['T = 5 秒', tOk],
  ['被动卡提升卡牌威力', powerOk],
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
