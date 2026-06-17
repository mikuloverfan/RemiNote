# 笔刷引擎审查报告：与 PS 笔刷引擎的差距分析

> 审查日期：2026-06-16
> 审查范围：`src/core/render/` + `src/core/gpu/` + `src/core/brush/` + `src/core/material/`

---

## 0. 概述

当前代码已实现"性能优化后的贴图笔刷"，但距离真正的 Photoshop 笔刷引擎还有 **渲染模型代差**。问题不在参数调优，而在架构层。以下逐一分析。

---

## 1. 问题一：渲染模型 — "贴图盖章" 而非 "动态 Mesh"

### 现状

有两个并存的渲染路径：

| 路径 | 位置 | 方式 |
|------|------|------|
| **Mesh 路径** | [`buildStrokeGeometry()`](src/core/render/StrokeGeometryEngine.ts:276) | Catmull-Rom 平滑 → 三角形条带 → 半圆 cap |
| **Stamp 路径** | [`drawStampStroke()`](src/core/render/StrokeGeometryEngine.ts:599) | 沿路径每间距 1px 画一个笔尖贴图 |

两条路径被混用，核心渲染走的是 **stamp 路径**（通过 [`StampBuffer`](src/core/render/StampBuffer.ts) → [`GPUStampRenderer`](src/core/gpu/GPUStampRenderer.ts)）。

### 根本原因

[`GPUStampRenderer`](src/core/gpu/GPUStampRenderer.ts) 的 fragment shader（第 124-137 行）：

```glsl
float d = length(v_localCoord);
if (d > 1.0) discard;
float alpha = v_opacity;
fragColor = vec4(v_color * alpha, alpha);
```

本质就是 **画圆盘**，等同于：

```text
○○○○○○○○○○
```

即使 stamp 间距 0.5px，最终效果仍然是：

```text
◔◕●●●●●◕◔
```

**一串重叠圆 → 香肠形笔触**

### PS 的做法

PS 笔迹是 **连续几何体**（triangle strip / mesh），基于压力生成左右边界：

```
输入点 → 平滑 → 重采样 → 压力曲线 → 宽度(t)
↓
构建左边界 L(t) 和右边界 R(t)
↓
三角化（triangle strip）
↓
shader 填充软边
```

### 影响

- 起笔收笔永远圆（因为是半圆 cap 或圆 stamp）
- 笔画身体像香肠（宽度变化再连续，边缘也是光滑管子）
- 快速笔画出现珠子感（beading）

---

## 2. 问题二：软边算法 — 线性渐变而非 PS falloff 曲线

### 现状

[`BrushTipTexture.generateSoftRound()`](src/core/render/BrushTipTexture.ts:22-37) 的软边生成：

```typescript
const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
g.addColorStop(0, 'rgba(0,0,0,1)');
g.addColorStop(0.6, 'rgba(0,0,0,0.95)');
g.addColorStop(0.85, 'rgba(0,0,0,0.5)');
g.addColorStop(1, 'rgba(0,0,0,0)');
```

这是一个 **三段线性+指数** 的近似。PS 的 alpha falloff 更像：

```text
alpha(r)

1.0
|███▌
|███▉
|███▉    ← plateau: fully opaque core
|   ▉
|    ▋   ← smoothstep/quadratic transition
|     ▁
+------------>
          r
```

关键差异：
- PS 有 **hardness 参数** 控制核心大小 vs 羽化半径
- PS 的边缘过渡是 **smoothstep（三次 Hermite）** 而非线性
- PS 的衰减曲线更接近 `1 - smoothstep(coreRadius, radius, dist)` 的形态

### GPU 路径的软边完全缺失

[`GPUStampRenderer`](src/core/gpu/GPUStampRenderer.ts:124-137) 的 fragment shader 甚至没有软边：

```glsl
// Hard brush: binary ink mask — no gaussian, no halo
float alpha = v_opacity;
```

**这是硬边裁剪**，完全没有 alpha falloff。

### 第 167-177 行的 Stroke Ribbon Shader 有 Bug

```glsl
float alpha = smoothstep(v_radius * u_dpr * u_zoom, 0.0, length(gl_FragCoord.xy - vec2(0.0)));
```

问题：
1. `u_dpr`、`u_zoom` 在 fragment shader 中未声明为 uniform，是 undefined
2. `gl_FragCoord.xy - vec2(0.0)` = `gl_FragCoord.xy`，没有相对中心偏移
3. 这个 shader 实际上 **不可用**

---

## 3. 问题三：毛笔纹理 — 随机点而非连续刷毛

### 现状

[`BrushTipTexture.generateBristle()`](src/core/render/BrushTipTexture.ts:57-107)：

```typescript
const bristleCount = 12;
for (let i = 0; i < bristleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = (Math.random() + Math.random() + Math.random()) / 3 * TIP_SIZE * 0.4;
    // ...
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
}
```

核心问题：**使用 `Math.random()`** 生成笔尖纹理。

