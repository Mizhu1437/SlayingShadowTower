/**
 * 牌堆查看面板。
 *
 * 右下角三个按钮（牌堆 / 弃牌 / 卡组），点开查看具体卡牌。
 *
 * 为什么需要它：
 *   本作的牌组循环是核心机制（过载、洗回、删卡），
 *   但玩家看不到牌堆里有什么，就没法规划"这张该不该弃"。
 *   杀戮尖塔把这三个按钮放在显眼位置也是同样原因。
 *
 * 实现：面板内容按需重建，不每帧刷新。
 *   商店那边踩过"每帧重建导致点不动"的坑，
 *   这里只在打开或切换标签时构建一次。
 */

import type { Pile } from '../core/cards/pile';
import type { CardDef } from '../core/cards/def';

type Tab = 'draw' | 'discard' | 'all';

const TAB_LABEL: Record<Tab, string> = {
  draw: '抽牌堆',
  discard: '弃牌堆',
  all: '卡组',
};

export class PileViewer {
  private root: HTMLElement;
  private listEl: HTMLElement;
  private titleEl: HTMLElement;
  private buttons: Record<Tab, HTMLButtonElement>;

  private open = false;
  private tab: Tab = 'draw';
  /** 打开时的数据快照，避免边看边变 */
  private snapshot: CardDef[] = [];
  private counts = { draw: 0, discard: 0, all: 0 };
  /** 数据源。按钮点击时用它取最新内容，避免每帧传参 */
  private pileRef: Pile | null = null;
  /** 上次渲染的内容签名，用于判断是否需要重建 */
  private lastSig = '';

  /** 按标签取牌堆内容 */
  private readCards(pile: Pile, tab: Tab): CardDef[] {
    if (tab === 'draw') return [...pile.drawCards];
    if (tab === 'discard') return [...pile.discardCards];
    return [...pile.allCards()];
  }

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'pile-viewer';
    this.root.className = 'pile-viewer hidden';
    this.root.innerHTML = `
      <div class="pv-head">
        <span class="pv-title" id="pv-title">抽牌堆</span>
        <button class="pv-close" id="pv-close">×</button>
      </div>
      <div class="pv-list" id="pv-list"></div>
    `;
    host.appendChild(this.root);

    this.listEl = this.root.querySelector('#pv-list')!;
    this.titleEl = this.root.querySelector('#pv-title')!;
    this.root.querySelector('#pv-close')!.addEventListener('click', () => this.hide());

    // 右下角三个按钮
    const bar = document.createElement('div');
    bar.id = 'pile-bar';
    bar.innerHTML = `
      <button class="pv-btn" data-tab="draw">
        牌堆 <b id="pv-count-draw">0</b>
      </button>
      <button class="pv-btn" data-tab="discard">
        弃牌 <b id="pv-count-discard">0</b>
      </button>
      <button class="pv-btn" data-tab="all">
        卡组 <b id="pv-count-all">0</b>
      </button>
    `;
    host.appendChild(bar);

    const mk = (tab: Tab): HTMLButtonElement =>
      bar.querySelector(`[data-tab="${tab}"]`) as HTMLButtonElement;

    this.buttons = {
      draw: mk('draw'),
      discard: mk('discard'),
      all: mk('all'),
    };

    for (const tab of ['draw', 'discard', 'all'] as Tab[]) {
      this.buttons[tab].addEventListener('click', () => {
        // 点同一个标签时收起，点别的则切换
        if (this.open && this.tab === tab) this.hide();
        else this.show(tab, this.pileRef ?? undefined);
      });
    }
  }

  /**
   * 每帧调用：只更新按钮上的数字，不重建面板。
   *
   * 但面板打开时，牌堆内容会变（抽牌、弃牌、洗回），
   * 必须跟着刷新 —— 否则玩家看到的是打开那一刻的旧快照。
   * 用签名判断内容是否真的变了，避免无谓重建。
   */
  syncCounts(pile: Pile): void {
    // 记住数据源，供按钮点击时读取
    this.pileRef = pile;

    // 面板打开时同步内容
    if (this.open) {
      const cards = this.readCards(pile, this.tab);
      const sig = cards.map((c) => c.id).join(',');
      if (sig !== this.lastSig) {
        this.lastSig = sig;
        this.snapshot = cards;
        this.titleEl.textContent = `${TAB_LABEL[this.tab]}（${cards.length} 张）`;
        this.renderList();
      }
    }

    const draw = pile.drawCount;
    const discard = pile.discardCount;
    const all = pile.totalCards;

    if (draw !== this.counts.draw) {
      this.counts.draw = draw;
      const el = document.getElementById('pv-count-draw');
      if (el) el.textContent = String(draw);
    }
    if (discard !== this.counts.discard) {
      this.counts.discard = discard;
      const el = document.getElementById('pv-count-discard');
      if (el) el.textContent = String(discard);
    }
    if (all !== this.counts.all) {
      this.counts.all = all;
      const el = document.getElementById('pv-count-all');
      if (el) el.textContent = String(all);
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * 打开面板并展示指定标签。
   * @param pile 牌堆（用于取数据快照）
   */
  show(tab: Tab, pile?: Pile): void {
    this.open = true;
    this.tab = tab;

    const src = pile ?? this.pileRef;
    if (src) {
      this.snapshot = this.readCards(src, tab);
    } else {
      this.snapshot = [];
    }
    // 记录签名，避免下一帧 syncCounts 重复重建
    this.lastSig = this.snapshot.map((c) => c.id).join(',');

    this.titleEl.textContent = `${TAB_LABEL[tab]}（${this.snapshot.length} 张）`;
    this.root.classList.remove('hidden');

    this.renderList();
    this.syncActiveButton();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.syncActiveButton();
  }

  toggle(tab: Tab, pile: Pile): void {
    if (this.open && this.tab === tab) this.hide();
    else this.show(tab, pile);
  }

  private syncActiveButton(): void {
    for (const tab of ['draw', 'discard', 'all'] as Tab[]) {
      this.buttons[tab].classList.toggle('active', this.open && this.tab === tab);
    }
  }

  /** 构建卡牌列表（只在打开/切换标签时调用一次） */
  private renderList(): void {
    this.listEl.innerHTML = '';

    if (this.snapshot.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pv-empty';
      empty.textContent = '（空）';
      this.listEl.appendChild(empty);
      return;
    }

    // 同名卡合并显示，避免一长串重复
    const grouped = new Map<string, { card: CardDef; n: number }>();
    for (const c of this.snapshot) {
      const cur = grouped.get(c.id);
      if (cur) cur.n++;
      else grouped.set(c.id, { card: c, n: 1 });
    }

    for (const { card, n } of grouped.values()) {
      const el = document.createElement('div');
      el.className = `pv-card ${card.type}`;
      el.innerHTML = `
        <span class="pv-name">${card.name}${n > 1 ? ` ×${n}` : ''}</span>
        <span class="pv-cost">${card.energy != null ? `${card.energy} 费` : '被动'}</span>
        <span class="pv-desc">${card.text ?? ''}</span>
      `;
      this.listEl.appendChild(el);
    }
  }
}
