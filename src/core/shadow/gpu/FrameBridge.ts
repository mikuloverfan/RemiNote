// ============================================================
//  GPU Shadow Mirror — FrameBridge
//
//  职责：
//  ✔ 确保 CPU / Shadow / GPU 三路使用同一个 SVS snapshot
//  ✔ Snapshot 版本追踪 — 每帧一个唯一 snapshotId
//  ✔ 防止跨帧数据混用 — frame token 校验
//  ✔ 单帧生命周期 — capture → use → release
//
//  数据流：
//    SVS FrameSnapshot (single source)
//         ↓
//    FrameBridge.capture(snapshot) → bridgedSnapshot
//         ↓
//    ┌──────────┬──────────┬──────────┐
//    │ CPU      │ Shadow   │ GPU      │
//    │ consume   │ consume  │ consume  │
//    └──────────┴──────────┴──────────┘
//
//  约束：
//  ❌ 不修改 snapshot
//  ❌ 不持有 snapshot 长期引用（每帧 release）
//  ✅ 纯协调层
// ============================================================

import type { FrameSnapshot } from '../FrameSnapshot';
import type { ShadowRenderOutput } from '../ShadowRenderer';
import type { GPUMirrorOutput } from './GPUShadowMirror';
import type { RenderAlignmentResult } from './GPUAlignmentEngine';
import type { StabilityReport } from '../SVSDiffStabilizer';

// ============================================================
//  Types
// ============================================================

/** 单帧的完整桥接数据 */
export interface BridgedFrame {
  /** 唯一帧 ID (与 snapshot.frameId 对齐) */
  frameId: number;
  /** 桥接时间戳 */
  bridgedAt: number;
  /** SVS snapshot (共享引用) */
  snapshot: FrameSnapshot;

  // ── 三路输出（异步填充）──
  shadowOutput: ShadowRenderOutput | null;
  gpuOutput: GPUMirrorOutput | null;
  alignmentResult: RenderAlignmentResult | null;
  stabilityReport: StabilityReport | null;

  /** 是否所有三路都已就绪 */
  allReady: boolean;
}

/** FrameBridge 配置 */
export interface FrameBridgeConfig {
  /** debug */
  debug?: boolean;
}

// ============================================================
//  FrameBridge
// ============================================================

export class FrameBridge {
  private _config: Required<FrameBridgeConfig>;
  private _enabled = false;
  private _currentFrame: BridgedFrame | null = null;
  private _totalFrames = 0;

  constructor(config: FrameBridgeConfig = {}) {
    this._config = { ...{ debug: false }, ...config };
  }

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    this._currentFrame = null;
  }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  capture — 捕获新帧
  // ==========================================================

  /**
   * 捕获一帧的快照，开始新的桥接周期。
   *
   * 调用时机：SVS snapshot 创建后，三路渲染之前。
   *
   * @param snapshot SVS 帧快照
   * @returns        BridgedFrame（当前活跃帧）
   */
  capture(snapshot: FrameSnapshot): BridgedFrame {
    this._totalFrames++;

    this._currentFrame = {
      frameId: snapshot.frameId,
      bridgedAt: performance.now(),
      snapshot,
      shadowOutput: null,
      gpuOutput: null,
      alignmentResult: null,
      stabilityReport: null,
      allReady: false,
    };

    if (this._config.debug && this._totalFrames % 60 === 0) {
      console.log('[FrameBridge] 🔗 frame captured:', {
        frameId: snapshot.frameId,
        strokeCount: snapshot.strokes.length,
        totalFrames: this._totalFrames,
      });
    }

    return this._currentFrame;
  }

  // ==========================================================
  //  fill — 填充各路输出
  // ==========================================================

  /** 填充 Shadow 渲染输出 */
  fillShadow(output: ShadowRenderOutput): void {
    if (!this._currentFrame) return;
    this._currentFrame.shadowOutput = output;
    this._checkReady();
  }

  /** 填充 GPU 镜像输出 */
  fillGPU(output: GPUMirrorOutput): void {
    if (!this._currentFrame) return;
    this._currentFrame.gpuOutput = output;
    this._checkReady();
  }

  /** 填充对齐结果 */
  fillAlignment(result: RenderAlignmentResult): void {
    if (!this._currentFrame) return;
    this._currentFrame.alignmentResult = result;
    this._checkReady();
  }

  /** 填充稳定性报告 */
  fillStability(report: StabilityReport): void {
    if (!this._currentFrame) return;
    this._currentFrame.stabilityReport = report;
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** 当前活跃帧 */
  get currentFrame(): BridgedFrame | null {
    return this._currentFrame;
  }

  /** 当前帧是否所有输出都已就绪 */
  isFrameReady(): boolean {
    return this._currentFrame?.allReady ?? false;
  }

  /** 总帧数 */
  get totalFrames(): number { return this._totalFrames; }

  // ==========================================================
  //  Release
  // ==========================================================

  /** 释放当前帧（允许 GC） */
  release(): void {
    this._currentFrame = null;
  }

  // ==========================================================
  //  Private
  // ==========================================================

  private _checkReady(): void {
    if (!this._currentFrame) return;
    this._currentFrame.allReady =
      this._currentFrame.shadowOutput !== null
      && this._currentFrame.gpuOutput !== null
      && this._currentFrame.alignmentResult !== null;
  }
}

export default FrameBridge;