1. 每次调用 `generateBristle()` 产生不同的随机图案
2. 但纹理在 `getTipTexture()` 中被缓存（第 146-148 行），所以首次生成后固定
3. **固定图案在拖动时会产生重复纹理，看起来像噪点而非纤维**

### PS 的做法

真正的毛笔刷毛不是随机点，而是 **连续纤维**：

```
bristles = [
  {offset: -5, x, width: 0.3},
  {offset: -4, x, width: 0.4},
  {offset: -2, x, width: 0.5},
  ...
]

for each point along stroke:
  for each bristle:
    bristle.x += noise(t)      // 刷毛弯曲
    bristle.width *= pressure   // 压力控制刷毛散开
    draw(bristle)
```

效果：

```text
|||||||||      ← 连续纤维
 |||||||||
  |||||||
   |||||
```

不是：

```text
. . .  . . .   ← 随机点（当前效果）
 .. .  .. .
```

### 另外的问题

`generateBristle()` 第 73 行每次生成不同角度/距离，**生成结果不可复现**，破坏确定性。

---

## 4. 问题四：Flow/透明度累积 — 固定 alpha 而非累积

### 现状

[`InkMaterialSystem`](src/core/material/InkMaterialSystem.ts:147-160)：

```typescript
const finalOpacity = Math.min(1, 0.35 + 0.65 * input.pressure);
```

[`StrokeBatchRenderer`](src/core/render/StrokeBatchRenderer.ts:255)：

```typescript
const alpha = batch.style.opacity !== 1 ? batch.style.opacity : 0.9;
ctx.globalAlpha = alpha;
```

[`drawStampStroke()`](src/core/render/StrokeGeometryEngine.ts:619)：

```typescript
ctx.globalAlpha = 0.85;
```

所有 alpha 都是 **静态值**，不随重叠次数累积。

### PS 的做法

PS 的 Flow 不是 `alpha=0.5`，而是：

```text
dst += src * flow
```

每次画过同一区域，墨水会 **逐渐变深**：

```text
pass 1: ░░        (alpha = 0.2)
pass 2: ██░       (alpha = 0.2 + 0.2*0.8 = 0.36)
pass 3: ████░     (alpha accumulates)
```

当前用的是 `multiply` 混合模式（第 617 行），这有一定的累积效果，但：

1. `ctx.globalAlpha = 0.85` 意味着每次 stamp 的 alpha 上限是 0.85
2. `multiply` 模式下，多次重叠确实会变深，但变深速度不符合 PS 的 flow 模型
3. 没有 flow rate 参数控制累积速度

---

## 5. 问题五：宽度 Taper — anti-needle 阻止了真正的尖头

### 现状

[`computeWidths()`](src/core/render/StrokeGeometryEngine.ts:219-221)：

```typescript
// Anti-needle: minimum width for first/last points
const minWidth = Math.max(0.3, baseWidth * 0.06);
raw[0] = Math.max(raw[0], minWidth);
if (n > 1) raw[n - 1] = Math.max(raw[n - 1], minWidth);
```

这行代码 **阻止了起笔/收笔真正尖细**。即使压力为 0，宽度也不会低于 0.3px 或 baseWidth * 0.06。

同时，bell curve 的混合公式（第 174 行）：

```typescript
const bellStrength = 0.2 + taper * 0.6; // 0.2~0.8
const bell = 1 - bellStrength + bellStrength * bellBase;
```

当 `taper=1` 时，`bell = 0.2 + 0.8 * sin(π*t)^0.5`，最小值是 **0.2**。

所以即使 taper=1，中间宽度是 1.0，宽度最小也只能降到 **0.2 × baseWidth**，无法真正尖头。

### 另外的问题

[`BrushKernelSpec.evaluateCPU()`](src/core/brush/BrushKernelSpec.ts:285)：

```typescript
const inkW = Math.max(0.1, brush.size * P * V * E);
```

这个 `Math.max(0.1, ...)` 也限制了最小宽度。

### PS 的做法

PS 的笔宽可以降到 **0**（真正尖头），起笔从无到有，收笔从有到无：

```text
pressure: 0 → 0.2 → 0.6 → 0.9 → 1.0 → 0.8 → 0.3 → 0
width:    0 → 0.2w → 0.6w → 0.9w → 1.0w → 0.8w → 0.3w → 0
```

---

## 6. 问题六：GPU Shader 过于简陋

### 现状

[`GPUStampRenderer`](src/core/gpu/GPUStampRenderer.ts) 的 shader 对比：

| 功能 | 当前 | PS 级别 |
|------|------|---------|
| 边缘 | 硬裁剪（`if(d>1)discard`） | smoothstep falloff |
| 软度参数 | 无 | hardness 控制 core/feather 比例 |
| 压力控制 | stamp 级 opacity | 像素级 pressure * alpha |
| 纹理 | 纯色 | 支持 noise/grain/纸纹 |
| 混合 | ONE, ONE_MINUS_SRC_ALPHA | 可编程 blend mode |

### Fragment Shader 的简单软边实现

