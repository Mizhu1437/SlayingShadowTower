import { describe, it, expect } from 'vitest';
import { World, FIELD_W, FIELD_H } from '../../src/core/world';
import { Enemy } from '../../src/core/enemy';

/** 跑 n 个逻辑步 */
function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

const DUMMY = { hp: 12, radius: 11, score: 100, coin: 5 };

describe('World 无自动射击（设计变更）', () => {
  it('静止不动不会发射任何子弹', () => {
    const w = new World({ seed: 1 });
    expect(w.playerShots.aliveCount).toBe(0);

    // 跑 5 秒（300 帧），不应该有任何自机子弹
    stepN(w, 300);
    expect(w.playerShots.aliveCount).toBe(0);
  });

  it('没有卡牌输出时，敌人不会被自动打死', () => {
    const w = new World({ seed: 1 });
    w.spawnEnemy({ hp: 3, radius: 10, score: 100, coin: 5 }, w.player.x, w.player.y - 120);

    // 跑 5 秒，敌人应该还活着（没有任何输出来源）
    stepN(w, 300);
    expect(w.kills).toBe(0);
    expect(w.aliveEnemyCount).toBe(1);
  });
});

describe('World 用卡牌击破敌人', () => {
  /**
   * 辅助：把某张带 damage_all 的卡放到选中位置并打出。
   * 自动射击已移除，输出只能靠卡牌。
   */
  function playDamageCard(w: World): boolean {
    // 选中一张有 damage_all 效果的卡
    const hand = w.deck.pile.hand;
    const idx = hand.findIndex((c) =>
      c.effects?.some((e) => e.op === 'damage_all'),
    );
    if (idx < 0) return false;
    w.deck.selected = idx;
    // 确保有能量
    w.deck.energy.refill();
    return w.playSelectedCard();
  }

  it('卡牌伤害能击破敌人并累加得分与金钱', () => {
    const w = new World({ seed: 1 });

    // 放一个血薄的敌人
    w.spawnEnemy({ hp: 10, radius: 10, score: 100, coin: 5 }, w.player.x, w.player.y - 120);
    w.step(); // 让敌人入列

    const before = w.kills;
    const played = playDamageCard(w);
    expect(played).toBe(true);

    expect(w.kills).toBe(before + 1);
    expect(w.score).toBe(100);
    expect(w.coins).toBe(5);
  });

  it('血厚的敌人不会被一张卡打死', () => {
    const w = new World({ seed: 1 });
    w.spawnEnemy({ hp: 9999, radius: 12, score: 100, coin: 5 }, w.player.x, w.player.y - 120);
    w.step();

    playDamageCard(w);
    expect(w.kills).toBe(0);
    expect(w.aliveEnemyCount).toBe(1);
  });

  it('被击破的敌人最终从数组移除', () => {
    const w = new World({ seed: 1 });
    w.spawnEnemy({ hp: 1, radius: 10, score: 1, coin: 1 }, w.player.x, w.player.y - 80);
    w.step();

    playDamageCard(w);
    // 等消散动画结束
    stepN(w, 60);
    expect(w.aliveEnemyCount).toBe(0);
    expect(w.enemies.length).toBe(0);
  });
});

