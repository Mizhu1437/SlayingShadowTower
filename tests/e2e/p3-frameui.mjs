/**
 * 验证横版布局 + E/Q/Tab 牌堆快捷键。
 * 运行：node tests/e2e/p3-frameui.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, '../../docs/shots');
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.card', { timeout: 15000 });
await page.waitForTimeout(2000);
console.log('✓ 页面已加载\n');

const checks = [];

// 开无敌避免测试中死亡
await page.evaluate(() => window.__world.debug.set('invincible', true));

// ── 1. 横版画布 ──
console.log('── 1. 横版画布 ──');
const canvas = await page.$eval('canvas', (el) => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log(`  画布 ${canvas.w}×${canvas.h}`);
checks.push(['画布为横版（宽>高）', canvas.w > canvas.h]);
checks.push(['画布宽度合理', canvas.w > 850 && canvas.w < 1000]);

// ── 2. 两侧面板 ──
console.log('\n── 2. 两侧面板 ──');
const panels = await page.evaluate(() => {
  const left = document.getElementById('panel-left');
  const right = document.getElementById('panel-right');
  const lb = left?.getBoundingClientRect();
  const rb = right?.getBoundingClientRect();
  return {
    leftExists: !!left, rightExists: !!right,
    leftX: lb ? Math.round(lb.x) : null,
    rightX: rb ? Math.round(rb.x) : null,
    leftAct: document.getElementById('act')?.textContent,
    lives: document.querySelectorAll('.life-star').length,
    spells: document.querySelectorAll('.spell-tag').length,
    coins: document.getElementById('coins')?.textContent,
  };
});
console.log(`  左侧面板 x=${panels.leftX}，幕次=${panels.leftAct}`);
console.log(`  右侧面板 x=${panels.rightX}`);
console.log(`  残机星 ${panels.lives} 个，符札 ${panels.spells} 个，蜃銭 ${panels.coins}`);
checks.push(['左右面板都存在', panels.leftExists && panels.rightExists]);
checks.push(['残机用星形显示', panels.lives >= 3]);
checks.push(['符卡用符札形显示', panels.spells === 3]);

// ── 3. 战场内无局外信息 ──
console.log('\n── 3. 战场内不应有 HUD ──');
// 用几何相交判断，而不是探点：探点会被 canvas 的父容器干扰
const geom = await page.evaluate(() => {
  const c = document.querySelector('canvas').getBoundingClientRect();
  const field = { l: c.x, t: c.y, r: c.right, b: c.bottom };
  const hit = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return !(r.right < field.l || r.left > field.r
      || r.bottom < field.t || r.top > field.b);
  };
  const hand = document.getElementById('hand-area');
  const hr = hand?.getBoundingClientRect();
  return {
    leftPanelHits: hit(document.getElementById('panel-left')),
    rightPanelHits: hit(document.getElementById('panel-right')),
    handBelow: hr ? Math.round(hr.top) >= Math.round(field.b) : null,
    fieldBottom: Math.round(field.b),
    handTop: hr ? Math.round(hr.top) : null,
  };
});
console.log(`  左面板与战场相交：${geom.leftPanelHits}`);
console.log(`  右面板与战场相交：${geom.rightPanelHits}`);
console.log(`  手牌顶 ${geom.handTop} / 战场底 ${geom.fieldBottom}`);
checks.push(['战场内无面板遮挡', !geom.leftPanelHits && !geom.rightPanelHits]);
checks.push(['手牌在战场下方', geom.handBelow === true]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-37-frameui.png') });

// ── 4. E 打开抽牌堆 ──
console.log('\n── 4. E 打开抽牌堆 ──');
await page.keyboard.press('e');
await page.waitForTimeout(400);
let pv = await page.evaluate(() => ({
  visible: !document.getElementById('pile-viewer')?.classList.contains('hidden'),
  title: document.getElementById('pv-title')?.textContent,
}));
console.log(`  面板可见=${pv.visible}，标题=${pv.title}`);
checks.push(['E 打开抽牌堆', pv.visible && String(pv.title).includes('抽牌堆')]);

await page.keyboard.press('e');
await page.waitForTimeout(300);
pv = await page.evaluate(() => ({
  visible: !document.getElementById('pile-viewer')?.classList.contains('hidden'),
}));
checks.push(['再按 E 关闭', !pv.visible]);

// ── 5. Q 打开弃牌堆 ──
console.log('\n── 5. Q 打开弃牌堆 ──');
await page.keyboard.press('q');
await page.waitForTimeout(400);
let pv2 = await page.evaluate(() => ({
  visible: !document.getElementById('pile-viewer')?.classList.contains('hidden'),
  title: document.getElementById('pv-title')?.textContent,
}));
console.log(`  面板可见=${pv2.visible}，标题=${pv2.title}`);
checks.push(['Q 打开弃牌堆', pv2.visible && String(pv2.title).includes('弃牌堆')]);
await page.keyboard.press('q');
await page.waitForTimeout(300);

// ── 6. Tab 打开卡组并暂停 ──
console.log('\n── 6. Tab 打开卡组并暂停 ──');
const beforeTab = await page.evaluate(() => window.__world.waves.waveTime);
await page.keyboard.press('Tab');
await page.waitForTimeout(900);
const tabState = await page.evaluate(() => ({
  visible: !document.getElementById('deck-overlay')?.classList.contains('hidden'),
  waveTime: window.__world.waves.waveTime,
  cards: document.querySelectorAll('.deck-card').length,
}));
console.log(`  面板可见=${tabState.visible}，卡牌 ${tabState.cards} 种`);
console.log(`  游戏时间 ${beforeTab.toFixed(2)} → ${tabState.waveTime.toFixed(2)}（应几乎不变）`);
checks.push(['Tab 打开卡组', tabState.visible && tabState.cards > 0]);
checks.push(['Tab 暂停游戏', Math.abs(tabState.waveTime - beforeTab) < 0.1]);

await page.screenshot({ path: resolve(SHOT_DIR, 'p3-38-deckoverlay.png') });

// ── 7. 再按 Tab 关闭并恢复 ──
console.log('\n── 7. 再按 Tab 关闭并恢复 ──');
await page.keyboard.press('Tab');
await page.waitForTimeout(800);
const afterTab = await page.evaluate(() => ({
  visible: !document.getElementById('deck-overlay')?.classList.contains('hidden'),
  waveTime: window.__world.waves.waveTime,
}));
console.log(`  面板可见=${afterTab.visible}，游戏时间 ${afterTab.waveTime.toFixed(2)}`);
checks.push(['Tab 关闭', !afterTab.visible]);
checks.push(['关闭后游戏继续', afterTab.waveTime > tabState.waveTime]);

// ── 8. 鼠标点击按钮也可以 ──
console.log('\n── 8. 鼠标点击牌堆按钮 ──');
const btns = await page.$$eval('.pv-btn', (els) => els.length);
console.log(`  右侧按钮数 ${btns}`);
checks.push(['按钮仍可用鼠标点击', btns === 3]);

// ── 9. 图标无 404 ──
console.log('\n── 9. 图标加载 ──');
const imgOk = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')];
  return imgs.map((i) => ({ src: i.src.split('/').pop(), ok: i.complete && i.naturalWidth > 0 }));
});
for (const i of imgOk.slice(0, 6)) console.log(`  ${i.src} → ${i.ok ? 'OK' : 'BROKEN'}`);
checks.push(['所有图标正常加载', imgOk.every((i) => i.ok)]);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  横版布局验收');
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
