# Online HWR 实施清单

## 前提
- [ ] 用户审批本方案
- [ ] 切换到 Code 模式实施

## 实施步骤
- [ ] **Step 1**: 创建 [`HwrFeatureExtractor.ts`](src/core/beautify/HwrFeatureExtractor.ts)
  - `extractFeatures(strokes, bbox)` → `HwrCharacterFeatures`
  - 每笔 16 维特征提取（方向链码、包围盒、弯曲度等）
  - 归一化到相对坐标系
- [ ] **Step 2**: 创建 [`HwrFeatureDB.ts`](src/core/beautify/HwrFeatureDB.ts)
  - 基于 `CHAR_STROKES` 字典生成特征库
  - 使用 canvas font rendering 提取标准字形特征
  - Float32Array 存储，~2MB
- [ ] **Step 3**: 创建 [`HwrEngine.ts`](src/core/beautify/HwrEngine.ts)
  - 笔画数过滤 → 宽高比过滤 → 加权欧氏距离评分
  - `match(strokes, bbox)` → Top-3 候选
  - 阈值 `score > 0.35` 接受，否则 fallback
- [ ] **Step 4**: 集成到 [`RedrawOrchestrator.ts`](src/core/beautify/RedrawOrchestrator.ts)
  - 替换 PaddleOCR 路径为 HwrEngine
  - 保留图片匹配作为二级 fallback
- [ ] **Step 5**: 清理废弃代码
  - 移除 `paddleocr`, `onnxruntime-web` 依赖
  - 移除 `PaddleEngine.ts`, `ModelAssets.ts` 中相关部分
  - 移除 `ort.min.js`, `ort-wasm*.wasm`, `*.onnx` 等大文件
- [ ] **Step 6**: 编译 + 测试

## 预期效果
- main.js 从 45MB 降至 ~2MB
- 识别速度从 ~500ms 降至 ~5ms
- 手写识别准确率预期 70-80%
- 零网络依赖，零运行时二进制文件
