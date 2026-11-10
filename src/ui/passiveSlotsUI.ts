/**
 * 左下角被动符卡区。
 *
 * 按需求：默认 2 个槽，代表被动符卡上限。
 *   空槽   —— 虚位（虚线框），告诉玩家还能再装几张
 *   已装备 —— 卡图缩略 + 名称
 *
 * 为什么放在左下角：右下角被手牌占了，左侧上方是幕次/波次信息，
 * 左下是唯一不会在战斗中频繁变化、又能一眼扫到的位置。
 * 被动卡是"永久生效"的构筑成果，玩家需要随时知道自己装了什么。
 */

import type { CardDef } from '../core/cards/def';

export class PassiveSlotsUI {
  private root: HTMLElement;
  private slotsEl: HTMLElement;
  private titleEl: HTMLElement;
  private lastSig = '';

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'passive-slots';
    this.root.innerHTML = `
      <div class="ps-title" id="ps-title">被动符卡</div>
      <div class="ps-row" id="ps-row"></div>
    `;
    host.appendChild(this.root);

    this.slotsEl = this.root.querySelector('#ps-row')!;
    this.titleEl = this.root.querySelector('#ps-title')!;
  }

  /**
   * 每帧调用；签名不变就不重建。
   *
   * @param passives 已装备的被动卡
   * @param slots 槽位上限
   */
  render(passives: readonly CardDef[], slots: number): void {
    const sig = `${passives.map((p) => p.id).join(',')}|${slots}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    this.titleEl.textContent = `被动符卡 ${passives.length}/${slots}`;

    this.slotsEl.innerHTML = '';

    for (let i = 0; i < slots; i++) {
      const card = passives[i];
      const el = document.createElement('div');

      if (card) {
        el.className = 'ps-slot filled';
        // 卡图 id 与文件名一致（p_sharp → p_sharp.png）
        const artSrc = `./art/cards/${card.id}.png`;
        el.innerHTML = `
          <img src="${artSrc}" alt="" onerror="this.style.display='none'" />
          <div class="ps-name">${escapeHtml(card.name)}</div>
        `;
        el.title = card.text ?? card.name;
      } else {
        // 空槽用虚位，不用"变暗的卡"—— 那会被误认为已装备
        el.className = 'ps-slot empty';
        el.innerHTML = '<div class="ps-plus">+</div>';
        el.title = '空槽位';
      }

      this.slotsEl.appendChild(el);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
