import { describe, it, expect } from 'vitest';
import { generateStage } from '../../src/core/stage/generator';
import { WaveRunner } from '../../src/core/stage/waveRunner';
import { ENEMY_POOL } from '../../src/core/stage/enemies';
import {
  ACT_STRUCTURE_1_TO_3,
  ACT_STRUCTURE_4,
  type ActStructure,
  type EnemyPool,
} from '../../src/core/stage/types';

const STRUCT_3: ActStructure = { actId: 'act1', ...ACT_STRUCTURE_1_TO_3 };

describe('波次生成：结构固定，内容随机', () => {
  it('波次数量与种类严格等于模板', () => {
    const r = generateStage({
      masterSeed: 42, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    expect(r.errors).toEqual([]);
    expect(r.stage.waves.length).toBe(STRUCT_3.slots.length);

    for (let i = 0; i < STRUCT_3.slots.length; i++) {
      expect(r.stage.waves[i]!.kind).toBe(STRUCT_3.slots[i]!.kind);
    }
  });

  it('同一种子生成完全相同的内容', () => {
    const a = generateStage({
      masterSeed: 1234, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    const b = generateStage({
      masterSeed: 1234, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    expect(JSON.stringify(a.stage)).toBe(JSON.stringify(b.stage));
  });

  it('不同种子生成不同内容（但结构相同）', () => {
    const a = generateStage({
      masterSeed: 1, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    const b = generateStage({
      masterSeed: 999, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });

    // 结构必须一致
    expect(a.stage.waves.length).toBe(b.stage.waves.length);
    // 内容应当不同
    expect(JSON.stringify(a.stage)).not.toBe(JSON.stringify(b.stage));
  });

  it('不同幕使用不同的派生种子，内容不重复', () => {
    const act0 = generateStage({
      masterSeed: 7, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    const act1 = generateStage({
      masterSeed: 7, actIndex: 1, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    expect(JSON.stringify(act0.stage)).not.toBe(JSON.stringify(act1.stage));
  });

  it('每一波至少有一个敌人', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = generateStage({
        masterSeed: seed, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
      });
      for (const w of r.stage.waves) {
        expect(w.spawns.length).toBeGreaterThan(0);
      }
    }
  });

  it('BOSS 与道中 BOSS 只有一个敌人且居中', () => {
    const r = generateStage({
      masterSeed: 42, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    const bosses = r.stage.waves.filter(
      (w) => w.kind === 'boss' || w.kind === 'midboss',
    );
    expect(bosses.length).toBeGreaterThan(0);

    for (const b of bosses) {
      expect(b.spawns.length).toBe(1);
      expect(b.spawns[0]!.x).toBeCloseTo(0.5, 2);
      expect(b.clearOn).toBe('timeout');
    }
  });

  it('普通波与精英波用 either（全灭或到时都能推进）', () => {
    const r = generateStage({
      masterSeed: 42, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    for (const w of r.stage.waves) {
      if (w.kind === 'normal' || w.kind === 'elite') {
        // 不用 all_dead：本作输出靠卡牌，玩家可能打不动，不能因此卡关
        expect(w.clearOn).toBe('either');
      }
    }
  });

  it('生成的敌人类型都在池内', () => {
    const r = generateStage({
      masterSeed: 55, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    for (const w of r.stage.waves) {
      for (const s of w.spawns) {
        expect(ENEMY_POOL[s.typeId]).toBeDefined();
      }
    }
  });

  it('敌人位置在合理范围（横向 0–1，纵向为负=场外上方）', () => {
    const r = generateStage({
      masterSeed: 88, actIndex: 0, pool: ENEMY_POOL, structure: STRUCT_3,
    });
    for (const w of r.stage.waves) {
      for (const s of w.spawns) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(1);
        expect(s.y).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('波次生成：经济校验', () => {
  it('经济下限不满足时会重试', () => {
    // 构造一个只有极低掉落敌人的池
    const poorPool: EnemyPool = {
      poor: { hp: 1, radius: 8, score: 1, coin: 1 },
    };
    const r = generateStage({
      masterSeed: 3, actIndex: 0, pool: poorPool, structure: STRUCT_4_TO_TEST,
      minCoin: 10000,   // 不可能达到
      maxRetries: 3,
    });
    // 应该失败并记录原因
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.includes('蜃銭不足'))).toBe(true);
  });

  it('经济下限满足时一次通过', () => {
    const richPool: EnemyPool = {
      rich: { hp: 1, radius: 8, score: 1, coin: 100 },
    };
    const r = generateStage({
      masterSeed: 3, actIndex: 0, pool: richPool, structure: STRUCT_4_TO_TEST,
      minCoin: 50,
    });
    expect(r.errors).toEqual([]);
    expect(r.retries).toBe(0);
  });
});

const STRUCT_4_TO_TEST: ActStructure = { actId: 'act4', ...ACT_STRUCTURE_4 };

describe('WaveRunner 推进', () => {
  function makeRunner() {
    const spawned: { typeId: string; x: number; y: number }[] = [];
    let alive = 0;
    const runner = new WaveRunner();
    return {
      runner,
      spawned,
      hooks: {
        spawn: (typeId: string, x: number, y: number) => {
          spawned.push({ typeId, x, y });
          alive++;
        },
        aliveCount: () => alive,
      },
      killAll: () => { alive = 0; },
    };
  }

  it('启动后相位为 running', () => {
    const { runner, hooks } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [{
        id: 'w0', kind: 'normal' as const,
        spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
        duration: 10, clearOn: 'all_dead' as const,
      }],
    };
    runner.start(stage, hooks);
    expect(runner.phase).toBe('running');
    expect(runner.totalWaves).toBe(1);
    expect(runner.currentWave).toBe(1);
  });

  it('按延迟生成敌人', () => {
    const { runner, spawned, hooks } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [{
        id: 'w0', kind: 'normal' as const,
        spawns: [
          { typeId: 'grunt', x: 0.3, y: -0.1, delay: 0 },
          { typeId: 'fan', x: 0.7, y: -0.1, delay: 0.5 },
        ],
        duration: 10, clearOn: 'all_dead' as const,
      }],
    };
    runner.start(stage, hooks);

    runner.step(0.016);
    expect(spawned.length).toBe(1);   // 第一只在 delay 0 时生成

    // 推进 0.6 秒
    for (let i = 0; i < 40; i++) runner.step(0.016);
    expect(spawned.length).toBe(2);
  });

  it('all_dead：敌人全清空才推进', () => {
    const { runner, hooks, killAll } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [
        {
          id: 'w0', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 10, clearOn: 'all_dead' as const,
        },
        {
          id: 'w1', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 10, clearOn: 'all_dead' as const,
        },
      ],
    };
    runner.start(stage, hooks);

    // 推进 1 秒，敌人还在场上 → 不应推进
    for (let i = 0; i < 60; i++) runner.step(0.016);
    expect(runner.currentWave).toBe(1);

    // 清空敌人后推进
    killAll();
    runner.step(0.016);
    expect(runner.currentWave).toBe(2);
  });

  it('timeout：到时即推进，不看敌人是否清空', () => {    const { runner, hooks } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [
        {
          id: 'w0', kind: 'boss' as const,
          spawns: [{ typeId: 'boss_placeholder', x: 0.5, y: -0.1, delay: 0 }],
          duration: 1.0, clearOn: 'timeout' as const,
        },
        {
          id: 'w1', kind: 'boss' as const,
          spawns: [{ typeId: 'boss_placeholder', x: 0.5, y: -0.1, delay: 0 }],
          duration: 1.0, clearOn: 'timeout' as const,
        },
      ],
    };
    runner.start(stage, hooks);

    // 敌人一直在场上
    for (let i = 0; i < 70; i++) runner.step(0.016);
    expect(runner.currentWave).toBe(2);
  });

  it('either：敌人打不死时，到时也会推进（防卡关）', () => {
    const { runner, hooks } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [
        {
          id: 'w0', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 1.0, clearOn: 'either' as const,
        },
        {
          id: 'w1', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 10, clearOn: 'either' as const,
        },
      ],
    };
    runner.start(stage, hooks);

    // 敌人一直在场上（从不调用 killAll）
    // duration=1 秒后应推进，而不是等到 duration*2
    for (let i = 0; i < 70; i++) runner.step(0.016);
    expect(runner.currentWave).toBe(2);
  });

  it('either：敌人提前清空时立刻推进（不等到时）', () => {
    const { runner, hooks, killAll } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [
        {
          id: 'w0', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 10, clearOn: 'either' as const,
        },
        {
          id: 'w1', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 10, clearOn: 'either' as const,
        },
      ],
    };
    runner.start(stage, hooks);

    runner.step(0.016);
    killAll();
    runner.step(0.016);
    expect(runner.currentWave).toBe(2);
  });

  it('走完全部波次后相位变为 done', () => {
    const { runner, hooks } = makeRunner();
    const stage = {
      actId: 'act1',
      waves: [{
        id: 'w0', kind: 'boss' as const,
        spawns: [{ typeId: 'boss_placeholder', x: 0.5, y: -0.1, delay: 0 }],
        duration: 0.5, clearOn: 'timeout' as const,
      }],
    };
    runner.start(stage, hooks);

    for (let i = 0; i < 60; i++) runner.step(0.016);
    expect(runner.phase).toBe('done');
  });

  it('硬超时兜底：卡住的波也会被强制推进', () => {
    const { runner, hooks } = makeRunner();
    // all_dead 波，但敌人永远不死
    const stage = {
      actId: 'act1',
      waves: [
        {
          id: 'w0', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 0.5, clearOn: 'all_dead' as const,
        },
        {
          id: 'w1', kind: 'normal' as const,
          spawns: [{ typeId: 'grunt', x: 0.5, y: -0.1, delay: 0 }],
          duration: 10, clearOn: 'all_dead' as const,
        },
      ],
    };
    runner.start(stage, hooks);

    // duration*2 = 1 秒后应强制推进
    for (let i = 0; i < 80; i++) runner.step(0.016);
    expect(runner.currentWave).toBe(2);
  });

  it('未启动时 step 不崩溃', () => {
    const runner = new WaveRunner();
    expect(() => runner.step(0.016)).not.toThrow();
    expect(runner.phase).toBe('idle');
  });
});

describe('World 整合关卡', () => {
  it('startAct 能成功启动并开始生成敌人', async () => {
    const { World } = await import('../../src/core/world');
    const w = new World({ seed: 2026 });

    expect(w.startAct(0)).toBe(true);
    expect(w.waves.phase).toBe('running');
    expect(w.currentAct).toBe(0);

    // 推进一段时间，应该有敌人被生成
    for (let i = 0; i < 300; i++) w.step();
    expect(w.enemies.length).toBeGreaterThan(0);
  });

  it('每幕开局能量回满、牌堆重置', async () => {
    const { World } = await import('../../src/core/world');
    const w = new World({ seed: 5 });
    w.deck.energy.pay(3);
    expect(w.deck.energy.value).toBe(0);

    w.startAct(0);
    expect(w.deck.energy.value).toBe(w.deck.energy.cap);
  });
});
