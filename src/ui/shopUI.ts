/**
 * 商店界面（DOM）。
 *
 * 为什么用 DOM 而不是画在 canvas 上：
 *   商店是"停下来做选择"的界面，不需要每帧重绘，
 *   用 DOM 能直接拿到浏览器的排版、滚动与可访问性支持，
 *   也不必占用 PixiJS 的绘制预算。
 */

import type { Shop, ShopItem } from '../core/shop/shop';
import type { CardDef } from '../core/cards/def';

/** 商店界面需要的回调 */
export interface ShopUICallbacks {
  /** 购买第 index 件商品 */
  onBuy: (index: number) => void;
  /** 玩家完成了删卡选牌 */
  onRemoveCard: (cardId: string) => void;
  /** 离开商店 */
  onLeave: () => void;
}

export class ShopUI {
  private root: HTMLElement;
  private listEl: HTMLElement;
  private coinEl: HTMLElement;
  private hintEl: HTMLElement;
  private removePanel: HTMLElement;
  private removeListEl: HTMLElement;

  private visible = false;
  /** 上一次渲染的签名，避免每帧重建 DOM */
  private lastSig = '';

  constructor(host: HTMLElement, private readonly cb: ShopUICallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'shop-overlay';
    this.root.className = 'shop-overlay hidden';

    this.root.innerHTML = `
      <div class="shop-panel">
        <div class="shop-head">
          <span class="shop-title">蜃景交易</span>
          <span class="shop-coins">蜃銭 <b id="shop-coins">0</b></span>
        </div>
        <div class="shop-hint" id="shop-hint"></div>
        <div class="shop-list" id="shop-list"></div>
        <div class="shop-remove hidden" id="shop-remove">
          <div class="shop-remove-title">选择一张要焚去的符</div>
          <div class="shop-remove-list" id="shop-remove-list"></div>
        </div>
        <div class="shop-foot">
          <button class="shop-btn shop-leave" id="shop-leave">离开（Enter）</button>
        </div>
      </div>
    `;

    host.appendChild(this.root);

    this.listEl = this.root.querySelector('#shop-list')!;
    this.coinEl = this.root.querySelector('#shop-coins')!;
    this.hintEl = this.root.querySelector('#shop-hint')!;
    this.removePanel = this.root.querySelector('#shop-remove')!;
    this.removeListEl = this.root.querySelector('#shop-remove-list')!;

    this.root.querySelector('#shop-leave')!.addEventListener('click', () => {
      this.cb.onLeave();
    });
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** 显示商店 */
  show(shop: Shop, coins: number, allCards: CardDef[], pendingRemove: boolean): void {
    this.visible = true;
    this.root.classList.remove('hidden');
    this.render(shop, coins, allCards, pendingRemove, true);
  }

  /** 隐藏商店 */
  hide(): void {
    this.visible = false;
    this.root.classList.add('hidden');
    this.lastSig = '';
  }

  /** 每帧调用；内部判断是否需要重绘 */
  render(
    shop: Shop,
    coins: number,
    allCards: CardDef[],
    pendingRemove: boolean,
    force = false,
  ): void {
    if (!this.visible) return;

    // 签名：商品售出状态 + 钱 + 待选状态 + 卡组数量
    const sig = shop.state.items.map((i) => (i.sold ? '1' : '0')).join('')
      + `|${coins}|${pendingRemove ? 'R' : ''}|${allCards.length}`;

    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;

    this.coinEl.textContent = String(coins);

    // 提示
    if (pendingRemove) {
      this.hintEl.textContent = '请从下方的牌组中选择一张移除';
      this.hintEl.classList.add('warn');
    } else {
      this.hintEl.textContent = '';
      this.hintEl.classList.remove('warn');
    }

    // 商品列表
    this.listEl.innerHTML = '';
    shop.state.items.forEach((item, i) => {
      this.listEl.appendChild(this.buildItem(item, i, coins));
    });

    // 删卡面板
    if (pendingRemove) {
      this.removePanel.classList.remove('hidden');
      this.removeListEl.innerHTML = '';
      const counts = new Map<string, { card: CardDef; n: number }>();
      for (const c of allCards) {
        const cur = counts.get(c.id);
        if (cur) cur.n++;
        else counts.set(c.id, { card: c, n: 1 });
      }
      for (const { card, n } of counts.values()) {
        const btn = document.createElement('button');
        btn.className = `shop-remove-item ${card.type}`;
        btn.innerHTML = `
          <span class="sri-name">${card.name}${n > 1 ? ` ×${n}` : ''}</span>
          <span class="sri-cost">${card.energy != null ? `${card.energy} 费` : '被动'}</span>
        `;
        btn.addEventListener('click', () => this.cb.onRemoveCard(card.id));
        this.removeListEl.appendChild(btn);
      }
    } else {
      this.removePanel.classList.add('hidden');
    }
  }

  private buildItem(item: ShopItem, index: number, coins: number): HTMLElement {
    const el = document.createElement('button');
    el.className = 'shop-item';
    if (item.sold) el.classList.add('sold');
    if (!item.sold && coins < item.price) el.classList.add('expensive');

    const kindLabel: Record<string, string> = {
      card: item.card?.type === 'passive' ? '被动符片' : '主动符',
      remove_card: '服务',
      heal_life: '服务',
      restore_spell: '服务',
    };

    el.innerHTML = `
      <div class="si-kind">${kindLabel[item.kind] ?? ''}</div>
      <div class="si-name">${item.name}</div>
      <div class="si-desc">${item.desc}</div>
      <div class="si-price">${item.sold ? '已售出' : `${item.price} 蜃銭`}</div>
    `;

    if (!item.sold) {
      el.addEventListener('click', () => this.cb.onBuy(index));
    } else {
      el.disabled = true;
    }
    return el;
  }
}
