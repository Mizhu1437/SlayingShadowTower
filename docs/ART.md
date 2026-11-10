# 卡面插画（ART）

> 状态：**14 张卡面已完成**（2026-11-02）
> 相关：[ART-STAGE.md](ART-STAGE.md) 四幕背景与关卡 UI · [SCOPE.md](SCOPE.md) §2.2 美术可换原则 · [DESIGN.md](DESIGN.md) 卡牌系统

---

## 一、这是什么

`docs/art/cards/` 下是当前卡池里**每一张卡**的插画，512×512 PNG，可直接裁进卡牌 UI 的插画窗口。

**全部由代码绘制，零外部素材。** 生成器：`tools/cardart.py`（Python + Pillow + numpy）。

```bash
pnpm art          # 等价于 python tools/cardart.py
```

> 需要中文字体（`C:\Windows\Fonts\msyh.ttc`）；Linux/macOS 上改 `cardart.py` 顶部的 `FONT_PATH`。

### 为什么是程序绘制而不是 AI 生图

三条理由，按重要性排：

1. **合规成本为零。** 东方 Project 二创准则禁止提取官方素材；程序生成的图不存在来源争议。素材来源表可以直接写「全部程序生成」。
2. **可复现、可微调。** 改一个颜色常量、改一个随机种子，整批图重出。AI 生图改不动细节。
3. **风格强制统一。** 所有卡共用同一套调色板和笔刷函数（`ribbon` / `shock_ring` / `ray_burst` / `stamp`），不会出现「这张卡画风不一样」。

这也正是 [SCOPE.md](SCOPE.md) §2.2 定下的路线。

---

## 二、产物清单

| 文件 | 内容 |
| :--- | :--- |
| `docs/art/cards/<card-id>.png` | 单张卡面，512×512 |
| `docs/art/cards/_contact.png` | 14 张总览（带卡名），用于快速比对风格 |
| `docs/art/cards/_ui_preview.png` | **塞进真实卡框后的样子** —— 判断「进游戏好不好看」看这张 |

`<card-id>` 与 `src/core/cards/library.ts` 的 `id` 字段一一对应：

| id | 卡名 | 类型 | 画面要点 |
| :--- | :--- | :--- | :--- |
| `hougeki` | 符击 | 初始主动 | 三张符札并排前射 |
| `bougyo` | 防御 | 初始主动 | 六边护罩 + 被弹开的敌弹 |
| `houyokutenshou` | 不死「火鸟 -凤翼天翔-」 | 初始主动 | 展翅凤凰火焰剪影 |
| `p_sharp` | 锋利符片 | 被动 | 斜切两半的符札，刃口发光 |
| `p_heavy` | 重击符片 | 被动 | 厚重符片砸出冲击坑 |
| `p_rapid` | 疾射符片 | 被动 | 斜置符札 + 三发弹 + 速度线 |
| `p_spell_wide` | 广域符卡 | 被动 | 三层符札叠影 + 多层护罩 |
| `p_spell_bane` | 破邪符卡 | 被动 | 紫黑符札 + 十字斩 |
| `a_meteor` | 流星符 | 主动 | 五道斜坠陨火 |
| `a_focus` | 心念符 | 主动 | 轨道环 + 环绕的小卡 |
| `a_cleanse` | 净域符 | 主动 | 向上的弧形扫荡波 |
| `a_bounty` | 丰收符 | 主动 | 蜃銭竖直下落 |
| `a_slow` | 缓时符 | 主动 | 钟面 + 被拖慢的敌弹 |
| `a_restore` | 复符 | 主动 | 碎裂符札被吸回中心 |

---

## 三、设计约束

### 3.1 调色板锁定

`cardart.py` 顶部的颜色常量**必须**与 `src/render/gameRenderer.ts` 的 `COLORS` 表保持一致：

