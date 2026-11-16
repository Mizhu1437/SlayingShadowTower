/**
 * 难度选择界面。
 *
 * 游戏开始前弹出，玩家选定难度后才进入战斗。
 * 为什么放在最前面而不是设置里：
 * 难度决定了弹幕密度、掉落与价格三条轴，
 * 中途切换等于换了一个游戏，必须在开局就定下来。
 */

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  type DifficultyId,
} from '../core/difficulty';

export class DifficultySelect {
  private root: HTMLElement;
  private onPick: (id: DifficultyId) => void;
  private selected: DifficultyId = 'normal';

  constructor(host: HTMLElement, onPick: (id: DifficultyId) => void) {
    this.onPick = onPick;

    this.root = document.createElement('div');
    this.root.id = 'difficulty-select';
    this.root.innerHTML = `
      <div class="ds-panel">
        <div class="ds-title">東方戮影塔 〜 Formless Barrage</div>
        <div class="ds-sub">选择难度</div>
        <div class="ds-list" id="ds-list"></div>
        <div class="ds-hint">不同难度的起跑线完全相同 —— 差别在于弹幕密度、掉落与价格</div>
        <button class="ds-start" id="ds-start">开始</button>
      </div>
    `;
    host.appendChild(this.root);

    this.buildList();

    this.root.querySelector('#ds-start')!.addEventListener('click', () => {
      this.hide();
      this.onPick(this.selected);
    });
  }

  private buildList(): void {
    const list = this.root.querySelector('#ds-list')!;
    list.innerHTML = '';

    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      const el = document.createElement('div');
      el.className = 'ds-item' + (id === this.selected ? ' on' : '');
      el.dataset.id = id;
      el.innerHTML = `
        <div class="ds-name">${d.name}</div>
        <div class="ds-desc">${d.desc}</div>
      `;
      el.addEventListener('click', () => {
        this.selected = id;
        for (const n of list.querySelectorAll('.ds-item')) {
          n.classList.toggle('on', (n as HTMLElement).dataset.id === id);
        }
      });
      list.appendChild(el);
    }
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
