# PS 笔刷引擎修复实施计划

> 基于审查报告 [`docs/fix/BRUSH_ENGINE_REVIEW.md`](docs/fix/BRUSH_ENGINE_REVIEW.md)
> 目标：在不推翻架构的前提下，最大化视觉效果提升

---

## 修复策略

```
当前渲染数据流:
  Input → CoordinateInputSystem → BrushKernel.evaluateCPU()
    ↓                                     ↓
  SmoothPoint (Catmull-Rom)        StampBuffer (x,y,radius,opacity,color)
    ↓                                     ↓
  computeWidths (bell curve)        GPUStampRenderer (instanced quads)
    ↓                                     ↓
  drawStampStroke (CPU stamp)       fragment shader (硬边裁剪 ❌)
    OR
  buildStrokeGeometry (CPU mesh)
```

核心问题：GPU 路径 (`GPUStampRenderer`) 的 fragment shader 是硬边裁剪，且没有利用 `tipHardness` 参数。

---

## 第一阶段：快速修复（Tier 1 — 零架构改动，高视觉回报）

### Fix 1: GPU Fragment Shader 添加 smoothstep 软边

**文件**: [`src/core/gpu/GPUStampRenderer.ts`](src/core/gpu/GPUStampRenderer.ts)

**现状** (第 124-137 行):
```glsl
void main() {
    float d = length(v_localCoord);
    if (d > 1.0) discard;
    float alpha = v_opacity;
    fragColor = vec4(v_color * alpha, alpha);
}
```

**修复**: 添加 `a_hardness` 实例属性 + `smoothstep` 羽化

```glsl
// 新增 per-instance attribute
in float a_hardness;  // 0=soft, 1=hard

void main() {
    float d = length(v_localCoord);
    if (d > 1.0) discard;
    
    // PS-style hardness curve:
    // hardness=0 → soft, full feather from center to edge
    // hardness=1 → hard, only 2px feather at edge
    float core = a_hardness * 0.85;  // core opaque radius
    float feather = 1.0 - core;
    float alpha = 1.0 - smoothstep(core, core + feather, d);
    alpha *= v_opacity;
    
    fragColor = vec4(v_color * alpha, alpha);
}
```

**同步修改**:
- GPU stride 从 7 → 8 (新增 `hardness` float)
- `_setupGeometry()` 添加 `a_hardness` attribute binding
- `draw()` 上传 `hardness` 到 CPU buffer

---

### Fix 2: computeWidths — 移除 anti-needle，允许真正尖头

**文件**: [`src/core/render/StrokeGeometryEngine.ts`](src/core/render/StrokeGeometryEngine.ts)

**现状** (第 219-221 行):
```typescript
const minWidth = Math.max(0.3, baseWidth * 0.06);
raw[0] = Math.max(raw[0], minWidth);
if (n > 1) raw[n - 1] = Math.max(raw[n - 1], minWidth);
```

**修复**: 改为渐变到接近 0，允许真正的"尖"

```typescript
// 起笔：从 0 开始渐入（而非从 minWidth 跳变）
// 对前几个点做更激进的 taper
if (n > 3) {
  const fadeInPct = 0.06; // 前 6% 渐入
  const fadeInEnd = Math.max(2, Math.floor(n * fadeInPct));
  for (let i = 0; i < fadeInEnd; i++) {
    const t = i / fadeInEnd; // 0→1
    // smoothstep fade-in: 从接近 0 到 1
    const fade = t * t * (3 - 2 * t); // smoothstep
    raw[i] *= fade;
  }
}

// 同理收笔：末尾 8% 渐出到接近 0
if (n > 3) {
  const fadeOutPct = 0.08;
  const fadeOutStart = n - Math.max(2, Math.floor(n * fadeOutPct));
  for (let i = fadeOutStart; i < n; i++) {
    const t = (n - 1 - i) / (n - fadeOutStart); // 1→0
    const fade = t * t * (3 - 2 * t);
    raw[i] *= fade;
  }
}

// 保留极小的 minWidth 避免完全消失 (0.05px)
const absMin = Math.max(0.05, baseWidth * 0.01);
raw[0] = Math.max(raw[0], absMin);
if (n > 1) raw[n - 1] = Math.max(raw[n - 1], absMin);
```

---

### Fix 3: BrushTipTexture — 改进 soft-round falloff 曲线

**文件**: [`src/core/render/BrushTipTexture.ts`](src/core/render/BrushTipTexture.ts)

**现状** (第 28-32 行):
```typescript
g.addColorStop(0, 'rgba(0,0,0,1)');
g.addColorStop(0.6, 'rgba(0,0,0,0.95)');
g.addColorStop(0.85, 'rgba(0,0,0,0.5)');
g.addColorStop(1, 'rgba(0,0,0,0)');
```

**修复**: 使用多段色标模拟 smoothstep 曲线

```typescript
// PS-style hardness falloff with plateau + feather
// hardness=0.3 (default soft brush):
//   core(0-0.15): alpha=1.0 (plateau)
//   transition(0.15-0.85): smoothstep falloff
//   feather(0.85-1.0): soft fade to 0
g.addColorStop(0, 'rgba(0,0,0,1)');
g.addColorStop(0.15, 'rgba(0,0,0,1)');      // plateau
g.addColorStop(0.4, 'rgba(0,0,0,0.95)');
g.addColorStop(0.65, 'rgba(0,0,0,0.75)');
g.addColorStop(0.85, 'rgba(0,0,0,0.3)');
g.addColorStop(0.95, 'rgba(0,0,0,0.05)');
g.addColorStop(1, 'rgba(0,0,0,0)');
```

