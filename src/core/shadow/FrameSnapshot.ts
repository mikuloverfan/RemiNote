// ============================================================
//  Shadow Render Layer — FrameSnapshot
//  
//  职责：
//  ✔ 从 main.ts CanvasSession 捕获渲染输入的只读快照
//  ✔ 所有数据深拷贝，不共享任何引用
//  ✔ Object.freeze 全链路不可变
//  ✔ 零副作用 — 不触发任何 Observer / Proxy / getter
//
//  约束：
//  ❌ 不修改 main.ts 任何对象
//  ❌ 不持有原始引用（engine.strokes / camera / params）
//  ❌ 不触发任何副作用
// ============================================================

// ============================================================
//  Types — 从 main.ts 提取的 minimal 接口（不依赖 main.ts 类型）
// ============================================================

/** 冻结的 2D 点 */
export interface FrozenPoint {
  readonly x: number;
  readonly y: number;
}

/** 冻结的 stroke 快照（仅渲染所需字段） */
export interface FrozenStroke {
  readonly id: string;
  readonly points: readonly FrozenPoint[];
  readonly color: string;
  readonly width: number;
  readonly _penParams?: {
    readonly spacing: number;
    readonly smoothness: number;
    readonly strokeWidth: number;
    readonly cornerKeep: number;
  };
}

/** 冻结的相机状态 */
export interface FrozenCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** 冻结的笔刷参数 */
export interface FrozenBrushParams {
  readonly spacing: number;
  readonly smoothness: number;
  readonly strokeWidth: number;
  readonly cornerKeep: number;
}

