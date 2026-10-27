import { describe, it, expect } from 'vitest';
import { Pile, DEFAULT_PILE } from '../../src/core/cards/pile';
import { Energy, ENERGY_CAP, ENERGY_INTERVAL } from '../../src/core/cards/energy';
import { Deck, DRAW_INTERVAL } from '../../src/core/cards/deck';
import { Rng } from '../../src/core/rng';
import { createStarterDeck, getCard } from '../../src/core/cards/library';
import type { CardDef } from '../../src/core/cards/def';

/** 造一批能区分身份的假卡 */
function makeDeck(n: number): CardDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `测试卡${i}`,
    type: 'active' as const,
    rarity: 'common' as const,
    price: 1,
    energy: 1,
    effects: [{ op: 'gain_coin' as const, value: 1 }],
  }));
}

describe('Pile 基础', () => {
  it('初始手牌为 cfg.initial', () => {
    const p = new Pile(makeDeck(20), new Rng(1));
    expect(p.handSize).toBe(DEFAULT_PILE.initial);
    expect(p.handSize).toBe(3);
  });

  it('卡组不足时初始手牌相应减少', () => {
    const p = new Pile(makeDeck(2), new Rng(1));
    expect(p.handSize).toBe(2);
  });

  it('牌堆 + 手牌 + 弃牌 = 卡组总数', () => {
    const p = new Pile(makeDeck(20), new Rng(1));
    p.draw(3, 3);
    const total = p.drawCount + p.handSize + p.discardCount;
    expect(total).toBe(20);
  });

  it('打出一张牌进入弃牌堆', () => {
    const p = new Pile(makeDeck(20), new Rng(1));
    const before = p.handSize;
    const played = p.playAt(0);
    expect(played).not.toBeNull();
    expect(p.handSize).toBe(before - 1);
    expect(p.discardCount).toBe(1);
  });

  it('打出非法索引返回 null', () => {
    const p = new Pile(makeDeck(20), new Rng(1));
    expect(p.playAt(-1)).toBeNull();
    expect(p.playAt(99)).toBeNull();
  });

  it('抽牌堆空时把弃牌堆洗回来', () => {
    // 只有 5 张，抽到抽牌堆空
    const p = new Pile(makeDeck(5), new Rng(1));
    // 初始 3 张，抽牌堆还剩 2
    expect(p.drawCount).toBe(2);

    p.draw(2, 3); // 抽空
    expect(p.drawCount).toBe(0);

    // 打出几张进弃牌堆
    p.playAt(0);
    p.playAt(0);
    expect(p.discardCount).toBe(2);

    // 再抽，应从弃牌堆洗回
    const r = p.draw(1, 3);
    expect(r.drawn).toBe(1);
  });
});

