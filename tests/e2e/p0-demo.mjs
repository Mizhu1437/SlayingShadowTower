/**
 * P0 端到端验证：启动浏览器 → 打开 demo → 采集帧率 → 截图
 *
 * 这是"我能自己看到结果"的能力证明。
 * 对 AI 代工项目来说，这比代码写得多漂亮重要得多。
 *
 * 运行：node tests/e2e/p0-demo.mjs
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
  args: ['--use-gl=angle', '--use-angle=gl', '--enable-gpu-rasterization'],
});

const page = await browser.newPage({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

console.log(`打开 ${URL} …`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

// 等 canvas 出现（说明 PixiJS 初始化成功）
await page.waitForSelector('canvas', { timeout: 15000 });
console.log('✓ canvas 已渲染');

/** 读取 HUD 上的某个数值 */
async function readHud(id) {
  const el = await page.$(`#${id}`);
  return el ? (await el.textContent())?.trim() : null;
}

/** 采样 N 秒，返回 FPS 序列 */
async function sampleFps(seconds = 4) {
  const samples = [];
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await page.waitForTimeout(500);
    const v = await readHud('fps');
    if (v && v !== '—') samples.push(Number(v));
  }
  return samples;
}

async function testCase(label, key, bulletCount) {
  console.log(`\n── ${label} ──`);
  if (key) {
    await page.keyboard.press(key);
    await page.waitForTimeout(600);
  }

  const bullets = await readHud('bullets');
  const mode = await readHud('mode');
  const fps = await sampleFps(4);

  const avg = fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : 0;
  const min = fps.length ? Math.min(...fps) : 0;

  console.log(`  敌弹数：${bullets}`);
  console.log(`  碰撞模式：${mode}`);
  console.log(`  FPS 采样：${fps.join(', ')}`);
  console.log(`  平均 ${avg.toFixed(1)} / 最低 ${min.toFixed(1)}`);

  // 抓逻辑与碰撞耗时
  const logic = await readHud('logic');
  const grid = await readHud('grid');
  console.log(`  逻辑耗时：${logic} ms　碰撞耗时：${grid} ms`);

  await page.screenshot({
    path: resolve(SHOT_DIR, `p0-${bulletCount}.png`),
  });

  return { bullets, mode, avg, min, logic, grid };
}

const results = [];

// 2000 弹（默认）
results.push(await testCase('2000 弹 · 空间哈希', null, 2000));

// 切到暴力遍历对比
await page.keyboard.press('g');
await page.waitForTimeout(800);
results.push(await testCase('2000 弹 · 暴力遍历', null, 2000));
await page.keyboard.press('g'); // 切回
await page.waitForTimeout(400);

// 4000 弹压力测试
await page.keyboard.press('5');
await page.waitForTimeout(800);
results.push(await testCase('4000 弹 · 空间哈希', null, 4000));

// 纯逻辑基准
console.log('\n── 纯逻辑基准（B 键）──');
await page.keyboard.press('b');
await page.waitForTimeout(6000);
const benchText = await readHud('bench');
console.log(benchText?.replace(/\s+/g, ' ').trim() ?? '(无输出)');

// 切回 2000
await page.keyboard.press('3');
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(SHOT_DIR, 'p0-final.png') });

console.log('\n════════════════════════════════════');
console.log('  汇总');
console.log('════════════════════════════════════');
for (const r of results) {
  const pass = r.avg >= 55 ? '✓' : r.avg >= 40 ? '!' : '✗';
  console.log(
    `  ${pass} ${String(r.bullets).padStart(5)} 弹  平均 ${r.avg.toFixed(1)} FPS  最低 ${r.min.toFixed(1)}` +
    `  ｜ 逻辑 ${r.logic}ms  碰撞 ${r.grid}ms  ｜ ${r.mode}`,
  );
}

console.log(`\n截图已保存到：${SHOT_DIR}`);

if (errors.length) {
  console.log('\n⚠ 控制台错误：');
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
} else {
  console.log('\n✓ 无控制台错误');
}

await browser.close();
