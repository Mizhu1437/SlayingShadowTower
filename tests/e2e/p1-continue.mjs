/**
 * 续关面板端到端验证。
 *
 * 用 Playwright 真的把自机打死，然后检查：
 *   1. 面板是否弹出
 *   2. 游戏是否真的暂停（子弹不动）
 *   3. 点「续关」是否恢复
 *
 * 运行：node tests/e2e/p1-continue.mjs
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
    phase: w.phase,
    lives: w.player.lives,
    score: w.score,
    kills: w.kills,
    bullets: w.enemyBullets.aliveCount,
    shots: w.playerShots.aliveCount,
  };
});

/** 直接把自机打死（注入子弹，比硬躲快得多） */
async function killPlayer() {
  await page.evaluate(() => {
    const w = window.__world;
    // 反复注入子弹直到死
    for (let i = 0; i < 20 && !w.player.dead; i++) {
      w.player.invuln = 0;
      w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
      w.step();
    }
  });
}

// ── 检查 1：先攒点分数 ──
console.log('── 检查 1：先玩一会儿攒分数 ──');
await page.waitForTimeout(6000);
let s = await readWorld();
console.log(`  阶段=${s.phase} 分数=${s.score} 击破=${s.kills} 残机=${s.lives}`);

// ── 检查 2：把自机打死 ──
console.log('\n── 检查 2：打死自机，观察是否暂停 ──');
await killPlayer();
await page.waitForTimeout(600);

s = await readWorld();
console.log(`  阶段 = ${s.phase}（应为 dead）`);
console.log(`  残机 = ${s.lives}（应为 0）`);
const phaseOk = s.phase === 'dead' && s.lives === 0;
console.log(`  ${phaseOk ? '✓' : '✗'} 进入死亡阶段`);

// 面板是否可见
const overlayVisible = await page.isVisible('#overlay');
console.log(`  ${overlayVisible ? '✓' : '✗'} 续关面板已弹出`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p1-04-dead.png') });

// ── 检查 3：游戏是否真的暂停 ──
console.log('\n── 检查 3：暂停后子弹是否冻结 ──');
const frozen = await page.evaluate(async () => {
  const w = window.__world;
  // 清空后放一颗会飞的子弹
  w.enemyBullets.clear();
  const idx = w.enemyBullets.spawn(50, 200, 200, 0, 4, 10);
  const x0 = w.enemyBullets.x[idx];
  // 等 500ms
  await new Promise((r) => setTimeout(r, 500));
  const x1 = w.enemyBullets.x[idx];
  return { x0, x1, moved: Math.abs(x1 - x0) };
});
console.log(`  子弹 x: ${frozen.x0} → ${frozen.x1}（位移 ${frozen.moved}）`);
console.log(`  ${frozen.moved === 0 ? '✓ 完全冻结，游戏确实暂停' : '✗ 仍在移动'}`);

// ── 检查 4：点续关 ──
console.log('\n── 检查 4：点「续关」按钮 ──');
await page.click('#btn-continue');
await page.waitForTimeout(800);

s = await readWorld();
console.log(`  阶段 = ${s.phase}（应回到 playing）`);
console.log(`  残机 = ${s.lives}（应恢复满）`);
console.log(`  敌弹 = ${s.bullets}（应被清空）`);
const resumedOk = s.phase === 'playing' && s.lives === 3;
console.log(`  ${resumedOk ? '✓ 成功续关' : '✗ 未恢复'}`);

const overlayHidden = !(await page.isVisible('#overlay'));
console.log(`  ${overlayHidden ? '✓ 面板已关闭' : '✗ 面板仍在'}`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p1-05-resumed.png') });

// ── 检查 5：续关后能继续玩 ──
console.log('\n── 检查 5：续关后游戏恢复推进 ──');
const beforeShots = s.shots;
await page.waitForTimeout(1200);
s = await readWorld();
console.log(`  自机子弹数 ${beforeShots} → ${s.shots}（应恢复生成）`);
console.log(`  ${s.shots > 0 ? '✓ 射击已恢复' : '✗ 未恢复'}`);

// ── 检查 6：键盘快捷方式 ──
console.log('\n── 检查 6：Enter 快捷键续关 ──');
await killPlayer();
await page.waitForTimeout(400);
s = await readWorld();
const deadAgain = s.phase === 'dead';
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
s = await readWorld();
console.log(`  死后用 Enter：阶段 ${s.phase} 残机 ${s.lives}`);
const enterOk = deadAgain && s.phase === 'playing';
console.log(`  ${enterOk ? '✓ Enter 快捷键有效' : '✗ 无效'}`);

// ── 检查 7：放弃 → 结算 ──
console.log('\n── 检查 7：放弃后进入结算 ──');
await killPlayer();
await page.waitForTimeout(400);
await page.click('#btn-giveup');
await page.waitForTimeout(600);
s = await readWorld();
console.log(`  阶段 = ${s.phase}（应为 cleared）`);
const giveUpOk = s.phase === 'cleared';
console.log(`  ${giveUpOk ? '✓ 已进入结算' : '✗ 未进入'}`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p1-06-cleared.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  续关功能验收');
console.log('════════════════════════════════════');
const checks = [
  ['死亡后进入 dead 阶段', phaseOk],
  ['续关面板弹出', overlayVisible],
  ['暂停后子弹完全冻结', frozen.moved === 0],
  ['点续关后恢复满残机', resumedOk],
  ['续关后面板关闭', overlayHidden],
  ['续关后射击恢复', s.shots > 0 || beforeShots > 0],
  ['Enter 快捷键有效', enterOk],
  ['放弃后进入结算', giveUpOk],
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