describe('Pile 过载规则', () => {
  it('未满时不触发过载', () => {
    const p = new Pile(makeDeck(30), new Rng(1));
    const r = p.draw(1, 3);
    expect(r.overloaded).toBe(false);
    expect(p.handSize).toBe(4);
  });

  it('满手时抽牌触发过载', () => {
    const p = new Pile(makeDeck(40), new Rng(1));
    // 抽到满手（6）
    while (p.handSize < 6) p.draw(1, 3);
    expect(p.handSize).toBe(6);

    const r = p.draw(1, 3);
    expect(r.overloaded).toBe(true);
  });

  it('过载重抽量 = min(初始 + 本次抽牌, 上限)', () => {
    const p = new Pile(makeDeck(40), new Rng(1));
    while (p.handSize < 6) p.draw(1, 3);

    // D = 1 → 重抽 min(3+1, 6) = 4
    const r1 = p.draw(1, 3);
    expect(r1.drawn).toBe(4);
    expect(p.handSize).toBe(4);
  });

  it('抽牌数较大时重抽量截断到上限', () => {
    const p = new Pile(makeDeck(40), new Rng(1));
    while (p.handSize < 6) p.draw(1, 3);

    // D = 5 → min(3+5, 6) = 6
    const r = p.draw(5, 3);
    expect(r.drawn).toBe(6);
    expect(p.handSize).toBe(6);
  });

  it('过载会把旧手牌全部弃掉', () => {
    const p = new Pile(makeDeck(40), new Rng(1));
    while (p.handSize < 6) p.draw(1, 3);

    const r = p.draw(1, 3);
    expect(r.discarded.length).toBe(6);
    expect(p.discardCount).toBeGreaterThanOrEqual(6);
  });

  it('停顿时长 = 初始手牌数 × 抽牌间隔（与本次抽牌数无关）', () => {
    // D = 1：停顿 3 × 3s = 9s
    const p1 = new Pile(makeDeck(40), new Rng(1));
    while (p1.handSize < 6) p1.draw(1, 3);
    const r1 = p1.draw(1, 3);
    expect(r1.pauseMs).toBeCloseTo(3 * 3 * 1000, 0);

    // D = 3：停顿仍是 3 × 3s = 9s
    const p2 = new Pile(makeDeck(40), new Rng(1));
    while (p2.handSize < 6) p2.draw(1, 3);
    const r2 = p2.draw(3, 3);
    expect(r2.pauseMs).toBeCloseTo(3 * 3 * 1000, 0);
  });

  it('未满但装不下时，只把溢出部分计入过载', () => {
    const p = new Pile(makeDeck(60), new Rng(1));
    // 手牌 4 张（初始 3 + 抽 1）
    p.draw(1, 3);
    expect(p.handSize).toBe(4);

    // 此时卡牌效果抽 3 张：space = 2，overflow = 1
    const r = p.draw(3, 3);
    expect(r.overloaded).toBe(true);

    // 先装下 2 张，再按 overflow=1 过载重抽 min(3+1, 6) = 4 张
    expect(r.drawn).toBe(2 + 4);
    expect(p.handSize).toBe(4);
  });

  it('溢出 0 张时不触发过载（刚好装满）', () => {
    const p = new Pile(makeDeck(60), new Rng(1));
    // 手牌 3，抽 3 张刚好装满 6
    const r = p.draw(3, 3);
    expect(r.overloaded).toBe(false);
    expect(p.handSize).toBe(6);
  });

  it('溢出越多，重抽越多（截断前）', () => {
    const build = (preDraw: number) => {
      const p = new Pile(makeDeck(80), new Rng(1));
      if (preDraw > 0) p.draw(preDraw, 3);
      return p;
    };

    // 手牌 5，抽 3 -> space=1, overflow=2 -> R=min(3+2,6)=5
    const p1 = build(2);   // 3+2=5 张
    expect(p1.handSize).toBe(5);
    const r1 = p1.draw(3, 3);
    expect(r1.drawn).toBe(1 + 5);  // 装 1 + 重抽 5
  });

  it('规则无状态：连续触发过载不会被拦住', () => {
    // 这条对应硬约束：不得有"过载后需先出牌"之类的标记。
    // 注意过载后手牌只有 4 张（不是 6），所以需要再抽 2 次才回到满手。
    const p = new Pile(makeDeck(80), new Rng(1));

    // 填满到 6
    p.draw(3, 3);
    expect(p.handSize).toBe(6);

    let overloads = 0;
    for (let i = 0; i < 30; i++) {
      const r = p.draw(1, 3);
      if (r.overloaded) overloads++;
    }
    // 30 次抽牌里应该能触发多次过载（每 3 次填满算一轮）
    expect(overloads).toBeGreaterThanOrEqual(8);
  });
});

