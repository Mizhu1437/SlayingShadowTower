/**
 * 符卡（X 键）与决死系统的端到端验证。
 *
 * 检查：
 *   1. X 键释放符卡，清屏、消耗 1 张
 *   2. 中弹后进入决死窗口（而不是直接扣命）
 *   3. 决死窗口内按 X 能救场
 *   4. 决死不按 → 扣命 + 符卡重置
 *
 * 运行：node tests/e2e/p1-spell.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, '../../docs/shots');
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 15000 });
console.log('✓ 页面已加载\n');

const readWorld = () => page.evaluate(() => {
  const w = window.__world;
  return {
    lives: w.player.lives,
    cards: w.spell.cards,
    spellPhase: w.spell.phase,
    bullets: w.enemyBullets.aliveCount,
    invuln: w.player.invuln,
    deathbombLeft: w.spell.deathbombLeftSeconds,
  };
});

// ── 检查 1：X 键释放符卡 ──
console.log('── 检查 1：X 键释放符卡 ──');
let s = await readWorld();
console.log(`  初始符卡 ${s.cards}`);

// 先塞一堆敌弹，验证清屏
await page.evaluate(() => {
  const w = window.__world;
  for (let i = 0; i < 40; i++) {
    w.enemyBullets.spawn(20 + (i % 20) * 17, 60 + Math.floor(i / 20) * 40, 0, 0, 4, 10);
  }
});
await page.waitForTimeout(200);
let before = await readWorld();
console.log(`  清屏前敌弹 ${before.bullets}`);

await page.keyboard.press('x');
await page.waitForTimeout(300);
s = await readWorld();
console.log(`  释放后：符卡 ${s.cards}　敌弹 ${s.bullets}　无敌 ${s.invuln.toFixed(2)}s`);

const castOk = s.cards === before.cards - 1 && s.bullets === 0 && s.invuln > 0;
console.log(`  ${castOk ? '✓' : '✗'} 消耗 1 张、清空敌弹、获得无敌`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p1-07-bomb.png') });

// 等无敌结束
await page.waitForTimeout(2300);

// ── 检查 2：中弹进入决死窗口 ──
console.log('\n── 检查 2：中弹后进入决死（不立即扣命）──');
await page.evaluate(() => {
  const w = window.__world;
  w.player.invuln = 0;
  w.player.lives = 3;
  w.spell.cards = 3;
  w.enemyBullets.clear();
  w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
});
await page.waitForTimeout(120);
s = await readWorld();
console.log(`  阶段 ${s.spellPhase}　残机 ${s.lives}　决死剩余 ${s.deathbombLeft.toFixed(3)}s`);
const deathbombEntered = s.spellPhase === 'deathbomb' && s.lives === 3;
console.log(`  ${deathbombEntered ? '✓' : '✗'} 进入决死窗口且未扣命`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p1-08-deathbomb.png') });

// ── 检查 3：决死窗口内按 X 救场 ──
console.log('\n── 检查 3：决死窗口内按 X 救场 ──');
const livesBefore = s.lives;
const cardsBefore = s.cards;
await page.keyboard.press('x');
await page.waitForTimeout(300);
s = await readWorld();
console.log(`  残机 ${s.lives}（应保持 ${livesBefore}）　符卡 ${s.cards}　阶段 ${s.spellPhase}`);
const saveOk = s.lives === livesBefore && s.cards === cardsBefore - 1 && s.spellPhase === 'active';
console.log(`  ${saveOk ? '✓' : '✗'} 决死成功：不掉命，消耗 1 张符卡`);

// 等无敌结束
await page.waitForTimeout(2300);

// ── 检查 4：决死不按 → 扣命 + 重置符卡 ──
console.log('\n── 检查 4：决死不按 X → 扣命并重置符卡 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.player.invuln = 0;
  w.player.lives = 3;
  w.spell.cards = 1;      // 故意只剩 1 张
  w.enemyBullets.clear();
  w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
});
await page.waitForTimeout(100);
s = await readWorld();
console.log(`  中弹后：阶段 ${s.spellPhase}　残机 ${s.lives}　符卡 ${s.cards}`);

// 等决死窗口过去（3 张 = 26 帧 ≈ 0.43 秒，给足 1.5 秒）
await page.waitForTimeout(1500);
s = await readWorld();
console.log(`  窗口结束后：残机 ${s.lives}　符卡 ${s.cards}`);
const missOk = s.lives === 2 && s.cards === 3;
console.log(`  ${missOk ? '✓' : '✗'} 扣命且符卡重置为 3`);

// ── 检查 5：符卡数量影响决死窗口 ──
console.log('\n── 检查 5：符卡数越少，决死窗口越短 ──');
const windows = await page.evaluate(() => {
  const w = window.__world;
  const result = {};
  for (const n of [0, 1, 2, 3]) {
    w.spell.cards = n;
    w.spell.phase = 'idle';
    w.player.invuln = 0;
    const win = w.spell.enterDeathbomb(false);
    result[n] = +(win * 1000).toFixed(1);  // 毫秒
    w.spell.phase = 'idle';
  }
  return result;
});
console.log(`  0 张: ${windows[0]}ms　1 张: ${windows[1]}ms　2 张: ${windows[2]}ms　3 张: ${windows[3]}ms`);
const monotonic = windows[0] < windows[1] && windows[1] < windows[2] && windows[2] < windows[3];
console.log(`  ${monotonic ? '✓' : '✗'} 窗口随符卡数递增`);

// 理论值对照
const theory = { 0: 4, 1: 14, 2: 20, 3: 26 };
let formulaOk = true;
for (const n of [0, 1, 2, 3]) {
  const expected = (theory[n] / 60) * 1000;
  if (Math.abs(windows[n] - expected) > 1) formulaOk = false;
}
console.log(`  ${formulaOk ? '✓' : '✗'} 符合公式 8帧 + 符卡数×6（0张为4帧）`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  符卡系统验收');
console.log('════════════════════════════════════');
const checks = [
  ['X 键释放符卡（清屏+无敌+消耗）', castOk],
  ['中弹先进入决死，不立即扣命', deathbombEntered],
  ['决死窗口内按 X 能救场', saveOk],
  ['决死不按 → 扣命且符卡重置', missOk],
  ['决死窗口随符卡数递增', monotonic],
  ['窗口时长符合公式', formulaOk],
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