同时修改 `generateSoftRound()` 接受 `hardness` 参数：
```typescript
function generateSoftRound(hardness: number = 0.3): CanvasImageSource {
  const coreR = hardness * 0.7;  // 0..0.7
  // plateau from 0 to coreR
  // feather from coreR to 1.0
}
```

---

### Fix 4: Catmull-Rom 压力插值采用 4 点插值

**文件**: [`src/core/render/StrokeGeometryEngine.ts`](src/core/render/StrokeGeometryEngine.ts)

**现状** (第 139-141 行):
```typescript
const interpT = s / (subSteps + 1);
const pressure = (p1.pressure ?? 0.5) * (1 - interpT) + (p2.pressure ?? 0.5) * interpT;
```

**修复**: 使用与位置相同的 Catmull-Rom 基函数插值压力

```typescript
// 使用相同 Catmull-Rom basis
const p0p = p0.pressure ?? 0.5, p1p = p1.pressure ?? 0.5;
const p2p = p2.pressure ?? 0.5, p3p = p3.pressure ?? 0.5;

const pressure = 0.5 * (
  (2 * p1p) +
  (-p0p + p2p) * t +
  (2 * p0p - 5 * p1p + 4 * p2p - p3p) * t2 +
  (-p0p + 3 * p1p - 3 * p2p + p3p) * t3
);
```

---

### Fix 5: Bristle 纹理确定性生成

**文件**: [`src/core/render/BrushTipTexture.ts`](src/core/render/BrushTipTexture.ts)

**现状** (第 72-104 行): 使用 `Math.random()`

**修复**: 用 deterministic seed-based 伪随机替代

```typescript
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function generateBristle(seed: number = 42): CanvasImageSource {
  const rand = seededRandom(seed);
  // ... 所有 Math.random() 替换为 rand()
}
```

---

## 第二阶段：中等改动（Tier 2 — 增强表现力）

### Fix 6: Flow 累积 — GPU 混合模式改进

**文件**: [`src/core/gpu/GPUStampRenderer.ts`](src/core/gpu/GPUStampRenderer.ts)

**现状** (第 289-290 行):
```glsl
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
```

**修复**: 添加 flow 参数的 uniform，在 fragment shader 中动态调整 alpha

```glsl
uniform float u_flow; // 0=no accumulation, 1=max buildup

void main() {
    // ... soft edge calculation ...
    
    // Flow accumulation: lower alpha = more passes needed for full opacity
    float flowAlpha = alpha * (1.0 - u_flow * 0.7); // 0.3~1.0 range
    fragColor = vec4(v_color * flowAlpha, flowAlpha);
}
```

### Fix 7: InkMaterialSystem 连接到渲染管线

**文件**: 在 `GPUStampRenderer.draw()` 或 stamp 构建阶段应用 `edgeSoftness`

**要点**: 在构建 `GPUStamp` 时将 `InkMaterialSystem.edgeSoftness(pressure)` 的结果编码到 opacity 中

### Fix 8: 清理/修复 Stroke Ribbon Shader

**文件**: [`src/core/gpu/GPUStampRenderer.ts`](src/core/gpu/GPUStampRenderer.ts) (第 144-177 行)

**选项 A**: 修复 bug（添加缺失 uniform，正确计算 center distance）
**选项 B**: 移除（当前未被使用），待 mesh 架构升级时重新实现

**建议**: 选项 B — 移除未使用的 broken code

---

## 第三阶段：架构升级（Tier 3 — 后续大版本）

### Fix 9: GPU 路径从 Stamp 升级为 Mesh

核心思路：让 `GPUStampRenderer` 不再渲染 instanced quads，而是：
1. 消费 `buildStrokeGeometry()` 的输出（`vertices` + `indices`）
2. Vertex shader: 直接使用 mesh 顶点（不做 per-instance 变换）
3. Fragment shader: 用 distance-to-edge（vertex attribute 编码）做 smoothstep 软边

这需要新的 `GPUMeshRenderer` 类，与现有 `GPUStampRenderer` 共存。

### Fix 10: 刷毛纤维系统

参考方案：
- 每个笔刷定义 5-12 根"虚拟刷毛"（offset + width + noiseSeed）
- 每根刷毛沿路径独立生成 sub-path
- 每根刷毛的宽度受 pressure 调制
- 在 GPU 中每根刷毛渲染为独立 thin stroke

---

## 实施顺序

```
第一阶段 (本次):
  Fix 1: GPU shader soft edge          ← 🔴 最高优先级
  Fix 2: computeWidths 真正尖头        ← 🔴 最高优先级
  Fix 3: BrushTipTexture falloff       ← 🟡 影响 CPU shadow 路径
  Fix 4: Catmull-Rom 压力插值          ← 🟢 精度提升
  Fix 5: Bristle 确定性                ← 🟢 正确性修复

第二阶段 (后续):
  Fix 6: Flow 累积
  Fix 7: InkMaterialSystem 连接
  Fix 8: 清理 broken shader

第三阶段 (架构):
  Fix 9: GPU mesh 路径
  Fix 10: 刷毛纤维
```

---

## 影响范围

| Fix | 文件 | 改动量 |
|-----|------|--------|
| Fix 1 | `GPUStampRenderer.ts` | ~40 行（shader + buffer stride + attribute setup） |
| Fix 2 | `StrokeGeometryEngine.ts` | ~30 行（替换 anti-needle + 平滑 fade） |
| Fix 3 | `BrushTipTexture.ts` | ~20 行（色标调整 + hardness 参数） |
| Fix 4 | `StrokeGeometryEngine.ts` | ~10 行（压力插值公式） |
| Fix 5 | `BrushTipTexture.ts` | ~30 行（seed 随机 + 重构 generateBristle） |

**总计第一阶段**: ~130 行改动，4 文件
