/**
 * 验证开发者控制台。
 * 运行：node tests/e2e/p3-console.mjs
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

/** 执行一条指令 */
async function cmd(line) {
  await page.fill('#dc-input', line);
  await page.press('#dc-input', 'Enter');
  await page.waitForTimeout(150);
  const out = await page.$$eval('.dc-line', (els) =>
    els.map((e) => e.textContent), 
  );
  return out.slice(-4);
}

// ── 1. 按 ~ 打开 ──
console.log('── 1. 按 ~ 打开控制台 ──');
await page.keyboard.press('Backquote');
await page.waitForTimeout(300);

const visible = await page.$eval('#dev-console', (el) =>
  !el.classList.contains('hidden')).catch(() => false);
console.log(`  控制台可见：${visible}`);
checks.push(['按 ~ 打开控制台', visible]);

// 输入框是否聚焦
const focused = await page.evaluate(() =>
  document.activeElement?.id === 'dc-input');
console.log(`  输入框聚焦：${focused}`);
checks.push(['输入框自动聚焦', focused]);

// ── 2. help ──
console.log('\n── 2. help ──');
let out = await cmd('help');
const helpText = out.join('\n');
const hasAll = ['god', 'lockenergy', 'lockcoins', 'wave', 'shop', 'act']
  .every((c) => helpText.includes(c));
console.log(`  列出全部指令：${hasAll}`);
checks.push(['help 列出指令', hasAll]);

// ── 3. 无敌开关 ──
console.log('\n── 3. 无敌开关 ──');
out = await cmd('god on');
const godOn = await page.evaluate(() => window.__world.debug.invincible);
console.log(`  god on → invincible=${godOn}`);

// 实测中弹不死
const survived = await page.evaluate(async () => {
  const w = window.__world;
  const before = w.player.lives;
  for (let i = 0; i < 3; i++) {
    w.player.invuln = 0;
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    for (let j = 0; j < 60; j++) w.step();
  }
  return { before, after: w.player.lives };
});
console.log(`  连续中弹：残机 ${survived.before} → ${survived.after}`);
checks.push(['god 开启后不受伤', godOn && survived.after === survived.before]);

out = await cmd('god off');
const godOff = await page.evaluate(() => window.__world.debug.invincible);
console.log(`  god off → invincible=${godOff}`);
checks.push(['god 可关闭', !godOff]);

// ── 4. 锁能量 ──
console.log('\n── 4. 锁能量 ──');
await cmd('lockenergy on');
const energyLock = await page.evaluate(() => {
  const w = window.__world;
  w.deck.energy.refill();
  const before = w.deck.energy.value;
  for (let i = 0; i < 3; i++) {
    w.deck.energy.refill();
    w.playSelectedCard();
  }
  return { before, after: w.deck.energy.value };
});
console.log(`  连打 3 张：能量 ${energyLock.before} → ${energyLock.after}`);
checks.push(['锁能量生效', energyLock.after === energyLock.before]);
await cmd('lockenergy off');

// ── 5. 锁金钱 ──
console.log('\n── 5. 锁金钱 ──');
await cmd('lockcoins on');
await cmd('coins 1000');
const coinLock = await page.evaluate(async () => {
  const w = window.__world;
  // 清掉场上残留（敌人击杀会爆钱，与 MISS 无关，会干扰断言）
  w.coinDrops.length = 0;
  w.enemies.length = 0;
  w.coins = 1000;

  w.player.x = 96;
  w.player.y = 112;
  w.player.invuln = 0;
  w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
  for (let i = 0; i < 150; i++) w.step();
  return { coins: w.coins, drops: w.coinDrops.length };
});
console.log(`  MISS 后：蜃銭 ${coinLock.coins}，掉落物 ${coinLock.drops}`);
// 锁金钱时应：钱不变、且不产生 MISS 掉钱
checks.push(['锁金钱生效', coinLock.coins === 1000 && coinLock.drops === 0]);
await cmd('lockcoins off');

// 对照：关闭后 MISS 应该扣钱
const coinUnlock = await page.evaluate(async () => {
  const w = window.__world;
  w.coinDrops.length = 0;
  w.enemies.length = 0;
  w.coins = 1000;
  w.player.x = 96;
  w.player.y = 112;
  w.player.invuln = 0;
  w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
  for (let i = 0; i < 150; i++) w.step();
  return { coins: w.coins };
});
console.log(`  关闭锁金钱后 MISS：蜃銭 ${coinUnlock.coins}`);
checks.push(['关闭后 MISS 正常扣钱', coinUnlock.coins < 1000]);

// ── 6. 跳跃到波次 ──
console.log('\n── 6. 跳转到指定波 ──');
out = await cmd('wave 2 5');
console.log(`  输出：${out[out.length - 1]}`);
const jumped = await page.evaluate(() => ({
  act: window.__world.currentAct,
  wave: window.__world.waves.currentWave,
}));
console.log(`  实际：第 ${jumped.act + 1} 幕 第 ${jumped.wave} 波`);
checks.push(['wave 跳转生效', jumped.act === 1 && jumped.wave === 5]);

// ── 7. 跳到商店 ──
console.log('\n── 7. 跳到商店 ──');
out = await cmd('shop 3');
await page.waitForTimeout(600);
const shopState = await page.evaluate(() => ({
  phase: window.__world.phase,
  act: window.__world.currentAct,
  items: window.__world.shop.state.items.length,
}));
console.log(`  阶段=${shopState.phase} 幕=${shopState.act + 1} 商品=${shopState.items}`);
checks.push(['shop 跳转生效',
  shopState.phase === 'shop' && shopState.act === 2 && shopState.items === 8]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-26-console.png') });

// ── 8. status ──
console.log('\n── 8. status ──');
out = await cmd('status');
console.log('  ' + out.filter((l) => l?.includes('幕')).join('\n  '));
checks.push(['status 有输出', out.some((l) => l?.includes('蜃銭'))]);

// ── 9. 关闭控制台 ──
console.log('\n── 9. 再按 ~ 关闭 ──');
await page.keyboard.press('Backquote');
await page.waitForTimeout(300);
const hidden = await page.$eval('#dev-console', (el) =>
  el.classList.contains('hidden')).catch(() => false);
console.log(`  已隐藏：${hidden}`);
checks.push(['按 ~ 关闭控制台', hidden]);

// ── 10. 关闭后游戏恢复 ──
console.log('\n── 10. 关闭后游戏可继续 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.debugJumpToWave(0, 1);
});
await page.waitForTimeout(1200);
const running = await page.evaluate(() => ({
  wave: window.__world.waves.currentWave,
  phase: window.__world.phase,
}));
console.log(`  波次 ${running.wave}，阶段 ${running.phase}`);
checks.push(['关闭后可继续游戏', running.phase === 'playing']);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  开发者控制台验收');
console.log('════════════════════════════════════');
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
