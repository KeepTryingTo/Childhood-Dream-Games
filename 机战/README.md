# 机战 MechWarfare Web

依据《require.md 实现步骤文档》实现的**纵向卷轴弹幕射击游戏**，采用文档指定的技术栈：
**Phaser 3（游戏核心）+ Vue 3 / Pinia（UI 遮罩层）+ Vite + TypeScript**。

## 运行方式


```bash
npm install        # 首次安装依赖
npm run dev        # 开发模式（http://localhost:5180）
npm run build      # 生产构建 → dist/
npm run preview    # 预览生产构建
npm run typecheck  # TypeScript 严格类型检查（当前 0 错误）
```

或者
```
cd D:\xxx\myProjects\机战
npm run dev
```

> 首次进入需点击/按键以解锁 Web Audio（浏览器自动播放策略）。

## 操作说明

| 输入 | 功能 |
|---|---|
| WASD / 方向键 | 移动（触摸：手指跟随，松开急停） |
| 空格 / J（按住） | 射击 |
| B | 炸弹（全屏清弹 + 全体敌机伤害） |
| P | 暂停 / 继续 |
| Enter | 菜单开始 / 结算重试 |

> 开局后**屏幕左侧常驻按键指南面板**，随时查看；仅 4 组按键，简洁上手。

## 难度模式

开始菜单三档可选（选择会存档记忆）：

| 模式 | 敌机血量 | 敌机速度 | 敌弹速度 | 生成密度 | 玩家受伤 | 得分 |
|---|---|---|---|---|---|---|
| 简单 | ×0.7 | ×0.8 | ×0.75 | 更稀疏 | ×0.5 | ×0.8 |
| 中等 | ×1.0 | ×1.0 | ×1.0 | 标准 | ×1.0 | ×1.0 |
| 困难 | ×1.5 | ×1.25 | ×1.25 | 更密集 | ×1.5 | ×1.5 |

## 已实现功能

### 玩家系统（require.md 五）
- HP/火力等级 1~5/炸弹/无敌时间，`setVelocity + setDrag` 惯性手感 + 世界边界
- 火力升级弹幕：单发 → 双发 → 三发扇形 → 四发+侧翼**追踪弹** → 五发+中央激光炮
- 无敌闪烁 Tween、引擎尾焰粒子、血条

### 敌机系统（require.md 六）
| 类型 | 行为 | HP | 分数 |
|---|---|---|---|
| Scout | 直线下坠+摆动 | 1 | 10 |
| Fighter | 持续下压+正弦摇摆+瞄准弹 | 3 | 30 |
| Bomber | 缓慢下压+3 发扇形弹 | 8 | 100 |
| Interceptor | Z 字折返 300 速 | 2 | 50 |
| Boss | 悬停漂移+三阶段弹幕（瞄准/扇形/螺旋+召唤） | 500+ | 2000 |

- **所有普通敌机均持续向下推进攻击玩家**（不再上半屏悬停）
- **7-bag 式波次配置表**循环推进，生成模式：单点/横排/V 字/包围圈
- 难度公式：`difficulty = 1 + 0.1 * floor(score / 1000)` 与难度模式倍率叠加，影响血量/速度/射频/密度
- Boss 战：警告音画 → 顶部超长血条 → HP 阈值阶段切换（重置攻击计时）

### 成长系统（替代原道具系统）
- **道具已移除**（不再掉落 P/H/S/B 泡泡）
- 火力随分数自动升级：1500 / 4000 / 8000 / 15000 分 → Lv1~Lv5，升级时炸弹 +1
- Boss 击破奖励：回血 30 + 炸弹补满

### 特效与性能（require.md 八/十二）
- 分级爆炸粒子（小 8 / 大 20 / Boss 42）+ 屏幕震动 + 闪光
- **子弹/敌机/道具全对象池**（maxSize 上限）；距离平方比较；出界回收
- 三层视差星空；dpr 上限 2；`touch-action: none`

### UI 与架构（require.md 二/四/九）
- **场景流**：BootScene（程序化纹理生成，零外部资源）→ MainScene
- **HUD 用 Phaser Text/Graphics**（分数左上/血条左下/炸弹右下/Boss 血条顶部/WAVE 大字动画）
- **菜单/暂停/结算用 Vue 遮罩**（MenuOverlay / PauseOverlay / GameOverOverlay，含分数滚动结算动画）
- 两者通过 **EventBus + Pinia** 解耦（`PLAYER_DIE` / `SCORE_UPDATE` / `WAVE_START` / `ui:*` 动作）
- 存档：`mechwarfare_save_v1`（最高分 + 音效/BGM 设置，try-catch 防配额异常）

## 项目结构

```
机战/
├── index.html                 # 双挂载点：#game-container + #ui-layer
├── package.json / tsconfig.json / vite.config.ts
├── src/
│   ├── main.ts                # 入口：Vue + Phaser 装配、全局键位、音频解锁
│   ├── style.css
│   ├── game/
│   │   ├── Game.ts            # Phaser.Game 实例化（Scale.FIT）
│   │   ├── config/constants.ts# 常量、敌机/道具配置表、波次表、难度公式
│   │   ├── scenes/
│   │   │   ├── BootScene.ts   # 程序化纹理生成（战机/敌机/子弹/道具/星空）
│   │   │   └── MainScene.ts   # 主战斗场景
│   │   ├── entities/          # Player / Enemy / Bullet / PowerUp
│   │   └── systems/           # EventBus / Sfx(WebAudio合成) / Spawner
│   ├── stores/game.ts         # Pinia：HUD 数据镜像 + 存档
│   └── ui/                    # Vue 遮罩组件（菜单/暂停/结算）
└── dist/                      # 生产构建产物
```

## 与 require.md 的实现取舍说明

| 文档项 | 实现 | 说明 |
|---|---|---|
| Phaser 3 + Vue 3 + Pinia | ✅ | vue-router 未使用（单页游戏无路由需求） |
| waves.json 配置表 | ✅ | 内联为 `config/constants.ts` 的 WAVES（类型安全） |
| TexturePacker 图集 | ➖ | BootScene 程序化纹理，开箱即跑；可后续无缝替换图集 |
| 音频文件 | ➖ | Web Audio 实时合成 SFX/BGM，规避资源与 CORS |
| GameOverScene | ➖ | 结算按文档第九节由 Vue 承担（场景内冻结画面） |
| 对象池 / 池化 | ✅ | 从第一天就启用 |
| 多人联机 / Roguelike / 商业化 | ⏳ | 文档标注的后续扩展方向，未包含 |

## 已知限制

- BGM 为合成琶音循环，节奏简单（可替换为音频文件）
- 移动端横竖屏提示遮罩、PWA manifest 未包含（文档标注的部署增强项）
- iOS Safari 的 Web Audio 需要一次手势解锁（已实现，首次点击后生效）
