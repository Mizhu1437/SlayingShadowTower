/**
 * 卡组总览（Tab 打开的大面板）。
 *
 * 与 PileViewer 的区别：
 *   PileViewer —— 右侧小栏，快速瞥一眼抽牌堆/弃牌堆，不打断节奏
 *   本面板     —— 屏幕正中大面积展示整副卡组，**同时暂停游戏**
 *
 * 为什么卡组要暂停：这是玩家做长期规划的时刻（估算伤害、看牌组配比），
 * 需要完整注意力，不能边躲弹边看。抽牌堆/弃牌堆则只是确认信息，
 * 不需要暂停。
 */

import type { CardDef } from '../core/cards/def';

export class DeckOverlay {
  private root: HTMLElement;
  private gridEl: HTMLElement;
  private statsEl: HTMLElement;
  private open = false;

  constructor(
    host: HTMLElement,
    private readonly onClose?: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'deck-overlay';
    this.root.className = 'deck-overlay hidden';
    this.root.innerHTML = `
      <div class="deck-panel">
        <div class="deck-head">
          <span class="deck-title">卡组</span>
          <span class="deck-close-hint">Tab / Esc 关闭</span>
        </div>
        <div class="deck-stats" id="deck-stats"></div>
        <div class="deck-grid" id="deck-grid"></div>
        <div class="deck-foot">游戏已暂停</div>
      </div>
    `;
    host.appendChild(this.root);

    this.gridEl = this.root.querySelector('#deck-grid')!;
    this.statsEl = this.root.querySelector('#deck-stats')!;

    // 点背景关闭
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(cards: readonly CardDef[], passiveSlots: number, passiveCount: number): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render(cards, passiveSlots, passiveCount);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  toggle(cards: readonly CardDef[], passiveSlots: number, passiveCount: number): void {
    if (this.open) this.hide();
    else this.show(cards, passiveSlots, passiveCount);
  }

  private render(
    cards: readonly CardDef[],
    passiveSlots: number,
    passiveCount: number,
  ): void {
    // 同名卡合并
    const grouped = new Map<string, { card: CardDef; n: number }>();
    for (const c of cards) {
      const cur = grouped.get(c.id);
      if (cur) cur.n++;
      else grouped.set(c.id, { card: c, n: 1 });
    }

    const actives = [...grouped.values()].filter((g) => g.card.type === 'active');
    const passives = [...grouped.values()].filter((g) => g.card.type === 'passive');

    const totalActive = actives.reduce((s, g) => s + g.n, 0);
    const avgCost = totalActive > 0
      ? actives.reduce((s, g) => s + (g.card.energy ?? 0) * g.n, 0) / totalActive
      : 0;

    this.statsEl.innerHTML = `
      <span>主动牌 <b>${totalActive}</b> 张 / ${grouped.size} 种</span>
      <span>平均费用 <b>${avgCost.toFixed(1)}</b></span>
      <span>被动槽 <b>${passiveCount}/${passiveSlots}</b></span>
    `;

    this.gridEl.innerHTML = '';

    for (const { card, n } of actives) {
      this.gridEl.appendChild(this.buildCard(card, n, 'active'));
    }
    for (const { card, n } of passives) {
      this.gridEl.appendChild(this.buildCard(card, n, 'passive'));
    }

    if (this.gridEl.children.length === 0) {
      this.gridEl.innerHTML = '<div class="deck-empty">（空）</div>';
    }
  }

  private buildCard(card: CardDef, n: number, kind: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `deck-card ${kind}`;
    el.innerHTML = `
      <div class="dc-top">
        <span class="dc-name">${card.name}</span>
        ${n > 1 ? `<span class="dc-count">×${n}</span>` : ''}
      </div>
      <div class="dc-cost">${card.energy != null ? `${card.energy} 费` : '被动'}</div>
      <div class="dc-text">${card.text ?? ''}</div>
    `;
    return el;
  }
}
