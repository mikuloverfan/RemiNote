# PS 级笔刷引擎架构设计

## 为什么所有尝试都失败了

| 尝试 | 为什么像"伸缩棍/香肠" |
|------|---------------------|
| Mesh + Cap | 三角网身体 + 硬接半圆 cap → 接缝感 |
| Stamp chain (径向渐变) | 完美平滑的渐变 → 每个圆都是"光滑管子" |
| Bell curve 宽度 | 宽度变化再连续, 边缘还是光滑 → "香肠" |

**核心问题**: 我们一直在改变"宽度轮廓", 但 PS 笔刷的"毛笔感"不在于宽度曲线, 而在于 **笔尖纹理 (brush tip texture)**。

## PS 笔刷引擎的真正工作原理

```
PS 笔刷 = 笔尖纹理 (grayscale image) × 沿路径密集打点
         × 形状动态 (size/angle/opacity jitter)
         × 混合模式 (multiply for ink buildup)
```

### PS 的四层架构

```
┌─────────────────────────────────────────────┐
│ Layer 1: Brush Tip Shape (笔尖形状)         │
│   - 不是圆形！是一张灰度贴图                 │
│   - 默认圆头 = 高斯模糊的软圆盘              │
│   - 纹理笔刷 = 任意灰度图案                  │
├─────────────────────────────────────────────┤
│ Layer 2: Shape Dynamics (形状动态)           │
│   - 每个 stamp: size ± 抖动                 │
│   - 每个 stamp: angle ± 抖动                │
│   - 每个 stamp: opacity ± 抖动              │
│   - 每个 stamp: position 微偏移              │
├─────────────────────────────────────────────┤
│ Layer 3: Dual Brush (双重笔刷)              │
│   - 两个笔尖纹理叠加产生复杂肌理              │
│   - 模拟毛笔分叉/散锋效果                   │
├─────────────────────────────────────────────┤
│ Layer 4: Texture & Transfer (纹理)           │
│   - 纸纹叠加                                │
│   - 不透明度/流量随压力变化                  │
│   - 湿边效果                                │
└─────────────────────────────────────────────┘
```

### 为什么我们的 stamp chain 不像 PS

```
我们的方案:
  ● ● ● ● ● ● ●  ← 完美圆滑的径向渐变圆
  每个圆: 100%均匀 → 边缘光滑 fade
  结果: 像一根光滑的橡胶管

PS 的方案:
  ✦ ✦ ✦ ✦ ✦ ✦ ✦  ← 每片笔尖都有内部纹理
  每个贴图: 灰度图案, 有暗区/亮区/噪点
  结果: 像毛笔分叉的有肌理笔触
```

## 正确架构: 纹理笔尖 + 密集打点

### 核心思想

不再用数学公式（径向渐变）生成笔尖，而是**预生成一张灰度纹理**作为笔尖贴图，然后沿路径密集 stamp 这张贴图。

### 笔尖纹理生成 (Brush Tip Texture)

```typescript
// 预设几种笔尖纹理
type TipTexture = 'soft-round' | 'hard-round' | 'bristle' | 'flat-calligraphy'

// soft-round: 32×32 高斯模糊圆盘
// hard-round: 32×32 圆盘, 边缘锐利
// bristle:    32×32 区域随机撒 5-8 个黑点, 模拟毛笔分叉
// flat-calligraphy: 32×32 椭圆, 模拟扁平笔头
```

### 渲染流程

```
for each point along smoothed path:
  1. 确定 stamp 中心 = point.x, point.y
  2. 确定 stamp 大小 = width[i] × tipScale
  3. 确定 stamp 方向 = 笔画局部切线方向
  4. 添加 jitter: position ±0.3px, size ±5%, angle ±3°
  5. ctx.save() → translate → rotate → scale → drawImage(tipTexture)
  6. ctx.restore()
```

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| Stamp 间距 | 0.5-1.0px | 极密集，保证无缝 |
| Tip 贴图大小 | 32×32 | 高频足够了 |
| Position jitter | ±0.3px | 模拟手抖 |
| Size jitter | ±5% | 模拟笔压不稳 |
| Angle jitter | ±3° | 模拟笔杆旋转 |
| Blend mode | multiply | 墨水堆积 |

### 软圆笔尖的生成

```typescript
function generateSoftRoundTip(size: number): CanvasImageSource {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  
  // 径向渐变: 不透明中心 → 透明边缘
  const cx = size / 2, cy = size / 2, r = size / 2;
  const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  g.addColorStop(0, 'black');
  g.addColorStop(0.7, 'black');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  
  return c;
}
```

### 刷毛笔尖的生成 (这才是毛笔感的关键！)

```typescript
function generateBristleTip(size: number, bristleCount: number): CanvasImageSource {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2, cy = size / 2;
  
  // 在圆形区域内随机撒点, 模拟刷毛
  for (let i = 0; i < bristleCount; i++) {
    // 偏高斯分布: 多数在中心, 少数在边缘
    const angle = Math.random() * Math.PI * 2;
    const dist = gaussianRandom() * size * 0.35; // 偏中心
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const br = 0.4 + Math.random() * 1.2; // 0.4-1.6px 宽
    
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = 'black';
    ctx.fill();
  }
  
  return c;
}
```

### 为什么这样就能模拟毛笔

毛笔的笔迹不是一根均匀的管子，而是一束纤维（刷毛）在纸上拖过的痕迹：
- 纤维之间有空隙 → 笔触边缘有飞白
- 纤维弯曲/分叉 → 中央暗、边缘有纹理
- 纤维方向随运笔 → 沿笔画方向的纹理

用 `bristle` 笔尖 stamp 链模拟的正是这个效果：每个 stamp 都是一小撮纤维的印记，密集 stamp 后它们连成一片，边缘自然有肌理。

## 性能分析

| 项目 | 当前 (radial gradient stamps) | 新方案 (pre-generated tip image) |
|------|------------------------------|----------------------------------|
| 每个 stamp 的 draw call | `createRadialGradient()` + `fill()` | `drawImage()` |
| 成本 | ~0.05ms per stamp | ~0.002ms per stamp |
| 1000 stamp 的帧成本 | ~50ms (无法 60fps) | ~2ms (60fps 可行) |
| 纹理质量 | 完美光滑 | 可配, 可选, 可变 |

用 `drawImage(tipCanvas, x, y, w, h)` 替代 `createRadialGradient` 每帧省 10-20×。

## 实施计划 (最小可行 PS 级别)

### Phase 1: Pre-generated Tip Texture
- 新建 `BrushTipTexture.ts`
- 实现 `generateSoftRound()` 和 `generateBristle()` 
- 缓存生成的 Canvas 对象

### Phase 2: Stamped Stroke Renderer v2
- 重写 `drawStampStroke()`: 
  - 使用 `drawImage(tipTexture)` 替代 `createRadialGradient`
  - Stamp 间距改为 0.8px
  - 每个 stamp 加 position/size/angle jitter

### Phase 3: Connect to Render Pipeline
- 替换 `ShadowRenderer._drawStampStroke()` 使用新版
- 保持 `StrokeBatchRenderer` 的 multiply blend 用于实时绘制

### 改动范围

| 文件 | 改动 |
|------|------|
| 新建 `BrushTipTexture.ts` | 笔尖纹理生成 |
| [`StrokeGeometryEngine.ts`](src/core/render/StrokeGeometryEngine.ts) | 重写 `drawStampStroke` |
| [`ShadowRenderer.ts`](src/core/shadow/ShadowRenderer.ts) | 更新调用 |
