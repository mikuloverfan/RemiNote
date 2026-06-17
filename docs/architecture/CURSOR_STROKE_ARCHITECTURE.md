# Cursor + Stroke 三层架构重设计

> **目标**：彻底解决 cursor 不跟手、stroke 滞后、系统互相污染问题。
>
> **原则**：每个 DOM element 只有一个 owner；每个职责只有唯一执行者。

---

## 1. 当前架构诊断（问题根源）

### 1.1 当前数据流（有问题的）

```
pointermove ──→ _onPointerMove()  ──→ dualInput.rawX/rawY  (✅ 即时更新)
                                      │
                                      ├──→ ??? cursor ???  (⚠️ 没有直接驱动！)
                                      │
                                      └──→ RAF: _unifiedTick()
                                              │
                                              ├── tickSmoothing()  → smoothedX/Y
                                              ├── renderFrame()    → Renderer.draw()
                                              │                        └── drawCursor()  ← 🔴 canvas光标，在RAF内
                                              └── renderCursor()   ← 🔴 DOM光标，在RAF内
```

### 1.2 三个致命问题

| # | 问题 | 根因 | 文件:行 |
|---|------|------|---------|
| 🔴1 | **DOM cursor 在 RAF 中更新** | `renderCursor()` 在 `_unifiedTick()` 内调用，而非 pointermove 事件中 | [`main.ts:3193`](main.ts:3193) |
| 🔴2 | **Canvas cursor 在 Renderer.draw() 内绘制** | `drawCursor()` 嵌入 `Renderer.draw()`，与 stroke 共用同一渲染路径 | [`main.ts:2637-2645`](main.ts:2637) |
| 🔴3 | **双 cursor 系统并存** | DOM cursor (`CursorRenderer` + `renderCursor()`) 与 Canvas cursor (`drawCursor()`) 同时存在，互相覆盖/闪烁 | [`main.ts:260`](main.ts:260) vs [`src/core/render/CanvasCursor.ts:13`](src/core/render/CanvasCursor.ts:13) |

### 1.3 具体症状

- **Cursor 不跟手**：`renderCursor()` 在 RAF 中执行 → 延迟 0~16ms，快速移动时明显滞后
- **Cursor 闪烁**：Canvas cursor 在 `renderFrame()` 中被 `clearRect` 擦除再重绘 → 每帧闪烁
- **Stroke 滞后**：`renderNow()` 虽然是同步调用，但 Path2D 重建 + 平滑 + 全量渲染都在 pointermove 内同步执行 → 阻塞输入

---

