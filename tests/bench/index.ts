/**
 * P0 性能基准（Node 环境，无渲染）
 *
 * 目的：测「纯逻辑」能否在一帧预算内处理 2000 颗子弹。
 * 渲染性能另外在浏览器里看 FPS。
 *
 * 运行：pnpm bench
 *
 * ── 方法论 ──
 *
 * 前一版用了「固定重复次数 → 除以次数」，结果非单调（2000 颗比 4000 颗还慢），
 * 说明单次测量落进了性能计时器与 JIT 的噪声区，数据不可用于决策。
 *
 * 本版改用**时间累积法**：
 *   反复执行同一操作，直到累积耗时超过 MIN_DURATION，
 *   再用「总耗时 / 执行次数」得出单次耗时。
 *
 * 好处：
 *   - 每组测量都在同一时长尺度上（≥100ms），噪声占比被压到 1% 以下
 *   - 不同规模之间的比较不再受「测量窗口长度不同」影响
 *   - 自动适应 CPU 快慢，慢机器上也测得出稳定值
 *
 * 另外：
 *   - 每组独立跑 ROUNDS 轮，取中位数（抗离群值）
 *   - 每轮打乱执行顺序（消除降频导致的系统性偏差）
 *   - 结束时做单调性自检，不单调就明确报告"数据不可信"
 */

import { BulletField } from '../../src/core/danmaku/bulletField';
import { BulletFieldNaive } from '../../src/core/danmaku/bulletFieldNaive';
import { SpatialGrid, naiveGrazeCheck } from '../../src/core/danmaku/spatialGrid';
import { Rng } from '../../src/core/rng';

const W = 384;
const H = 448;
const DT = 1 / 60;
const BUDGET = 16.667;

/** 每次测量的最短累积时长（毫秒） */
const MIN_DURATION = 120;
/** 独立测量轮数 */
const ROUNDS = 5;

const SIZES = [500, 1000, 2000, 3000, 4000];

const f3 = (ms: number): string => ms.toFixed(3).padStart(7);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * 时间累积法：重复执行 body，直到累积耗时达到 MIN_DURATION。
 * 返回单次执行的平均耗时（毫秒）。
 */
function timeIt(body: () => void): number {
  // 先测一次估计单次耗时，用于推算需要跑多少次
  const probeStart = performance.now();
  body();
  const probeMs = Math.max(performance.now() - probeStart, 1e-4);

  // 目标循环次数：至少 1 次，且预计总量达到 MIN_DURATION 的两倍（留余量）
  const targetIters = Math.max(1, Math.ceil((MIN_DURATION * 2) / probeMs));

  // 分批执行，每批检查一次时间，避免单批过长导致长时间阻塞
  const BATCH = Math.max(1, Math.min(targetIters, 5000));
  let totalIters = 0;
  const t0 = performance.now();
  let elapsed = 0;

  do {
    for (let i = 0; i < BATCH; i++) body();
    totalIters += BATCH;
    elapsed = performance.now() - t0;
  } while (elapsed < MIN_DURATION && totalIters < 5_000_000);

  return elapsed / totalIters;
}

// ─────────────────────────────────────────────
// 数据准备
// ─────────────────────────────────────────────
function makeSoA(n: number, rng: Rng): BulletField {
  const f = new BulletField(4096);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const sp = 60 + rng.next() * 180;
    f.spawn(
      rng.next() * W, rng.next() * H,
      Math.cos(a) * sp, Math.sin(a) * sp,
      3, 1e9,
      (rng.next() - 0.5) * 20, (rng.next() - 0.5) * 20,
    );
  }
  return f;
}

function makeObj(n: number, rng: Rng): BulletFieldNaive {
  const f = new BulletFieldNaive(4096);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const sp = 60 + rng.next() * 180;
    f.spawn(
      rng.next() * W, rng.next() * H,
      Math.cos(a) * sp, Math.sin(a) * sp,
      3, 1e9,
      (rng.next() - 0.5) * 20, (rng.next() - 0.5) * 20,
    );
  }
  return f;
}

function wrapSoA(f: BulletField): void {
  const { x, y, state } = f;
  const end = f.scanLimit;
  for (let i = 0; i < end; i++) {
    if (state[i] !== 1) continue;
    if (x[i]! < 0) x[i] = W; else if (x[i]! > W) x[i] = 0;
    if (y[i]! < 0) y[i] = H; else if (y[i]! > H) y[i] = 0;
  }
}

function wrapObj(f: BulletFieldNaive): void {
  const b = f.bullets;
  for (let i = 0; i < b.length; i++) {
    const o = b[i]!;
    if (!o.alive) continue;
    if (o.x < 0) o.x = W; else if (o.x > W) o.x = 0;
    if (o.y < 0) o.y = H; else if (o.y > H) o.y = 0;
  }
}