describe('Pile 过载中性（核心性质）', () => {
  /**
   * 模拟：在固定时长内，不同"出牌频率"下抽到多少张牌。
   *
   * 理论（DESIGN.md 2.5）：
   *   从手牌 R 填到 U 需要 (U-R) 次抽牌，然后过载重抽 R 张，停顿 R×T 秒
   *   单周期 = (U-R+R)×T 秒，抽 (U-R+R) 张
   *   速率 = 1/T，**与参数无关**
   *
   * 但憋牌有一个启动成本：从初始手牌 3 填到 6 需要 9 秒，
   * 这 9 秒里它一次都没过载。所以短期内憋牌会略少抽。
   * 这个"起手吃亏"是有意的——它让憋着不出牌在开局就付出代价。
   */
  function simulate(playIntervalSec: number | null, seconds: number): number {
    const p = new Pile(makeDeck(500), new Rng(42));
    const T = 3.0;
    let t = 0;
    let timer = 0;
    let totalDrawn = 0;
    let nextPlay = playIntervalSec ?? Infinity;
    let pauseLeft = 0;

    const dt = 1 / 60;
    while (t < seconds) {
      t += dt;

      // 出牌：不受停顿影响
      if (t >= nextPlay) {
        nextPlay += playIntervalSec!;
        if (p.handSize > 0) p.playAt(0);
      }

      // 过载停顿：只停抽牌
      if (pauseLeft > 0) {
        pauseLeft -= dt;
        continue;
      }

      timer += dt;
      if (timer >= T) {
        timer -= T;
        const r = p.draw(1, T);
        totalDrawn += r.drawn;
        if (r.overloaded) {
          pauseLeft = r.pauseMs / 1000;
          timer = 0;
        }
      }
    }
    return totalDrawn;
  }

  it('过载不产生额外收益（憋牌 ≤ 正常出牌）', () => {
    const hold = simulate(null, 180);
    const normal = simulate(3.0, 180);

    // 憋牌最多与正常持平（允许模拟相位噪声 +5%），绝不能超过
    expect(hold).toBeLessThanOrEqual(normal * 1.05);
  });

  it('过载是严格中性的：憋牌与正常出牌抽牌量相等', () => {
    // 中性条件：停顿 = (R-1)×T，而非 R×T
    // 用长窗口摊薄启动成本
    const hold = simulate(null, 600);
    const normal = simulate(3.0, 600);
    const dev = Math.abs(hold - normal) / normal;
    if (dev >= 0.03) {
      throw new Error(
        `憋牌=${hold} 正常=${normal} 偏差 ${(dev * 100).toFixed(1)}%，应 < 3%`,
      );
    }
  });

  it('正常出牌与快出牌抽牌量一致（都不会频繁过载）', () => {
    const normal = simulate(3.0, 180);
    const fast = simulate(2.0, 180);
    expect(Math.abs(fast - normal) / normal).toBeLessThan(0.05);
  });

  it('长期看所有玩法抽牌量收敛到同一量级', () => {
    const hold = simulate(null, 600);
    const normal = simulate(3.0, 600);
    // 10 分钟窗口，启动成本被摊薄
    expect(Math.abs(hold - normal) / normal).toBeLessThan(0.03);
  });

  it('抽牌速率约为 1/T（不因过载而变慢）', () => {
    const normal = simulate(3.0, 180);
    const expected = 180 / 3.0;   // 60 张
    // 允许一次抽牌的误差
    expect(Math.abs(normal - expected)).toBeLessThanOrEqual(2);
  });
});

describe('Energy', () => {
  it('初始满能量', () => {
    const e = new Energy();
    expect(e.value).toBe(ENERGY_CAP);
    expect(e.full).toBe(true);
  });

  it('满能量时不累积计时', () => {
    const e = new Energy();
    e.step(10);
    expect(e.progress).toBe(1);
    expect(e.value).toBe(ENERGY_CAP);
  });

  it('消耗后按间隔回复', () => {
    const e = new Energy();
    e.pay(2);
    expect(e.value).toBe(1);

    // 推进一个间隔（多跑一帧，避免浮点累积差）
    const steps = Math.ceil(ENERGY_INTERVAL * 60) + 2;
    for (let i = 0; i < steps; i++) e.step(1 / 60);

    expect(e.value).toBe(2);
  });

  it('能量不足时无法支付，且不扣', () => {
    const e = new Energy();
    e.pay(3);
    expect(e.value).toBe(0);
    expect(e.canPay(1)).toBe(false);
    expect(e.pay(1)).toBe(false);
    expect(e.value).toBe(0);
  });

  it('gain 不超上限', () => {
    const e = new Energy();
    e.pay(2);
    e.gain(10);
    expect(e.value).toBe(ENERGY_CAP);
  });

  it('refill 回满', () => {
    const e = new Energy();
    e.pay(3);
    e.refill();
    expect(e.value).toBe(ENERGY_CAP);
  });
});

