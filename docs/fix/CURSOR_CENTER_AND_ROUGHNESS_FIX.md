# Cursor 中心对齐 + 笔迹粗糙修复方案

## 问题 1：Cursor 圆心 ≠ Stroke 起点

### 根因

`renderCursor()` 设置 `transform: translate3d(sx, sy, 0)`，将 `.goodnote-cursor-overlay` 的**左上角**定位在 `(sx, sy)`。

但 cursor 是一个圆形环（`border-radius: 50%` + `border: 1.5px`），其视觉圆心在：

```
centerX = sx + (contentWidth + 2*border) / 2
centerY = sy + (contentHeight + 2*border) / 2
```

默认 `content-box` 模式下 border 外扩，`--cursor-size=20px` → 总尺寸 23×23px → 圆心偏移 = +11.5px（右下）。

Stroke 起点计算的是 `(sx, sy)` 的精确投影，位于 cursor 元素左上角，而非圆心。

### 修复

[`CoordinateInputSystem.ts:192`](src/core/input/CoordinateInputSystem.ts:192) — 在 inline transform 中追加 `translate(-50%, -50%)`：

```
旧: translate3d(sx, sy, 0)
新: translate3d(sx, sy, 0) translate(-50%, -50%)
```

`translate(-50%, -50%)` 的百分比参照元素自身 **border-box**，将圆心对齐到 `(sx, sy)`。

---

## 问题 2：旧笔迹在新笔画绘制时变粗糙

### 根因分析

**2a. `smoothStroke` 尾部漂移**

```typescript
function smoothStroke(points) {
    for (let i = 0; i < points.length; i++) {
        const next = points[i + 1] || points[i];  // ← 尾部回退
        smoothed.push({ x: (prev+curr+next)/3, y: ... });
    }
}
```

当 stroke 从 N 个点增长到 N+1 个点时，第 N-1 个点的 `next` 从 `points[N-1]`（回退到自身）变为 `points[N]`（新点）。3-point kernel 改变 → **倒数第二个点位置轻微漂移**。每帧新点到达都会重复此过程，视觉上表现为笔迹末端"蠕动"。

**2b. `buildPath2D` 全量重建**

```typescript
function buildPath2D(points, p) {
    const pts = smoothStroke(points);  // O(n) 每次重建全部
    const path = new Path2D();
    // 遍历所有 pts 构建 path
}
```

每一帧对全部 points 做 smoothStroke + 构建完整 Path2D。对于 100 点的 stroke，每帧重复 100 次 kernel 计算。尾部漂移通过 Path2D 的 `quadraticCurveTo` 被放大。

### 修复

**`smoothStroke` 增量版**：只对新增点做 kernel，已处理点冻结不变。

```
已处理: [P0, P1, P2, ..., P_{k-1}]  ← 冻结，不再参与 kernel
新增:   [P_{k-2}, P_{k-1}, P_k, ..., P_N]  ← 从 k-2 开始（保留两个重叠用于连续性）
```

实现：在 `buildPath2D` 调用处维护 `_lastSmoothedCount`，仅对新段做 smoothStroke。

**`buildPath2D` 增量版**：已平滑的旧点直接追加到 Path2D，只对新段做 corner detection + quadraticCurveTo。

---

## 问题 3（辅助）：Canvas 尺寸精度

### 根因

[`main.ts:2993-2997`](main.ts:2993)：
```typescript
const w = Math.round(rect.width);        // 800.7 → 801
this.canvasEl.width = Math.round(w * dpr); // 801*1.5=1201.5→1202
// CSS: width: w + 'px' = 801px
// 实际 CSS 布局: 800.7px
```

CSS 尺寸 801px ≠ 实际布局 800.7px，浏览器 scale canvas → ratio 偏离 dpr → 亚像素模糊。

### 修复

使用精确的 CSS 尺寸（不取整），保持 `canvas.width / CSS width = dpr`：

```typescript
const cssW = rect.width;                        // 精确值 800.7
this.canvasEl.width = Math.round(cssW * dpr);   // 1201
this.canvasEl.style.width = cssW + 'px';        // CSS 也 800.7
```

---

## 改动清单

| # | 文件 | 行 | 改动 |
|---|------|-----|------|
| 1 | [`CoordinateInputSystem.ts`](src/core/input/CoordinateInputSystem.ts) | 192 | `translate3d(x,y,0)` → `translate3d(x,y,0) translate(-50%,-50%)` |
| 2 | [`styles.css`](styles.css) | 93 | `.cursor-pen` 添加 `box-sizing: border-box` |
| 3 | [`main.ts`](main.ts) | 2502-2516 | `smoothStroke` → `smoothStrokeIncremental(points, startIdx)` |
| 4 | [`main.ts`](main.ts) | 2518-2567 | `buildPath2D` 增量构建，仅处理新增点 |
| 5 | [`main.ts`](main.ts) | 2993-3000 | `applySize` 使用精确 CSS 尺寸 |
| 6 | [`main.ts`](main.ts) | 2626 | `Renderer.draw` 添加 `ctx.imageSmoothingEnabled = false` |

## 不变式保护

| 不变式 | 状态 |
|--------|------|
| cursor 0ms 延迟 | ✅ `translate(-50%,-50%)` 是纯 CSS transform，GPU 合成，无额外开销 |
| stroke 手感不变 | ✅ smoothStroke 的 O(1) per-frame 优化不影响数学结果 |
| 旧 stroke Path2D 缓存不变 | ✅ 只改增量重建，缓存逻辑不变 |