/** 单帧渲染输入的完整冻结快照 */
export interface FrameSnapshot {
  /** 单调递增帧序号 */
  readonly frameId: number;
  /** 已提交的 strokes（深拷贝） */
  readonly strokes: readonly FrozenStroke[];
  /** 当前正在绘制的预览 stroke（可能为 null） */
  readonly previewStroke: FrozenStroke | null;
  /** 冻结的相机状态 */
  readonly camera: FrozenCamera;
  /** 冻结的笔刷参数 */
  readonly brushParams: FrozenBrushParams;
  /** 捕获时间戳 (performance.now) */
  readonly capturedAt: number;
  /** 创建此快照的帧标记（供 trace） */
  readonly _sourceFrame: number;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_BRUSH_PARAMS: FrozenBrushParams = {
  spacing: 3,
  smoothness: 0.5,
  strokeWidth: 2,
  cornerKeep: 0.3,
};

// ============================================================
//  Pure helpers — 深拷贝 + freeze
// ============================================================

/** 深拷贝单个点 */
function freezePoint(p: { x: number; y: number }): FrozenPoint {
  return Object.freeze({ x: p.x, y: p.y });
}

/** 深拷贝 points 数组 */
function freezePoints(
  pts: readonly { x: number; y: number }[] | undefined | null,
): readonly FrozenPoint[] {
  if (!pts) return Object.freeze([]);
  return Object.freeze(pts.map(p => freezePoint(p)));
}

/** 深拷贝单个 stroke */
function freezeStroke(s: {
  id: string;
  points?: readonly { x: number; y: number }[];
  color?: string;
  width?: number;
  _penParams?: {
    spacing?: number;
    smoothness?: number;
    strokeWidth?: number;
    cornerKeep?: number;
  };
}): FrozenStroke {
  const penParams = s._penParams;
  return Object.freeze({
    id: s.id,
    points: freezePoints(s.points ?? []),
    color: s.color ?? '#000000',
    width: s.width ?? 2,
    _penParams: penParams ? Object.freeze({
      spacing: penParams.spacing ?? 3,
      smoothness: penParams.smoothness ?? 0.5,
      strokeWidth: penParams.strokeWidth ?? 2,
      cornerKeep: penParams.cornerKeep ?? 0.3,
    }) : undefined,
  });
}

/** 深拷贝 strokes 数组 */
function freezeStrokes(
  strokes: ReadonlyArray<{
    id: string;
    points?: readonly { x: number; y: number }[];
    color?: string;
    width?: number;
    _penParams?: {
      spacing?: number;
      smoothness?: number;
      strokeWidth?: number;
      cornerKeep?: number;
    };
  }> | undefined | null,
): readonly FrozenStroke[] {
  if (!strokes) return Object.freeze([]);
  return Object.freeze(strokes.map(s => freezeStroke(s)));
}

/** 深拷贝 camera */
function freezeCamera(c: {
  x?: number;
  y?: number;
  zoom?: number;
}): FrozenCamera {
  return Object.freeze({
    x: c.x ?? 0,
    y: c.y ?? 0,
    zoom: c.zoom ?? 1,
  });
}

/** 深拷贝 brush params */
function freezeBrushParams(p: {
  spacing?: number;
  smoothness?: number;
  strokeWidth?: number;
  cornerKeep?: number;
} | undefined | null): FrozenBrushParams {
  if (!p) return Object.freeze({ ...DEFAULT_BRUSH_PARAMS });
  return Object.freeze({
    spacing: p.spacing ?? DEFAULT_BRUSH_PARAMS.spacing,
    smoothness: p.smoothness ?? DEFAULT_BRUSH_PARAMS.smoothness,
    strokeWidth: p.strokeWidth ?? DEFAULT_BRUSH_PARAMS.strokeWidth,
    cornerKeep: p.cornerKeep ?? DEFAULT_BRUSH_PARAMS.cornerKeep,
  });
}

// ============================================================
//  captureFrameSnapshot — 唯一捕获入口
// ============================================================

let _frameIdCounter = 0;

/**
 * 从 main.ts CanvasSession 的状态中捕获一帧的渲染输入快照。
 *
 * 调用时机：在 main.ts renderFrame() 完成后调用。
 * 调用方传入 CanvasSession 的只读视图。
 *
 * 复杂度：O(n strokes × m points) — 深拷贝所有数据。
 * 不做任何 Path2D / render / cache 构建。
 *
 * @param params 需要从 CanvasSession 读取的数据（调用方提供）
 * @returns 完全不可变的 FrameSnapshot
 */
export function captureFrameSnapshot(params: {
  /** engine.strokes — 已提交的 strokes 数组 */
  strokes: ReadonlyArray<{
    id: string;
    points?: readonly { x: number; y: number }[];
    color?: string;
    width?: number;
    _penParams?: {
      spacing?: number;
      smoothness?: number;
      strokeWidth?: number;
      cornerKeep?: number;
    };
  }>;
  /** inputSnapshot.previewStroke — 当前预览 stroke（可能 null） */
  previewStroke: {
    id: string;
    points?: readonly { x: number; y: number }[];
    color?: string;
    width?: number;
    _penParams?: {
      spacing?: number;
      smoothness?: number;
      strokeWidth?: number;
      cornerKeep?: number;
    };
  } | null;
  /** viewport.camera */
  camera: { x: number; y: number; zoom: number };
  /** engine.params */
  brushParams: {
    spacing: number;
    smoothness: number;
    strokeWidth: number;
    cornerKeep: number;
  };
}): FrameSnapshot {
  const frameId = ++_frameIdCounter;

  const snapshot: FrameSnapshot = {
    frameId,
    strokes: freezeStrokes(params.strokes),
    previewStroke: params.previewStroke
      ? freezeStroke(params.previewStroke)
      : null,
    camera: freezeCamera(params.camera),
    brushParams: freezeBrushParams(params.brushParams),
    capturedAt: performance.now(),
    _sourceFrame: frameId,
  };

  return Object.freeze(snapshot) as FrameSnapshot;
}

// ============================================================
//  Convenience: 快捷构造（用于测试 / 非 main.ts 场景）
// ============================================================

/**
 * 从 Stroke[] 数组直接构造 FrameSnapshot（不依赖 CanvasSession）。
 * 用于单元测试 / 回放 / 离线分析。
 */
export function createSnapshotFromStrokes(
  strokes: ReadonlyArray<{
    id: string;
    points: { x: number; y: number }[];
    color?: string;
    width?: number;
    _penParams?: FrozenStroke['_penParams'];
  }>,
  camera?: Partial<FrozenCamera>,
  brushParams?: Partial<FrozenBrushParams>,
): FrameSnapshot {
  return captureFrameSnapshot({
    strokes: strokes as any,
    previewStroke: null,
    camera: { x: camera?.x ?? 0, y: camera?.y ?? 0, zoom: camera?.zoom ?? 1 },
    brushParams: {
      spacing: brushParams?.spacing ?? DEFAULT_BRUSH_PARAMS.spacing,
      smoothness: brushParams?.smoothness ?? DEFAULT_BRUSH_PARAMS.smoothness,
      strokeWidth: brushParams?.strokeWidth ?? DEFAULT_BRUSH_PARAMS.strokeWidth,
      cornerKeep: brushParams?.cornerKeep ?? DEFAULT_BRUSH_PARAMS.cornerKeep,
    },
  });
}

export type { FrameSnapshot as FrameSnapshotType };
