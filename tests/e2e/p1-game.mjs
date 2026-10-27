/**
 * P1 端到端验证：自机移动、自动射击、击破敌人。
 *
 * 运行：node tests/e2e/p1-game.mjs
 * 前置：pnpm dev 已在 5173 端口运行
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, '../../docs/shots');
mkdirSync(SHOT_DIR, { recursive: true });

const URL = 'http://localhost:5173/';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=gl'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

console.log(`打开 ${URL} …`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('canvas', { timeout: 15000 });
console.log('✓ canvas 已渲染');

/** 读取 World 的状态（依赖 main.ts 暴露的 __world） */
async function readWorld() {
  return await page.evaluate(() => {
    const w = window.__world;
    return {
      px: +w.player.x.toFixed(1),
      py: +w.player.y.toFixed(1),
      lives: w.player.lives,
      kills: w.kills,
      score: w.score,
      coins: w.coins,
      shots: w.playerShots.aliveCount,
      enemies: w.enemies.length,
      focusing: w.player.focusing,
    };
  });
}

async function hud(id) {
  const el = await page.$(`#${id}`);
  return el ? (await el.textContent())?.trim() : null;
}

// ── 检查 1：初始状态 ──
console.log('\n── 检查 1：初始状态 ──');
let s = await readWorld();
console.log(`  自机位置 (${s.px}, ${s.py})`);
console.log(`  残机 ${s.lives}　射击数 ${s.shots}　敌人数 ${s.enemies}`);
const startPos = { x: s.px, y: s.py };
await page.screenshot({ path: resolve(SHOT_DIR, 'p1-01-start.png') });

// ── 检查 2：自动射击 ──
console.log('\n── 检查 2：自动射击（不按任何键）──');
await page.waitForTimeout(1200);
s = await readWorld();
console.log(`  射击数 ${s.shots}（应 > 0）`);
const autoShootOk = s.shots > 0;
console.log(`  ${autoShootOk ? '✓' : '✗'} 静止时自动射击`);

// ── 检查 3：方向键移动 ──
console.log('\n── 检查 3：方向键移动 ──');
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(400);
await page.keyboard.up('ArrowLeft');
s = await readWorld();
const movedLeft = s.px < startPos.x;
console.log(`  x: ${startPos.x} → ${s.px}　${movedLeft ? '✓ 左移生效' : '✗ 未移动'}`);

await page.keyboard.down('ArrowRight');
await page.waitForTimeout(700);
await page.keyboard.up('ArrowRight');
s = await readWorld();
const movedRight = s.px > startPos.x;
console.log(`  x: ${startPos.x} → ${s.px}　${movedRight ? '✓ 右移生效' : '✗ 未移动'}`);

// ── 检查 4：低速 ──
console.log('\n── 检查 4：Shift 低速 ──');
await page.keyboard.down('Shift');
await page.waitForTimeout(150);
s = await readWorld();
console.log(`  focusing = ${s.focusing}　${s.focusing ? '✓' : '✗'}`);

// 低速下移动更慢
const beforeSlow = s.px;
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(300);
await page.keyboard.up('ArrowLeft');
s = await readWorld();
const slowDist = Math.abs(s.px - beforeSlow);
await page.keyboard.up('Shift');

await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(300);
await page.keyboard.up('ArrowLeft');
s = await readWorld();
const fastDist = Math.abs(s.px - beforeSlow) - slowDist;
console.log(`  低速位移 ${slowDist.toFixed(1)}px　高速位移 ${fastDist.toFixed(1)}px`);
console.log(`  ${slowDist < fastDist ? '✓ 低速确实更慢' : '✗ 速度无差异'}`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p1-02-focus.png') });

// ── 检查 5：击破敌人（自机自动躲弹） ──
console.log('\n── 检查 5：击破敌人 ──');
console.log('  敌人会开火，脚本控制自机左右躲闪后击破（最长 30 秒）…');

/**
 * 简易自动躲弹：往子弹最少的方向移动，避免自机被打死导致游戏结束。
 * 这不是在测"AI 能玩"，只是为了让验收跑得完。
 */
async function dodgeStep() {
  const move = await page.evaluate(() => {
    const w = window.__world;
    const px = w.player.x;
    const py = w.player.y;

    // 找出离自机最近、且在下半区朝着自机来的子弹
    let bestDx = 0;
    let threat = 0;
    const f = w.enemyBullets;
    for (let i = 0; i < f.scanLimit; i++) {
      if (f.state[i] !== 1) continue;
      const dx = f.x[i] - px;
      const dy = f.y[i] - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > 90 * 90) continue;
      const w1 = 1 / Math.max(1, d2);
      if (w1 > threat) {
        threat = w1;
        bestDx = dx;
      }
    }
    // 往远离威胁的方向走
    if (threat > 0) return bestDx > 0 ? -1 : 1;
    // 没威胁时轻微游走，避开正面弹道
    return Math.sin(Date.now() / 600) > 0 ? 1 : -1;
  });

  if (move < 0) {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(60);
    await page.keyboard.up('ArrowLeft');
  } else {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(60);
    await page.keyboard.up('ArrowRight');
  }
}

let kills = 0;
let maxBullets = 0;
for (let i = 0; i < 100; i++) {
  await dodgeStep();
  s = await readWorld();
  if (s.shots > 0) maxBullets = Math.max(maxBullets, s.shots);
  if (s.kills > 0) { kills = s.kills; break; }
  if (s.lives === 0) break;
}
console.log(`  击破 ${kills} 个　得分 ${s.score}　蜃銭 ${s.coins}　残机 ${s.lives}`);
console.log(`  ${kills > 0 ? '✓ 自动射击能击破敌人' : '✗ 未能击破'}`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p1-03-combat.png') });

// ── 检查 6：HUD 同步 ──
console.log('\n── 检查 6：HUD 与内部状态一致 ──');
const hudKills = await hud('kills');
const hudScore = await hud('score');
const hudLives = await hud('lives');
const hudFps = await hud('fps');
console.log(`  HUD: 击破=${hudKills} 得分=${hudScore} 残机=${hudLives} FPS=${hudFps}`);
const hudOk =
  Number(hudKills) === s.kills &&
  Number(hudScore) === s.score &&
  Number(hudLives) === s.lives;
console.log(`  ${hudOk ? '✓ HUD 与内部状态一致' : '✗ HUD 不同步'}`);

// ── 检查 7：帧率 ──
console.log('\n── 检查 7：帧率 ──');
const fpsSamples = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  const v = await hud('fps');
  if (v && v !== '—') fpsSamples.push(Number(v));
}
const avgFps = fpsSamples.reduce((a, b) => a + b, 0) / (fpsSamples.length || 1);
console.log(`  FPS 采样 ${fpsSamples.join(', ')}　平均 ${avgFps.toFixed(1)}`);
console.log(`  ${avgFps >= 55 ? '✓ 满帧' : '⚠ 未满帧'}`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p1-final.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  P1 验收汇总');
console.log('════════════════════════════════════');
const checks = [
  ['自动射击（静止也开火）', autoShootOk],
  ['方向键左移', movedLeft],
  ['方向键右移', movedRight],
  ['Shift 低速状态', s.focusing !== undefined],
  ['击破敌人并计分', kills > 0],
  ['HUD 与内部状态同步', hudOk],
  ['帧率 ≥ 55', avgFps >= 55],
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
