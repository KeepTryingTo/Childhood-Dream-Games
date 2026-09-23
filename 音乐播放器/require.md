# 网页版音乐播放器 —— 需求与实现步骤文档

> 版本：v1.0 ｜ 日期：2026-08-30 ｜ 状态：需求评审

## 1. 项目概述

### 1.1 目标
实现一个纯前端、无需后端的网页音乐播放器，具备：
- 本地音频文件导入与播放（核心音源，规避版权风险）
- 完整播放控制（播放/暂停/切歌/进度/音量/播放模式）
- 播放列表管理
- 可选：LRC 歌词同步、音频频谱可视化、系统媒体键集成

### 1.2 技术选型（建议）

| 方案 | 技术栈 | 适用场景 |
|---|---|---|
| A（推荐） | 原生 HTML5 + CSS3 + JavaScript | 零依赖，适合学习与演示 |
| B | Vue3 + Vite | 组件化，状态管理清晰 |
| C | React + Vite | 生态丰富，便于扩展 |

核心 Web API：
- `HTMLAudioElement`：播放能力主体
- `Web Audio API`（AnalyserNode）：频谱可视化
- `File API` + `URL.createObjectURL`：本地文件导入
- `localStorage` / `IndexedDB`：设置与文件持久化
- `Media Session API`：系统级媒体控制（锁屏/硬件媒体键）

### 1.3 版权说明
仅支持**用户本地文件**或**无版权/授权音源**；不内置任何盗版音乐抓取能力。

## 2. 需求清单

### 2.1 核心功能（P0，必须实现）

| 编号 | 功能 | 说明 |
|---|---|---|
| F1 | 文件导入 | 支持多选本地音频（mp3/ogg/flac/m4a 等），生成播放列表 |
| F2 | 播放/暂停 | 按钮切换，图标随状态变化 |
| F3 | 上/下一首 | 手动切歌，保持播放连续性 |
| F4 | 进度控制 | 显示当前/总时长；点击、拖拽跳转（seek） |
| F5 | 音量控制 | 滑块调节 + 静音切换 |
| F6 | 播放模式 | 顺序、列表循环、单曲循环、随机（不重不漏一轮） |
| F7 | 播放列表 | 展示、点击切歌、高亮当前、删除单曲、清空 |
| F8 | 歌曲信息 | 标题、艺术家、封面（缺省占位图/旋转唱片动画） |
| F9 | 自动续播 | 一首结束按当前模式自动切下一首 |
| F10 | 错误处理 | 损坏/不支持文件提示并自动跳过 |

### 2.2 扩展功能（P1，可选）

| 编号 | 功能 | 说明 |
|---|---|---|
| E1 | LRC 歌词 | 解析 .lrc，逐行高亮、平滑滚动 |
| E2 | 频谱可视化 | Canvas 绘制频率柱状/波形 |
| E3 | 键盘快捷键 | 空格播放/暂停，←→ 快退/快进，↑↓ 音量 |
| E4 | Media Session | 系统锁屏/媒体键控制与元数据展示 |
| E5 | 持久化 | 音量、模式、列表设置记忆；IndexedDB 存本地文件 Blob |
| E6 | 搜索过滤 | 列表内按标题/艺术家过滤 |
| E7 | 主题切换 | 深色/浅色主题 |
| E8 | 响应式 | 移动端自适应布局 |

### 2.3 非功能需求
- 逻辑与 UI 分离：`PlayerCore` 不直接操作 DOM，通过事件/回调通知 UI
- 进度与歌词刷新用 `requestAnimationFrame`，不依赖低频 `timeupdate`
- 遵守浏览器自动播放策略：首次播放必须由用户手势触发
- 关键逻辑（模式切换、列表索引、LRC 解析）可单元测试

## 3. 技术基线与易错点

### 3.1 自动播放策略
- 无用户手势时 `audio.play()` 会被拒绝（Promise reject），需捕获并引导用户点击播放。
- 切歌续播属于用户操作链路内，一般不受限；页面加载即播必被拦截。

### 3.2 timeupdate 频率
- `timeupdate` 约 4Hz，直接驱动进度条会卡顿；渲染层用 rAF 轮询 `audio.currentTime`。

### 3.3 Web Audio 约束
- `createMediaElementSource(audio)` 同一元素**只能调用一次**，重复调用抛异常。
- 在线音频若无 CORS 头，频谱会因 canvas 污染而失效；本地 objectURL 无此问题，在线源需做降级（装饰性动画）。

### 3.4 objectURL 生命周期
- `URL.createObjectURL` 生成的地址仅当前会话有效，刷新即失效；
- 需持久化本地文件时，用 IndexedDB 存 `File/Blob`，读取时重建 objectURL；
- 移除歌曲时 `revokeObjectURL` 防内存泄漏。

## 4. 总体设计

