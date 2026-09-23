# 机战网页游戏实现步骤

## 一、项目概述

### 游戏名称与类型
- **名称**：机战（MechWarfare Web）
- **类型**：纵向卷轴弹幕射击游戏（Vertical Scrolling Shooter）
- **核心玩法**：玩家操控战机在屏幕底部进行躲避与射击，通过击毁敌机、收集道具提升火力，挑战不断增强的敌机波次与Boss，追求高分与生存时长。

### 目标平台
- **环境**：现代浏览器（Chrome, Firefox, Safari, Edge）
- **设备**：PC端（键鼠/键盘）、移动端（触屏）
- **性能基准**：60FPS 稳定运行，首屏加载 < 2s

### 画面风格
- **风格**：复古像素风（Pixel Art）结合现代光影特效
- **背景**：多层视差滚动（Parallax Scrolling）星空/云层背景
- **UI**：极简科幻风，高对比度霓虹色（青色、洋红、亮黄）
- **特效**：粒子爆炸、屏幕震动、子弹拖尾

---

## 二、技术选型

### 前端框架与引擎
- **核心方案**：**Phaser 3**
- **辅助框架**：**Vue 3**（仅用于非游戏Canvas的UI层，如菜单、结算、设置）
- **理由**：
    - Phaser 3 内置物理、动画、音频、对象池、Tilemap，极大减少轮子开发。
    - Vue 3 处理复杂DOM交互（如设置面板、排行榜）比纯Canvas高效且易维护。
    - 两者通过事件总线或共享状态（Pinia）通信，解耦游戏逻辑与UI逻辑。

### 资源管理
- **图片**：TexturePacker 打包图集，减少 DrawCall。
- **音频**：Web Audio API（Phaser 封装），支持多通道音效，BGM 循环淡入淡出。
- **预加载**：Phaser `Preloader` 场景，显示加载进度条，确保资源就绪再启动。

### 构建工具
- **工具**：**Vite**
- **理由**：极速 HMR，原生 ESM 支持，Phaser 3 官方推荐，配置简单。

### 语言
- **TypeScript**：强类型约束，接口定义实体属性，重构安全，IDE 提示友好。

---

## 三、项目初始化

### 目录结构

