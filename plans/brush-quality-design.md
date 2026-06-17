# 笔刷质量提升方案

> 基于与 PS 笔刷的对比报告，针对四个核心缺陷逐一设计方案。

---

## 问题1：边缘硬边 — 缺乏肌理与抗锯齿

### 根因定位

[`StrokeGeometryEngine.ts`](src/core/render/StrokeGeometryEngine.ts) 的 `drawGeometryToCanvas2D()` (L374-403) 使用 `fill()` 填充纯色三角形，边缘无任何抗锯齿处理。即使 Canvas 2D 有内置 1px 反锯齿，在多三角形拼接处也会出现视觉硬边。

[`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts) 的 `tipHardness` (L56) 目前只影响 `opacity`，不影响边缘渲染方式。

### 方案：三层边缘渲染

```
Layer 1: 核心填充（不透明中心）
Layer 2: 边缘渐变（1-3px 半透明过渡带）
Layer 3: 噪点纹理叠加（噪声点 × 边缘 opacity）
```

**具体实施**：

| 步骤 | 改动位置 | 说明 |
|------|---------|------|
| ① 调整 `tipHardness` 映射 | [`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts) L56 | tipHardness 0.3 → 边缘 3px 软过渡；0.8 → 边缘 1px 硬过渡 |
| ② Canvas 2D shadowBlur | [`StrokeGeometryEngine.ts`](src/core/render/StrokeGeometryEngine.ts) L374 | `ctx.shadowBlur = (1 - tipHardness) * 3` + `shadowColor = fillColor` |
| ③ 添加 2D 噪声纹理 | 新建 `BrushTextureSampler.ts` | 预生成 64×64 灰度噪声图，在边缘透明区域叠加 |

**效果**：tipHardness=0.3 时笔触边缘有柔和羽化，接近 PS "柔边圆"笔刷；=0.8 时接近硬铅笔。

---

## 问题2：三段式结构 — 缺乏自然笔锋

### 根因定位