| 常量 | 值 | 对应 renderer |
| :--- | :--- | :--- |
| `BG_DEEP` | `#05060d` → `#0a0c16` | `bg` |
| `CYAN` | `#7ec8ff` | `enemyBullet` |
| `CYAN_HI` | `#9fe3ff` | `shot` |
| `VIOLET` | `#c79bff` | `shotTalisman` |
| `MAGENTA` | `#ff6b8a` | `enemy` |
| `PLAYER` | `#ff5f7e` | `player` |
| `GOLD` | `#ffd479` | `coin` / `shotOrb` |
| `ORANGE` | `#ffa63d` | `fireMid` |
| `RED` | `#ff4d2e` | `fireEdge` |
| `FIRE_CORE` | `#fff2b0` | `fireCore` |

改 renderer 的配色时，这张表要同步改，否则卡面和游戏内会脱节。

### 3.2 符札是识别锚点

世界观里 **「怪物本来就是一张暴走的符片」**（[WORLD.md](WORLD.md) §3.4），所以**符札**（竖长的纸片 + 抽象笔触 + 朱印）是全作的视觉识别物。

`cardart.py` 的 `talisman_sprite()` 统一生成符札，所有卡共用。`stamp()` 里的 `SPRITE_BOOST` 控制符札在画面中的整体占比——放小了在 512 的卡面里会糊成一个小白条。

**注意：** 符札上的笔触是抽象线条，**不写可读文字**。这既避免「写了什么字」的语义问题，也让 512px 下不糊。

### 3.3 与判定完全无关

插画只喂给 UI 的 `<img>` 或 Pixi 的纹理，不参与任何碰撞判定。判定半径仍由核心层数据决定（[SCOPE.md](SCOPE.md) §2.2）。

---

## 四、如何接入游戏

卡面目前是**离线生成的 PNG**，还没接进运行时。接入方式取决于你想要的复杂度：

### 方案 A：静态引用（最省事）

把 `docs/art/cards/` 拷到 `public/art/cards/`，卡牌 UI 里加一个 `<img>`：

```
<div class="card-art"><img src="./art/cards/${cardId}.png" alt=""></div>
```

需要在 `src/core/cards/def.ts` 的 `CardDef` 上加一个 `art?: string` 字段，缺省回退到纯文字——符合 SCOPE 的「缺图时回退占位，不崩溃」。

### 方案 B：图集（atlas）

按 SCOPE §2.2 的要求，长期应该走图集：把所有卡面打进一张 atlas，运行时按 id 查子矩形。这样只发一次请求，也方便做「卡面淡入」之类的效果。

> **建议：** 现在先走方案 A 把观感验证掉，等内容量稳定（20 张卡定稿）再打图集。卡面还会改，过早图集化只会增加返工。

---

## 五、改图怎么改

| 想改什么 | 改哪里 |
| :--- | :--- |
| 单张卡的构图 | `cardart.py` 里对应的 `card_xxx()` 函数 |
| 整批画的配色 | 顶部颜色常量（记得同步 renderer） |
| 符札的样式 | `talisman_sprite()` |
| 符札在画面里的大小 | `stamp()` 里的 `SPRITE_BOOST` |
| 背景的塔影/尘埃 | `background()` |
| 随机碎屑的分布 | 各函数里的 `np.random.default_rng(种子)` —— 换个种子就换一批 |

渲染一遍约 5 分钟（3× 超采样 + 多轮高斯模糊）。**只改一张时**，可以单独跑：

```python
import importlib.util
spec = importlib.util.spec_from_file_location('ca', 'tools/cardart.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c = m.Canvas(); m.card_firebird(c); c.finish().save('docs/art/cards/houyokutenshou.png')
```

---

## 六、还没做的

| 项 | 说明 |
| :--- | :--- |
| 敌人 / BOSS 立绘 | 渡里贝子、伪千亦、符札轮廓怪物 —— 都还是几何图形 |
| 自机立绘 | 占位符 `自机` 尚未定人 |
| 子弹 / 掉落物贴图 | 目前由 renderer 实时画，够用，优先级低 |
| 标题画面 | 塔的蜃景悬浮在妖怪之山上方，适合做 README 头图 |
| 图集打包 | 等内容定稿（见 §4 方案 B） |

> **四幕背景与关卡 UI 已单独完成**，见 [ART-STAGE.md](ART-STAGE.md)。
