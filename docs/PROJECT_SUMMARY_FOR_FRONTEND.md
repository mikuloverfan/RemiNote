# RemiNote (GoodNote Max) — Obsidian 手写插件现状总结

> 给前端同学看的，用于排查 cursor（光标）与 stroke（笔迹）起点不重合的问题。

---

## 项目概览

这是一个 Obsidian 插件，在笔记中嵌入一个 `<canvas>` 实现手写批注功能。

- **框架**：Obsidian Plugin API（基于 CodeMirror/Electron）
- **语言**：TypeScript
- **入口**：[`main.ts`](main.ts)（~4180 行，单文件包含全部逻辑）
- **核心模块**：`src/core/input/`（输入）、`src/core/render/`（渲染）、`src/core/orchestrator/`（调度）

---

## 当前架构（已完成三层重构）

```
pointermove (document, capture)
  │
  ├── [INPUT LAYER] CoordinateInputSystem.ts
  │     ├── dualInput.rawX/Y = e.clientX/Y        (即时, 0ms)
  │     ├── dualInput.isInsideCanvas = isInCanvas()
  │     └── renderCursor() → DOM transform         (即时, 0ms)
  │
  ├── [STROKE INPUT] PointerPipeline → PenTool
  │     ├── pointerdown: dualInput.rawX/Y → screenToWorld() → engine.startStroke()
  │     └── pointermove: InputSnapshot → addPoint() → markDirty()
  │
  └── [RENDER LAYER] RAF: RuntimeOrchestrator → _unifiedTick()
        ├── tickSmoothing()         (EMA, 仅 DebugBus 用)
        ├── renderFrame()
        │     ├── buildPath2D() → smoothStroke() [3-point kernel]
        │     └── Renderer.draw() → canvas
        └── (cursor 不在此层)
```

---

## Cursor 系统细节

### DOM 结构

```
document.body
  └── #goodnote-ui-layer          [position: fixed; z-index: 2147483647; isolation: isolate]
        └── .goodnote-cursor-overlay.cursor-pen
              [position: fixed; top:0; left:0; z-index: 2147483647]
              [will-change: transform; contain: layout style paint]
              [transform: translate3d(x, y, 0)]  ← JS 动态设置
```

### CSS 关键属性

| 属性 | 值 | 作用 |
|------|-----|------|
| `position` | `fixed` | 相对于 viewport |
| `z-index` | `2147483647` | 理论最高层 |
| `will-change` | `transform` | GPU 合成层 |
| `contain` | `layout style paint` | CSS containment |
| `background` | `transparent` | 环形光标（仅 border） |
| `width/height` | `var(--cursor-size, 20px)` | JS 动态设置 `--cursor-size` |

### 生命周期

```
Plugin._boot()
  → startPointerStream()                      document 级 pointer 监听
  → CursorRenderer.mount()
      → 创建 #goodnote-ui-layer
      → 创建 .goodnote-cursor-overlay
      → bindCursorDocument(_doc)
      → bindViewportCamera(session.viewport.camera)
```

---

## Stroke 系统细节

### 坐标变换链

```
e.clientX/Y (屏幕坐标)
  → screenToWorld():  wx = (clientX - rect.left - cam.x) / cam.zoom
  → Engine.addPoint(wx, wy)  →  spacing 插值 →  currentStroke.points[]
  → RAF: buildPath2D(points) →  smoothStroke() [3-point moving average]
  → Renderer.draw():
      ctx.setTransform(dpr*zoom, 0, 0, dpr*zoom, cam.x*dpr, cam.y*dpr)
      ctx.stroke(path2D)
```

### Canvas 尺寸

```javascript
// applySize()
const w = Math.round(rect.width), h = Math.round(rect.height);
const dpr = window.devicePixelRatio || 1;
canvas.width  = Math.round(w * dpr);   // 设备像素
canvas.height = Math.round(h * dpr);
// CSS: width: 100%; height: 100%  (通过 CSS 变量 --canvas-css-w/h)
```

---

## 🔴 当前问题：Cursor 与 Stroke 起点不重合

### 症状

pointerdown 落笔时，`.goodnote-cursor-overlay`（环形光标）的圆心与 canvas 上 stroke 的第一个点存在 **轻微像素级偏移**。

### 已尝试的修复（均已实施，未解决）

| 尝试 | 改动 | 效果 |
|------|------|------|
| 统一输入源 | `PenTool.onPointerDown` 改为读 `dualInput.rawX/Y` 而非 `InputSnapshot.worldX/Y` | 保证同一次 pointerdown 事件的值一致 |
| 共享投影管线 | `renderCursor()` 改为 `screenToWorld → worldToScreen` 回投影，与 stroke 用同一份 `camera` 引用 + 同一个 `getBoundingClientRect()` | 数学上等价于直接 `clientX/Y`，无实际效果 |
| Canvas cursor 移除 | 删除 `Renderer.draw()` 内的 `drawCursor()`，避免双 cursor 闪烁 | 修复闪烁，不解决偏移 |

### 疑点分析

**理论上两者应对齐**：

```
cursor screen pos:  clientX
stroke world pos:   (clientX - rect.left - cam.x) / zoom
stroke device pos:  world * dpr * zoom + cam.x * dpr = (clientX - rect.left) * dpr
stroke screen pos:  rect.left + device / dpr = clientX  ✅
```

但实际仍有偏移。可能原因：

1. **Canvas device buffer 整数取整**：`canvas.width = Math.round(w * dpr)` 导致 CSS px ↔ device px 映射不是严格的 `dpr` 倍。例如 CSS 800.7px × dpr 1.5 = 1201.05 → round → 1201，实际 ratio = 1201/800.7 ≠ 1.5

2. **GPU 合成层对齐**：cursor 在独立 GPU 层（`will-change: transform`），canvas 也可能被提升到 GPU 层，两个合成层在屏幕上的 device-pixel snapping 可能不一致

3. **Obsidian 布局中的 CSS transform**：如果 canvas 的父级元素有 `transform`、`filter`、`perspective` 等，会影响 `getBoundingClientRect()` 的精度，导致 `rect.left/top` 为亚像素值

4. **`contain: layout style paint` 的影响**：CSS containment 在某些浏览器可能影响子元素的渲染位置

### 建议排查方向

1. **DevTools 验证**：在 pointerdown 时 console.log `clientX/Y`、`getBoundingClientRect()`、camera 值，计算理论 screen pos 并与实际 cursor DOM 位置对比
2. **检查 stacking context**：确认 cursor 的 GPU 层和 canvas 的 GPU 层是否在同一 compositor 层级
3. **尝试关闭 `will-change: transform`** 和 `contain` 看是否解决
4. **检查 canvas device buffer ratio**：`canvas.width / CSS width` 是否精确等于 `dpr`

---

## 文件索引

| 文件 | 关键内容 |
|------|---------|
| [`main.ts`](main.ts) | PenTool、CanvasSession、CursorRenderer、Renderer、Viewport、PointerPipeline |
| [`src/core/input/CoordinateInputSystem.ts`](src/core/input/CoordinateInputSystem.ts) | `dualInput`、`renderCursor()`、`startPointerStream()`、`isInCanvas()` |
| [`src/core/render/CanvasCursor.ts`](src/core/render/CanvasCursor.ts) | `drawCursor()`（canvas 版，已废弃不用） |
| [`styles.css`](styles.css) | `.goodnote-cursor-overlay`、`.goodnote-ui-layer`、`.goodnote-canvas` |
