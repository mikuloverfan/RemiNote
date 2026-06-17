// ============================================================
//  GPU Shadow Mirror — StrokeToGPUEncoder
//
//  职责：
//  ✔ FrozenStroke → GPUStrokeBuffer（结构化 SoA 布局）
//  ✔ 归一化管线：world coords → camera-normalized → GPU-ready
//  ✔ 压力/速度/时间归一化
//  ✔ 纯函数 — 无副作用，无 WebGL 依赖
//
//  GPU Buffer Schema (SoA = Structure of Arrays):
//    positions:  Float32Array [x0,y0, x1,y1, ...]  — camera-normalized
//    pressures:  Float32Array [p0, p1, ...]         — 0~1
//    velocities: Float32Array [v0, v1, ...]         — 0~1 normalized
//    times:      Float32Array [t0, t1, ...]         — 0~1 along stroke length
//    brushSize:  number                              — base brush size
//    hardness:   number                              — 0~1
//
//  约束：
//  ❌ 不访问 engine / session / WebGL
//  ❌ 不修改 FrozenStroke
//  ✅ 纯数据转换
// ============================================================

import type { FrameSnapshot, FrozenStroke, FrozenPoint, FrozenCamera, FrozenBrushParams } from '../FrameSnapshot';
import type { StrokeGeometry, StrokeGeometryConfig } from '../../render/StrokeGeometryEngine';

// ============================================================
//  Types
// ============================================================

/** GPU-ready stroke buffer — SoA layout */
export interface GPUStrokeBuffer {
  /** Interleaved [x,y] positions in camera-normalized space */
  positions: Float32Array;
  /** Per-point pressure 0~1 */
  pressures: Float32Array;
  /** Per-point normalized velocity 0~1 */
  velocities: Float32Array;
  /** Per-point normalized time along stroke 0~1 */
  times: Float32Array;
  /** Stroke-level metadata */
  meta: GPUStrokeMeta;
}

/** Per-stroke metadata */
export interface GPUStrokeMeta {
  strokeId: string;
  pointCount: number;
  brushSize: number;
  hardness: number;
  color: [number, number, number]; // R,G,B 0~1
}

/** Encoding config */
export interface EncoderConfig {
  /** Camera zoom factor for normalization (default from snapshot) */
  cameraZoom?: number;
  /** Velocity normalization factor (px/ms → 0~1) */
  velocityNormFactor?: number;
  /** debug */
  debug?: boolean;
}

/** Encoding stats */
export interface EncoderStats {
  totalStrokesEncoded: number;
  totalPointsEncoded: number;
  encodingTimeMs: number;
  skippedStrokes: number; // < 2 points
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<EncoderConfig> = {
  cameraZoom: 1,
  velocityNormFactor: 5, // 5 px/ms = max velocity (normalized to 1)
  debug: false,
};

// ============================================================
//  StrokeToGPUEncoder
// ============================================================

export class StrokeToGPUEncoder {
  private _config: Required<EncoderConfig>;
  private _enabled = false;
  private _lastStats: EncoderStats | null = null;

