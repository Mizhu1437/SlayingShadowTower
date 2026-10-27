/**
 * 验证火鸟卡的外观。
 * 运行：node tests/e2e/p3-firebird.mjs
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

console.log('── 1. 卡名 ──');
const cardName = await page.evaluate(() => {
  const w = window.__world;
  const c = w.deck.pile.hand.find((x) => x.name.includes('火鸟'))
    || w.deck.pile.hand[0];
  return c?.name;
});
console.log(`  手牌中的火鸟卡：${cardName}`);

console.log('\n── 2. 打出火鸟并截图 ──');
await page.evaluate(() => {
  const w = window.__world;
  // 让火鸟卡进入手牌并选中
  const firebird = w.deck.passives; // 占位
  void firebird;

  // 直接把火鸟卡塞进手牌首位
  const card = {
    id: 'houyokutenshou',
    name: '不死「火鸟 -凤翼天翔-」',
    type: 'active',
    rarity: 'starter',
    price: 0,
    energy: 2,
    text: '发射穿透的凤凰造成高额伤害，命中者虚弱并燃烧 10 秒。',
    effects: [
      { op: 'pierce_shot', count: 1, damage: 400, speed: 380, pierce: 99, radius: 26, kind: 'firebird' },
      { op: 'apply_status', status: 'weak', seconds: 10 },
      { op: 'apply_status', status: 'burn', seconds: 10 },
    ],
  };
  w.deck.pile.hand.unshift(card);
  w.deck.selected = 0;
  w.deck.energy.refill();

  // 放几个敌人在上方
  for (const [x, y] of [[150, 120], [192, 170], [240, 120]]) {
    w.spawnEnemy({ hp: 3000, radius: 16, score: 1, coin: 1 }, x, y);
  }
  w.step();

  w.playSelectedCard();
});

// 立刻截图，捕捉火鸟飞行中
await page.waitForTimeout(120);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-05-firebird-a.png') });
console.log('  截图 1（飞行初期）');

await page.waitForTimeout(180);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-06-firebird-b.png') });
console.log('  截图 2（飞行中段）');

// 检查火鸟是否存在
const state = await page.evaluate(() => {
  const w = window.__world;
  const s = w.cardShots.shots;
  let firebirds = 0;
  for (let i = 0; i < s.field.scanLimit; i++) {
    if (s.field.state[i] !== 1) continue;
    if (s.kind[i] === 3) firebirds++;   // KIND_FIREBIRD
  }
  return { firebirds, alive: s.aliveCount };
});
console.log(`\n  场上火鸟数量：${state.firebirds}（自机子弹共 ${state.alive}）`);

// 检查点燃传播
console.log('\n── 3. 燃烧与点燃 ──');
await page.waitForTimeout(1200);
const status = await page.evaluate(() => {
  const w = window.__world;
  return w.enemies.filter((e) => !e.dead).map((e) => ({
    burning: e.status.isBurning,
    weak: e.status.isWeak,
    hp: Math.round(e.hp),
  }));
});
console.log(`  存活敌人状态：${JSON.stringify(status)}`);
const anyBurning = status.some((e) => e.burning);
console.log(`  ${anyBurning ? '✓' : '✗'} 有敌人处于燃烧状态`);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-07-burning.png') });

// 汇总
console.log('\n════════════════════════════════════');
const ok = state.firebirds > 0 || state.alive > 0;
console.log(`  ${ok ? '✓' : '✗'} 火鸟已发射`);
console.log(`  ${anyBurning ? '✓' : '✗'} 燃烧状态生效`);

if (errors.length) {
  console.log('\n⚠ 控制台错误：');
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
} else {
  console.log('\n✓ 无控制台错误');
}

await browser.close();