### 4.1 分层架构
```
┌─ UI 层：布局、控件、列表、歌词面板、频谱 Canvas、主题
├─ 应用流程层：导入、持久化、快捷键、Media Session
├─ 服务层：LrcParser / Visualizer / Storage / EventBus
├─ 播放核心层：PlayerCore（Audio 封装 + 模式 + 切歌）
└─ 数据模型层：Track / Playlist / PlayerState

```

### 4.2 数据模型
```js
track = {
  id,          // 唯一 id（crypto.randomUUID 或自增）
  title,       // 标题（文件名解析：'艺术家 - 标题'）
  artist,
  url,         // objectURL 或在线 URL
  cover,       // 封面 URL，可空
  duration,    // 秒，loadedmetadata 后回填
  lrc          // 歌词文本，可空
}

playerState = {
  currentIndex,          // 当前播放索引
  isPlaying,
  currentTime, duration,
  volume,                // 0~1
  muted,
  mode                   // 'order' | 'list-loop' | 'single' | 'shuffle'
}

```

### 4.3 文件结构（原生版示例）
```
music-player/
├── index.html
├── require.md              # 本文档
├── css/style.css
├── js/
│   ├── model.js            # Track/状态/事件总线
│   ├── player.js           # PlayerCore：Audio 封装、模式、切歌
│   ├── playlist.js         # 列表增删改查、索引维护
│   ├── lrc.js              # LRC 解析与同步计算
│   ├── visualizer.js       # 频谱可视化
│   ├── storage.js          # localStorage / IndexedDB
│   ├── ui.js               # DOM 渲染与交互绑定
│   └── main.js             # 入口装配
└── tests/lrc.test.js       # 单元测试（可选）

```

## 5. 详细实现步骤

### 步骤 0：项目初始化与页面骨架（0.5 天）
1. 建立目录结构；index.html 划分区域：信息区（封面/标题/艺术家）、歌词区、列表侧栏、底部控制栏（模式/上一首/播放/下一首/进度/音量/导入）。
2. 基础样式与占位图标（SVG 或 iconfont）。
3. 验收：布局完整、响应式骨架正确、控制台无报错。

### 步骤 1：本地文件导入（0.5–1 天）
1. `input[type=file][accept="audio/*"][multiple]` + 拖拽导入（dragover/drop）。
2. 逐个 File：`URL.createObjectURL` 生成 url；文件名按 `艺术家 - 标题` 解析，否则标题=文件名、艺术家='未知'。
3. 用临时 `Audio` 读取 `loadedmetadata` 回填 duration；`canPlayType` 预检格式。
4. 支持同时拖入 .lrc 文件按同名关联歌词（可选）。
5. 验收：多选导入后列表正确展示标题/时长；损坏文件有提示不中断。

### 步骤 2：播放核心 PlayerCore（1.5 天）
1. 封装 Audio：`load(track)`、`play()`、`pause()`、`toggle()`、`seek(t)`、`setVolume(v)`、`setMuted(b)`。
2. 事件桥接：`play/pause/ended/error/loadedmetadata` → 更新 state 并通过 EventBus 通知 UI。
3. `play()` 返回 Promise 并捕获 NotAllowedError（自动播放策略），失败时置暂停态并提示。
4. 切歌逻辑：`next()/prev()`；按模式计算下一索引：
   - order：末首结束 → 停止
   - list-loop：末首 → 回首
   - single：ended 时重播当前
   - shuffle：维护洗牌队列（Fisher–Yates），一轮不重不漏
5. 切歌时保持"播放中切歌继续播、暂停中切歌保持暂停"。
6. 验收：通过第 6 节 T1–T6。

### 步骤 3：控制栏 UI 与交互（1 天）
1. 播放/暂停图标切换；上/下一首按钮。
2. 自定义进度条组件：点击 + 拖拽（pointerdown/move/up），拖拽中暂停刷新、松手 seek；显示 `mm:ss / mm:ss`。
3. 音量滑块 + 静音按钮（记忆静音前音量）。
4. 模式按钮循环切换，图标 + title 提示当前模式。
5. 验收：所有控件可用；拖拽 seek 平滑不跳变。

### 步骤 4：播放列表与信息展示（1 天）
1. 列表渲染：序号、标题、艺术家、时长；当前项高亮 + 播放动效图标。
2. 点击切歌；删除单曲（**删除当前项时正确维护索引与播放状态**）；清空（停止播放并复位）。
3. 信息区：标题/艺术家文本；封面缺省为旋转唱片 CSS 动画，暂停时停止旋转。
4. 搜索过滤框（可选）。
5. 验收：通过第 6 节 T7–T8；增删后索引无错乱。

### 步骤 5：LRC 歌词解析与同步（1–1.5 天）
1. `lrc.js` 解析：正则 `/\[(\d{2}):(\d{2})(?:[.:](\d+))?\]/g` 提取时间标签，支持一行多时间戳与 `[offset:]` 偏移；生成按时间升序的 `[{t, text}]`。
2. 渲染歌词列表；播放中用 rAF + **二分查找**定位当前行。
3. 当前行高亮并自动居中滚动（transform 平滑过渡）；无歌词显示占位文案。
4. 验收：通过第 6 节 T9；同步误差 < 0.5s。