  constructor(config: EncoderConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  encodeSnapshot — 主入口
  // ==========================================================

  /**
   * 将 SVS FrameSnapshot 编码为 GPU stroke buffer 数组。
   *
   * 编码流程：
   * 1. 遍历 committed strokes + preview stroke
   * 2. 对每个 stroke：提取 points → 归一化 → 打包
   * 3. 返回 GPUStrokeBuffer[]
   *
   * @param snapshot SVS 帧快照
   * @returns GPU stroke buffer 数组 + 编码统计
   */
  encodeSnapshot(
    snapshot: FrameSnapshot,
  ): { buffers: GPUStrokeBuffer[]; stats: EncoderStats } {
    const t0 = performance.now();
    const stats: EncoderStats = {
      totalStrokesEncoded: 0,
      totalPointsEncoded: 0,
      encodingTimeMs: 0,
      skippedStrokes: 0,
    };

    const buffers: GPUStrokeBuffer[] = [];

    // ── Committed strokes ──
    for (const stroke of snapshot.strokes) {
      const buf = this.encodeStroke(stroke, snapshot);
      if (buf) {
        buffers.push(buf);
        stats.totalStrokesEncoded++;
        stats.totalPointsEncoded += buf.meta.pointCount;
      } else {
        stats.skippedStrokes++;
      }
    }

    // ── Preview stroke ──
    if (snapshot.previewStroke && snapshot.previewStroke.points.length >= 2) {
      const buf = this.encodeStroke(snapshot.previewStroke, snapshot);
      if (buf) {
        buffers.push(buf);
        stats.totalStrokesEncoded++;
        stats.totalPointsEncoded += buf.meta.pointCount;
      }
    }

    stats.encodingTimeMs = performance.now() - t0;
    this._lastStats = stats;

    return { buffers, stats };
  }

  // ==========================================================
  //  encodeStroke — 单笔 stroke 编码
  // ==========================================================

  /**
   * 将单个 FrozenStroke 编码为 GPUStrokeBuffer。
   *
   * 归一化规则：
   * - position: world → camera-normalized (除以 zoom，保持相对关系)
   * - pressure: 固定 0.5（无压感设备时）
   * - velocity: EMA smoothedSpeed → clamp(0, velocityNormFactor) / velocityNormFactor
   * - time: arc-length ratio 0~1 along stroke
   *
   * @returns GPUStrokeBuffer 或 null（点数不足）
   */
  encodeStroke(
    stroke: FrozenStroke,
    _snapshot?: FrameSnapshot,
  ): GPUStrokeBuffer | null {
    if (!this._enabled) return null;

    const pts = stroke.points as readonly FrozenPoint[];
    const n = pts.length;

    if (n < 2) return null;

    // ── Allocate buffers ──
    const positions = new Float32Array(n * 2);
    const pressures = new Float32Array(n);
    const velocities = new Float32Array(n);
    const times = new Float32Array(n);

    // ── Pre-compute cumulative arc length ──
    const arcLengths: number[] = [0];
    let totalLen = 0;
    for (let i = 1; i < n; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      totalLen += Math.hypot(dx, dy);
      arcLengths.push(totalLen);
    }

    // ── Encode each point ──
    const zoom = this._config.cameraZoom;
    const vFactor = this._config.velocityNormFactor;

    for (let i = 0; i < n; i++) {
      const p = pts[i];

      // Position: world → camera-normalized
      positions[i * 2] = p.x;
      positions[i * 2 + 1] = p.y;

      // Pressure: default 0.5 (no pressure device)
      pressures[i] = 0.5;

      // Velocity: compute from adjacent points
      let rawVel = 0;
      if (i > 0) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        rawVel = Math.hypot(dx, dy); // px per point (not per ms — no timestamp)
      }
      velocities[i] = Math.min(1, rawVel / vFactor);

      // Time: normalized arc-length position
      times[i] = totalLen > 0 ? arcLengths[i] / totalLen : 0;
    }

    // ── Metadata ──
    const color = this._parseColor(stroke.color);
    const brushSize = stroke._penParams?.strokeWidth ?? stroke.width;
    const hardness = 0.5; // default — no hardness data in FrozenStroke

    return {
      positions,
      pressures,
      velocities,
      times,
      meta: {
        strokeId: stroke.id,
        pointCount: n,
        brushSize,
        hardness,
        color,
      },
    };
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get lastStats(): EncoderStats | null {
    return this._lastStats;
  }

  // ==========================================================
  //  Private: color parsing
  // ==========================================================

  private _parseColor(hex: string): [number, number, number] {
    // Default black
    if (!hex || !hex.startsWith('#')) return [0, 0, 0];

    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];

    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;

    return [r, g, b];
  }
}

export default StrokeToGPUEncoder;
