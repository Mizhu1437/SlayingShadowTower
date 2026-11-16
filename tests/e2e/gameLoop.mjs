/**
 * 游戏循环 e2e：主菜单 → 开始 → 死亡 → 结算 → 再来一局 → 回主菜单
 * 运行：node tests/e2e/gameLoop.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-gl=angle'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const checks = [];
const ck = (name, ok) => { checks.push([name, ok]); };

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForSelector('#main-menu', { timeout: 15000 });
await p.waitForTimeout(1000);

// 1. 主菜单
let r = await p.evaluate(() => ({
  menu: !document.getElementById('main-menu')?.classList.contains('hidden'),
  phase: window.__world?.flow?.phase,
  wave: window.__world?.waves?.waveTime ?? 0,
  items: document.querySelectorAll('.mm-item').length,
}));
ck('主菜单显示', r.menu);
ck('阶段为 menu', r.phase === 'menu');
ck('主菜单时游戏未推进', r.wave === 0);
ck('四档难度可选', r.items === 4);

// 2. 开始游戏
await p.click('.mm-item[data-id="hard"]');
await p.click('#mm-start');
await p.waitForTimeout(2200);
r = await p.evaluate(() => ({
  hidden: document.getElementById('main-menu')?.classList.contains('hidden'),
  phase: window.__world?.flow?.phase,
  diff: window.__world?.difficulty?.id,
  wave: +(window.__world?.waves?.waveTime ?? 0).toFixed(1),
}));
ck('开始后菜单隐藏', r.hidden);
ck('阶段为 playing', r.phase === 'playing');
ck('难度已应用', r.diff === 'hard');
ck('波次开始推进', r.wave > 0);

// 3. 死亡
await p.evaluate(() => window.__world.flow.onPlayerDead());
await p.waitForTimeout(500);
r = await p.evaluate(() => ({
  panel: !document.getElementById('overlay')?.classList.contains('hidden'),
  phase: window.__world?.flow?.phase,
}));
ck('死亡面板显示', r.panel);
ck('阶段为 dead', r.phase === 'dead');

// 4. 放弃 → 结算
await p.click('#btn-giveup');
await p.waitForTimeout(600);
r = await p.evaluate(() => {
  const rs = document.getElementById('result-screen');
  return {
    visible: rs && !rs.classList.contains('hidden'),
    grade: document.getElementById('rs-grade')?.textContent,
    rows: document.querySelectorAll('.rs-item').length,
    phase: window.__world?.flow?.phase,
  };
});
ck('结算界面显示', r.visible);
ck('有评级', !!r.grade && r.grade.length === 1);
ck('有分项明细', r.rows >= 6);
ck('阶段为 cleared', r.phase === 'cleared');

// 5. 再来一局
await p.click('#rs-restart');
await p.waitForTimeout(1800);
r = await p.evaluate(() => ({
  hidden: document.getElementById('result-screen')?.classList.contains('hidden'),
  phase: window.__world?.flow?.phase,
  wave: +(window.__world?.waves?.waveTime ?? 0).toFixed(1),
}));
ck('结算关闭', r.hidden);
ck('重新进入 playing', r.phase === 'playing');
ck('新对局在推进', r.wave > 0);

// 6. 回主菜单
await p.evaluate(() => window.__world.flow.onPlayerDead());
await p.waitForTimeout(400);
await p.click('#btn-giveup');
await p.waitForTimeout(500);
await p.click('#rs-menu');
await p.waitForTimeout(500);
r = await p.evaluate(() => ({
  menu: !document.getElementById('main-menu')?.classList.contains('hidden'),
  result: document.getElementById('result-screen')?.classList.contains('hidden'),
}));
ck('返回主菜单', r.menu);
ck('结算已关闭', r.result);

// 汇总
console.log('\n════ 游戏循环验收 ════');
let pass = 0;
for (const [n, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${n}`); if (ok) pass++; }
console.log(`\n  ${pass}/${checks.length} 项通过`);

if (errs.length) { console.log('\n⚠ 错误：'); for (const e of errs.slice(0, 5)) console.log('  ' + e); }
else console.log('\n✓ 无控制台错误');

await b.close();
process.exit(pass === checks.length && errs.length === 0 ? 0 : 1);
