/**
 * 输入采集。
 *
 * 硬约束：Shift 只用于低速，绝不承载其他功能。
 * 理由：Shift 是弹幕游戏里最高频的精确移动键，
 * 把任何"切换/选择"类操作绑上去，会导致玩家每次微移都被强制减速。
 */

export interface Keys {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  focus: boolean;
}

export class Input {
  readonly keys: Keys = {
    left: false, right: false, up: false, down: false, focus: false,
  };

  /** 一次性按键（本帧内消费后清零） */
  private pressed = new Set<string>();

  private readonly onKeyDown = (e: KeyboardEvent) => {
    // 阻止方向键滚动页面
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)
    ) {
      e.preventDefault();
    }

    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A':
        this.keys.left = true; break;
      case 'ArrowRight': case 'd': case 'D':
        this.keys.right = true; break;
      case 'ArrowUp': case 'w': case 'W':
        this.keys.up = true; break;
      case 'ArrowDown': case 's': case 'S':
        this.keys.down = true; break;
      case 'Shift':
        this.keys.focus = true; break;
      default:
        this.pressed.add(e.key.toLowerCase());
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A':
        this.keys.left = false; break;
      case 'ArrowRight': case 'd': case 'D':
        this.keys.right = false; break;
      case 'ArrowUp': case 'w': case 'W':
        this.keys.up = false; break;
      case 'ArrowDown': case 's': case 'S':
        this.keys.down = false; break;
      case 'Shift':
        this.keys.focus = false; break;
    }
  };

  private readonly onBlur = () => {
    // 失焦时清空，避免"按着方向键切窗口"导致自机一直漂
    this.keys.left = this.keys.right = this.keys.up = this.keys.down = false;
    this.keys.focus = false;
  };

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window = window): void {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }

  /** 转换为自机输入 */
  toInput(): { dx: number; dy: number; focus: boolean } {
    return {
      dx: (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0),
      dy: (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0),
      focus: this.keys.focus,
    };
  }

  /** 取一次性按键（消费后消失） */
  consume(key: string): boolean {
    const k = key.toLowerCase();
    if (this.pressed.has(k)) {
      this.pressed.delete(k);
      return true;
    }
    return false;
  }

  clearPressed(): void {
    this.pressed.clear();
  }
}
