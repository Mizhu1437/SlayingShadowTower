/**
 * 波次运行器：按时间轴把 StageDef 变成实际的敌人。
 *
 * 状态机（一个时刻只能处于一个状态，避免"暂停中还在生成敌人"这类漏洞）：
 *   idle → running → (done | failed)
 *
 * 推进条件由 WaveDef.clearOn 决定：
 *   all_dead — 本波敌人在场上全部清空
 *   timeout  — 到时即推进（BOSS 战）
 */

import type { StageDef, WaveDef } from './types';

export type RunnerPhase = 'idle' | 'running' | 'done';

export interface RunnerHooks {
  /** 生成一个敌人（由 World 实现） */
  spawn: (typeId: string, x: number, y: number) => void;
  /** 当前场上还活着几个敌人 */
  aliveCount: () => number;
}

export class WaveRunner {
  phase: RunnerPhase = 'idle';

  private stage: StageDef | null = null;
  private waveIndex = 0;
  private waveTime = 0;
  private spawnCursor = 0;
  /** 本波已生成的敌人数（用于判断 all_dead 是否已开始） */
  private spawnedThisWave = 0;
  private hooks: RunnerHooks | null = null;

  /** 总波数，供 UI 显示进度 */
  get totalWaves(): number {
    return this.stage?.waves.length ?? 0;
  }

  /** 当前波次序号（从 1 开始；未开始时为 0） */
  get currentWave(): number {
    return this.phase === 'running' ? this.waveIndex + 1 : 0;
  }

  /** 当前波次定义 */
  get currentWaveDef(): WaveDef | null {
    if (!this.stage || this.phase !== 'running') return null;
    return this.stage.waves[this.waveIndex] ?? null;
  }

  start(stage: StageDef, hooks: RunnerHooks): void {
    this.stage = stage;

    this.hooks = hooks;
    this.waveIndex = 0;
    this.waveTime = 0;
    this.spawnCursor = 0;
    this.spawnedThisWave = 0;
    this.phase = stage.waves.length > 0 ? 'running' : 'done';
  }

  reset(): void {
    this.phase = 'idle';
    this.stage = null;
    this.hooks = null;
    this.waveIndex = 0;
    this.waveTime = 0;
    this.spawnCursor = 0;
    this.spawnedThisWave = 0;
  }

  /**
   * 推进一个逻辑步。
   * 返回本步是否切换到了下一波（供 UI 播提示）。
   */
  step(dt: number): boolean {
    if (this.phase !== 'running' || !this.stage || !this.hooks) return false;

    const wave = this.stage.waves[this.waveIndex];
    if (!wave) {
      this.phase = 'done';
      return false;
    }

    this.waveTime += dt;

    // 1. 按延迟生成敌人
    while (
      this.spawnCursor < wave.spawns.length &&
      wave.spawns[this.spawnCursor]!.delay <= this.waveTime
    ) {
      const s = wave.spawns[this.spawnCursor]!;
      this.hooks.spawn(s.typeId, s.x, s.y);
      this.spawnCursor++;
      this.spawnedThisWave++;
    }

    // 2. 判断本波是否结束
    const allSpawned = this.spawnCursor >= wave.spawns.length;

    let finished = false;

    if (wave.clearOn === 'all_dead') {
      // 必须先把敌人全部生成完，且场上清空，才算结束
      finished = allSpawned && this.hooks.aliveCount() === 0;
    } else if (wave.clearOn === 'either') {
      // 全灭 或 到时，满足其一即结束。
      // 这样"打不动"也不会卡关，只是推进得慢一些。
      const allDead = allSpawned && this.hooks.aliveCount() === 0;
      const timeUp = this.waveTime >= wave.duration;
      finished = allDead || timeUp;
    } else {
      // timeout：到时即结束
      finished = this.waveTime >= wave.duration;
    }

    // 3. 硬超时兜底：避免因为敌人卡在场上导致永远无法推进
    if (!finished && this.waveTime >= wave.duration * 2) {
      finished = true;
    }

    if (!finished) return false;

    // 4. 进入下一波
    this.waveIndex++;
    this.waveTime = 0;
    this.spawnCursor = 0;
    this.spawnedThisWave = 0;

    if (this.waveIndex >= this.stage.waves.length) {
      this.phase = 'done';
    }
    return true;
  }

  /** 本波已生成敌人数 */
  get waveSpawnedCount(): number {
    return this.spawnedThisWave;
  }
}