interface CollData {
  ex: Float32Array;
  ey: Float32Array;
  ealive: Uint8Array;
  px: Float32Array;
  py: Float32Array;
  palive: Uint8Array;
  enemyCount: number;
  playerCount: number;
  grid: SpatialGrid;
  out: Int32Array;
}

const RADIUS = 7;
const R2 = RADIUS * RADIUS;

function makeCollData(enemyCount: number, playerCount: number, rng: Rng): CollData {
  const ex = new Float32Array(4096);
  const ey = new Float32Array(4096);
  const ealive = new Uint8Array(4096).fill(1);
  for (let i = 0; i < enemyCount; i++) {
    ex[i] = rng.next() * W;
    ey[i] = rng.next() * H;
  }
  const px = new Float32Array(1024);
  const py = new Float32Array(1024);
  const palive = new Uint8Array(1024).fill(1);
  for (let i = 0; i < playerCount; i++) {
    px[i] = rng.next() * W;
    py[i] = rng.next() * H;
  }
  return {
    ex, ey, ealive, px, py, palive, enemyCount, playerCount,
    grid: new SpatialGrid(W, H, 32, 4096),
    out: new Int32Array(1024),
  };
}

function runGrid(d: CollData): void {
  const { ex, ey, ealive, px, py, palive, enemyCount, playerCount, grid, out } = d;
  grid.rebuild(ex, ey, ealive, enemyCount);
  let hits = 0;
  for (let i = 0; i < playerCount; i++) {
    if (palive[i] !== 1) continue;
    const cnt = grid.queryNeighbors(px[i]!, py[i]!, out);
    for (let k = 0; k < cnt; k++) {
      const j = out[k]!;
      if (ealive[j] !== 1) continue;
      const dx = px[i]! - ex[j]!;
      const dy = py[i]! - ey[j]!;
      if (dx * dx + dy * dy <= R2) hits++;
    }
  }
  if (hits < 0) throw new Error('unreachable');
}

function runNaive(d: CollData): void {
  const { ex, ey, ealive, px, py, palive, enemyCount, playerCount } = d;
  const hits = naiveGrazeCheck(px, py, palive, playerCount, ex, ey, ealive, enemyCount, RADIUS);
  if (hits < 0) throw new Error('unreachable');
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────
const seedRng = new Rng(20261026);
const soaData = new Map<number, BulletField>();
const objData = new Map<number, BulletFieldNaive>();
const collData = new Map<number, CollData>();

for (const n of SIZES) {
  soaData.set(n, makeSoA(n, seedRng));
  objData.set(n, makeObj(n, seedRng));
  collData.set(n, makeCollData(n, 240, seedRng));
}

interface Task {
  key: string;
  run: () => void;
}

const tasks: Task[] = [];
for (const n of SIZES) {
  tasks.push({
    key: `soa:${n}`,
    run: () => {
      const f = soaData.get(n)!;
      f.integrate(DT);
      wrapSoA(f);
    },
  });
  tasks.push({
    key: `obj:${n}`,
    run: () => {
      const f = objData.get(n)!;
      f.integrate(DT);
      wrapObj(f);
    },
  });
  tasks.push({ key: `grid:${n}`, run: () => runGrid(collData.get(n)!) });
  tasks.push({ key: `naive:${n}`, run: () => runNaive(collData.get(n)!) });
}

// 预热：让 JIT 充分优化，丢弃结果
for (const t of tasks) {
  for (let i = 0; i < 200; i++) t.run();
}

const results = new Map<string, number[]>();
for (const t of tasks) results.set(t.key, []);

for (let round = 0; round < ROUNDS; round++) {
  const order = [...tasks];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const t of order) {
    results.get(t.key)!.push(timeIt(t.run));
  }
}

const med = (key: string): number => median(results.get(key)!);

// ─────────────────────────────────────────────
// 单调性自检
// ─────────────────────────────────────────────
function checkMonotonic(prefix: string): { ok: boolean; detail: string } {
  const vals = SIZES.map((n) => med(`${prefix}:${n}`));
  const bad: string[] = [];
  for (let i = 1; i < vals.length; i++) {
    // 规模翻倍时，允许最多 25% 的负向抖动（测量误差），更大幅度的倒退视为异常
    const prev = vals[i - 1]!;
    const cur = vals[i]!;
    const grow = SIZES[i]! / SIZES[i - 1]!;
    const expectedMin = prev * (1 + (grow - 1) * 0.5);
    if (cur < expectedMin * 0.75) {
      bad.push(`${SIZES[i - 1]}→${SIZES[i]} (${prev.toFixed(3)}→${cur.toFixed(3)})`);
    }
  }
  return { ok: bad.length === 0, detail: bad.length ? bad.join('；') : '正常' };
}

