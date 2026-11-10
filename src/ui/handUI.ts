/**
 * 手牌 UI（DOM 实现）。
 *
 * 为什么不画在 canvas 里：
 *   手牌需要文字、描边、选中态、悬停——用 DOM 做又快又清晰，
 *   而且不占用 PixiJS 的绘制预算。
 *
 * 位置：屏幕底部，紧贴场地边缘下方，绝不遮挡弹幕区。
 */

import type { Deck } from '../core/cards/deck';

export class HandUI {
  private readonly root: HTMLElement;
  private readonly cardEls: HTMLElement[] = [];
  private readonly infoEl: HTMLElement;
  /** 手牌 N / 上限，贴在手牌区上方 */
  private readonly countEl: HTMLElement;
  private lastCountSig = '';

  /** 缓存上一次渲染的状态，避免每帧重建 DOM */
  private lastSig = '';
  private lastSelected = -1;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hand-root';

    // 能量与符卡已移到左下角（灵力 / 符卡图标排），
    // 手牌区不再重复显示能量条。

    // 手牌数量 / 上限，贴在手牌区正上方
    this.countEl = document.createElement('div');
    this.countEl.className = 'hand-count';
    host.appendChild(this.countEl);

    host.appendChild(this.root);

    this.infoEl = document.createElement('div');
    this.infoEl.className = 'hand-info';
    host.appendChild(this.infoEl);
  }

  /** 每帧调用；内部会判断是否需要重建 DOM */
  render(deck: Deck): void {
    const hand = deck.pile.hand;

    // 手牌变化签名：只含 id 序列
    const sig = hand.map((c) => c.id).join(',');

    // 重建 DOM 时，选中态会随之丢失，所以必须把 lastSelected 一起失效，
    // 否则下一次循环会误判"选中没变"而不重新上色。
    if (sig !== this.lastSig) {
      this.rebuild(hand);
      this.lastSig = sig;
      this.lastSelected = -1;   // ← 关键：强制下一段重新应用选中态
    }

    // 应用选中态（重建后必然执行一次）
    if (deck.selected !== this.lastSelected) {
      for (let i = 0; i < this.cardEls.length; i++) {
        this.cardEls[i]!.classList.toggle('selected', i === deck.selected);
      }
      this.lastSelected = deck.selected;
    }

    // 能量不在这里显示（左下角有灵力图标排），
    // 但下面的状态提示仍需要进度来算倒计时
    const e = deck.energy;

    // 状态提示
    //
    // 时间必须显示"还剩多少"，而不是"已经过了多少"：
    //   progress 是已积累的比例（0→1），剩余时间 = (1 - progress) × 间隔。
    //   早先写成 progress × 常数，既是从 0 往上涨（像正计时），
    //   又把间隔硬编码成 3 秒，导致 T 改成 5 后显示仍是 3。
    let info = '';
    if (deck.paused) {
      info = `过载 · 抽牌停顿 ${deck.pauseLeft.toFixed(1)}s`;
    } else if (e.full) {
      info = '能量已满';
    } else {
      const remain = (1 - e.progress) * e.interval;
      info = `下一点能量 ${remain.toFixed(1)}s`;
    }
    const deckInfo =
      `牌堆 ${deck.pile.drawCount} · 弃牌 ${deck.pile.discardCount}`;
    this.infoEl.textContent = `${info}　｜　${deckInfo}`;

    // 手牌数 / 上限
    const cnt = `${deck.pile.handSize} / ${deck.pile.cfg.upper}`;
    if (cnt !== this.lastCountSig) {
      this.lastCountSig = cnt;
      this.countEl.textContent = `手牌 ${cnt}`;
    }
    this.infoEl.classList.toggle('overload', deck.paused);
  }

  private rebuild(hand: { id: string; name: string; type: string; energy?: number; text?: string }[]): void {
    this.root.innerHTML = '';
    this.cardEls.length = 0;

    for (let i = 0; i < hand.length; i++) {
      const c = hand[i]!;
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.id = c.id;
      if (c.type === 'passive') el.classList.add('passive');

      const cost = c.type === 'active' ? (c.energy ?? 0) : -1;

      // 卡图：素材在 public/art/cards/{id}.png
      // 起始卡有 hougeki_0..3 这类带序号的 id，取前缀映射到同一张图
      const artId = c.id.replace(/_\d+$/, '');
      const artSrc = `./art/cards/${artId}.png`;

      el.innerHTML = `
        <div class="card-art">
          <img src="${artSrc}" alt="" loading="lazy"
               onerror="this.style.display='none'" />
          <div class="card-cost">${cost >= 0 ? cost : '被'}</div>
        </div>
        <div class="card-name">${escapeHtml(c.name)}</div>
        <div class="card-text">${escapeHtml(c.text ?? '')}</div>
      `;

      this.root.appendChild(el);
      this.cardEls.push(el);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
