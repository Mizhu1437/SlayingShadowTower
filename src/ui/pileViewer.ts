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
  private buttons: Record<'draw' | 'discard', HTMLButtonElement>;

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
      <button class="pv-btn" data-tab="discard">
        弃牌堆 <b id="pv-count-discard">0</b>
      </button>
      <button class="pv-btn" data-tab="draw">
        抽牌堆 <b id="pv-count-draw">0</b>
      </button>
    `;
    host.appendChild(bar);

    const mk = (tab: 'draw' | 'discard'): HTMLButtonElement =>
      bar.querySelector(`[data-tab="${tab}"]`) as HTMLButtonElement;

    this.buttons = {
      draw: mk('draw'),
      discard: mk('discard'),
    };

    for (const tab of ['draw', 'discard'] as const) {
      this.buttons[tab].addEventListener('click', () => {
        // 弃牌堆向左展开，抽牌堆向右展开
        this.setAnchor(tab === 'discard' ? 'left' : 'right');
        if (this.open && this.tab === tab) {
          this.hide();
        } else {
          this.show(tab, this.pileRef ?? undefined);
          this.attachTo(this.buttons[tab]);
        }
      });
    }
  }

  /**
   * 设置面板相对按钮的展开方向。
   *
   * @param side 'left'  = 贴按钮左侧、向左展开（弃牌堆用）
   *             'right' = 贴按钮右侧、向右展开（抽牌堆用）
   */
  setAnchor(side: 'left' | 'right'): void {
    this.root.dataset.anchor = side;
  }

  /**
   * 把面板贴到指定按钮旁边（按当前 anchor 决定贴哪一侧）。
   */
  attachTo(btn: HTMLElement | null): void {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const anchor = this.root.dataset.anchor;
    const panelW = this.root.offsetWidth || 300;

    /*
     * 直接算出面板的**左边界**，不依赖 CSS 的 translateX。
     *
     * 早期用 left=按钮左边 + translateX(-100%) 向左展开，
     * 但那条 CSS transform 与 .pile-viewer 上的其他定位规则冲突，
     * 面板实际跑到了屏幕外。这里改成纯数值定位：
     *   弃牌堆（anchor=left）  → 面板右边缘贴按钮左边缘
     *   抽牌堆（anchor=right） → 面板左边缘贴按钮右边缘
     * 最后再夹一次到视口范围内，保证任何窗口尺寸都看得见。
     */
    let left: number;
    if (anchor === 'left') {
      left = r.left - 8 - panelW;
    } else {
      left = r.right + 8;
    }

    const margin = 8;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.right = 'auto';
    // 面板底边贴在按钮顶边上方
    this.root.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
    this.root.style.top = 'auto';
    // 确保不被 transform 二次位移
    this.root.style.transform = 'none';
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
    const btn = this.tab === 'draw' || this.tab === 'discard'
      ? this.buttons[this.tab]
      : null;
    this.attachTo(btn);
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
    for (const tab of ['draw', 'discard'] as const) {
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
