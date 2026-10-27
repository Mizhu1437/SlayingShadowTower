import { describe, it, expect } from 'vitest';
import { World } from '../../src/core/world';
import { EnemyStatus, BURN_CONFIG, WEAK_FIRE_FACTOR } from '../../src/core/status';
import { createStarterDeck } from '../../src/core/cards/library';

const DT = 1 / 60;

describe('敌人状态：虚弱', () => {
  it('施加后 isWeak 为真，到时自动失效', () => {
    const s = new EnemyStatus();
    s.apply('weak', 1.0);
    expect(s.isWeak).toBe(true);

    for (let i = 0; i < 70; i++) s.step(DT, 100);
    // 1 秒后应过期
    expect(s.isWeak).toBe(false);
  });

  it('重复施加取较长时间，不叠加', () => {
    const s = new EnemyStatus();
    s.apply('weak', 5);
    s.apply('weak', 3);
    // 应是 5 秒而不是 8 秒
    expect(s.remain('weak')).toBeCloseTo(5, 1);
  });

  it('虚弱使敌人发射量减少 25%', () => {
    expect(WEAK_FIRE_FACTOR).toBe(0.75);

    // 通过实际战斗验证：同一敌人，虚弱前后一轮发射的子弹数
    const w = new World({ seed: 7 });
    w.spawnEnemy(
      {
        hp: 99999, radius: 20, score: 1, coin: 1,
        emitter: { count: 8, angle: 0, spread: Math.PI * 2, speed: 100, radius: 4, life: 5 },
        fireInterval: 1.0,
      },
      w.player.x, 120,
    );
    w.step();
    const e = w.enemies[0]!;
    e.y = 120;
    e.moveTo(e.x, 120);

    // 先让它到位并打完一轮
    for (let i = 0; i < 90; i++) w.step();
    const normalCount = w.enemyBullets.aliveCount;
    expect(normalCount).toBeGreaterThan(0);

    // 清空后施加虚弱
    w.enemyBullets.clear();
    e.status.apply('weak', 10);

    for (let i = 0; i < 90; i++) w.step();
    const weakCount = w.enemyBullets.aliveCount;

    // 虚弱后应明显更少（8 × 0.75 = 6）
    expect(weakCount).toBeLessThan(normalCount);
  });
});

describe('敌人状态：燃烧', () => {
  it('燃烧持续造成伤害', () => {
    const w = new World({ seed: 3 });
    w.spawnEnemy({ hp: 1000, radius: 12, score: 1, coin: 1 }, w.player.x, 120);
    w.step();
    const e = w.enemies[0]!;
    e.moveTo(e.x, 120);

    const hpBefore = e.hp;
    e.status.apply('burn', 5);

    for (let i = 0; i < 120; i++) w.step();

    expect(e.hp).toBeLessThan(hpBefore);
  });

  it('燃烧到时自动停止', () => {
    const s = new EnemyStatus();
    s.apply('burn', 0.5);
    expect(s.isBurning).toBe(true);

    for (let i = 0; i < 40; i++) s.step(DT, 100);
    expect(s.isBurning).toBe(false);
  });

  it('燃烧可以点燃附近未燃烧的敌人（传播）', () => {
    const w = new World({ seed: 9 });

    // 两个相邻敌人
    w.spawnEnemy({ hp: 9999, radius: 12, score: 1, coin: 1 }, 150, 120);
    w.spawnEnemy({ hp: 9999, radius: 12, score: 1, coin: 1 }, 200, 120);
    w.step();

    const a = w.enemies[0]!;
    const b = w.enemies[1]!;
    // 固定位置，确保在传播半径内
    a.x = 150; a.y = 120; a.moveTo(150, 120);
    b.x = 200; b.y = 120; b.moveTo(200, 120);

    // 只点燃 A
    a.status.apply('burn', 10);
    expect(b.status.isBurning).toBe(false);

    // 跑够一个传播间隔
    const steps = Math.ceil(BURN_CONFIG.spreadInterval / DT) + 10;
    for (let i = 0; i < steps; i++) w.step();

    // B 应该被点燃
    expect(b.status.isBurning).toBe(true);
  });

  it('传播距离外的敌人不会被点燃', () => {
    const w = new World({ seed: 11 });
    w.spawnEnemy({ hp: 9999, radius: 12, score: 1, coin: 1 }, 60, 120);
    w.spawnEnemy({ hp: 9999, radius: 12, score: 1, coin: 1 }, 60, 400);
    w.step();

    const a = w.enemies[0]!;
    const far = w.enemies[1]!;
    a.x = 60; a.y = 120; a.moveTo(60, 120);
    far.x = 60; far.y = 400; far.moveTo(60, 400);

    a.status.apply('burn', 10);

    const steps = Math.ceil(BURN_CONFIG.spreadInterval / DT) + 20;
    for (let i = 0; i < steps; i++) w.step();

    // 距离 280px，远超 90px 传播半径
    expect(far.status.isBurning).toBe(false);
  });
});

