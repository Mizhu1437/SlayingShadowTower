/**
 * 主菜单与结算界面。
 *
 * 完整循环：
 *   主菜单 →（选难度）→ 开始对局 → 结束 → 结算 → 回主菜单
 *
 * 为什么合并成一个模块：
 * 两者共享同一套全屏遮罩 + 面板样式，且互斥出现（同一时刻只显示一个）。
 * 分成两个文件会让调用方必须在两者之间手动切换显隐，反而更容易出错。
 */

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  type DifficultyId,
} from '../core/difficulty';
import type { RunStats } from '../core/runStats';
import { formatDuration, gradeOf } from '../core/runStats';

export class MenuUI {
  private menuRoot: HTMLElement;
  private resultRoot: HTMLElement;
  private selected: DifficultyId = 'normal';

  constructor(
    host: HTMLElement,
    private readonly onStart: (id: DifficultyId) => void,
    private readonly onRestart: (id: DifficultyId) => void,
  ) {
    // ── 主菜单 ──
    this.menuRoot = document.createElement('div');
    this.menuRoot.id = 'main-menu';
    this.menuRoot.innerHTML = `
      <div class="mm-panel">
        <div class="mm-title">東方戮影塔</div>
        <div class="mm-sub">〜 Formless Barrage 〜</div>
        <div class="mm-note">本作品是东方 Project 的二次创作</div>

        <div class="mm-section">选择难度</div>
        <div class="mm-list" id="mm-list"></div>
        <div class="mm-hint">
          起跑线完全相同 —— 差别在于弹幕密度、掉落与价格
        </div>

        <button class="mm-start" id="mm-start">开始游戏</button>
        <div class="mm-keys">
          <span><kbd>方向键</kbd> 移动</span>
          <span><kbd>Z</kbd> 打牌</span>
          <span><kbd>X</kbd> 符卡</span>
          <span><kbd>C</kbd> 切换</span>
          <span><kbd>E</kbd>/<kbd>Q</kbd> 牌堆</span>
          <span><kbd>Tab</kbd> 卡组</span>
        </div>
      </div>
    `;
    host.appendChild(this.menuRoot);

    // ── 结算 ──
    this.resultRoot = document.createElement('div');
    this.resultRoot.id = 'result-screen';
    this.resultRoot.className = 'hidden';
    this.resultRoot.innerHTML = `
      <div class="rs-panel">
        <div class="rs-grade" id="rs-grade">A</div>
        <div class="rs-label" id="rs-label">通关</div>

        <div class="rs-score-row">
          <span class="rs-score-label">得分</span>
          <span class="rs-score" id="rs-score">0</span>
        </div>

        <div class="rs-grid" id="rs-grid"></div>

        <div class="rs-actions">
          <button class="rs-btn primary" id="rs-restart">再来一局</button>
          <button class="rs-btn" id="rs-menu">返回主菜单</button>
        </div>
      </div>
    `;
    host.appendChild(this.resultRoot);

    this.buildDifficultyList();

    this.menuRoot.querySelector('#mm-start')!.addEventListener('click', () => {
      this.hideMenu();
      this.onStart(this.selected);
    });

    this.resultRoot.querySelector('#rs-restart')!.addEventListener('click', () => {
      this.hideResult();
      this.onRestart(this.selected);
    });
    this.resultRoot.querySelector('#rs-menu')!.addEventListener('click', () => {
      this.hideResult();
      this.showMenu();
    });
  }

  private buildDifficultyList(): void {
    const list = this.menuRoot.querySelector('#mm-list')!;
    list.innerHTML = '';
    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      const el = document.createElement('div');
      el.className = 'mm-item' + (id === this.selected ? ' on' : '');
      el.dataset.id = id;
      el.innerHTML = `
        <div class="mm-name">${d.name}</div>
        <div class="mm-desc">${d.desc}</div>
      `;
      el.addEventListener('click', () => {
        this.selected = id;
        for (const n of list.querySelectorAll('.mm-item')) {
          n.classList.toggle('on', (n as HTMLElement).dataset.id === id);
        }
      });
      list.appendChild(el);
    }
  }

  showMenu(): void {
    this.menuRoot.classList.remove('hidden');
  }

  hideMenu(): void {
    this.menuRoot.classList.add('hidden');
  }

  /** 展示结算 */
  showResult(stats: RunStats): void {
    this.resultRoot.classList.remove('hidden');

    const g = gradeOf(stats);
    const gradeEl = this.resultRoot.querySelector('#rs-grade')!;
    gradeEl.textContent = g.letter;
    gradeEl.className = `rs-grade grade-${g.letter}`;
    this.resultRoot.querySelector('#rs-label')!.textContent = g.label;

    this.resultRoot.querySelector('#rs-score')!.textContent =
      stats.score.toLocaleString('en-US');

    // 分项明细
    const rows: Array<[string, string]> = [
      ['难度', stats.difficulty.name],
      ['到达', `第 ${stats.actReached} / ${stats.totalActs} 幕`],
      ['用时', formatDuration(stats.elapsedSeconds)],
      ['击破', String(stats.kills)],
      ['蜃銭', String(stats.coins)],
      ['卡组', `${stats.deckSize} 张（被动 ${stats.passiveCount}）`],
      ['续关', stats.continues > 0 ? `${stats.continues} 次` : '无'],
      ['结局', stats.outcome === 'cleared' ? '通关' : '放弃'],
    ];

    const grid = this.resultRoot.querySelector('#rs-grid')!;
    grid.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="rs-item"><span class="rs-k">${k}</span><span class="rs-v">${v}</span></div>`,
      )
      .join('');
  }

  hideResult(): void {
    this.resultRoot.classList.add('hidden');
  }
}