## 2. 🚀 新架构：三层系统

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     🟢 LAYER 1: INPUT LAYER                      │
│                    (唯一真源，驱动一切)                              │
│                                                                   │
│  pointermove ──→ _onPointerMove()                                │
│  pointerdown ──→ _onPointerDown()                                │
│  pointerup   ──→ _onPointerUp()                                  │
│                     │                                             │
│                     ├──→ dualInput.rawX/rawY  (immediate write)   │
│                     │                                             │
│                     ├──→ 🟢 renderCursorDOM()  ← ZERO LATENCY!   │
│                     │     (直接操作 .goodnote-cursor-overlay)      │
│                     │                                             │
│                     └──→ requestStrokeUpdate()                    │
│                          (仅标记 dirty，不阻塞)                    │
│                                                                   │
│  职责：                                                           │
│  ✅ raw pointer state 更新                                       │
│  ✅ cursor DOM 直接驱动（禁止进入 RAF）                            │
│  ✅ 标记 stroke dirty                                             │
│  ❌ 不做 smoothing                                                │
│  ❌ 不操作 canvas                                                 │
│  ❌ 不做任何 Path2D 构建                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ requestStrokeUpdate()
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   🟡 LAYER 2: RENDER LAYER                       │
│                 (唯一渲染循环，RAF 驱动)                            │
│                                                                   │
│  requestAnimationFrame ──→ _renderTick()                         │
│                               │                                   │
│                               ├── tickSmoothing()                │
│                               │   raw → smoothed (EMA 0.35)      │
│                               │                                   │
│                               ├── buildStrokePath2D()            │
│                               │   使用 smoothed coords           │
│                               │                                   │
│                               ├── Renderer.drawStrokes()         │
│                               │   canvas 绘制所有笔迹             │
│                               │                                   │
│                               └── (inertia / replay 物理)        │
│                                                                   │
│  职责：                                                           │
│  ✅ EMA smoothing（每帧一次）                                     │
│  ✅ Path2D 构建 + 缓存                                           │
│  ✅ Canvas stroke 绘制                                            │
│  ✅ Inertia / Replay 物理                                         │
│  ❌ 禁止控制 cursor DOM                                           │
│  ❌ 禁止直接读 pointer 事件                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ drawStrokes()
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   🔵 LAYER 3: DISPLAY LAYER                      │
│                   (纯输出，无逻辑)                                  │
│                                                                   │
│  ┌─────────────────────┐    ┌─────────────────────┐              │
│  │  Cursor (DOM)        │    │  Stroke (Canvas)     │              │
│  │                      │    │                      │              │
│  │  .goodnote-cursor-   │    │  .goodnote-canvas    │              │
│  │  overlay             │    │  (HTMLCanvasElement) │              │
│  │                      │    │                      │              │
│  │  Owner: INPUT LAYER  │    │  Owner: RENDER LAYER │              │
│  │  更新时机: pointermove│    │  更新时机: RAF        │              │
│  │  延迟: 0ms            │    │  延迟: ≤16ms          │              │
│  └─────────────────────┘    └─────────────────────┘              │
│                                                                   │
│  职责：                                                           │
│  ✅ 纯 DOM/CSS 渲染（cursor）                                     │
│  ✅ 纯 Canvas 2D 绘制（stroke）                                   │
│  ❌ 不做任何决策                                                  │
│  ❌ 不改变任何状态                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流图

```
                     TIME ──────────────────────────────►

pointermove  ─┬──→ rawX/rawY  ──→ renderCursorDOM()  ← 0ms 延迟
              │                    (DOM transform 直接更新)
              │
              └──→ markStrokeDirty()
                         │
                         │ (等待下一帧)
                         ▼
              ═══════════════════════════════════════  ← VSYNC
 RAF tick  ──→ tickSmoothing()
              │   raw → smoothed (EMA)
              │
              ├──→ 收集所有 dirty points
              │
              ├──→ buildPath2D(smoothed points)
              │
              ├──→ ctx.setTransform(camera)
              ├──→ ctx.clearRect(...)
              ├──→ ctx.stroke(path2D) × N
              │
              └──→ ✅ stroke 显示完成  ← ≤16ms 延迟
```

**关键规则：**

```
🟢 cursor path:  pointermove → raw → DOM    (0ms)
🟡 stroke path:  pointermove → raw → [wait] → smoothed → canvas  (≤16ms)
```

---

## 3. 模块拆分（文件级）

### 3.1 现有文件改造清单

| 文件 | 当前问题 | 改造方向 |
|------|---------|---------|
| [`src/core/input/CoordinateInputSystem.ts`](src/core/input/CoordinateInputSystem.ts) | ✅ 结构正确，但 `renderCursor()` 不在 pointermove 中调用 | 将 `renderCursor()` 移到 `_onPointerMove()` 内部直接调用 |
| [`src/core/render/CanvasCursor.ts`](src/core/render/CanvasCursor.ts) | 🔴 `drawCursor()` 在 canvas 上绘制 cursor，与 stroke 混在一起 | **删除 `drawCursor()`**；该文件仅保留 `CanvasCursorState` 类型定义 |
| [`main.ts:2637-2645`](main.ts:2637) | 🔴 `Renderer.draw()` 内调用 `drawCursor()` | **删除 cursor 绘制代码** |
| [`main.ts:3193`](main.ts:3193) | 🔴 `renderCursor()` 在 `_unifiedTick()` 中调用 | **移除该行** |
| [`main.ts:3206-3209`](main.ts:3206) | 🟡 `renderNow()` 同步渲染（pointermove 内调用） | 改为 `markDirty()` + `requestRender()`，不再同步渲染 |
| [`main.ts:260-371`](main.ts:260) | 🟢 `CursorRenderer` 结构合理 | 保持，但 `mount()` 中的注释需要更新 |