// ─────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────
function bar(pct: number): string {
  const filled = Math.min(20, Math.round(pct / 5));
  const mark = pct > 100 ? '✗' : pct > 50 ? '!' : '✓';
  return `${mark} ${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${pct.toFixed(1)}%`;
}

console.log('');
console.log('═'.repeat(88));
console.log('  P0 弹幕性能基准  ·  東方戮影塔');
console.log('═'.repeat(88));
console.log(`  Node ${process.version}  ·  逻辑预算 ${BUDGET.toFixed(2)}ms/帧（60fps）`);
console.log(`  测量方法：时间累积法（每组累积 ≥${MIN_DURATION}ms 再折算单次）`);
console.log(`  ${ROUNDS} 轮独立测量取中位数，每轮打乱执行顺序`);
console.log('═'.repeat(88));

console.log('');
console.log('【基准 1】逐帧积分：位置 + 速度 + 加速度 + 寿命');
console.log('─'.repeat(88));
console.log('  子弹数    SoA平均     对象平均    SoA/对象    SoA占预算');
console.log('─'.repeat(88));

for (const n of SIZES) {
  const soa = med(`soa:${n}`);
  const obj = med(`obj:${n}`);
  console.log(
    `  ${String(n).padStart(5)}  ${f3(soa)} ms  ${f3(obj)} ms  ${(soa / obj).toFixed(2)}x     ${bar((soa / BUDGET) * 100)}`,
  );
}

const soaMono = checkMonotonic('soa');
const objMono = checkMonotonic('obj');
console.log('');
console.log(`  单调性  SoA: ${soaMono.ok ? '✓' : '✗'} ${soaMono.detail}`);
console.log(`          对象: ${objMono.ok ? '✓' : '✗'} ${objMono.detail}`);

console.log('');
console.log('【基准 2】消弹碰撞（自机子弹 240 颗）');
console.log('─'.repeat(88));
console.log('  敌弹数    哈希平均    暴力平均    加速比    哈希占预算');
console.log('─'.repeat(88));

for (const n of SIZES) {
  const grid = med(`grid:${n}`);
  const naive = med(`naive:${n}`);
  console.log(
    `  ${String(n).padStart(5)}  ${f3(grid)} ms  ${f3(naive)} ms  ${(naive / grid).toFixed(1).padStart(5)}x    ${bar((grid / BUDGET) * 100)}`,
  );
}

const gridMono = checkMonotonic('grid');
const naiveMono = checkMonotonic('naive');
console.log('');
console.log(`  单调性  哈希: ${gridMono.ok ? '✓' : '✗'} ${gridMono.detail}`);
console.log(`          暴力: ${naiveMono.ok ? '✓' : '✗'} ${naiveMono.detail}`);

console.log('');
console.log('═'.repeat(88));
console.log('  结论（2000 颗 / 帧）');
console.log('─'.repeat(88));

const soa2k = med('soa:2000');
const obj2k = med('obj:2000');
const grid2k = med('grid:2000');
const naive2k = med('naive:2000');
const total = soa2k + grid2k;

console.log(`  逐帧积分：SoA ${f3(soa2k)}ms  vs  对象 ${f3(obj2k)}ms  → ${soa2k < obj2k ? 'SoA 更快' : '对象数组更快'} ${(Math.max(soa2k, obj2k) / Math.min(soa2k, obj2k)).toFixed(2)}x`);
console.log(`  消弹碰撞：哈希 ${f3(grid2k)}ms  vs  暴力 ${f3(naive2k)}ms  → 哈希快 ${(naive2k / grid2k).toFixed(1)}x`);
console.log('');
console.log(`  合计逻辑耗时 ${total.toFixed(3)}ms / ${BUDGET}ms = ${((total / BUDGET) * 100).toFixed(2)}% 预算`);
console.log(`  → ${total < BUDGET ? '✓ 逻辑层余量充足，瓶颈将在渲染侧' : '✗ 逻辑层超预算，需要优化'}`);

const allMono = soaMono.ok && objMono.ok && gridMono.ok && naiveMono.ok;
console.log('');
console.log(`  数据可信度：${allMono ? '✓ 全部通过单调性自检' : '✗ 存在非单调数据，结论需谨慎'}`);

console.log('');
console.log('  注：仅测逻辑，不含渲染。渲染性能在浏览器里看 FPS。');
console.log('═'.repeat(88));
console.log('');
