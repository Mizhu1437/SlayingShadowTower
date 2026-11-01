/**
 * 验证四项新需求。
 * 运行：node tests/e2e/p3-newreq.mjs
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

// ── 1. 牌堆按钮 ──
console.log('── 1. 牌堆查看按钮 ──');
const btnCount = await page.$$eval('.pv-btn', (els) => els.length);
console.log(`  按钮数：${btnCount}`);
checks.push(['右下角有三个按钮', btnCount === 3]);

await page.click('.pv-btn[data-tab="draw"]');
await page.waitForTimeout(300);
const viewerVisible = await page.$eval('#pile-viewer', (el) =>
  !el.classList.contains('hidden')).catch(() => false);
const title = await page.$eval('#pv-title', (el) => el.textContent).catch(() => '');
console.log(`  面板可见：${viewerVisible}，标题：${title}`);
checks.push(['点牌堆按钮打开面板', viewerVisible]);

const cardCount = await page.$$eval('.pv-card', (els) => els.length);
console.log(`  显示 ${cardCount} 种卡`);
checks.push(['面板列出卡牌', cardCount > 0]);

// 切换标签
await page.click('.pv-btn[data-tab="discard"]');
await page.waitForTimeout(300);
const discardTitle = await page.$eval('#pv-title', (el) => el.textContent);
console.log(`  切到弃牌：${discardTitle}`);
checks.push(['可切换标签', discardTitle.includes('弃牌')]);

await page.click('.pv-btn[data-tab="all"]');
await page.waitForTimeout(300);
const allTitle = await page.$eval('#pv-title', (el) => el.textContent);
console.log(`  切到卡组：${allTitle}`);
checks.push(['可查看完整卡组', allTitle.includes('卡组')]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-28-pileviewer.png') });

// 关闭
await page.click('#pv-close');
await page.waitForTimeout(200);

// ── 2. 被动卡槽位 ──
console.log('\n── 2. 被动卡槽位上限 2 ──');
const slots = await page.evaluate(() => ({
  slots: window.__world.deck.passiveSlots,
  left: window.__world.deck.passiveSlotsLeft,
}));
console.log(`  槽位 ${slots.slots}，剩余 ${slots.left}`);
checks.push(['默认槽位为 2', slots.slots === 2]);

const slotTest = await page.evaluate(() => {
  const w = window.__world;
  w.deck.passives.length = 0;
  const pool = [
    { id: 'p1', name: 'A', type: 'passive', rarity: 'common', price: 1,
      modifiers: [{ op: 'add', stat: 'damage', value: 3 }] },
    { id: 'p2', name: 'B', type: 'passive', rarity: 'common', price: 1,
      modifiers: [{ op: 'add', stat: 'damage', value: 3 }] },
    { id: 'p3', name: 'C', type: 'passive', rarity: 'common', price: 1,
      modifiers: [{ op: 'add', stat: 'damage', value: 3 }] },
  ];
  const r = pool.map((c) => w.deck.addPassive(c));
  return { results: r, count: w.deck.passives.length };
});
console.log(`  依次加 3 张：${JSON.stringify(slotTest.results)}，实际 ${slotTest.count} 张`);
checks.push(['第 3 张被拒绝', slotTest.results[2] === false && slotTest.count === 2]);

// ── 3. MISS 保护期禁止放符卡 ──
console.log('\n── 3. MISS 后不能放符卡 ──');
const missTest = await page.evaluate(async () => {
  const w = window.__world;
  w.phase === 'playing';
  w.player.x = 96;
  w.player.y = 112;
  w.player.invuln = 0;
  w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
  w.step();
  for (let i = 0; i < 150; i++) {
    w.step();
    if (w.missProtectLeft > 0) break;
  }
  const protect = w.missProtectLeft;
  const cardsBefore = w.spell.cards;
  const ok = w.pressBomb();
  return { protect, ok, cardsBefore, cardsAfter: w.spell.cards };
});
console.log(`  保护期 ${missTest.protect.toFixed(2)}s`);
console.log(`  按 X 结果：${missTest.ok}，符卡 ${missTest.cardsBefore} → ${missTest.cardsAfter}`);
checks.push(['保护期内无法放符卡',
  !missTest.ok && missTest.cardsAfter === missTest.cardsBefore]);

// ── 4. 波次倒计时 ──
console.log('\n── 4. 波次 30 秒倒计时 ──');
const timerTest = await page.evaluate(async () => {
  const w = window.__world;
  w.debugJumpToWave(0, 1);
  const t0 = w.waves.waveRemainSeconds;
  for (let i = 0; i < 60; i++) w.step();
  const t1 = w.waves.waveRemainSeconds;
  return { t0, t1 };
});
console.log(`  倒计时 ${timerTest.t0.toFixed(1)} → ${timerTest.t1.toFixed(1)}`);
checks.push(['倒计时为 30 秒且递减',
  timerTest.t0 > 29 && timerTest.t0 <= 30 && timerTest.t1 < timerTest.t0]);

// 超时清场
const timeoutTest = await page.evaluate(async () => {
  const w = window.__world;
  w.debug.set('invincible', true);
  w.debugJumpToWave(0, 1);

  // 生成敌人但不杀
  for (let i = 0; i < 400; i++) w.step();
  const hadEnemies = w.enemies.filter((e) => !e.dead && e.targetable).length;
  const killsBefore = w.kills;
  const scoreBefore = w.score;

  // 跑到超时
  let clearedAtAdvance = -1;
  for (let i = 0; i < 1800; i++) {
    const before = w.waves.currentWave;
    w.step();
    if (w.waves.currentWave > before) {
      clearedAtAdvance = w.enemies.filter((e) => !e.dead && e.targetable).length;
      break;
    }
  }
  return {
    hadEnemies, clearedAtAdvance,
    killsBefore, killsAfter: w.kills,
    scoreBefore, scoreAfter: w.score,
  };
});
console.log(`  超时前敌人 ${timeoutTest.hadEnemies} 个`);
console.log(`  推进瞬间存活：${timeoutTest.clearedAtAdvance}`);
console.log(`  击杀 ${timeoutTest.killsBefore} → ${timeoutTest.killsAfter}（不应变）`);
console.log(`  得分 ${timeoutTest.scoreBefore} → ${timeoutTest.scoreAfter}（不应变）`);
checks.push([
  '超时清空全屏敌人',
  timeoutTest.hadEnemies > 0 && timeoutTest.clearedAtAdvance === 0,
]);
checks.push([
  '超时清场不给奖励',
  timeoutTest.killsAfter === timeoutTest.killsBefore
    && timeoutTest.scoreAfter === timeoutTest.scoreBefore,
]);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  四项需求验收');
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