### 3.2 文件职责矩阵

```
                     INPUT LAYER    RENDER LAYER    DISPLAY LAYER
                     ───────────    ────────────    ─────────────
CoordinateInputSystem.ts    ●              ○               ●
  (raw state)            owner           reader          cursor DOM

CanvasCursor.ts              ○              ○               ●
  (仅类型定义)             none           none            type only

Renderer (main.ts)           ○              ●               ●
  (stroke绘制)             none           owner           canvas draw

CursorRenderer (main.ts)     ●              ○               ●
  (DOM cursor)             owner           none            DOM create

_unifiedTick (main.ts)       ○              ●               ○
  (RAF入口)                none           owner           none

PointerPipeline (main.ts)    ●              ○               ○
  (事件路由)               owner           none            none
```

● = owner（唯一控制权）  ○ = reader/consumer（只读）

---

## 4. 最小可实施 TypeScript 结构

### 4.1 改造点 1：`CoordinateInputSystem.ts` — cursor 驱动移到 pointermove

```typescript
// src/core/input/CoordinateInputSystem.ts

// 🟢 在 pointermove handler 内直接调用 cursor 渲染
function _onPointerMove(e: PointerEvent): void {
  _updateRaw(e.clientX, e.clientY, e.buttons > 0);
  // ✅ CURSOR DRIVEN HERE — zero latency
  renderCursor();
}

function _onPointerDown(e: PointerEvent): void {
  _updateRaw(e.clientX, e.clientY, true);
  renderCursor();
}

function _onPointerUp(e: PointerEvent): void {
  _updateRaw(e.clientX, e.clientY, false);
  renderCursor();
}
```

### 4.2 改造点 2：`Renderer.draw()` — 移除 canvas cursor

```typescript
// main.ts - Renderer class

draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  queue: RenderQueue,
  viewport: Viewport,
): void {
  // ... 清屏 + 背景 ...

  // Batch draw all renderables — STROKE ONLY
  for (const r of queue.renderables) {
    if (!r) continue;
    ctx.save();
    ctx.strokeStyle = r.style.color;
    ctx.lineWidth = r.style.lineWidth;
    ctx.lineCap = r.style.lineCap;
    ctx.lineJoin = r.style.lineJoin;
    ctx.stroke(r.path2D);
    ctx.restore();
  }

  // ❌ DELETE: 不再在此处绘制 cursor
  // drawCursor(...)  ← 删除
}
```

### 4.3 改造点 3：`_unifiedTick()` — 移除 cursor 调用

```typescript
// main.ts - CanvasSession

private _unifiedTick(): void {
  if (!this.alive) return;

  // ① Smoothing (once per frame)
  tickSmoothing();

  // ② Inertia physics
  if (this.viewport.inertia.active) {
    this.viewport.inertia.tick();
  }

  // ③ Replay tick
  if (this.replayCtrl.active) {
    // ...
  }

  // ④ Render frame (STROKE ONLY)
  this.renderFrame();

  // ❌ DELETE: renderCursor();  ← cursor 已由 INPUT LAYER 在 pointermove 中直接驱动
}
```

### 4.4 改造点 4：`PointerPipeline` — 不再同步渲染

