/**
 * 手牌选中态持久性验证（针对用户报告的 bug）。
 *
 * 用户报告：抽了牌或使用了牌之后，就看不到选中是哪张卡，
 *          必须按 C 才能重新看到。
 *
 * 根因：rebuild() 重建 DOM 后没有重新应用 selected 类，
 *      而 lastSelected 仍保留旧值，导致"选中没变"的误判。
 *
 * 运行：node tests/e2e/p2-selection.mjs
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

/** 读取 DOM 中哪个索引带 selected 类 */
const selectedDomIndex = () => page.$$eval('.card', (els) =>
  els.findIndex((e) => e.classList.contains('selected')));

/** 读取内部选中索引 */
const selectedModel = () => page.evaluate(() => window.__world.deck.selected);

/** 手牌数量 */
const handSize = () => page.evaluate(() => window.__world.deck.pile.handSize);

/** 检查 DOM 与模型是否一致 */
async function checkSync(label) {
  const dom = await selectedDomIndex();
  const model = await selectedModel();
  const n = await handSize();
  const ok = dom === model && (n === 0 || dom >= 0);
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}：模型选中=${model}，DOM 选中=${dom}，手牌 ${n} 张`,
  );
  return ok;
}

const results = [];

// ── 1. 初始状态 ──
console.log('── 1. 初始状态 ──');
results.push(await checkSync('初始'));

// ── 2. 抽牌后（不按 C）──
console.log('\n── 2. 等一次自动抽牌后 ──');
const h0 = await handSize();
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  if ((await handSize()) > h0) break;
}
results.push(await checkSync('抽牌后'));

// ── 3. 出牌后（不按 C）──
console.log('\n── 3. 按 Z 出牌后 ──');
await page.evaluate(() => {
  // 确保有能量
  window.__world.deck.energy.refill();
});
await page.keyboard.press('z');
await page.waitForTimeout(400);
results.push(await checkSync('出牌后'));

// ── 4. 再等一次抽牌 ──
console.log('\n── 4. 再等一次抽牌 ──');
const h1 = await handSize();
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  const cur = await handSize();
  if (cur !== h1) break;
}
results.push(await checkSync('抽牌后（第二次）'));

// ── 5. 按 C 切换后 ──
console.log('\n── 5. 按 C 切换 ──');
const before = await selectedModel();
await page.keyboard.press('c');
await page.waitForTimeout(200);
const after = await selectedModel();
console.log(`  选中 ${before} → ${after}`);
results.push(await checkSync('C 切换后'));

// ── 6. 连续抽牌，每帧都检查同步 ──
console.log('\n── 6. 连续抽牌过程保持同步 ──');
let syncFails = 0;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(250);
  const dom = await selectedDomIndex();
  const model = await selectedModel();
  const n = await handSize();
  if (n > 0 && dom !== model) {
    syncFails++;
    console.log(`    ✗ 第 ${i} 次采样失同步：模型=${model}, DOM=${dom}, 手牌=${n}`);
  }
}
const continuousOk = syncFails === 0;
console.log(`  ${continuousOk ? '✓' : '✗'} 24 次采样，失同步 ${syncFails} 次`);
results.push(continuousOk);

// ── 7. 过载后仍保持同步 ──
console.log('\n── 7. 过载后 ──');
await page.evaluate(() => {
  const w = window.__world;
  while (w.deck.pile.handSize < 6) w.deck.drawNow(1);
});
await page.waitForTimeout(150);
// 等过载触发
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  if (await page.evaluate(() => window.__world.deck.paused)) break;
}
results.push(await checkSync('过载后'));

await page.screenshot({ path: resolve(SHOT_DIR, 'p2-05-selection.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  选中态持久性验收');
console.log('════════════════════════════════════');
const names = [
  '初始状态同步',
  '抽牌后仍显示选中',
  '出牌后仍显示选中',
  '再次抽牌后仍显示选中',
  'C 切换正常',
  '连续抽牌保持同步',
  '过载后保持同步',
];
let pass = 0;
for (let i = 0; i < names.length; i++) {
  console.log(`  ${results[i] ? '✓' : '✗'} ${names[i]}`);
  if (results[i]) pass++;
}
console.log(`\n  ${pass}/${names.length} 项通过`);

if (errors.length) {
  console.log('\n⚠ 控制台错误：');
  for (const e of errors.slice(0, 6)) console.log('  ' + e);
} else {
  console.log('\n✓ 无控制台错误');
}

await browser.close();
process.exit(pass === names.length && errors.length === 0 ? 0 : 1);