[`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts) 的 `evaluateCPU()` (L164-192) 的 spatial envelope：

```
E = smoothstep(0, 12, t) * smoothstep(0, 12, totalLen - t)
```

这是固定的 12px 起收笔淡入淡出，导致：
- 起笔：**突然出现**的极细短段（12px 内从 0→1）
- 中段：**恒定宽度**（E=1 的平顶区）
- 收笔：**突然掐断**的极细短段

### 方案：物理启发的宽度曲线

替换固定 smoothstep 为**三参数可调配曲线**：

```
// 当前（固定）
E(t) = smoothstep(0, 12, t) × smoothstep(0, 12, L-t)

// 方案（可配）
E(t) = ease(t/L) × pressureResponse(t, p(t)) × velocityResponse(t, v(t))

其中 ease(x) 支持多种曲线：
  - 'brush'   : sin(x * π/2) ^ 0.7     (毛笔感，起笔缓渐变粗)
  - 'pen'     : x ^ 0.5                   (钢笔感，快速达到全宽)
  - 'pencil'  : step(0.05, x)             (铅笔感，几乎无淡入)
  - 'marker'  : 1 - (1-x)^2               (马克笔，收笔有明显尾迹)
```

**具体实施**：

| 改动 | 位置 | 说明 |
|------|------|------|
| 新增 `widthProfile` 字段 | [`BrushModel.ts`](src/core/brush/BrushModel.ts) L47 | `widthProfile: 'brush' | 'pen' | 'pencil' | 'linear'` |
| 新增 `taperCurve` 字段 | [`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts) L46 | 替换固定的 `envelopeSize` 为 `{ start: number, end: number, curve: string }` |
| 重写 `evaluateCPU` 的 envelope 段 | [`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts) L175-181 | 支持非对称起收笔 + 可变曲线 |

**关键改进**：

- **非对称**：起笔可以慢（毛笔感），收笔可以快（钢笔感）
- **可配长度**：最短 3px，最长 40px（当前固定 12px）
- **曲线形状**：'brush' 起笔慢渐变，模拟"顿笔→提笔"

---

## 问题3：无纹理/无噪声 — 缺乏笔触肌理

### 根因定位

[`BrushModel.ts`](src/core/brush/BrushModel.ts) 只有 7 个字段，全部是数值参数。没有任何纹理或噪声相关字段。

PS 笔刷的核心优势在于：
- **纹理叠加**（Texture）— 模拟纸纹/画布颗粒
- **双重画笔**（Dual Brush）— 两个笔尖复合
- **湿边**（Wet Edges）— 边缘墨水聚集

### 方案：轻量级纹理系统（Canvas 2D 可行）

不引入 WebGL 纹理采样，而是在 Canvas 2D 层面实现三种效果：

#### A. 纸纹颗粒（Paper Grain）

```
渲染流程：
1. 预生成 128×128 灰度噪点纹理（离线，存为 ImageData）
2. 笔触渲染时，在 fill() 之后叠加：
   ctx.globalCompositeOperation = 'source-atop'
   ctx.globalAlpha = 0.08
   用 pattern fill 覆盖笔触区域
3. 颗粒密度由 brush.grainIntensity 控制（0=无颗粒, 1=强颗粒）
```

#### B. 笔尖形状多样化（Tip Shape）

当前所有笔刷都是圆形笔尖。扩展为：
- `circle` — 圆形（默认）
- `flat` — 平头（椭圆，模拟马克笔/刷子）
- `chisel` — 凿形（菱形，模拟书法笔）

通过 `StrokeGeometryEngine.ts` 的宽度计算实现：
- `circle`：正常
- `flat`：宽度随角度变化，笔杆旋转角 = 0 时最宽
- `chisel`：宽度随角度在菱形对角线变化

#### C. 墨水流体感（Ink Flow）

```
在 BrushKernelSpec 中增加 flow 参数：
  flow: 0 = 即时干燥（当前行为）
  flow: 1 = 墨水流动（笔触内宽度带微小滞后）

实现：用前几个点的宽度做指数移动平均，而不是每个点独立计算
  width[i] = lerp(width_raw[i], width[i-1], 0.85)
```

这模拟了真实墨水在纸上的"惯性"——起笔处墨多，快速移动时墨跟不上。

---

## 问题4：具体绘画痛点修复

### 4.1 短线问题（死蚊子）

**根因**：短笔画中 envelope 12px 占比过大，起笔和收笔几乎占据全部长度。

**方案**：envelope 长度 = `min(12, 笔画总长 × 0.15)`
- 长笔画：仍然 12px（保持笔锋感）
- 短笔画：自动缩小到 15% 总长
- 极短笔画（< 8px）：envelope = 0（不需要 taper）

### 4.2 长弧线呆板

**根因**：中间段 E=1 恒定宽度，没有任何变化。

**方案**：在中段加入**微小的宽度调制**：

```
// 基于正弦波的微宽调制
widthModulation = 1 + sin(t * frequency) * amplitude

frequency = 0.02 / brushSize  (更粗的笔刷调制更慢)
amplitude = 0.03  (极小调制，肉眼不易察觉但能感受到有机感)
```

这给长弧线添加了"微呼吸"，不再像工业图纸。

### 4.3 平放线条突兀

**根因**：水平线和垂直线没有方向区分，起收笔 taper 总是一样。

**方案**：起收笔强度随方向微调：
- 横画：起笔收笔都略强（模拟从左到右的书写习惯）
- 竖画：起笔略弱（模拟从上到下的自然落笔）
- 方向由起笔矢量确定

---

## 实施优先级

| 优先级 | 问题 | 方案 | 改动量 | 效果值 |
|-------|------|------|-------|-------|
| **P0** | 三段式 | 可配宽度曲线 + 非对称起收笔 | 中 | ⭐⭐⭐⭐⭐ |
| **P0** | 边缘硬边 | shadowBlur + tipHardness 映射 | 小 | ⭐⭐⭐⭐⭐ |
| **P1** | 纸纹颗粒 | Canvas pattern + grainIntensity | 小 | ⭐⭐⭐ |
| **P1** | 短线修复 | 自适应 envelope | 小 | ⭐⭐⭐ |
| **P2** | 笔尖形状 | flat/chisel tip shape | 中 | ⭐⭐⭐ |
| **P2** | 墨水流体 | flow 参数 + 宽度移动平均 | 小 | ⭐⭐⭐ |
| **P3** | 长弧线调制 | 微宽正弦调制 | 小 | ⭐⭐ |
| **P3** | 方向感知 taper | 横竖画区别处理 | 小 | ⭐⭐ |

## 涉及的代码文件

| 文件 | 改动范围 |
|------|---------|
| [`BrushModel.ts`](src/core/brush/BrushModel.ts) | 新增 `widthProfile`, `grainIntensity`, `flow`, `tipShape` |
| [`BrushKernelSpec.ts`](src/core/brush/BrushKernelSpec.ts) | 重写 envelope 计算，新增 taper 曲线 |
| [`StrokeGeometryEngine.ts`](src/core/render/StrokeGeometryEngine.ts) | shadowBlur 抗锯齿，宽度调制 |
| 新建 `BrushTextureSampler.ts` | 纹理噪点生成与叠加 |
| [`main.ts`](main.ts) 设置面板 | 新增参数滑块 |
