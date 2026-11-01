/**
 * 验证控制台的抽牌 / 弃牌指令。
 * 运行：node tests/e2e/p3-console-draw.mjs
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

async function cmd(line) {
  await page.fill('#dc-input', line);
  await page.press('#dc-input', 'Enter');
  await page.waitForTimeout(200);
  const out = await page.$$eval('.dc-line', (els) => els.map((e) => e.textContent));
  return out.slice(-3).filter(Boolean);
}

const state = () => page.evaluate(() => ({
  hand: window.__world.deck.pile.handSize,
  draw: window.__world.deck.pile.drawCount,
  discard: window.__world.deck.pile.discardCount,
  total: window.__world.deck.pile.totalCards,
  handNames: window.__world.deck.pile.hand.map((c) => c.name),
}));

// 打开控制台
await page.keyboard.press('Backquote');
await page.waitForTimeout(300);

// ── 1. help 里有新指令 ──
console.log('── 1. help 列出抽弃指令 ──');
let out = await cmd('help');
const txt = out.join('\n');
const hasCmds = ['draw', 'discard', 'discardall', 'deck'].every((c) => txt.includes(c));
console.log(`  含 draw/discard/discardall/deck：${hasCmds}`);
checks.push(['help 含抽弃指令', hasCmds]);

// ── 2. 抽牌 ──
console.log('\n── 2. draw 抽牌 ──');
await page.evaluate(() => window.__world.debugDiscardAll());
let s0 = await state();
console.log(`  起始：手牌 ${s0.hand}`);

out = await cmd('draw 1');
let s1 = await state();
console.log(`  ${out[out.length - 1]}`);
console.log(`  手牌 ${s0.hand} → ${s1.hand}`);
checks.push(['draw 1 生效', s1.hand === s0.hand + 1]);

out = await cmd('draw 2');
let s2 = await state();
console.log(`  ${out[out.length - 1]}`);
console.log(`  手牌 ${s1.hand} → ${s2.hand}`);
checks.push(['draw 2 生效', s2.hand === s1.hand + 2]);

// ── 3. 弃牌 ──
console.log('\n── 3. discard 弃牌 ──');
const beforeNames = (await state()).handNames;
out = await cmd('discard 1');
let s3 = await state();
console.log(`  ${out[out.length - 1]}`);
console.log(`  手牌 ${beforeNames.join(',')} → ${s3.handNames.join(',')}`);
checks.push([
  'discard 1 弃掉第一张',
  s3.hand === s2.hand - 1 && s3.handNames[0] === beforeNames[1],
]);

// ── 4. 弃指定位置 ──
console.log('\n── 4. discard 指定位置 ──');
const names4 = (await state()).handNames;
out = await cmd('discard 2');
let s4 = await state();
console.log(`  ${out[out.length - 1]}`);
console.log(`  ${names4.join(',')} → ${s4.handNames.join(',')}`);
const removedSecond = !s4.handNames.includes(names4[1]);
checks.push(['discard 2 弃掉第二张', removedSecond && s4.hand === s3.hand - 1]);

// ── 5. 弃牌进弃牌堆 ──
console.log('\n── 5. 弃掉的牌进入弃牌堆 ──');
const s5 = await state();
console.log(`  弃牌堆 ${s5.discard} 张，总数 ${s5.total}`);
checks.push(['弃牌堆增加', s5.discard >= 2]);

// ── 6. deck 查看 ──
console.log('\n── 6. deck 查看牌堆 ──');
out = await cmd('deck');
console.log('  ' + out.join('\n  '));
checks.push(['deck 有输出', out.some((l) => l?.includes('手牌'))]);

// ── 7. discardall ──
console.log('\n── 7. discardall 弃光 ──');
out = await cmd('discardall');
let s7 = await state();
console.log(`  ${out[out.length - 1]}`);
console.log(`  手牌 ${s7.hand}，弃牌堆 ${s7.discard}`);
checks.push(['discardall 生效', s7.hand === 0]);

// ── 8. 抽牌总量守恒 ──
console.log('\n── 8. 牌堆总数守恒 ──');
const s8a = await state();
await cmd('draw 2');
const s8b = await state();
console.log(`  总数 ${s8a.total} → ${s8b.total}`);
checks.push(['总数守恒', s8a.total === s8b.total]);

// ── 9. 满手抽牌触发过载 ──
console.log('\n── 9. 满手时抽牌触发过载 ──');
await page.evaluate(() => {
  const w = window.__world;
  w.debugDiscardAll();
  w.debugFillHand();
});
const full = await state();
out = await cmd('draw 1');
const overloadText = out.join(' ');
console.log(`  满手 ${full.hand} 张时抽牌`);
console.log(`  输出含"过载"：${overloadText.includes('过载')}`);
checks.push(['满手抽牌报过载', overloadText.includes('过载')]);

// ── 10. 无效参数有提示 ──
console.log('\n── 10. 参数错误提示 ──');
out = await cmd('draw abc');
const errText = out.join(' ');
console.log(`  ${errText}`);
checks.push(['无效参数有提示', errText.includes('用法')]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-27-console-draw.png') });

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  抽牌 / 弃牌指令验收');
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
