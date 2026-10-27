import { describe, it, expect } from 'vitest';
import { GameFlow } from '../../src/core/flow';
import { World, FIELD_W, FIELD_H } from '../../src/core/world';

describe('GameFlow 状态机', () => {
  it('初始为 playing，未暂停', () => {
    const f = new GameFlow();
    expect(f.phase).toBe('playing');
    expect(f.paused).toBe(false);
  });

  it('死亡后进入 dead 并暂停', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    expect(f.phase).toBe('dead');
    expect(f.paused).toBe(true);
  });

  it('重复调用 onPlayerDead 不会重复处理', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    f.onPlayerDead();
    expect(f.phase).toBe('dead');
  });

  it('续关后回到 playing 并计数', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    expect(f.doContinue()).toBe(true);
    expect(f.phase).toBe('playing');
    expect(f.continueCount).toBe(1);
    expect(f.paused).toBe(false);
  });

  it('非 dead 阶段不能续关', () => {
    const f = new GameFlow();
    expect(f.doContinue()).toBe(false);
  });

  it('放弃后进入 cleared', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    f.giveUp();
    expect(f.phase).toBe('cleared');
  });

  it('非 dead 阶段放弃无效', () => {
    const f = new GameFlow();
    f.giveUp();
    expect(f.phase).toBe('playing');
  });

  it('续关次数上限生效', () => {
    const f = new GameFlow(2);
    for (let i = 0; i < 2; i++) {
      f.onPlayerDead();
      expect(f.doContinue()).toBe(true);
    }
    expect(f.canContinue).toBe(false);

    f.onPlayerDead();
    expect(f.doContinue()).toBe(false);
    expect(f.phase).toBe('dead');
  });

  it('上限为 null 时无限续关', () => {
    const f = new GameFlow(null);
    for (let i = 0; i < 10; i++) {
      f.onPlayerDead();
      expect(f.doContinue()).toBe(true);
    }
    expect(f.continueCount).toBe(10);
  });

  it('reset 回到初始状态', () => {
    const f = new GameFlow();
    f.onPlayerDead();
    f.doContinue();
    f.reset();
    expect(f.phase).toBe('playing');
    expect(f.continueCount).toBe(0);
  });
});

describe('World 死亡暂停', () => {
  /**
   * 把自机打到死。
   *
   * 注意：现在中弹先进入决死窗口，窗口走完才扣命。
   * 所以要循环「投弹 → 跑完窗口」直到 dead。
   */
  function killPlayer(w: World): void {
    for (let round = 0; round < 10 && !w.player.dead; round++) {
      // 清掉残留子弹，确保这次必中
      w.enemyBullets.clear();
      w.player.invuln = 0;
      w.enemyBullets.spawn(w.player.x, w.player.y, 0, 0, 4, 10);
      w.step();
      // 跑完决死窗口（不按 X）
      for (let i = 0; i < 80; i++) {
        w.step();
        if (w.player.dead) break;
        // 决死已结束且进入无敌，说明这次 MISS 完成
        if (w.spell.phase === 'idle' && w.player.invuln > 0) break;
      }
    }
  }

  it('残机耗尽后进入 dead 阶段', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);
    expect(w.player.dead).toBe(true);
    expect(w.phase).toBe('dead');
  });

  it('dead 阶段不再推进逻辑（子弹冻结）', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);
    expect(w.phase).toBe('dead');

    // 放一颗会飞的子弹，然后跑若干步——它不应该动
    w.enemyBullets.spawn(100, 100, 100, 0, 4, 10);
    let idx = -1;
    for (let i = 0; i < w.enemyBullets.scanLimit; i++) {
      if (w.enemyBullets.state[i] === 1 && w.enemyBullets.x[i] === 100) {
        idx = i; break;
      }
    }
    expect(idx).toBeGreaterThanOrEqual(0);
    const x0 = w.enemyBullets.x[idx]!;

    for (let i = 0; i < 60; i++) w.step();
    expect(w.enemyBullets.x[idx]!).toBe(x0); // 完全不动
  });

  it('续关后回到 playing 并恢复满残机', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);
    expect(w.player.lives).toBe(0);

    expect(w.doContinue()).toBe(true);
    expect(w.phase).toBe('playing');
    expect(w.player.lives).toBe(3);
    expect(w.player.dead).toBe(false);
  });

  it('续关会清空敌弹', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);

    // 塞一堆子弹进去
    for (let i = 0; i < 50; i++) {
      w.enemyBullets.spawn(10 + i * 5, 100, 0, 0, 4, 10);
    }
    expect(w.enemyBullets.aliveCount).toBeGreaterThan(0);

    w.doContinue();
    expect(w.enemyBullets.aliveCount).toBe(0);
  });

  it('续关会清空自机周围的敌人', () => {
    const w = new World({ seed: 1 });

    const cx = FIELD_W / 2;
    const cy = FIELD_H * 0.82;
    // 近处一个、远处一个
    w.spawnEnemy({ hp: 10, radius: 10, score: 1, coin: 1 }, cx, cy - 50);
    w.spawnEnemy({ hp: 10, radius: 10, score: 1, coin: 1 }, 40, 40);
    // spawnEnemy 是排队，需要推进一步才真正实例化
    w.step();
    expect(w.enemies.length).toBe(2);

    // 现在打死自机
    killPlayer(w);
    expect(w.player.dead).toBe(true);

    w.doContinue();
    expect(w.enemies.length).toBe(1);
    expect(w.enemies[0]!.x).toBe(40);
  });

  it('续关会清空排队中未生成的敌人', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);

    // 死后再排队，就绪后应立即被清掉
    w.spawnEnemy({ hp: 10, radius: 10, score: 1, coin: 1 }, 100, 100);
    w.doContinue();

    // 续关后推进：不应有敌人冒出来（因为队列已被清空）
    w.step();
    expect(w.enemies.length).toBe(0);
  });

  it('续关保留得分与金钱', () => {
    const w = new World({ seed: 1 });
    w.score = 1200;
    w.coins = 340;
    killPlayer(w);
    w.doContinue();
    expect(w.score).toBe(1200);
    expect(w.coins).toBe(340);
  });

  it('续关后给足无敌时间', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);
    w.doContinue();
    expect(w.player.invuln).toBeGreaterThan(2);
    expect(w.player.vulnerable).toBe(false);
  });

  it('放弃后进入 cleared', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);
    w.giveUp();
    expect(w.phase).toBe('cleared');
  });

  it('reset 把阶段恢复为 playing', () => {
    const w = new World({ seed: 1 });
    killPlayer(w);
    w.giveUp();
    w.reset();
    expect(w.phase).toBe('playing');
    expect(w.player.lives).toBe(3);
  });
});