```typescript
// main.ts - PointerPipeline

constructor(private session: CanvasSession) {
  const el = session.canvasEl;

  this._onPD = (ev) => {
    if (!session.isReady) return;
    const snapshot = this.inputCtrl.capture(ev, session);
    session.toolManager.getActive().onPointerDown(snapshot, session);
    // ✅ 只标记 dirty + 请求渲染，不阻塞
    session.markDirty();
    // ❌ DELETE: session.renderNow();
  };

  this._onPM = (ev) => {
    if (!session.isReady) return;
    const snapshot = this.inputCtrl.capture(ev, session);
    session.toolManager.getActive().onPointerMove(snapshot, session);
    session.markDirty();
    // ❌ DELETE: session.renderNow();
  };

  this._onPU = (ev) => {
    if (!session.isReady) return;
    const snapshot = this.inputCtrl.capture(ev, session);
    session.toolManager.getActive().onPointerUp(snapshot, session);
    session.markDirty();
    // ❌ DELETE: session.renderNow();
  };
}
```

### 4.5 改造点 5：`renderNow()` — 删除或改为纯标记

```typescript
// main.ts - CanvasSession

/** 🟦 标记需要渲染，不阻塞事件循环。 */
renderNow(): void {
  this.assertAlive();
  // ✅ 只标记，真正的渲染在下一个 RAF 中
  this.markDirty();
}
```

### 4.6 最终调用关系

```
pointermove
  │
  ├──→ _onPointerMove(e)
  │       ├── dualInput.rawX = e.clientX   (即时)
  │       ├── dualInput.rawY = e.clientY   (即时)
  │       ├── renderCursor()               (即时, DOM transform)
  │       └── (平滑由 RAF 处理)
  │
  ├──→ PointerPipeline._onPM
  │       ├── capture InputSnapshot
  │       ├── tool.onPointerMove()
  │       ├── session.markDirty()          (标记，不阻塞)
  │       └── session.renderScheduler.requestRender()  (合并到下一帧)
  │
  ═══ VSYNC ═══
  │
  └──→ RAF: _unifiedTick()
          ├── tickSmoothing()              (raw → smoothed)
          ├── inertia.tick()
          ├── renderFrame()
          │     ├── fullRebuild / updateDirty
          │     └── Renderer.draw()        (STROKE ONLY, no cursor)
          └── ✅ 完成
```

---

## 5. 不变式（Invariants）

以下约束必须在所有代码路径上保持：

| # | 不变式 | 验证方式 |
|---|--------|---------|
| I1 | `renderCursor()` 只能在 pointermove/pointerdown/pointerup handler 中调用 | grep `renderCursor` 排除 `CoordinateInputSystem.ts` |
| I2 | `drawCursor()` 不得在任何地方调用 | 删除该函数或标记 `@deprecated` |
| I3 | `renderNow()` 不得调用 `renderFrame()` | 改为仅调用 `markDirty()` |
| I4 | `_unifiedTick()` 不得调用任何 cursor 相关函数 | grep `_unifiedTick` 上下文中无 cursor |
| I5 | `.goodnote-cursor-overlay` 的 `style.transform` 仅由 `renderCursor()` 修改 | 搜索 `.goodnote-cursor-overlay` 的 transform 写入 |
| I6 | Canvas context 的 cursor 绘制代码（arc/stroke）不得存在于 `Renderer.draw()` | 删除 `drawCursor` 调用 |

---

## 6. 迁移步骤（建议顺序）

1. **Step 1**: 在 `CoordinateInputSystem.ts` 的 `_onPointerMove/_onPointerDown/_onPointerUp` 中直接调用 `renderCursor()`
2. **Step 2**: 从 `_unifiedTick()` 中移除 `renderCursor()` 调用
3. **Step 3**: 从 `Renderer.draw()` 中移除 `drawCursor()` 调用
4. **Step 4**: 将 `PointerPipeline` 中的 `renderNow()` 改为 `markDirty() + requestRender()`
5. **Step 5**: 将 `renderNow()` 方法改为纯标记（或删除）
6. **Step 6**: 验证 cursor 零延迟跟随 + stroke 在 RAF 中正确渲染
