/**
 * 子弹字段（SoA：Structure of Arrays）
 *
 * 为什么不用 Bullet 对象数组：
 * - 2000 颗子弹每帧都要读写位置与速度，对象数组的属性分散在堆内存各处，
 *   每次访问都可能是一次缓存未命中。
 * - 并行数组把同类数据连续存放，遍历时缓存命中率高得多（空间局部性）。
 *
 * 这是 P0 要验证的核心假设之一。
 */

export const MAX_BULLETS = 4096;

/** 子弹状态位：0 = 空闲，1 = 存活 */
export const enum BulletState {
  Dead = 0,
  Alive = 1,
}

export class BulletField {
  readonly capacity: number;

  // 位置与运动（每帧都要读写，用 Float32Array 保证连续）
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly ax: Float32Array;
  readonly ay: Float32Array;

  // 外观
  readonly radius: Float32Array;

  // 生命周期
  readonly age: Float32Array;
  readonly life: Float32Array;

  // 状态
  readonly state: Uint8Array;

  /** 空闲槽位栈，用于 O(1) 分配 */
  private readonly freeList: Int32Array;
  private freeCount: number;

  /**
   * 高水位：曾被分配过的最大索引 + 1。
   *
   * 为什么需要它：SoA 的索引不连续（有空洞），但遍历不能跑满 capacity——
   * 2000 颗子弹时跑 4096 个槽位会白费一倍的工作量。
   * 高水位让遍历范围贴近真实使用量。
   *
   * 全部子弹死亡时归零，避免长期运行后范围只增不减。
   */
  private highWater = 0;

  /** 当前存活数量 */
  aliveCount = 0;

  constructor(capacity: number = MAX_BULLETS) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.ax = new Float32Array(capacity);
    this.ay = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.state = new Uint8Array(capacity);

    // 初始时所有槽位都空闲，倒序压栈使得首个分配拿到 0 号槽
    this.freeList = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.freeList[i] = capacity - 1 - i;
    }
    this.freeCount = capacity;
  }

  /**
   * 分配一颗子弹。返回槽位索引，池满时返回 -1。
   * 对象池的意义：不 new 对象、不产生垃圾，避免 GC 抖动。
   */
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    life: number,
    ax = 0,
    ay = 0,
  ): number {
    if (this.freeCount === 0) return -1;

    const i = this.freeList[--this.freeCount];

    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.ax[i] = ax;
    this.ay[i] = ay;
    this.radius[i] = radius;
    this.age[i] = 0;
    this.life[i] = life;
    this.state[i] = BulletState.Alive;

    if (i >= this.highWater) this.highWater = i + 1;
    this.aliveCount++;
    return i;
  }

  /** 回收一颗子弹 */
  kill(i: number): void {
    if (this.state[i] === BulletState.Dead) return;
    this.state[i] = BulletState.Dead;
    this.freeList[this.freeCount++] = i;
    this.aliveCount--;
  }

  /** 清空所有子弹 */
  clear(): void {
    this.state.fill(BulletState.Dead);
    for (let i = 0; i < this.capacity; i++) {
      this.freeList[i] = this.capacity - 1 - i;
    }
    this.freeCount = this.capacity;
    this.aliveCount = 0;
    this.highWater = 0;
  }

  /**
   * 逐帧积分：位置 += 速度，速度 += 加速度。
   *
   * 注意循环上界是 highWater 而非 capacity：
   * 2000 颗子弹时如果跑满 4096 个槽位，会白费一倍工作量。
   */
  integrate(dt: number): void {
    const { x, y, vx, vy, ax, ay, age, life, state } = this;
    const limit = this.highWater;

    for (let i = 0; i < limit; i++) {
      if (state[i] === BulletState.Dead) continue;

      vx[i] += ax[i] * dt;
      vy[i] += ay[i] * dt;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      age[i] += dt;

      if (age[i] >= life[i]) {
        state[i] = BulletState.Dead;
        this.freeList[this.freeCount++] = i;
        this.aliveCount--;
      }
    }

    // 全部死亡则重置高水位，避免长期运行后范围只增不减
    if (this.aliveCount === 0) this.highWater = 0;
  }

  /** 遍历上界（供渲染与碰撞层复用，避免跑满 capacity） */
  get scanLimit(): number {
    return this.highWater;
  }
}
