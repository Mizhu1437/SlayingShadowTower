/**
 * 射击参数（ShotProfile）
 *
 * 这是 P2「被动卡决定全部火力」的数据基础。
 * 现在自机用默认值，接入卡牌后由 resolver 结算产出。
 *
 * 纯数据、可序列化、不依赖任何渲染对象。
 */

export interface ShotProfile {
  /** 发射间隔（秒） */
  interval: number;
  /** 每发子弹数 */
  count: number;
  /** 扇形角（弧度）。count=3 时 spread=0.2 表示左右各偏 0.1 */
  spread: number;
  /** 单发伤害 */
  damage: number;
  /** 子弹速度 px/s */
  speed: number;
  /** 碰撞半径 */
  radius: number;
  /** 视觉类型 */
  kind: 'needle' | 'orb' | 'talisman';
  /** 穿透次数（0 = 命中即消失） */
  pierce: number;
  /** 追踪强度（0 = 不追踪） */
  homing: number;
  /** 生命（秒） */
  lifetime: number;
  /**
   * 相对自机中心的横向偏移。
   * 双发时用 ±offset 让两颗子弹不重叠。
   */
  offsetX: number;
}

export const DEFAULT_SHOT: ShotProfile = {
  interval: 0.09,
  count: 2,
  spread: 0.06,
  damage: 3,
  speed: 900,
  radius: 3,
  kind: 'needle',
  pierce: 0,
  homing: 0,
  lifetime: 1.2,
  offsetX: 8,
};

/**
 * 三阶段结算：base → add → mul → set
 *
 * 为什么顺序必须固定：
 *   玩家换卡顺序不同，最终结果必须一样。
 *   加法和乘法可交换，所以 add 内部、mul 内部与顺序无关；
 *   但 add 与 mul 之间不交换（(3+2)*2 ≠ 3+2*2），
 *   因此必须全局固定「先加后乘」。
 *
 * 这是 P2 的核心，现在先建立接口，P2 再把卡牌接进来。
 */
export interface ShotModifier {
  op: 'add' | 'mul' | 'set';
  stat: keyof ShotProfile;
  value: number;
}

export function resolveShot(
  base: ShotProfile,
  modifiers: readonly ShotModifier[],
): ShotProfile {
  const out: ShotProfile = { ...base };

  // mul 先收集成累积因子，最后一次性应用，避免顺序影响
  const sums = new Map<string, number>();
  const muls = new Map<string, number>();
  const sets = new Map<string, number>();

  for (const m of modifiers) {
    switch (m.op) {
      case 'add':
        sums.set(m.stat, (sums.get(m.stat) ?? 0) + m.value);
        break;
      case 'mul':
        muls.set(m.stat, (muls.get(m.stat) ?? 1) * m.value);
        break;
      case 'set':
        sets.set(m.stat, m.value);
        break;
    }
  }

  for (const [stat, sum] of sums) {
    const cur = out[stat as keyof ShotProfile];
    if (typeof cur === 'number') {
      (out[stat as keyof ShotProfile] as number) = cur + sum;
    }
  }
  for (const [stat, factor] of muls) {
    const cur = out[stat as keyof ShotProfile];
    if (typeof cur === 'number') {
      (out[stat as keyof ShotProfile] as number) = cur * factor;
    }
  }
  for (const [stat, value] of sets) {
    const cur = out[stat as keyof ShotProfile];
    if (typeof cur === 'number') {
      (out[stat as keyof ShotProfile] as number) = value;
    }
  }

  // 收口：防止极端数值让游戏崩坏
  out.count = Math.max(0, Math.round(out.count));
  out.interval = Math.max(0.02, out.interval);
  out.damage = Math.max(0, out.damage);
  out.lifetime = Math.max(0.05, out.lifetime);

  return out;
}

/** 伤害拆解：给 UI 用的逐步记录 */
export interface DamageBreakdownStep {
  label: string;
  before: number;
  after: number;
}

export function resolveShotWithBreakdown(
  base: ShotProfile,
  modifiers: readonly { op: 'add' | 'mul' | 'set'; stat: string; value: number; label: string }[],
): { profile: ShotProfile; breakdown: DamageBreakdownStep[] } {
  const out: ShotProfile = { ...base };
  const breakdown: DamageBreakdownStep[] = [
    { label: '基础', before: base.damage, after: base.damage },
  ];

  // 加法阶段
  for (const m of modifiers) {
    if (m.op !== 'add') continue;
    const cur = out[m.stat as keyof ShotProfile];
    if (typeof cur !== 'number') continue;
    const before = cur;
    (out[m.stat as keyof ShotProfile] as number) = before + m.value;
    if (m.stat === 'damage') {
      breakdown.push({ label: m.label, before, after: before + m.value });
    }
  }
  // 乘法阶段
  for (const m of modifiers) {
    if (m.op !== 'mul') continue;
    const cur = out[m.stat as keyof ShotProfile];
    if (typeof cur !== 'number') continue;
    const before = cur;
    (out[m.stat as keyof ShotProfile] as number) = before * m.value;
    if (m.stat === 'damage') {
      breakdown.push({ label: m.label, before, after: before * m.value });
    }
  }
  // 覆盖阶段
  for (const m of modifiers) {
    if (m.op !== 'set') continue;
    const cur = out[m.stat as keyof ShotProfile];
    if (typeof cur !== 'number') continue;
    const before = cur;
    (out[m.stat as keyof ShotProfile] as number) = m.value;
    if (m.stat === 'damage') {
      breakdown.push({ label: m.label, before, after: m.value });
    }
  }

  return { profile: out, breakdown };
}
