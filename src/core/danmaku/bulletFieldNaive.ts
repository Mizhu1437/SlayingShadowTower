/**
 * 对照组：对象数组实现。
 *
 * 这个文件的存在意义只有一个——**被证明比 SoA 慢**。
 * 没有对照组，“我们用 Float32Array 因为更快”就是一句空话。
 */

export interface BulletObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  radius: number;
  age: number;
  life: number;
  alive: boolean;
}

export class BulletFieldNaive {
  readonly bullets: BulletObject[] = [];
  aliveCount = 0;

  constructor(private readonly capacity: number = 4096) {}

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
    if (this.bullets.length >= this.capacity) return -1;

    // 这里刻意用「复用已死对象」来模拟对象池，
    // 保证对照组在“无 GC 压力”的前提下比较，避免不公平。
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i]!;
      if (!b.alive) {
        b.x = x;
        b.y = y;
        b.vx = vx;
        b.vy = vy;
        b.ax = ax;
        b.ay = ay;
        b.radius = radius;
        b.age = 0;
        b.life = life;
        b.alive = true;
        this.aliveCount++;
        return i;
      }
    }

    this.bullets.push({
      x, y, vx, vy, ax, ay, radius, age: 0, life, alive: true,
    });
    this.aliveCount++;
    return this.bullets.length - 1;
  }

  integrate(dt: number): void {
    const bullets = this.bullets;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i]!;
      if (!b.alive) continue;

      b.vx += b.ax * dt;
      b.vy += b.ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.age += dt;

      if (b.age >= b.life) {
        b.alive = false;
        this.aliveCount--;
      }
    }
  }

  clear(): void {
    this.bullets.length = 0;
    this.aliveCount = 0;
  }
}