### 步骤 6：频谱可视化（1–1.5 天）
1. 首次用户触发播放时初始化：`AudioContext` + `createMediaElementSource(audio)` + `AnalyserNode`（fftSize=256/512）→ 连接 destination。
2. rAF 循环 `getByteFrequencyData` 绘制柱状频谱（或 `getByteTimeDomainData` 波形）。
3. 暂停时冻结/淡出动画；在线源 CORS 失败时降级为装饰动画并提示。
4. 验收：频谱随音乐律动；重复初始化不抛异常。

### 步骤 7：持久化、快捷键与 Media Session（0.5–1 天）
1. `storage.js`：localStorage 存音量、模式、主题；列表元数据仅在线 URL 可持久化，本地文件用 IndexedDB 存 Blob（可选）。
2. 键盘：空格播放/暂停、←/→ ±5s、↑/↓ 音量、N/P 切歌；输入框聚焦时不响应。
3. Media Session：设置 `MediaMetadata`（标题/艺术家/封面），注册 play/pause/previoustrack/nexttrack handler。
4. 验收：刷新后设置恢复；系统媒体键可控。

### 步骤 8：优化、测试与发布（1 天）
1. 响应式（桌面双栏 + 底部控制栏；移动端竖排）、深浅主题。
2. 错误 toast（解码失败、格式不支持、自动播放被拦截）。
3. 补齐第 6 节测试；内存检查（objectURL revoke、rAF/监听器清理）。
4. 编写 README（运行方式、操作说明、版权说明）；静态托管发布（GitHub Pages 等）。
5. 验收：Chrome/Edge/Safari/Firefox 与移动端可用。

## 6. 测试计划（关键用例）

| 编号 | 用例 | 预期 |
|---|---|---|
| T1 | 播放/暂停切换 | 状态、图标、唱片动画一致 |
| T2 | 播完自动续播 | 四种模式行为均正确（order 末首停止） |
| T3 | 进度点击/拖拽 seek | 时间准确、拖拽中不抖动 |
| T4 | 音量/静音 | 即时生效，刷新后恢复 |
| T5 | 播放中/暂停中切歌 | 播放中续播；暂停中保持暂停 |
| T6 | 损坏或不支持文件 | error 捕获、toast 提示、可手动/自动跳过 |
| T7 | 删除当前播放歌曲 | 索引正确，续播合理（下一首或停止） |
| T8 | 空列表点播放 | 不报错，提示导入 |
| T9 | 歌词同步 | 高亮行与进度一致，滚动平滑 |
| T10 | 快捷键与输入框冲突 | 输入框聚焦时快捷键失效 |
| T11 | 页面加载即自动播放 | 被拦截时优雅降级为暂停态 |
| T12 | 长时间播放内存 | objectURL 及时 revoke，无明显泄漏 |

## 7. 里程碑计划

| 里程碑 | 内容 | 预计工时 |
|---|---|---|
| M1 | 骨架 + 文件导入 | 1 天 |
| M2 | 播放核心 + 控制栏 | 2.5 天 |
| M3 | 播放列表 + 信息展示 | 1 天 |
| M4 | LRC 歌词 | 1–1.5 天 |
| M5 | 频谱可视化 | 1–1.5 天 |
| M6 | 持久化 / 快捷键 / Media Session | 1 天 |
| M7 | 优化、测试与发布 | 1 天 |
| 合计 | | 约 8.5–9.5 人天 |

## 8. 风险与注意事项
1. **自动播放策略**：首次播放必须用户手势触发；`play()` 的 Promise 必须 catch，否则控制台报错且状态不一致。
2. **createMediaElementSource 一次性绑定**：同一 Audio 元素只能创建一次源节点，初始化时机与单例管理要做好。
3. **在线音源 CORS**：无 CORS 头时频谱/波形不可用，需设计降级方案；本项目默认本地文件可天然规避。
4. **objectURL 失效**：刷新后本地歌曲 url 失效，要么重新导入，要么上 IndexedDB 存 Blob 方案，产品文案需说明。
5. **timeupdate 低频**：进度条与歌词不要只依赖 timeupdate，用 rAF 轮询 currentTime。
6. **列表索引维护**：删除/清空/洗牌模式下 currentIndex 极易错乱，所有变更集中到 playlist 模块并配单测。
7. **格式兼容**：flac/m4a/ogg 支持度因浏览器而异，导入时用 canPlayType 预检并提示。
8. **版权合规**：不接入未授权在线曲库；README 明确音源来源责任。

---
> 开发顺序建议：**先核心播放链路（导入→播放→控制→列表），再歌词与可视化等增强；逻辑层先行、UI 后装配。**