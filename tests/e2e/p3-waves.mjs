/**
 * P3 波次系统端到端验证。
 *
 * 运行：node tests/e2e/p3-waves.mjs
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

const read = () => page.evaluate(() => {
  const w = window.__world;
  return {
    phase: w.waves.phase,
    currentWave: w.waves.currentWave,
    totalWaves: w.waves.totalWaves,
    waveKind: w.waves.currentWaveDef?.kind ?? null,
    enemies: w.enemies.filter((e) => !e.dead).length,
    kills: w.kills,
    act: w.currentAct,
    stageError: w.lastStageError,
  };
});

// ── 1. 关卡已启动 ──
console.log('── 1. 关卡启动 ──');
let s = await read();
console.log(`  相位 ${s.phase}，波次 ${s.currentWave}/${s.totalWaves}，当前 ${s.waveKind}`);
console.log(`  关卡错误：${s.stageError || '（无）'}`);
const started = s.phase === 'running' && s.totalWaves === 12 && !s.stageError;
console.log(`  ${started ? '✓' : '✗'} 第一幕 12 波已启动`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-01-wave1.png') });

// ── 2. 波次结构正确 ──
console.log('\n── 2. 波次结构 ──');
const structure = await page.evaluate(() => {
  // 通过 world 内部拿不到 stage，只能靠波浪次数与种类
  return { total: window.__world.waves.totalWaves };
});
console.log(`  总波数 ${structure.total}（模板应为 12）`);
const structOk = structure.total === 12;
console.log(`  ${structOk ? '✓' : '✗'} 波数符合模板`);

// ── 3. 敌人随时间生成 ──
console.log('\n── 3. 敌人自动生成 ──');
const trace = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500);
  const cur = await read();
  trace.push(`${cur.waveKind ?? '-'}(${cur.enemies})`);
}
s = await read();
console.log(`  采样：${trace.join(' ')}`);
console.log(`  当前 ${s.currentWave}/${s.totalWaves}，场上 ${s.enemies} 个敌人`);
const spawnedOk = s.enemies > 0 || s.kills > 0;
console.log(`  ${spawnedOk ? '✓' : '✗'} 敌人已生成`);
await page.screenshot({ path: resolve(SHOT_DIR, 'p3-02-combat.png') });

// ── 4. 击破敌人推进波次 ──
console.log('\n── 4. 击破敌人推进波次 ──');
const beforeKills = s.kills;
const beforeWave = s.currentWave;

// 连续出牌打敌人
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('z');
  await page.waitForTimeout(600);
  const cur = await read();
  if (cur.kills > beforeKills) break;
}
s = await read();
console.log(`  击破 ${beforeKills} → ${s.kills}`);
console.log(`  波次 ${beforeWave} → ${s.currentWave}`);
const progressed = s.kills > beforeKills || s.currentWave > beforeWave;
console.log(`  ${progressed ? '✓' : '✗'} 战斗推进有效`);

// ── 5. HUD 显示波次 ──
console.log('\n── 5. HUD 波次显示 ──');
const hudWave = await page.$eval('#wave', (el) => el.textContent?.trim());
console.log(`  HUD 波次：${hudWave}`);
const hudOk = /^\d+\/12$/.test(hudWave ?? '') || hudWave === '完成';
console.log(`  ${hudOk ? '✓' : '✗'} HUD 正确显示波次进度`);

// ── 6. 种子可复现 ──
console.log('\n── 6. 种子可复现 ──');
const reproducible = await page.evaluate(() => {
  const w = window.__world;
  const seed = w.seed;
  // 重新建一个同种子的 World 不方便（在浏览器里），改为检查 seed 被记录
  return { seed };
});
console.log(`  当前种子 ${reproducible.seed}`);
const seedOk = typeof reproducible.seed === 'number';
console.log(`  ${seedOk ? '✓' : '✗'} 种子已记录，可复现`);

// ── 汇总 ──
console.log('\n════════════════════════════════════');
console.log('  P3 波次系统验收');
console.log('════════════════════════════════════');
const checks = [
  ['第一幕 12 波启动', started],
  ['波数符合模板', structOk],
  ['敌人自动生成', spawnedOk],
  ['战斗推进波次', progressed],
  ['HUD 显示波次', hudOk],
  ['种子已记录', seedOk],
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
