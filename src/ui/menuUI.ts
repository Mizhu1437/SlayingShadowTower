/**
 * 游戏外流程界面：标题 → 难度 → 机体 → 对局 → 结算。
 *
 * 为什么拆成三个独立全屏画面而不是一个面板里塞三块：
 * 东方正作的菜单是**逐步推进**的 —— 每一步只问一个问题，
 * 玩家一次只需要看一件事。挤在一个面板里时，
 * 难度、机体、键位说明同时出现，视觉噪音大且没有仪式感。
 *
 * 流程：
 *   title   [开始游戏] → difficulty
 *   difficulty [确认] → character
 *   character  [开始] → 对局
 *
 *   Esc 在难度/机体界面返回上一步，和东方正作一致。
 */

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  type DifficultyId,
} from '../core/difficulty';
import { CHARACTERS, type CharacterDef } from '../core/character';
import type { RunStats } from '../core/runStats';
import { formatDuration, gradeOf } from '../core/runStats';

/** 当前所处的菜单画面 */
type Screen = 'title' | 'difficulty' | 'character' | 'result' | 'none';

export interface MenuPick {
  difficulty: DifficultyId;
  characterId: string;
}

export class MenuUI {
  private root: HTMLElement;
  private screen: Screen = 'none';

  private difficulty: DifficultyId = 'normal';
  private characterId: string = CHARACTERS[0]!.id;

  /** 各画面的 DOM，切换时只显示一个 */
  private titleEl: HTMLElement;
  private diffEl: HTMLElement;
  private charEl: HTMLElement;
  private resultEl: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly onStart: (pick: MenuPick) => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'menu-root';
    this.root.className = 'hidden';
    host.appendChild(this.root);

    this.titleEl = this.buildTitle();
    this.diffEl = this.buildDifficulty();
    this.charEl = this.buildCharacter();
    this.resultEl = this.buildResult();

    this.root.append(this.titleEl, this.diffEl, this.charEl, this.resultEl);

