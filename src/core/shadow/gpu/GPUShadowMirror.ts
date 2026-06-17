// ============================================================
//  GPU Shadow Mirror — GPUShadowMirror (Orchestrator)
//
//  职责：
//  ✔ 管理 GPU 影子渲染的完整生命周期
//  ✔ 消费 SVS FrameSnapshot → 编码 → 渲染 → 指标
//  ✔ 启停控制 — 可随时 enable/disable
//  ✔ 崩溃隔离 — GPU crash 不影响调用方
//
//  数据流：
//    SVS FrameSnapshot
//        ↓
//    StrokeToGPUEncoder.encodeSnapshot()
//        ↓
//    GPUInkFieldShadowRenderer.render()
//        ↓
//    GPURenderMetrics + GPU canvas
//
//  约束：
//  ❌ 不访问 main.ts / engine / session
//  ❌ 不修改 SVS snapshot
//  ✅ 纯消费 — 只读 snapshot
// ============================================================

import type { FrameSnapshot } from '../FrameSnapshot';
import {
  StrokeToGPUEncoder,
  type GPUStrokeBuffer,
  type EncoderStats,
  type EncoderConfig,
} from './StrokeToGPUEncoder';
import {
  GPUInkFieldShadowRenderer,
  type GPURenderMetrics,
  type GPURendererConfig,
} from './GPUInkFieldShadowRenderer';

// ============================================================
//  Types
// ============================================================

export interface GPUMirrorConfig {
  /** 是否启用 encoder */
  encoderEnabled?: boolean;
  /** 是否启用 renderer */
  rendererEnabled?: boolean;
  /** Encoder 配置 */
  encoderConfig?: EncoderConfig;
  /** Renderer 配置 */
  rendererConfig?: GPURendererConfig;
  /** debug */
  debug?: boolean;
}

export interface GPUMirrorOutput {
  /** 输入 snapshot 的 frameId */
  frameId: number;
  /** 编码统计 */
  encoderStats: EncoderStats;
  /** 渲染指标 */
  renderMetrics: GPURenderMetrics | null;
  /** 编码后的 buffer 数量 */
  bufferCount: number;
  /** mirror 总耗时 (ms) */
  totalTimeMs: number;
  /** GPU canvas base64 (可选, toDataURL 可能较慢) */
  canvasDataURL: string | null;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<GPUMirrorConfig> = {
  encoderEnabled: true,
  rendererEnabled: true,
  encoderConfig: {},
  rendererConfig: {},
  debug: false,
};

// ============================================================
//  GPUShadowMirror
// ============================================================

export class GPUShadowMirror {
  // ── Subsystems ──
  private _encoder: StrokeToGPUEncoder;
  private _renderer: GPUInkFieldShadowRenderer;

  // ── Config ──
  private _config: Required<GPUMirrorConfig>;
  private _enabled = false;

  // ── State ──
  private _lastOutput: GPUMirrorOutput | null = null;
  private _totalFrames = 0;

  constructor(config: GPUMirrorConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };

    this._encoder = new StrokeToGPUEncoder(this._config.encoderConfig);
    this._renderer = new GPUInkFieldShadowRenderer(this._config.rendererConfig);
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void {
    if (this._enabled) return;

    try {
      if (this._config.encoderEnabled) this._encoder.enable();
      if (this._config.rendererEnabled) this._renderer.enable();
      this._enabled = true;

      if (this._config.debug) console.log('[GPUShadowMirror] ✅ enabled');
    } catch (err) {
      console.error('[GPUShadowMirror] ❌ enable failed:', err);
      this._enabled = false;
    }
  }

  disable(): void {
    this._enabled = false;
    this._encoder.disable();
    this._renderer.disable();
    this._lastOutput = null;
  }

  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  mirror — 主入口
  // ==========================================================

  /**
   * 将 SVS FrameSnapshot 镜像渲染到 GPU。
   *
   * @param snapshot  SVS 帧快照（只读）
   * @param viewportW 视口宽度（px, 可选）
   * @param viewportH 视口高度（px, 可选）
   * @returns         GPU 镜像输出
   */
  mirror(
    snapshot: FrameSnapshot,
    viewportW?: number,
    viewportH?: number,
  ): GPUMirrorOutput | null {
    if (!this._enabled) return null;

    const t0 = performance.now();

    // 🔒 try/catch — GPU crash 不影响调用方
    try {
      this._totalFrames++;

      // ── Phase 1: Encode ──
      const { buffers, stats: encoderStats } = this._encoder.encodeSnapshot(snapshot);

      // ── Phase 2: Render ──
      let renderMetrics: GPURenderMetrics | null = null;
      if (this._renderer.enabled && buffers.length > 0) {
        renderMetrics = this._renderer.render(buffers, viewportW, viewportH);
      }

      // ── Phase 3: Output ──
      const output: GPUMirrorOutput = {
        frameId: snapshot.frameId,
        encoderStats,
        renderMetrics,
        bufferCount: buffers.length,
        totalTimeMs: performance.now() - t0,
        canvasDataURL: null, // toDataURL is expensive — call separately if needed
      };

      this._lastOutput = output;

      if (this._config.debug && this._totalFrames % 60 === 0) {
        console.log('[GPUShadowMirror] 📊 stats:', {
          totalFrames: this._totalFrames,
          avgTimeMs: output.totalTimeMs.toFixed(2),
          strokeCount: encoderStats.totalStrokesEncoded,
          stampCount: renderMetrics?.stampCount ?? 0,
        });
      }

      return output;
    } catch (err) {
      if (this._config.debug) {
        console.error('[GPUShadowMirror] ❌ mirror crashed:', err);
      }
      return null;
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get lastOutput(): GPUMirrorOutput | null { return this._lastOutput; }
  get totalFrames(): number { return this._totalFrames; }
  get encoder(): StrokeToGPUEncoder { return this._encoder; }
  get renderer(): GPUInkFieldShadowRenderer { return this._renderer; }

  /** 获取 GPU canvas 的 base64（按需调用，避免每帧 toDataURL） */
  captureCanvas(): string | null {
    return this._renderer.toDataURL();
  }
}

export default GPUShadowMirror;