```glsl
// 当前（第 124-137 行）：
float d = length(v_localCoord);
if (d > 1.0) discard;
float alpha = v_opacity;

// 需要的：
float d = length(v_localCoord);
float hardness = 0.3; // 来自 spec
float coreR = hardness; // 核心完全不透明
float feather = 1.0 - coreR; // 羽化区
float alpha = 1.0 - smoothstep(coreR, 1.0, d); // hermite falloff
alpha *= v_opacity;
```

---

## 7. 问题七：Catmull-Rom 压力插值缺失

### 现状

[`smoothPoints()`](src/core/render/StrokeGeometryEngine.ts:139-141) 做 Catmull-Rom 插值时，压力只用线性插值：

```typescript
const interpT = s / (subSteps + 1);
const pressure = (p1.pressure ?? 0.5) * (1 - interpT) + (p2.pressure ?? 0.5) * interpT;
```

而位置用的是 4 点 Catmull-Rom，两者不一致。压力应该也使用 Catmull-Rom 插值以保证压力曲线的平滑度与位置曲线一致。

---

## 8. 问题八：两条并行渲染路径导致不一致

### 现状

系统中有 **两条渲染路径**：

```
                                    ┌→ StrokeGeometryEngine.buildStrokeGeometry()
Input → CoordinateInputSystem ─────┤      ↓
                                    │  Mesh + Caps (用于 preview)
                                    │
                                    └→ BrushKernel.evaluate() → StampBuffer
                                           ↓
                                      GPUStampRenderer (用于 final)
```

而 [`InkFieldRenderer`](src/core/gpu/InkFieldRenderer.ts:49-72) 又实现了一套独立的 mesh 构建（`buildStrokeMesh`），用固定宽度 `HALF_WIDTH = 2.0`。

这意味着至少有 **三条** 不同的渲染路径，输出必然不一致。

---

## 9. 汇总表

| # | 问题 | 严重程度 | 关键代码位置 |
|---|------|---------|-------------|
| 1 | Stamp 模型 → 香肠形笔触 | 🔴 致命 | [`drawStampStroke()`](src/core/render/StrokeGeometryEngine.ts:599) |
| 2 | 软边是线性渐变而非 smoothstep | 🔴 致命 | [`BrushTipTexture.generateSoftRound()`](src/core/render/BrushTipTexture.ts:28-32) |
| 3 | GPU shader 无软边（硬裁剪） | 🔴 致命 | [`GPUStampRenderer`](src/core/gpu/GPUStampRenderer.ts:124-137) |
| 4 | 毛笔刷毛是随机点而非连续纤维 | 🔴 致命 | [`generateBristle()`](src/core/render/BrushTipTexture.ts:57-107) |
| 5 | Flow 是固定 alpha 而非累积 | 🟡 重要 | [`drawStampStroke()`](src/core/render/StrokeGeometryEngine.ts:619) |
| 6 | Anti-needle 阻止真正尖头 | 🟡 重要 | [`computeWidths()`](src/core/render/StrokeGeometryEngine.ts:219-221) |
| 7 | GPU Stroke Ribbon shader 有 bug | 🟡 重要 | [`GPUStampRenderer`](src/core/gpu/GPUStampRenderer.ts:167-177) |
| 8 | Catmull-Rom 压力仅线性插值 | 🟢 次要 | [`smoothPoints()`](src/core/render/StrokeGeometryEngine.ts:141) |
| 9 | 三条独立渲染路径不一致 | 🟡 重要 | [`InkFieldRenderer`](src/core/gpu/InkFieldRenderer.ts:49-72) |
| 10 | Bristle 纹理生成非确定性 | 🟢 次要 | [`generateBristle()`](src/core/render/BrushTipTexture.ts:73) 使用 `Math.random()` |
| 11 | `evaluateCPU()` 最小宽度限制 0.1 | 🟢 次要 | [`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts:285) |
| 12 | InkMaterialSystem 未实际连接渲染管线 | 🟡 重要 | [`InkMaterialSystem.ts`](src/core/material/InkMaterialSystem.ts:147) |

---

## 10. 架构升级方向

如果目标是从：

```text
○○○○○○○
```

变成：

```text
<══════>
```

需要以下架构升级：

1. **统一渲染模型**：放弃 stamp 路径，统一走 `buildStrokeGeometry()` 的 mesh 路径
2. **Mesh 软边**：在 vertex 中编码 distance-to-edge，在 fragment shader 中做 smoothstep falloff，支持 hardness 参数
3. **Flow 累积**：用 frame-buffer 级别的混合（而不是 stamp 级），`dst = dst + src * flow * (1 - dst)`
4. **刷毛系统**：每根刷毛是独立连续路径，非随机噪点
5. **压力曲线**：移除 anti-needle，允许宽度降到 0，压力 Catmull-Rom 插值
6. **GPU**：统一 WebGL2 管线，vertex shader 生成 mesh，fragment shader 做软边 + 纸纹

详细设计参考已有文档 [`plans/ps-brush-engine-design.md`](plans/ps-brush-engine-design.md)，但需要从 stamp 思路升级到 mesh + shader 思路。