describe('穿透弹：凤翼天翔', () => {
  it('穿透弹命中多个敌人', () => {
    const w = new World({ seed: 5 });
    // 打出一张必定是凤翼天翔的卡组
    w.deck.pile.reset([{ ...createStarterDeck().find((c) => c.name.includes('火鸟'))! }]);
    w.deck.selected = 0;
    w.deck.energy.refill();

    // 排成一列的三个敌人
    for (const y of [100, 160, 220]) {
      w.spawnEnemy({ hp: 100, radius: 14, score: 1, coin: 1 }, w.player.x, y);
    }
    w.step();

    expect(w.playSelectedCard()).toBe(true);

    const killsBefore = w.kills;
    for (let i = 0; i < 120; i++) w.step();

    // 至少命中 2 个（穿透使然）
    expect(w.kills - killsBefore).toBeGreaterThanOrEqual(2);
  });

  it('穿透次数用完后子弹消失', () => {
    const w = new World({ seed: 6 });
    // 手工发射一枚只穿透 1 次的弹
    w.deck.energy.refill();
    const before = w.cardShots.shots.aliveCount;
    w.cardShots.firePierce(w.player, 1, 500, 400, 1, 10);
    expect(w.cardShots.shots.aliveCount).toBe(before + 1);

    // 放两个敌人在弹道上
    for (const y of [200, 280]) {
      w.spawnEnemy({ hp: 100, radius: 12, score: 1, coin: 1 }, w.player.x, y);
    }
    w.step();

    for (let i = 0; i < 120; i++) w.step();
    // 穿透 1 次 = 最多打 2 个，之后消失
    expect(w.cardShots.shots.aliveCount).toBe(0);
  });
});

describe('持续射击：符击', () => {
  it('开启后 5 秒内持续产生子弹', () => {
    const w = new World({ seed: 8 });
    w.deck.pile.reset([{ ...createStarterDeck().find((c) => c.name === '符击')! }]);
    w.deck.selected = 0;
    w.deck.energy.refill();

    expect(w.playSelectedCard()).toBe(true);
    expect(w.cardShots.activeBursts).toBe(1);

    // 跑 1 秒，应有多发子弹
    for (let i = 0; i < 60; i++) w.step();
    expect(w.cardShots.shots.aliveCount).toBeGreaterThan(3);
  });

  it('窗口到期后停止发射', () => {
    const w = new World({ seed: 12 });
    w.deck.pile.reset([{ ...createStarterDeck().find((c) => c.name === '符击')! }]);
    w.deck.selected = 0;
    w.deck.energy.refill();
    w.playSelectedCard();

    // 跑 6 秒（超过 5 秒窗口）
    for (let i = 0; i < 400; i++) w.step();
    expect(w.cardShots.activeBursts).toBe(0);
  });
});

describe('初始卡组按用户设计', () => {
  it('8 张：4 符击 + 3 防御 + 1 凤翼天翔', () => {
    const deck = createStarterDeck();
    expect(deck.length).toBe(8);

    const names = deck.map((c) => c.name);
    expect(names.filter((n) => n === '符击').length).toBe(4);
    expect(names.filter((n) => n === '防御').length).toBe(3);
    expect(names.filter((n) => n.includes('火鸟')).length).toBe(1);
  });

  it('防御卡是 1 费，清弹 + 2.5 秒无敌', () => {
    const def = createStarterDeck().find((c) => c.name === '防御')!;
    expect(def.energy).toBe(1);

    const clear = def.effects?.find((e) => e.op === 'clear_bullets');
    const invuln = def.effects?.find((e) => e.op === 'invuln');
    expect(clear).toBeDefined();
    expect(invuln).toBeDefined();
    if (invuln?.op === 'invuln') {
      expect(invuln.seconds).toBe(2.5);
    }
  });

  it('凤翼天翔是 2 费，带穿透与两种状态', () => {
    const card = createStarterDeck().find((c) => c.name.includes('火鸟'))!;
    expect(card.energy).toBe(2);

    const ops = card.effects?.map((e) => e.op) ?? [];
    expect(ops).toContain('pierce_shot');
    expect(ops).toContain('apply_status');

    // 两种状态：虚弱 + 燃烧
    const statuses = (card.effects ?? [])
      .filter((e) => e.op === 'apply_status')
      .map((e) => (e.op === 'apply_status' ? e.status : ''));
    expect(statuses).toContain('weak');
    expect(statuses).toContain('burn');
  });

  it('符击是 1 费，持续 5 秒', () => {
    const card = createStarterDeck().find((c) => c.name === '符击')!;
    expect(card.energy).toBe(1);

    const burst = card.effects?.find((e) => e.op === 'burst_fire');
    expect(burst).toBeDefined();
    if (burst?.op === 'burst_fire') {
      expect(burst.duration).toBe(5);
      expect(burst.count).toBe(3);
    }
  });
});
