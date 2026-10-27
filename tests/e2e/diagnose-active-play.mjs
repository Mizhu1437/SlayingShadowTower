import { chromium } from 'playwright';

const b = await chromium.launch({ args: ['--use-gl=angle'] });
const p = await b.newPage();
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForSelector('.card');

// 模拟玩家积极出牌：每 400ms 尝试按一次 Z，持续 40 秒
const result = await p.evaluate(async () => {
  const w = window.__world;
  const log = [];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < 100; i++) {
    const card = w.deck.selectedCard;
    const cost = Math.max(0, (card?.energy ?? 0) - w.cardPower.energyDiscount);
    const energyBefore = w.deck.energy.value;
    const canPay = w.deck.energy.canPay(cost);
    const played = w.playSelectedCard();

    if (played) ok++; else fail++;

    log.push({
      t: (i * 0.4).toFixed(1),
      energy: energyBefore,
      cost,
      canPay,
      played,
      card: card?.name,
    });

    // 等 400ms（模拟玩家思考 + 操作）
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ok, fail, log };
});

const rate = ((result.ok / (result.ok + result.fail)) * 100).toFixed(0);
console.log('=== 积极出牌 40 秒（每 400ms 尝试一次，共 100 次）===');
console.log(`  成功 ${result.ok} 次，失败 ${result.fail} 次`);
console.log(`  成功率 ${rate}%\n`);

// 失败原因
const fails = result.log.filter((x) => !x.played);
const byReason = {};
for (const f of fails) {
  const k = f.canPay ? '其他原因' : `${f.cost}费卡-能量不足`;
  byReason[k] = (byReason[k] ?? 0) + 1;
}
console.log('失败原因分布：');
for (const [k, v] of Object.entries(byReason)) {
  console.log(`  ${k}: ${v} 次`);
}

// 能量轨迹（每 5 次采样取一个，压缩显示）
const etrace = result.log.map((x) => x.energy).join('');
console.log(`\n能量轨迹（100 次采样）：${etrace}`);

// 连续失败最长
let maxRun = 0;
let run = 0;
for (const x of result.log) {
  if (!x.played) { run++; maxRun = Math.max(maxRun, run); }
  else run = 0;
}
console.log(`最长连续失败：${maxRun} 次 ≈ ${(maxRun * 0.4).toFixed(1)} 秒`);

await b.close();
