/**
 * 开发者控制台。
 *
 * 按 ~（反引号）打开，输入指令执行对应操作。
 *
 * 设计要点：
 *   - 所有指令都是「名字 + 参数」的简单形式，不做复杂语法
 *   - 每条指令都返回一行文本，直接显示在输出区
 *   - 支持 help 列出全部指令
 *   - 控制台打开时暂停游戏输入（避免打字时自机乱跑）
 *
 * 为什么放在 UI 层而不是 core：
 *   它依赖 DOM 与键盘事件，属于表现层。但指令真正执行的效果
 *   全部通过 World 的 debug 接口完成，逻辑仍在 core 里可测。
 */

import type { World } from '../core/world';

interface CommandResult {
  ok: boolean;
  text: string;
}

interface Command {
  name: string;
  args: string;
  desc: string;
  run: (world: World, argv: string[]) => CommandResult;
}

/** 把 "on"/"off"/"1"/"0" 解析成布尔；空参数时切换 */
function parseToggle(argv: string[], current: boolean): boolean {
  const a = argv[0]?.toLowerCase();
  if (!a) return !current;
  if (['on', '1', 'true', 'yes'].includes(a)) return true;
  if (['off', '0', 'false', 'no'].includes(a)) return false;
  return !current;
}

function boolText(v: boolean): string {
  return v ? '开' : '关';
}

const COMMANDS: Command[] = [
  // ── 开关类 ──
  {
    name: 'god',
    args: '[on|off]',
    desc: '自机无敌（关闭中弹判定）',
    run: (w, argv) => {
      const v = parseToggle(argv, w.debug.invincible);
      w.debug.set('invincible', v);
      return { ok: true, text: `无敌：${boolText(v)}` };
    },
  },
  {
    name: 'lockenergy',
    args: '[on|off]',
    desc: '锁定能量（出牌不消耗）',
    run: (w, argv) => {
      const v = parseToggle(argv, w.debug.lockEnergy);
      w.debug.set('lockEnergy', v);
      return { ok: true, text: `锁能量：${boolText(v)}` };
    },
  },
  {
    name: 'lockcoins',
    args: '[on|off]',
    desc: '锁定金钱（MISS 不扣钱）',
    run: (w, argv) => {
      const v = parseToggle(argv, w.debug.lockCoins);
      w.debug.set('lockCoins', v);
      return { ok: true, text: `锁金钱：${boolText(v)}` };
    },
  },

  // ── 跳跃类 ──
  {
    name: 'wave',
    args: '<幕> <波>',
    desc: '跳到指定幕的指定波（幕从 1 起，波从 1 起）',
    run: (w, argv) => {
      const act = Number(argv[0]);
      const wave = Number(argv[1] ?? 1);
      if (!Number.isFinite(act) || act < 1) {
        return { ok: false, text: '用法：wave <幕> <波>，例如 wave 2 5' };
      }
      const ok = w.debugJumpToWave(act - 1, wave);
      return ok
        ? { ok: true, text: `已跳到第 ${act} 幕 第 ${wave} 波` }
        : { ok: false, text: `跳转失败：幕 ${act} 不存在` };
    },
  },
  {
    name: 'shop',
    args: '[幕]',
    desc: '跳到商店（默认当前幕）',
    run: (w, argv) => {
      const act = argv[0] ? Number(argv[0]) - 1 : w.currentAct;
      const ok = w.debugJumpToShop(act);
      return ok
        ? { ok: true, text: `已跳到第 ${act + 1} 幕商店` }
        : { ok: false, text: '跳转失败' };
    },
  },
  {
    name: 'act',
    args: '<幕>',
    desc: '从指定幕的第 1 波开始',
    run: (w, argv) => {
      const act = Number(argv[0]);
      if (!Number.isFinite(act) || act < 1) {
        return { ok: false, text: '用法：act <幕>' };
      }
      const ok = w.debugJumpToWave(act - 1, 1);
      return ok
        ? { ok: true, text: `已进入第 ${act} 幕` }
        : { ok: false, text: `幕 ${act} 不存在` };
    },
  },

  // ── 数值类 ──
  {
    name: 'coins',
    args: '<数量>',
    desc: '设置蜃銭',
    run: (w, argv) => {
      const n = Number(argv[0]);
      if (!Number.isFinite(n)) return { ok: false, text: '用法：coins 1000' };
      w.debugSetCoins(n);
      return { ok: true, text: `蜃銭设为 ${w.coins}` };
    },
  },
  {
    name: 'lives',
    args: '<数量>',
    desc: '设置残机',
    run: (w, argv) => {
      const n = Number(argv[0]);
      if (!Number.isFinite(n)) return { ok: false, text: '用法：lives 5' };
      w.debugSetLives(n);
      return { ok: true, text: `残机设为 ${w.player.lives}` };
    },
  },
  {
    name: 'spells',
    args: '<数量>',
    desc: '设置符卡数',
    run: (w, argv) => {
      const n = Number(argv[0]);
      if (!Number.isFinite(n)) return { ok: false, text: '用法：spells 3' };
      w.debugSetSpells(n);
      return { ok: true, text: `符卡设为 ${w.spell.cards}` };
    },
  },
  {
    name: 'energy',
    args: '',
    desc: '能量补满',
    run: (w) => {
      w.debugFillEnergy();
      return { ok: true, text: `能量补满：${w.deck.energy.value}/${w.deck.energy.cap}` };
    },
  },
  {
    name: 'hand',
    args: '',
    desc: '手牌抽满',
    run: (w) => {
      w.debugFillHand();
      return { ok: true, text: `手牌：${w.deck.pile.handSize} 张` };
    },
  },

  // ── 信息类 ──
  {
    name: 'status',
    args: '',
    desc: '查看当前状态',
    run: (w) => {
      const f = w.debug.snapshot();
      const lines = [
        `幕 ${w.currentAct + 1}  波 ${w.waves.currentWave}/${w.waves.totalWaves}  阶段 ${w.phase}`,
        `蜃銭 ${w.coins}  残机 ${w.player.lives}  符卡 ${w.spell.cards}  能量 ${w.deck.energy.value}/${w.deck.energy.cap}`,
        `手牌 ${w.deck.pile.handSize}  牌堆 ${w.deck.pile.drawCount}  弃牌 ${w.deck.pile.discardCount}`,
        `调试：无敌 ${boolText(f.invincible)}  锁能量 ${boolText(f.lockEnergy)}  锁金钱 ${boolText(f.lockCoins)}`,
      ];
      return { ok: true, text: lines.join('\n') };
    },
  },
  {
    name: 'reset',
    args: '',
    desc: '关闭所有调试开关',
    run: (w) => {
      w.debug.reset();
      return { ok: true, text: '所有调试开关已关闭' };
    },
  },
  {
    name: 'help',
    args: '',
    desc: '列出所有指令',
    run: () => {
      const lines = COMMANDS.map(
        (c) => `  ${(c.name + ' ' + c.args).padEnd(18)} ${c.desc}`,
      );
      return { ok: true, text: '可用指令：\n' + lines.join('\n') };
    },
  },
];

