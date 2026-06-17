// ============================================================
//  StrokePathFusion — Multi-Stroke Path Merge
//
//  将同一 batch 内空间连续的 stroke 合并为更少的 Path2D，
//  减少 ctx.stroke() 调用次数。
//
//  核心规则：
//  1️⃣ 只允许同 batch 内 fusion（caller 保证 style 一致）
//  2️⃣ 空间连续性：distance(prevEnd, nextStart) < 2px → 合并
//     否则必须拆 path（防止断笔粘连）
//  3️⃣ Path 合并策略：
//     - 首个 stroke: moveTo(firstPoint) + lineTo(all rest)
//     - 连续 stroke: lineTo(all points)
//     - 断点 stroke: moveTo(firstPoint) + lineTo(all rest)
//  4️⃣ stroke 顺序严格保持（不允许 reorder）
//
//  约束：
//  ❌ 不改变视觉输出（lineJoin: 'round' + 高密度点 → 等价）
//  ❌ 不允许丢点
//  ❌ 不允许 smoothing / resample
//  ❌ 不允许跨 batch / 跨 style fusion
// ============================================================

// ============================================================
//  Types
// ============================================================

/** 2D 点 */
interface Point2D {
  x: number;
  y: number;
}

/** 带原始点数据的 batched stroke（供 fusion 使用） */
export interface FusableStroke {
  id: string;
  /** 原始点序列（_sourcePoints），用于提取首尾点 */
  sourcePoints: readonly Point2D[];
  /** 已 resolve 的 Path2D（当无法 fusion 时回退使用） */
  path: Path2D;
}

// ============================================================
//  Constants
// ============================================================

/** 空间连续性阈值（px）— 距离小于此值视为可 fusion */
const FUSION_DISTANCE_THRESHOLD = 2;

// ============================================================
//  Helpers
// ============================================================

/** 计算两点欧几里得距离 */
function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ============================================================
//  StrokePathFusion
// ============================================================

export class StrokePathFusion {
  /**
   * 将同 batch strokes 按空间连续性合并为更少的 Path2D。
   *
   * 算法：
   * 1. 过滤 sourcePoints 不足 1 点的 stroke（退化为无操作）
   * 2. 顺序遍历 strokes，按 distance(prevEnd, nextStart) < 2px 决定合并/拆分
   * 3. 合并后的 path 使用 moveTo + lineTo 构建
   *
   * 边界条件：
   * - 单点 stroke：moveTo + arc（模拟点）
   * - sourcePoints 为空：跳过
   *
   * @param strokes 同 batch 内所有 stroke（caller 保证 style 一致）
   * @returns 合并后的 Path2D 数组（数量 ≤ strokes.length）
   */
  /**
   * Phase 6 Stabilization: 降级为直接返回 cache Path2D。
   *
   * 原实现用 lineTo 从 sourcePoints 重建 Path2D，丢弃了 buildPath2D
   * 生成的 quadraticCurveTo 贝塞尔曲线路径，导致实时绘制与抬笔后
   * 绘制使用不同几何路径。
   *
   * 降级后：fuse 不再重建几何路径，直接透传 stroke.path（即 cache 中的
   * quadraticCurveTo Path2D）。融合能力保留接口但暂不执行合并。
   */
  static fuse(strokes: readonly FusableStroke[]): Path2D[] {
    if (strokes.length === 0) return [];

    const resultPaths: Path2D[] = [];

    for (const stroke of strokes) {
      // 直接使用 cache 中的 Path2D（quadraticCurveTo 版本）
      // 不再从 sourcePoints 用 lineTo 重建
      if (stroke.path instanceof Path2D) {
        resultPaths.push(stroke.path);
      }
    }

    return resultPaths;
  }

  // _appendPoints 保留但不再被 fuse 调用（降级后可移除此方法）
  private static _appendPoints(
    path: Path2D,
    _points: readonly Point2D[],
    _includeMoveTo: boolean,
  ): void {
    // Phase 6: 降级后不再使用，保留方法签名以防外部引用
    void path;
  }
}