```
mechwarfare-web/
├── public/
│   ├── assets/          # 静态资源（图片、音频）
│   └── favicon.ico
├── src/
│   ├── game/            # Phaser 游戏核心
│   │   ├── scenes/      # 场景（Boot, Menu, Main, GameOver）
│   │   ├── entities/    # 实体类（Player, Enemy, Bullet）
│   │   ├── systems/     # 系统（Collision, Spawner, Pool）
│   │   ├── config/      # 常量、配置表
│   │   └── Game.ts      # Phaser.Game 实例化
│   ├── ui/              # Vue UI 组件
│   │   ├── components/  # HUD, Menu, Settings
│   │   └── App.vue
│   ├── stores/          # Pinia 状态管理
│   ├── utils/           # 工具函数
│   ├── main.ts          # 入口
│   └── style.css
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 依赖安装

```bash
npm create vite@latest mechwarfare-web -- --template vue-ts
cd mechwarfare-web
npm install phaser pinia vue-router
npm install -D @types/node sass
```

### 基础 HTML 结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>机战 - MechWarfare</title>
</head>
<body>
  <div id="game-container"></div> <!-- Phaser 挂载点 -->
  <div id="ui-layer"></div>       <!-- Vue UI 挂载点 -->
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

---

## 四、游戏核心架构设计

### 游戏主循环
- **机制**：Phaser 内置 `requestAnimationFrame` 循环。
- **Delta Time**：所有移动必须乘以 `delta`，确保帧率无关性。
  ```typescript
  update(time: number, delta: number) {
    const speed = 300; // 像素/秒
    this.player.y += speed * (delta / 1000);
  }
  ```

### 游戏状态管理
- **场景流**：`BootScene` -> `MenuScene` -> `MainScene` -> `GameOverScene`
- **暂停**：`this.scene.pause()`，覆盖半透明遮罩，停止物理更新。
- **恢复**：`this.scene.resume()`，重置 delta 防止跳帧。

### 实体系统
- **基类**：`BaseEntity extends Phaser.Physics.Arcade.Sprite`
- **属性**：`hp`, `maxHp`, `speed`, `scoreValue`, `isActive`
- **生命周期**：`spawn()`, `update()`, `takeDamage()`, `destroy()`
- **继承**：
  - `Player extends BaseEntity`
  - `Enemy extends BaseEntity`
  - `Bullet extends Phaser.Physics.Arcade.Image` (轻量级)

### 碰撞检测
- **引擎**：Phaser Arcade Physics（轻量、快速、支持 AABB/圆形）
- **分组**：
  - `playerGroup`
  - `enemyGroup`
  - `playerBulletGroup`
  - `enemyBulletGroup`
- **检测**：
  ```typescript
  this.physics.add.overlap(this.playerBulletGroup, this.enemyGroup, this.onBulletHitEnemy, null, this);
  this.physics.add.overlap(this.player, this.enemyGroup, this.onPlayerHit, null, this);
  ```

### 对象池
- **目的**：避免 GC 抖动，维持 60FPS。
- **实现**：`this.physics.add.group({ classType: Bullet, maxSize: 100, runChildUpdate: true })`
- **获取**：`pool.get(x, y)`，若池空则自动扩容或返回 `null`。
- **回收**：`bullet.setActive(false).setVisible(false).setVelocity(0)`。

### 事件总线
- **方案**：Phaser `EventEmitter` 或 全局 `mitt`。
- **用途**：
  - `EVENT.PLAYER_DIE` -> UI 显示 GameOver
  - `EVENT.SCORE_UPDATE` -> HUD 更新分数
  - `EVENT.WAVE_START` -> 显示波次提示

---

## 五、玩家战机系统

### 属性设计
```typescript
interface PlayerStats {
  hp: number;           // 当前血量
  maxHp: number;        // 最大血量
  fireLevel: number;    // 火力等级 1-5
  bombCount: number;    // 炸弹数量
  invincibleTime: number; // 无敌剩余时间(ms)
  fireRate: number;     // 射击间隔(ms)
}
```

### 移动控制
- **键盘**：`this.input.keyboard.createCursorKeys()` + `WASD`
- **触摸**：虚拟摇杆或跟随手指位置（带死区）
- **物理**：
  - 使用 `setVelocity` 而非直接修改坐标。
  - **加速度**：`setAcceleration(x, y)` 提供惯性手感。
  - **摩擦力**：`setDrag(600, 600)` 实现急停。
  - **边界**：`this.player.setCollideWorldBounds(true)`。

### 射击系统
- **冷却**：`lastFireTime + fireRate < time`
- **火力升级逻辑**：
  - Lv1: 单发直线
  - Lv2: 双发平行
  - Lv3: 三发扇形
  - Lv4: 四发 + 侧翼追踪弹
  - Lv5: 五发 + 激光炮（持续伤害）
- **子弹回收**：超出屏幕 `y < -50` 自动回收。

### 视觉反馈
- **血条**：Sprite 跟随玩家，`setScale(hp/maxHp, 1)`。
- **无敌闪烁**：`this.tweens.add({ targets: player, alpha: 0.3, duration: 100, yoyo: true, repeat: -1 })`，无敌结束时停止 Tween。
- **引擎尾焰**：粒子发射器，随速度调整发射频率。

---

## 六、敌机系统

### 敌机类型

| 类型 | 行为 | 血量 | 分数 |
|------|------|------|------|
| Scout（侦察机） | 直线向下，速度 150 | 1 | 10 |
| Fighter（战斗机） | 正弦波摇摆 | 3 | 30 |
| Bomber（轰炸机） | 缓慢移动，每2s发射3发扇形弹 | 8 | 100 |
| Interceptor（截击机） | Z字形，每1s变向，速度 300 | 2 | 50 |
| Boss（母舰） | 悬停顶部，多阶段攻击 | 500+ | 2000 |

### 生成系统
- **Spawner 类**：
  - `spawnInterval`：随时间递减（2s -> 0.5s）。
  - `spawnPattern`：单点、横排、V字、包围圈。
  - **难度曲线**：`difficulty = 1 + (score / 5000)`，影响敌机血量和射速。

### 敌机 AI
- **状态机**：`Idle` -> `Move` -> `Attack` -> `Flee` (仅Boss)
- **追踪**：`this.physics.moveToObject(target, speed)`

### 敌方子弹
- **类型**：直线、螺旋、瞄准弹、激光。
- **清理**：Boss 死亡或玩家死亡时，`enemyBulletGroup.clear(true, true)`。

---

## 七、道具与奖励系统

### 道具类型

| 道具 | 效果 | 说明 |
|------|------|------|
| PowerUp (P) | 火力 +1，上限 5 | 提升子弹数量和穿透力 |
| Health (H) | HP +20，不超过 MaxHP | 血量恢复 |
| Shield (S) | 无敌 5s | 碰撞敌机不扣血但推开 |
| Bomb (B) | 炸弹 +1，上限 3 | 全屏清屏 |

### 掉落逻辑
- **触发**：敌机 `destroy()` 时 `Math.random() < dropRate`。
- **位置**：敌机死亡坐标，轻微随机偏移。
- **物理**：缓慢下落，左右微漂，超出屏幕回收。

### 拾取效果
- **动画**：缩放弹跳 `scale: 1 -> 1.5 -> 1`。
- **音效**：清脆的 "Ding"。
- **逻辑**：立即生效，道具消失。

---

## 八、特效与音效系统

### 爆炸特效
- **粒子系统**：
  ```typescript
  this.add.particles(x, y, 'explosion', {
    speed: { min: 50, max: 150 },
    scale: { start: 1, end: 0 },
    lifespan: 600,
    blendMode: 'ADD',
    quantity: 10
  });
  ```
- **分级**：小敌机 5 粒子，大敌机 30 粒子 + 屏幕震动。

### 音频管理
- **BGM**：循环播放，`volume: 0.5`。
- **SFX**：`this.sound.play('shoot')`，多实例支持（避免射击音被截断）。
- **静音**：`this.sound.mute = true`，状态存入 LocalStorage。

---

## 九、UI界面设计

### 架构
- **游戏内 HUD**：Phaser Text/Sprite（跟随相机，无 DOM 开销）。
- **菜单/结算**：Vue 组件（绝对定位覆盖 Canvas，支持复杂交互）。

### 关键界面

1. **Start Menu（开始菜单）**
   - 标题动态光效。
   - "START GAME" 按钮，键盘回车触发。
   - 历史最高分显示。

2. **HUD（游戏中界面）**
   - 左上：分数（等宽字体，防止抖动）。
   - 左下：血条（红色渐变）。
   - 右下：炸弹图标 + 数量。

3. **Game Over（游戏结束）**
   - 结算动画（分数滚动）。
   - "RETRY" / "MAIN MENU" 按钮。
   - 分享按钮（调用 Web Share API 或生成截图）。

4. **暂停界面**
   - 半透明遮罩。
   - "继续" / "重新开始" / "退出" 按钮。

5. **波次提示动画**
   - 每波开始显示 "WAVE X" 大字动画，持续 2s 后淡出。

---

## 十、关卡与难度系统

### 波次设计
- **配置表**：`waves.json`
  ```json
  [
    { "time": 0, "enemies": ["scout", "scout"], "interval": 1500 },
    { "time": 10, "enemies": ["fighter", "fighter", "scout"], "interval": 1200 },
    { "time": 30, "boss": "boss_01" }
  ]
  ```
- **触发**：`MainScene.update` 中检查 `time >= wave.time`。

### 难度递增
- **参数**：`enemySpeed`, `fireRate`, `spawnRate`
- **公式**：`currentValue = baseValue * (1 + 0.1 * Math.floor(score / 1000))`

### Boss 战
- **入场**：清场，BGM 切换，警告动画。
- **血条**：屏幕顶部超长血条，显示 Boss 名称。
- **阶段切换**：HP 阈值触发，重置攻击计时器。

---

## 十一、数据存储

### 方案
- **Key**：`mechwarfare_save_v1`
- **Value**：
  ```typescript
  {
    highScore: number,
    unlockedSkins: string[],
    settings: { sfx: boolean, bgm: boolean, vibration: boolean }
  }
  ```

### 操作
- **读取**：`JSON.parse(localStorage.getItem(key))`
- **写入**：`localStorage.setItem(key, JSON.stringify(data))`
- **异常处理**：`try-catch` 防止 QuotaExceededError。

---

## 十二、性能优化

### 渲染
- **离屏 Canvas**：预渲染静态背景/复杂粒子到 Texture。
- **剔除**：Phaser 自动剔除，但需确保 `setActive(false)` 彻底停止更新。
- **DrawCall**：使用 Texture Atlas，单图集 < 2048x2048。

### 逻辑
- **对象池**：子弹、粒子必须池化。
- **数学**：避免 `Math.sqrt`，用距离平方比较。
- **节流**：UI 更新（如分数）每 100ms 同步一次，而非每帧。

### 移动端
- **像素比**：`window.devicePixelRatio > 2` 时限制为 2，防止 4K 屏渲染爆炸。
- **粒子降级**：移动端粒子数量减半。
- **触摸**：`touch-action: none` 防止浏览器手势冲突。

---

## 十三、响应式与移动端适配

### 画布适配
- **模式**：`Phaser.Scale.FIT` + `AUTO_CENTER`
- **安全区**：CSS `env(safe-area-inset-bottom)` 处理刘海屏。
- **横竖屏**：强制竖屏或横屏提示遮罩。

### 触摸控制
- **方案 A**：虚拟摇杆（左侧移动，右侧射击）。
- **方案 B**：全屏跟随（手指按下，战机平滑跟随，松开急停）。
- **反馈**：触摸点显示半透明光圈。

---

## 十四、测试计划

### 功能测试
- [ ] 移动边界不穿墙
- [ ] 子弹回收正常，无内存泄漏
- [ ] 道具效果叠加/上限正确
- [ ] Boss 阶段切换逻辑
- [ ] 暂停/恢复时间不跳变

### 性能测试
- [ ] Chrome DevTools Performance：帧率稳定 60FPS
- [ ] Memory：Heap 增长平稳，无持续上升
- [ ] 移动端：发热控制，1小时不崩溃

### 兼容性
- [ ] iOS Safari（Web Audio 自动播放策略）
- [ ] Android Chrome（触摸延迟）
- [ ] Firefox（AudioContext 限制）

---

## 十五、部署上线

### 静态托管
- **平台**：Vercel / Netlify / GitHub Pages
- **配置**：
  ```json
  {
    "headers": [
      {
        "source": "/assets/(.*)",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
      }
    ]
  }
  ```

### 域名与 HTTPS
- **必须 HTTPS**：Web Audio API 和 Gamepad API 要求安全上下文。
- **CDN**：资源上 CDN，HTML 走源站。

### SEO
- **Meta**：Title, Description, OG Image（分享卡片）。
- **PWA**：`manifest.json` + Service Worker，支持"添加到主屏幕"。

---

## 十六、后续扩展方向

### 多人联机
- **方案**：WebSocket + 帧同步/状态同步
- **库**：Colyseus / Socket.io
- **挑战**：延迟补偿、断线重连

### 内容扩展
- **地图编辑器**：Tiled Map Editor 支持，JSON 导入。
- **Mod 支持**：允许用户替换 Texture/Audio，配置 JSON 驱动。

### 系统深化
- **Roguelike 元素**：每局随机天赋（如：子弹分裂、吸血、护盾充能）。
- **成就系统**：本地/云端成就，解锁皮肤。
- **排行榜**：Redis + Node.js 后端，防作弊签名。

### 商业化
- **广告**：复活看广告（插屏），结算双倍分数（激励视频）。
- **内购**：皮肤、永久火力加成（需合规）。

---

> **开发提示**：先完成核心循环（移动+射击+碰撞），再堆砌内容。性能问题越早发现越好，对象池从第一天就要用。保持代码模块化，`Player` 不应知道 `Enemy` 的存在，通过事件或碰撞回调交互。
