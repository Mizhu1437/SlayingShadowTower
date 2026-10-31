/**
 * 验证符卡效果 + MISS 惩罚。
 * 运行：node tests/e2e/p3-miss.mjs
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

// ── 1. 符卡消弹 + 全屏伤害 ──
console.log('── 1. 符卡效果 ──');
const spellResult = await page.evaluate(() => {
  const w = window.__world;
  // 造敌弹
  for (let i = 0; i < 60; i++) {
    w.enemyBullets.spawn(30 + (i % 20) * 17, 80 + Math.floor(i / 20) * 50, 0, 40, 4, 6);
  }
  // 造敌人
  for (const [x, y] of [[120, 120], [200, 150], [280, 120]]) {
    w.spawnEnemy({ hp: 5000, radius: 18, score: 1, coin: 1 }, x, y);
  }
  w.step();

  const before = {
    bullets: w.enemyBullets.aliveCount,
    hpSum: w.enemies.filter((e) => !e.dead).reduce((s, e) => s + e.hp, 0),
    cards: w.spell.cards,
  };

  w.pressBomb();
  w.step();

  return {
    before,
    after: {
      bullets: w.enemyBullets.aliveCount,
      hpSum: w.enemies.filter((e) => !e.dead).reduce((s, e) => s + e.hp, 0),
      cards: w.spell.cards,
      invuln: w.player.invuln,
    },
  };
});
console.log(`  敌弹 ${spellResult.before.bullets} → ${spellResult.after.bullets}`);
console.log(`  敌人总血量 ${spellResult.before.hpSum} → ${spellResult.after.hpSum}`);
console.log(`  符卡 ${spellResult.before.cards} → ${spellResult.after.cards}`);
console.log(`  无敌 ${spellResult.after.invuln.toFixed(2)}s`);

const clearOk = spellResult.after.bullets === 0;
const dmgOk = spellResult.after.hpSum < spellResult.before.hpSum;
console.log(`  ${clearOk ? '✓' : '✗'} 全屏消弹`);
console.log(`  ${dmgOk ? '✓' : '✗'} 全屏伤害`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-10-spell.png') });

// ── 2. MISS 惩罚 ──
console.log('\n── 2. MISS 惩罚 ──');
const missResult = await page.evaluate(async () => {
  const w = window.__world;

  // 先等符卡 active 状态结束（否则自机处于符卡无敌期，打不中）
  for (let i = 0; i < 200 && w.spell.phase !== 'idle'; i++) w.step();

  w.coins = 1000;
  w.player.invuln = 0;

  // 挪到远离初始点的位置
  w.player.x = 96;
  w.player.y = 112;

  const before = {
    coins: w.coins,
    lives: w.player.lives,
    x: w.player.x,
    y: w.player.y,
  };

  // 中弹
  w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
  w.step();

  // 跑完决死窗口
  for (let i = 0; i < 150; i++) {
    w.step();
    if (w.player.invuln > 0 && w.coinDrops.length > 0) break;
  }

  const mid = {
    coins: w.coins,
    lives: w.player.lives,
    x: w.player.x,
    y: w.player.y,
    invuln: w.player.invuln,
    drops: w.coinDrops.length,
    dropTotal: w.coinDrops.reduce((s, c) => s + c.amount, 0),
  };

  return { before, mid };
});

console.log(`  蜃銭 ${missResult.before.coins} → ${missResult.mid.coins}`);
console.log(`  残机 ${missResult.before.lives} → ${missResult.mid.lives}`);
console.log(`  位置 (${missResult.before.x.toFixed(0)},${missResult.before.y.toFixed(0)}) → (${missResult.mid.x.toFixed(0)},${missResult.mid.y.toFixed(0)})`);
console.log(`  无敌 ${missResult.mid.invuln.toFixed(2)}s`);
console.log(`  掉落物 ${missResult.mid.drops} 个，总额 ${missResult.mid.dropTotal}`);

const lostRatio = (missResult.before.coins - missResult.mid.coins) / missResult.before.coins;
const coinOk = lostRatio > 0.35 && lostRatio < 0.45;
const dropOk = missResult.mid.drops > 0 && missResult.mid.dropTotal > 0;
const resetOk = Math.abs(missResult.mid.x - 192) < 5 && Math.abs(missResult.mid.y - 367) < 5;
const invulnOk = missResult.mid.invuln > 0;

console.log(`  ${coinOk ? '✓' : '✗'} 损失约 40%（实际 ${(lostRatio * 100).toFixed(0)}%）`);
console.log(`  ${dropOk ? '✓' : '✗'} 撞弹点爆出蜃銭`);
console.log(`  ${resetOk ? '✓' : '✗'} 自机重置到初始位置`);
console.log(`  ${invulnOk ? '✓' : '✗'} 获得无敌`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-11-coindrop.png') });

// ── 3. 掉落物能捡回来 ──
console.log('\n── 3. 掉落物可拾取 ──');
const pickupResult = await page.evaluate(async () => {
  const w = window.__world;
  const coinsBefore = w.coins;
  const dropsBefore = w.coinDrops.length;
  const totalAmount = w.coinDrops.reduce((s, c) => s + c.amount, 0);

  // 把自机挪到掉落物位置
  if (w.coinDrops.length > 0) {
    const d = w.coinDrops[0];
    w.player.x = d.x;
    w.player.y = d.y;
  }

  // 等拾取冷却结束
  for (let i = 0; i < 180; i++) {
    w.step();
    if (w.coinDrops.length === 0) break;
  }

  return {
    coinsBefore,
    coinsAfter: w.coins,
    dropsBefore,
    dropsAfter: w.coinDrops.length,
    totalAmount,
  };
});
console.log(`  蜃銭 ${pickupResult.coinsBefore} → ${pickupResult.coinsAfter}`);
console.log(`  掉落物 ${pickupResult.dropsBefore} → ${pickupResult.dropsAfter}`);
const pickupOk = pickupResult.coinsAfter > pickupResult.coinsBefore;
console.log(`  ${pickupOk ? '✓' : '✗'} 捡回蜃銭`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  符卡 + MISS 验收');
console.log('════════════════════════════════════');
const checks = [
  ['符卡全屏消弹', clearOk],
  ['符卡全屏伤害', dmgOk],
  ['MISS 损失 40% 蜃銭', coinOk],
  ['撞弹点爆出蜃銭', dropOk],
  ['自机重置到初始位置', resetOk],
  ['MISS 后获得无敌', invulnOk],
  ['掉落物可捡回', pickupOk],
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
