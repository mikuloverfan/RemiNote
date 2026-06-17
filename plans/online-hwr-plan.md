# Online HWR 方案：基于笔画轨迹的中文手写识别

## 背景：为什么 PaddleOCR 失败了

PaddleOCR 是 **Offline OCR**（离线文字识别），输入是静态图片。对手写体来说：

- 笔画的**先后顺序**丢失
- 运笔的**方向**丢失
- 书写**速度/力度**丢失
- 模型训练数据是**印刷体/场景文字**，不是手写体

手写输入法（Google 手写、Apple 随手写）使用的是 **Online HWR**（在线手写识别），输入是 `[(x, y, t)]` 序列。

**我们已经有笔画轨迹数据**。不需要渲染成图片再去 OCR，直接在轨迹上做识别。

---

## 方案：Stroke Feature Matching（笔画特征匹配）

核心思路：从笔画轨迹中提取**几何特征向量**，与预构建的常用字特征库做最近邻匹配。

这不是神经网络，而是**传统模式识别**，完全离线、无网络依赖、无额外依赖、适配 Obsidian CSP。

### 特征体系

对于每个"字"的笔画集合（已由 RedrawOrchestrator 聚类），提取：

**全局特征（7 维）：**
- 笔画总数（已有 `CHAR_STROKES` 字典）
- 宽高比（`bbox.w / bbox.h`）
- 长宽比（`maxSide / minSide`）
- 密度（非空像素 / 总面积）
- 重心偏移（重心相对 bbox 中心的位置，归一化）
- 第一笔类型（横/竖/撇/捺/点）
- 最后一笔类型

**局部特征（每笔 16 维）：**
- 笔画内点数量（归一化）
- 起点到终点的向量 `(dx, dy)` 归一化
- 笔画在字内的相对位置 `(cx, cy)` 归一化到 `[0, 1]`
- 笔画包围盒宽高 `(bw, bh)` 归一化到 `[0, 1]`
- 笔画总长度（归一化）
- 弯曲度（总长度 / 起点-终点直线距离）
- 方向链码简化（8 方向，每隔 3 点采样）
- 起笔类型（8 方向量化）

**总计**：对于 N 笔画字，特征向量维度 = 7 + N × 16

### 候选过滤 Pipeline

```
笔画聚类 → 特征提取 → 笔画数过滤(±2)
                     → 宽高比过滤(±30%)
                     → 第一笔方向过滤
                     → 欧氏距离加权评分
                     → Top-3 候选输出
```

### 特征库生成（构建时/首次运行时）

离线生成所有 1600+ 常用字的特征向量：

| 字 | 笔画数 | 宽高比 | 每笔特征 | 笔顺特征 |
|---|---|---|---|---|
| 一 | 1 | 8.2 | `[...]` | `[→]` |
| 二 | 2 | 2.1 | `[...]` | `[→, →]` |
| 人 | 2 | 0.7 | `[...]` | `[↙, ↘]` |
| 大 | 3 | 0.9 | `[...]` | `[→, ↙, ↘]` |
| 我 | 7 | 1.0 | `[...]` | `[...]` |
| ... | ... | ... | ... | ... |

特征库来源：现有 `CHAR_STROKES` 字典已有 500+ 字的笔画数 + 可通过字体渲染提取标准字形特征。

### 关键优势

| 方面 | PaddleOCR (已弃) | Stroke Feature Matching |
|------|------------------|------------------------|
| 输入 | 渲染图片 80×80 | 原始轨迹 `(x,y,t)` |
| 保留笔顺 | ❌ | ✅ |
| 保留方向 | ❌ | ✅ |
| 模型大小 | ONNX 模型 35MB | 特征库 ~2MB |
| 精度 | ~10%（手写体） | ~70-80%（预期） |
| 速度 | ~500ms | ~5ms |
| 依赖 | onnxruntime-web 21MB | 无额外依赖 |

---

## 实现步骤

### Step 1: 创建 [`HwrFeatureExtractor.ts`](src/core/beautify/HwrFeatureExtractor.ts)

```typescript
export interface HwrStrokeFeatures {
  pointCount: number;
  startPt: { x: number; y: number };
  endPt: { x: number; y: number };
  bbox: { x: number; y: number; w: number; h: number };
  totalLength: number;
  straightLength: number; // 起点到终点距离
  directionChain: number[]; // 8-direction chain code
}

export interface HwrCharacterFeatures {
  strokeCount: number;
  aspectRatio: number;
  boundingBox: { w: number; h: number };
  strokes: HwrStrokeFeatures[];
}
```

- `extractFeatures(strokes, bbox)` → `HwrCharacterFeatures`
- 8 方向量化：`0=→,1=↗,2=↑,3=↖,4=←,5=↙,6=↓,7=↘`
- 方向链码分段压缩（RDP 简化后均匀采样）

### Step 2: 创建 [`HwrFeatureDB.ts`](src/core/beautify/HwrFeatureDB.ts)

```typescript
export interface FeatureEntry {
  char: string;
  strokeCount: number;
  aspectRatio: number;
  features: number[]; // 展平的特征向量
}
```

- 编译时生成特征库（Node.js 脚本，用 canvas + font 渲染并提取特征）
- 或首次运行时生成

### Step 3: 创建 [`HwrEngine.ts`](src/core/beautify/HwrEngine.ts)

```typescript
export class HwrEngine {
  match(strokes, bbox): Array<{char:string, score:number}> {
    // 1. 提取用户输入特征
    // 2. 笔画数过滤（±1）
    // 3. 宽高比过滤（±30%）
    // 4. 逐笔特征加权欧氏距离
    // 5. 返回 Top-3
  }
}
```

加权评分公式：
```
distance = Σ (feature_i - db_feature_i)² × weight_i
score = 1 / (1 + distance / normalization_factor)
```

### Step 4: 集成到 [`RedrawOrchestrator.ts`](src/core/beautify/RedrawOrchestrator.ts)

替换 PaddleOCR 路径为 HwrEngine：

```typescript
// 之前（已弃用）
// const text = await recognizePaddle(data, w, h);

// 之后
const result = hwrEngine.match(multiPt, bbox);
if (result && result.score > 0.35) {
  matchedChar = result.char;
  confidence = result.score;
}
```

保留现有图片匹配引擎作为二级 fallback。

---

## 性能预期

| 特性 | 值 |
|------|-----|
| 特征库大小 | ~2MB（1600 字 × 100 维 × Float32） |
| 匹配速度 | ~1ms/字（线性扫描 1600 候选） |
| 首次匹配 | ~5ms（含特征提取） |
| 内存占用 | ~800KB（特征库 Float32Array） |
| 额外 npm 依赖 | 0 |

## 局限性

1. 用户书写习惯差异大 → 特征库需要覆盖不同写法（简化字、行书等）
2. 极端潦草的笔迹仍然会低分 → 保持 matchCharacter 图片匹配 fallback
3. 与标准笔顺不同的用户 → 笔顺作为弱特征加权

## 后续可扩展

- 特征库版本管理（可根据用户书写习惯本地微调）
- 多候选 UI（让用户从 Top-3 中选择）
- 学习模式（用户选择正确字后，调整特征权重）