describe('World 自机受击', () => {
  /**
   * 辅助：中弹并跑完决死窗口（不按 X），返回扣命后的状态。
   * 注意：现在中弹不会立即扣命，而是先进入决死窗口。
   */
  function missOnce(w: World): void {
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();
    // 跑完决死窗口
    for (let i = 0; i < 60; i++) {
      w.step();
      if (w.spell.phase === 'idle' && w.player.invuln > 0) break;
    }
  }

  it('中弹进入决死窗口，窗口走完才扣命', () => {
    const w = new World({ seed: 1 });
    const before = w.player.lives;

    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    w.step();

    // 第一步：进入决死，未扣命
    expect(w.spell.phase).toBe('deathbomb');
    expect(w.player.lives).toBe(before);
    expect(w.playerHitThisStep).toBe(true);

    // 跑完窗口：扣命
    for (let i = 0; i < 60; i++) w.step();
    expect(w.player.lives).toBe(before - 1);
  });

  it('被击中后周围的子弹会被清掉', () => {
    const w = new World({ seed: 1 });
    const px = w.player.x;
    const py = w.player.y;

    // 中心一颗必定命中，另外几颗在清弹半径内
    w.enemyBullets.spawn(px, py, 0, 0, 4, 10);
    w.enemyBullets.spawn(px + 20, py, 0, 0, 4, 10);
    w.enemyBullets.spawn(px, py + 25, 0, 0, 4, 10);

    const before = w.enemyBullets.aliveCount;
    w.step();

    expect(w.enemyBullets.aliveCount).toBeLessThan(before);
  });

  it('无敌期间不会连续掉命', () => {
    const w = new World({ seed: 1 });

    missOnce(w);
    const afterFirst = w.player.lives;

    // 再中弹一次，此时应处于无敌（或决死不再触发）
    w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
    for (let i = 0; i < 10; i++) w.step();

    expect(w.player.lives).toBe(afterFirst);
  });

  it('远离自机的子弹不会造成伤害', () => {
    const w = new World({ seed: 1 });
    w.enemyBullets.spawn(20, 20, 0, 0, 4, 10);

    const before = w.player.lives;
    w.step();
    expect(w.player.lives).toBe(before);
    expect(w.spell.phase).toBe('idle');
  });
});

describe('World 确定性', () => {
  it('同一种子的两局，推进同样的步数后状态一致', () => {
    const a = new World({ seed: 424242 });
    const b = new World({ seed: 424242 });

    // 同样的输入序列
    for (let i = 0; i < 300; i++) {
      a.input = { dx: 1, dy: 0, focus: false };
      b.input = { dx: 1, dy: 0, focus: false };
      a.step();
      b.step();
    }

    expect(a.player.x).toBeCloseTo(b.player.x, 10);
    expect(a.player.y).toBeCloseTo(b.player.y, 10);
    expect(a.playerShots.aliveCount).toBe(b.playerShots.aliveCount);
    expect(a.kills).toBe(b.kills);
  });
});

describe('Enemy 基础行为', () => {
  it('造成伤害直到死亡', () => {
    const e = new Enemy({ hp: 10, radius: 8, score: 1, coin: 1 }, 0, 0);
    expect(e.damage(4)).toBe(false);
    expect(e.hp).toBe(6);
    expect(e.damage(6)).toBe(true);
    expect(e.dead).toBe(true);
  });

  it('死亡后不再响应伤害', () => {
    const e = new Enemy({ hp: 1, radius: 8, score: 1, coin: 1 }, 0, 0);
    e.damage(1);
    expect(e.damage(1)).toBe(false);
  });

  it('朝目标点移动并停在那里', () => {
    const e = new Enemy({ hp: 1, radius: 8, score: 1, coin: 1 }, 0, 0);
    e.moveSpeed = 600;
    e.moveTo(100, 0);

    for (let i = 0; i < 60; i++) e.step(1 / 60);
    expect(e.x).toBeCloseTo(100, 0);
  });
});

describe('World 场地', () => {
  it('自机初始在场地下部中央', () => {
    const w = new World({ seed: 1 });
    expect(w.player.x).toBe(FIELD_W / 2);
    expect(w.player.y).toBeCloseTo(FIELD_H * 0.82, 0);
  });

  it('reset 清空所有状态', () => {
    const w = new World({ seed: 1 });
    w.spawnEnemy(DUMMY, 100, 100);
    stepN(w, 60);

    w.reset();
    expect(w.kills).toBe(0);
    expect(w.score).toBe(0);
    expect(w.coins).toBe(0);
    expect(w.enemies.length).toBe(0);
    expect(w.playerShots.aliveCount).toBe(0);
    expect(w.player.lives).toBe(3);
  });
});