export class DevConsole {
  private root: HTMLElement;
  private inputEl: HTMLInputElement;
  private outputEl: HTMLElement;
  private open = false;
  /** 打开前的历史记录 */
  private history: string[] = [];
  private historyIndex = -1;

  constructor(
    host: HTMLElement,
    private readonly world: World,
    /** 控制台打开/关闭时的回调，用于暂停游戏输入 */
    private readonly onToggle?: (open: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'dev-console';
    this.root.className = 'dev-console hidden';
    this.root.innerHTML = `
      <div class="dc-head">
        <span>开发者控制台</span>
        <span class="dc-hint">~ 关闭  ·  help 查看指令  ·  ↑↓ 历史</span>
      </div>
      <div class="dc-output" id="dc-output"></div>
      <div class="dc-input-row">
        <span class="dc-prompt">&gt;</span>
        <input id="dc-input" type="text" autocomplete="off" spellcheck="false" />
      </div>
    `;
    host.appendChild(this.root);

    this.inputEl = this.root.querySelector('#dc-input')!;
    this.outputEl = this.root.querySelector('#dc-output')!;

    this.inputEl.addEventListener('keydown', (e) => {
      // 反引号键必须在这里处理。
      //
      // 原因：这一行 stopPropagation 阻断了事件冒泡，
      // 主程序挂在 window 上的 ~ 键监听器收不到 ——
      // 于是"按 ~ 打开"能生效（焦点还在 body 上时），
      // 但"按 ~ 关闭"永远失效（焦点已在输入框里）。
      // 关闭必须由控制台自己接管。
      if (e.key === '`' || e.key === '~' || e.code === 'Backquote') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        return;
      }

      e.stopPropagation();     // 其余按键也不让游戏收到
      if (e.key === 'Enter') {
        this.submit(this.inputEl.value);
        this.inputEl.value = '';
      } else if (e.key === 'Escape') {
        this.hide();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateHistory(1);
      }
    });

    this.print('输入 help 查看可用指令。');
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.classList.remove('hidden');
    this.inputEl.focus();
    this.onToggle?.(true);
    // 自动滚动到底
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.inputEl.blur();
    this.onToggle?.(false);
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  private navigateHistory(dir: number): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(
      -1,
      Math.min(this.history.length - 1, this.historyIndex + (dir > 0 ? 1 : -1)),
    );
    this.inputEl.value = this.historyIndex >= 0
      ? this.history[this.historyIndex] ?? ''
      : '';
  }

  private submit(raw: string): void {
    const line = raw.trim();
    if (!line) return;

    this.history.push(line);
    this.historyIndex = this.history.length;
    this.print(`> ${line}`);

    const parts = line.split(/\s+/);
    const name = parts[0]!.toLowerCase();
    const argv = parts.slice(1);

    const cmd = COMMANDS.find((c) => c.name === name);
    if (!cmd) {
      this.print(`未知指令：${name}。输入 help 查看可用指令。`, true);
      return;
    }

    try {
      const r = cmd.run(this.world, argv);
      this.print(r.text, !r.ok);
    } catch (err) {
      this.print(`执行出错：${String(err)}`, true);
    }
  }

  private print(text: string, isError = false): void {
    const line = document.createElement('div');
    line.className = isError ? 'dc-line dc-error' : 'dc-line';
    line.textContent = text;
    this.outputEl.appendChild(line);
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }
}

/** 导出指令表供测试使用 */
export function commandNames(): string[] {
  return COMMANDS.map((c) => c.name);
}