    // Esc 返回上一步
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.screen === 'difficulty') {
        this.show('title');
        e.preventDefault();
      } else if (this.screen === 'character') {
        this.show('difficulty');
        e.preventDefault();
      }
    });
  }

  // ─────────────────────────────────────────────
  // ① 标题画面
  // ─────────────────────────────────────────────
  private buildTitle(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sc sc-title';
    el.innerHTML = `
      <div class="t-wrap">
        <div class="t-main">東方戮影塔</div>
        <div class="t-en">〜 Formless Barrage 〜</div>
        <div class="t-rule"></div>
        <button class="t-start" id="t-start">开 始 游 戏</button>
        <div class="t-copy">本作品是东方 Project 的二次创作</div>
      </div>
    `;
    el.querySelector('#t-start')!.addEventListener('click', () => {
      this.show('difficulty');
    });
    return el;
  }

  // ─────────────────────────────────────────────
  // ② 难度选择
  // ─────────────────────────────────────────────
  private buildDifficulty(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sc sc-diff';
    el.innerHTML = `
      <div class="d-head">
        <div class="d-step">STEP 1 / 2</div>
        <div class="d-title">选择难度</div>
      </div>
      <div class="d-list" id="d-list"></div>
      <div class="d-foot">
        <button class="d-back" id="d-back">返回</button>
        <div class="d-hint">起跑线完全相同 —— 差别在弹幕密度、掉落与价格</div>
        <button class="d-next" id="d-next">确认</button>
      </div>
    `;

    const list = el.querySelector('#d-list')!;
    for (const id of DIFFICULTY_ORDER) {
      const d = DIFFICULTIES[id];
      const item = document.createElement('div');
      item.className = 'd-item';
      item.dataset.id = id;
      item.innerHTML = `
        <div class="d-name">${d.name}</div>
        <div class="d-desc">${d.desc}</div>
        <div class="d-mods">
          开火 ×${d.fireIntervalMul}　弹数 ×${d.bulletCountMul}
          　掉落 ×${d.coinDropMul}　价格 ×${d.priceMul}
        </div>
      `;
      item.addEventListener('click', () => {
        this.difficulty = id;
        this.syncDifficulty();
      });
      list.appendChild(item);
    }

    el.querySelector('#d-back')!.addEventListener('click', () => this.show('title'));
    el.querySelector('#d-next')!.addEventListener('click', () => this.show('character'));
    return el;
  }

  private syncDifficulty(): void {
    for (const n of this.diffEl.querySelectorAll('.d-item')) {
      n.classList.toggle('on', (n as HTMLElement).dataset.id === this.difficulty);
    }
  }

  // ─────────────────────────────────────────────
  // ③ 机体选择
  // ─────────────────────────────────────────────
  private buildCharacter(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sc sc-char';
    el.innerHTML = `
      <div class="c-head">
        <div class="c-step">STEP 2 / 2</div>
        <div class="c-title">选择机体</div>
      </div>
      <div class="c-body">
        <div class="c-portrait" id="c-portrait"></div>
        <div class="c-info" id="c-info"></div>
      </div>
      <div class="c-foot">
        <button class="c-back" id="c-back">返回</button>
        <div class="c-summary" id="c-summary"></div>
        <button class="c-go" id="c-go">开 始</button>
      </div>
    `;

    el.querySelector('#c-back')!.addEventListener('click', () => this.show('difficulty'));
    el.querySelector('#c-go')!.addEventListener('click', () => {
      this.show('none');
      this.onStart({ difficulty: this.difficulty, characterId: this.characterId });
    });
    return el;
  }

  /** 渲染机体信息面板 */
  private renderCharacter(): void {
    const c: CharacterDef =
      CHARACTERS.find((x) => x.id === this.characterId) ?? CHARACTERS[0]!;

    // 立绘位置：目前没有立绘素材，用卡图里最能代表她的那张做占位
    const portrait = this.charEl.querySelector('#c-portrait')!;
    portrait.innerHTML = `
      <img src="./art/cards/houyokutenshou.png" alt="${c.name}"
           onerror="this.style.display='none'" />
      <div class="c-nameplate">${c.name}</div>
      <div class="c-nameen">${c.nameEn}</div>
    `;

    // 机体信息
    const info = this.charEl.querySelector('#c-info')!;
    const deckCount = c.deck.length;
    const stats: Array<[string, string]> = [
      ['称号', c.title],
      ['初始卡组', `${deckCount} 张`],
      ['残机', String(c.player.lives)],
      ['高速移动', `${c.player.speedHigh} px/s`],
      ['低速移动', `${c.player.speedLow} px/s`],
      ['判定半径', `${c.player.hitRadius} px`],
      ['受击无敌', `${c.player.invulnTime} 秒`],
    ];

    info.innerHTML = `
      <div class="c-bio">${c.bio.replace(/\n/g, '<br>')}</div>
      <div class="c-stats">
        ${stats
          .map(
            ([k, v]) =>
              `<div class="c-stat"><span class="c-k">${k}</span><span class="c-v">${v}</span></div>`,
          )
          .join('')}
      </div>
      <div class="c-shot">
        <div class="c-shot-label">初始卡组构成</div>
        ${c.shotTypes
          .map((s) => `<div class="c-shot-item"><b>${s.name}</b> ${s.desc}</div>`)
          .join('')}
      </div>
    `;

    // 底部汇总：让玩家在点开始前能确认两个选择
    const sum = this.charEl.querySelector('#c-summary')!;
    sum.innerHTML =
      `<span class="cs-item">难度 <b>${DIFFICULTIES[this.difficulty].name}</b></span>` +
      `<span class="cs-item">机体 <b>${c.name}</b></span>`;
  }

  // ─────────────────────────────────────────────
  // ④ 结算
  // ─────────────────────────────────────────────
  private buildResult(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'sc sc-result';
    el.innerHTML = `
      <div class="r-panel">
        <div class="r-grade" id="r-grade">A</div>
        <div class="r-label" id="r-label">通关</div>
        <div class="r-score-row">
          <span class="r-score-label">得分</span>
          <span class="r-score" id="r-score">0</span>
        </div>
        <div class="r-grid" id="r-grid"></div>
        <div class="r-actions">
          <button class="r-btn primary" id="r-restart">再来一局</button>
          <button class="r-btn" id="r-title">返回标题</button>
        </div>
      </div>
    `;

    el.querySelector('#r-restart')!.addEventListener('click', () => {
      this.show('none');
      this.onStart({ difficulty: this.difficulty, characterId: this.characterId });
    });
    el.querySelector('#r-title')!.addEventListener('click', () => this.show('title'));
    return el;
  }

  // ─────────────────────────────────────────────
  // 画面切换
  // ─────────────────────────────────────────────

  /** 切换到某个画面；'none' 表示全部隐藏（进入对局） */
  show(screen: Screen): void {
    this.screen = screen;

    if (screen === 'none') {
      this.root.classList.add('hidden');
      return;
    }

    this.root.classList.remove('hidden');

    const map: Record<Exclude<Screen, 'none'>, HTMLElement> = {
      title: this.titleEl,
      difficulty: this.diffEl,
      character: this.charEl,
      result: this.resultEl,
    };

    for (const [k, el] of Object.entries(map)) {
      el.classList.toggle('hidden', k !== screen);
    }

    // 进入画面时刷新动态内容
    if (screen === 'difficulty') this.syncDifficulty();
    if (screen === 'character') this.renderCharacter();
  }

  /** 展示结算 */
  showResult(stats: RunStats): void {
    this.show('result');

    const g = gradeOf(stats);
    const gradeEl = this.resultEl.querySelector('#r-grade')!;
    gradeEl.textContent = g.letter;
    gradeEl.className = `r-grade grade-${g.letter}`;
    this.resultEl.querySelector('#r-label')!.textContent = g.label;
    this.resultEl.querySelector('#r-score')!.textContent =
      stats.score.toLocaleString('en-US');

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

    this.resultEl.querySelector('#r-grid')!.innerHTML = rows
      .map(
        ([k, v]) =>
          `<div class="r-item"><span class="r-k">${k}</span><span class="r-v">${v}</span></div>`,
      )
      .join('');
  }

  /** 当前画面（测试/调试用） */
  get currentScreen(): Screen {
    return this.screen;
  }

  /** 当前选择（测试/调试用） */
  get currentPick(): MenuPick {
    return { difficulty: this.difficulty, characterId: this.characterId };
  }
}