describe('Deck 被动卡结算（改为卡牌威力）', () => {
  it('无被动卡时威力为 1 倍、无能量优惠', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    const p = d.resolveCardPower();
    expect(p.damageMul).toBe(1);
    expect(p.energyDiscount).toBe(0);
  });

  it('锋利符片提升卡牌伤害倍率', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(getCard('p_sharp')!);   // damage +3 -> +0.06 倍
    const p = d.resolveCardPower();
    expect(p.damageMul).toBeCloseTo(1.06, 5);
  });

  it('重击符片按乘法提升伤害', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(getCard('p_heavy')!);   // damage ×1.6, interval ×1.2
    const p = d.resolveCardPower();
    expect(p.damageMul).toBeCloseTo(1.6, 5);
  });

  it('加法与乘法叠加顺序无关', () => {
    const a = new Deck(new Rng(1), createStarterDeck());
    a.addPassive(getCard('p_sharp')!);
    a.addPassive(getCard('p_heavy')!);

    const b = new Deck(new Rng(1), createStarterDeck());
    b.addPassive(getCard('p_heavy')!);
    b.addPassive(getCard('p_sharp')!);

    expect(a.resolveCardPower().damageMul)
      .toBeCloseTo(b.resolveCardPower().damageMul, 10);
  });

  it('射速类词条转为能量优惠', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(getCard('p_rapid')!);   // interval ×0.85
    const p = d.resolveCardPower();
    expect(p.energyDiscount).toBeGreaterThan(0);
  });

  it('威力倍率有下限，不会被压到 0 或负', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    // 塞一堆减伤
    for (let i = 0; i < 10; i++) {
      d.addPassive({
        id: `neg${i}`, name: '减伤', type: 'passive', rarity: 'common',
        price: 0, modifiers: [{ op: 'mul', stat: 'damage', value: 0.1 }],
      });
    }
    expect(d.resolveCardPower().damageMul).toBeGreaterThanOrEqual(0.1);
  });
});

describe('Deck 符卡改造', () => {
  it('无被动时是默认符卡', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    const s = d.resolveSpell();
    expect(s.invulnTime).toBe(2.0);
    expect(s.damage).toBe(0);
  });

  it('广域符卡增加无敌时间', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(getCard('p_spell_wide')!);
    const s = d.resolveSpell();
    expect(s.invulnTime).toBeCloseTo(3.0, 5);
  });

  it('破邪符卡给符卡加伤害', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.addPassive(getCard('p_spell_bane')!);
    const s = d.resolveSpell();
    expect(s.damage).toBe(400);
  });
});

describe('Deck 抽牌节奏', () => {
  it('每 DRAW_INTERVAL 秒自动抽 1 张', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    expect(d.pile.handSize).toBe(3);

    const steps = Math.ceil(DRAW_INTERVAL * 60) + 1;
    for (let i = 0; i < steps; i++) d.step(1 / 60);

    expect(d.pile.handSize).toBe(4);
  });
});

describe('Deck 选卡与出牌', () => {
  it('C 键循环切换选中', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    expect(d.selected).toBe(0);
    d.cycleSelection();
    expect(d.selected).toBe(1);
    d.cycleSelection();
    expect(d.selected).toBe(2);
    d.cycleSelection();
    expect(d.selected).toBe(0); // 回到开头
  });

  it('空手牌时切换不崩溃', () => {
    const d = new Deck(new Rng(1), []);
    d.cycleSelection();
    expect(d.selected).toBe(0);
  });

  it('能打出手牌中的卡（Deck 不负责扣能量）', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    const before = d.pile.handSize;

    const played = d.playSelected();
    expect(played).not.toBeNull();
    expect(d.pile.handSize).toBe(before - 1);
    // 能量扣费由 World.playSelectedCard 统一处理（见 playCard.test.ts）
    expect(d.energy.value).toBe(ENERGY_CAP);
  });

  it('空手牌时打出返回 null', () => {
    const d = new Deck(new Rng(1), []);
    expect(d.playSelected()).toBeNull();
  });

  it('打出后选中索引被修正', () => {
    const d = new Deck(new Rng(1), createStarterDeck());
    d.selected = d.pile.handSize - 1;  // 选最后一张
    d.playSelected();
    expect(d.selected).toBeLessThan(d.pile.handSize);
  });
});
