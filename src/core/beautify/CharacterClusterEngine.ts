// ============================================================
//  Character Cluster Engine — 字级优化（非 OCR）
//
//  Phase 3a:
//  1. 时间聚类 — 基于笔画时间戳分组为"字"
//  2. 比例归一化 — 调整字内笔画到目标宽高比
//  3. 居中对齐 — 笔画整体居中于包围盒
//
//  原则:
//  🎯 不需要 OCR，不需要识别是什么字
//  🎯 只分析"哪些笔画属于同一个图形单元"
//  🎯 纯数学变换，不改变笔画内部结构
// ============================================================

// ============================================================
//  Types
// ============================================================

export interface ClusterStroke {
  /** Stroke ID */
  id: string;
  /** All points of the stroke */
  points: { x: number; y: number; t?: number }[];
  /** Whether this stroke has been modified by clustering */
  _modified?: boolean;
}

export interface CharacterCluster {
  strokes: ClusterStroke[];
  /** Bounding box of all strokes */
  bbox: { x: number; y: number; w: number; h: number };
  /** Geometric centroid */
  cx: number;
  cy: number;
  /** Timestamp of the last stroke in this cluster */
  lastTime: number;
}

export interface ClusterConfig {
  /** Time gap (ms) to split clusters — strokes with gap > this start a new character */
  timeGapMs: number;
  /** Target aspect ratio (w/h). 1.0 = square. 0 = skip normalization. */
  targetAspectRatio: number;
  /** Normalization strength 0-1 */
  normalizeStrength: number;
  /** Center alignment strength 0-1 */
  alignStrength: number;
}

export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  timeGapMs: 500,
  targetAspectRatio: 0,
  normalizeStrength: 0.6,
  alignStrength: 0.5,
};

// ============================================================
//  Public API
// ============================================================

/**
 * Cluster strokes into character groups based on time gaps.
 * Returns clusters in chronological order.
 */
export function clusterStrokes(
  strokes: ClusterStroke[],
  config: ClusterConfig,
): CharacterCluster[] {
  if (strokes.length === 0) return [];

  const clusters: CharacterCluster[] = [];
  let current: ClusterStroke[] = [];

  for (const s of strokes) {
    if (current.length === 0) {
      current.push(s);
      continue;
    }

    const lastTime = getStrokeEndTime(current[current.length - 1]);
    const thisTime = getStrokeStartTime(s);

    if (thisTime - lastTime > config.timeGapMs) {
      // Time gap → new cluster
      clusters.push(buildCluster(current));
      current = [s];
    } else {
      current.push(s);
    }
  }

  if (current.length > 0) {
    clusters.push(buildCluster(current));
  }

  return clusters;
}

/**
 * Apply character-level optimization to all clusters.
 * Modifies stroke points in-place.
 */
export function optimizeClusters(
  clusters: CharacterCluster[],
  config: ClusterConfig,
): void {
  for (const cluster of clusters) {
    if (cluster.strokes.length < 2 && config.targetAspectRatio <= 0) continue;

    // ① Aspect ratio normalization
    if (config.targetAspectRatio > 0 && config.normalizeStrength > 0) {
      normalizeAspectRatio(cluster, config.targetAspectRatio, config.normalizeStrength);
      // Recompute bbox after normalization
      recomputeBBox(cluster);
    }

    // ② Center alignment
    if (config.alignStrength > 0) {
      centerAlign(cluster, config.alignStrength);
    }
  }
}

// ============================================================
//  Internal: Time helpers
// ============================================================

function getStrokeEndTime(s: ClusterStroke): number {
  const pts = s.points;
  if (pts.length === 0) return 0;
  return pts[pts.length - 1].t ?? 0;
}

function getStrokeStartTime(s: ClusterStroke): number {
  const pts = s.points;
  if (pts.length === 0) return 0;
  return pts[0].t ?? 0;
}

// ============================================================
//  Internal: Cluster building
// ============================================================

function buildCluster(strokes: ClusterStroke[]): CharacterCluster {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let lastTime = 0;

  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const et = getStrokeEndTime(s);
    if (et > lastTime) lastTime = et;
  }

  return {
    strokes,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    lastTime,
  };
}

function recomputeBBox(cluster: CharacterCluster): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of cluster.strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  cluster.bbox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  cluster.cx = (minX + maxX) / 2;
  cluster.cy = (minY + maxY) / 2;
}

// ============================================================
//  Algorithm 1: Aspect Ratio Normalization
// ============================================================

/**
 * Adjust all strokes in a cluster to match the target aspect ratio.
 * Expands the shorter dimension about the centroid.
 */
function normalizeAspectRatio(
  cluster: CharacterCluster,
  targetRatio: number,
  strength: number,
): void {
  const { bbox, cx, cy } = cluster;
  if (bbox.w < 1 || bbox.h < 1) return;

  const currentRatio = bbox.w / bbox.h;
  if (Math.abs(currentRatio - targetRatio) < 0.05) return; // Already close

  // Compute scale factors
  let scaleX = 1, scaleY = 1;

  if (currentRatio > targetRatio) {
    // Too wide → compress horizontally
    const targetW = bbox.h * targetRatio;
    scaleX = 1 + (targetW / bbox.w - 1) * strength;
  } else {
    // Too tall → compress vertically
    const targetH = bbox.w / targetRatio;
    scaleY = 1 + (targetH / bbox.h - 1) * strength;
  }

  // Apply scale about centroid
  for (const s of cluster.strokes) {
    for (const p of s.points) {
      p.x = cx + (p.x - cx) * scaleX;
      p.y = cy + (p.y - cy) * scaleY;
    }
    s._modified = true;
  }
}

// ============================================================
//  Algorithm 2: Center Alignment
// ============================================================

/**
 * Move all strokes so the geometric centroid aligns with the bbox center.
 * This fixes drift where strokes are off-center within the character.
 */
function centerAlign(cluster: CharacterCluster, strength: number): void {
  const { bbox, cx, cy } = cluster;
  const bboxCx = bbox.x + bbox.w / 2;
  const bboxCy = bbox.y + bbox.h / 2;

  const offsetX = (bboxCx - cx) * strength;
  const offsetY = (bboxCy - cy) * strength;

  if (Math.abs(offsetX) < 0.5 && Math.abs(offsetY) < 0.5) return;

  for (const s of cluster.strokes) {
    for (const p of s.points) {
      p.x += offsetX;
      p.y += offsetY;
    }
    s._modified = true;
  }

  // Update centroid
  cluster.cx = bboxCx;
  cluster.cy = bboxCy;
}
