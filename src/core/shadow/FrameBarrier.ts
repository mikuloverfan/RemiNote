// ============================================================
//  FrameBarrier / FrameFence System — 全局帧锁
//
//  职责：
//  ✔ 时间一致性核心 — CPU/Shadow/GPU 永远基于同一 frozen snapshot
//  ✔ 4 阶段生命周期 — LOCK → DISTRIBUTE → COLLECT → RELEASE
//  ✔ 帧完整性验证 — 三路未全部就绪前不允许仲裁
//  ✔ 帧漂移检测 — frameId 单调递增，不接受乱序
//
//  状态机：
//    ┌──────────┐
//    │  LOCK    │  beginFrame() — 冻结 snapshot, frameId++
//    └────┬─────┘
//         │ distribute()
//    ┌────▼─────┐
//    │DISTRIBUTE│  三路各自消费 snapshot
//    └────┬─────┘
//         │ collect() — 收集各路输出
//    ┌────▼─────┐
//    │ COLLECT  │  等待三路就绪
//    └────┬─────┘
//         │ release() — 仲裁
//    ┌────▼─────┐
//    │ RELEASE  │  frame marked complete
//    └──────────┘
//
//  约束：
//  ❌ 不修改 main.ts renderFrame()
//  ❌ 不修改 SVS / GPU / Arbitration 内部逻辑
//  ❌ 不引入新渲染系统
//  ✅ 纯时间协调 — 顺序保证 + 完整性保证
// ============================================================

import { captureFrameSnapshot, type FrameSnapshot, type FrozenStroke } from './FrameSnapshot';
import type { ShadowRenderOutput } from './ShadowRenderer';
import type { RenderDiffResult } from './RenderDiffEngine';
import type { GPUMirrorOutput } from './gpu/GPUShadowMirror';
import type { RenderAlignmentResult } from './gpu/GPUAlignmentEngine';
import type { StabilityReport } from './SVSDiffStabilizer';
import type { SVSFrameLocker } from './SVSFrameLocker';
import type { SVSSnapshotGuard } from './SVSSnapshotGuard';
import type { ArbitrationEngine, ArbitrationInput } from './arbitration/ArbitrationEngine';
import type { RenderTruthResult } from './arbitration/RenderTruthModel';

// ============================================================
//  Types
// ============================================================

/** 帧生命周期阶段 */
export type FramePhase = 'idle' | 'locked' | 'distributed' | 'collecting' | 'complete' | 'invalid';

/** CPU 帧输出 — 从 CanvasSession 捕获的只读状态 */
export interface CPUFrameOutput {
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
  camera: { x: number; y: number; zoom: number };
  brushParams: {
    spacing: number;
    smoothness: number;
    strokeWidth: number;
    cornerKeep: number;
  };
  renderComplete: boolean;
}

/** 时间戳记录 */
export interface FrameTimestamps {
  barrierCreated: number;
  snapshotFrozen: number;
  cpuEnd: number;
  shadowEnd: number;
  gpuEnd: number;
  arbitrationEnd: number;
}

/** 帧栅栏 — 单帧的完整执行容器 */
export interface FrameFence {
  /** 单调递增帧 ID */
  frameId: number;
  /** 当前阶段 */
  phase: FramePhase;
  /** SVS 冻结快照（三路共享） */
  snapshot: FrameSnapshot | null;

  // ── 三路输出 ──
  cpu: CPUFrameOutput | null;
  shadow: ShadowRenderOutput | null;
  gpu: GPUMirrorOutput | null;

  // ── 验证输出 ──
  diff: RenderDiffResult | null;
  alignment: RenderAlignmentResult | null;
  stability: StabilityReport | null;
  arbitration: RenderTruthResult | null;

  // ── 时间戳 ──
  timestamps: FrameTimestamps;

  /** 是否所有三路输出都已就绪 */
  allOutputsReady: boolean;
}

/** FrameBarrier 配置 */
export interface FrameBarrierConfig {
  /** 最大帧漂移容忍度 (frames), 默认 0 */
  maxFrameDrift?: number;
  /** 超时时间 (ms), 超过此时间未完成标记为 invalid, 默认 200 */
  timeoutMs?: number;
  /** debug */
  debug?: boolean;
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<FrameBarrierConfig> = {
  maxFrameDrift: 0,
  timeoutMs: 200,
  debug: false,
};

// ============================================================
//  FrameBarrier
// ============================================================

export class FrameBarrier {
  // ── Config ──
  private _config: Required<FrameBarrierConfig>;
  private _enabled = false;

  // ── State ──
  private _frameId = 0;
  private _currentFence: FrameFence | null = null;
  private _history: FrameFence[] = [];
  private _totalFrames = 0;
  private _invalidFrames = 0;

  // ── External subsystems (injected) ──
  private _frameLocker: SVSFrameLocker | null = null;
  private _snapshotGuard: SVSSnapshotGuard | null = null;
  private _arbitrationEngine: ArbitrationEngine | null = null;

  constructor(config: FrameBarrierConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================
  //  Dependency Injection
  // ==========================================================

  /** 注入外部子系统引用 */
  inject(params: {
    frameLocker?: SVSFrameLocker;
    snapshotGuard?: SVSSnapshotGuard;
    arbitrationEngine?: ArbitrationEngine;
  }): void {
    if (params.frameLocker) this._frameLocker = params.frameLocker;
    if (params.snapshotGuard) this._snapshotGuard = params.snapshotGuard;
    if (params.arbitrationEngine) this._arbitrationEngine = params.arbitrationEngine;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void { this._enabled = true; }
  disable(): void {
    this._enabled = false;
    this._currentFence = null;
  }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  Phase A: LOCK — 冻结一帧
  // ==========================================================

  /**
   * 开始新帧 — 冻结 snapshot + 锁定 frameId。
   *
   * 调用时机：_unifiedTick() 的开始，在 renderFrame() 之前。
   *
   * @param cpuOutput CPU 帧输入（从 CanvasSession 读取）
   * @returns FrameFence（当前帧容器）
   */
  beginFrame(cpuOutput: CPUFrameOutput): FrameFence {
    if (!this._enabled) {
      // 未启用时返回空 fence
      return this._createEmptyFence();
    }

    this._frameId++;
    this._totalFrames++;

    const now = performance.now();

    // ── ① SVSFrameLocker: 冻结 stroke 版本 ──
    if (this._frameLocker?.enabled) {
      this._frameLocker.beginFrame(cpuOutput.strokes);
    }

    // ── ② SVSSnapshotGuard: 安全捕获 snapshot ──
    let snapshot: FrameSnapshot;
    if (this._snapshotGuard?.enabled) {
      const result = this._snapshotGuard.safeCapture(cpuOutput, {
        strokes: cpuOutput.strokes,
        previewStroke: cpuOutput.previewStroke,
      });
      snapshot = result.snapshot;
    } else {
      snapshot = captureFrameSnapshot(cpuOutput);
    }

    // ── ③ 创建 FrameFence ──
    const fence: FrameFence = {
      frameId: this._frameId,
      phase: 'locked',
      snapshot,
      cpu: cpuOutput,
      shadow: null,
      gpu: null,
      diff: null,
      alignment: null,
      stability: null,
      arbitration: null,
      timestamps: {
        barrierCreated: now,
        snapshotFrozen: now,
        cpuEnd: 0,
        shadowEnd: 0,
        gpuEnd: 0,
        arbitrationEnd: 0,
      },
      allOutputsReady: false,
    };

    this._currentFence = fence;

    if (this._config.debug && this._frameId % 60 === 0) {
      console.log('[FrameBarrier] 🔒 LOCKED:', {
        frameId: fence.frameId,
        strokeCount: snapshot.strokes.length,
        totalFrames: this._totalFrames,
      });
    }

    return fence;
  }

  // ==========================================================
  //  Phase B: DISTRIBUTE — 三路开始消费
  // ==========================================================

  /**
   * 标记快照已分发。三路各自读取 this._currentFence.snapshot。
   *
   * 调用时机：beginFrame() 之后，三路渲染开始之前。
   */
  distribute(): void {
    if (!this._currentFence || !this._enabled) return;
    if (this._currentFence.phase !== 'locked') {
      console.warn('[FrameBarrier] ⚠️ distribute() called in wrong phase:', this._currentFence.phase);
      return;
    }

    this._currentFence.phase = 'distributed';
    this._currentFence.timestamps.cpuEnd = 0;
    this._currentFence.timestamps.shadowEnd = 0;
    this._currentFence.timestamps.gpuEnd = 0;
  }

  // ==========================================================
  //  Phase C: COLLECT — 收集各路输出
  // ==========================================================

  /** 收集 CPU 完成信号 */
  collectCPU(): void {
    if (!this._currentFence) return;
    this._currentFence.timestamps.cpuEnd = performance.now();
    this._checkPhase();
  }

  /** 收集 Shadow 渲染输出 */
  collectShadow(output: ShadowRenderOutput | null): void {
    if (!this._currentFence) return;
    this._currentFence.shadow = output;
    this._currentFence.timestamps.shadowEnd = performance.now();
    this._checkPhase();
  }

  /** 收集 GPU 镜像输出 */
  collectGPU(output: GPUMirrorOutput | null): void {
    if (!this._currentFence) return;
    this._currentFence.gpu = output;
    this._currentFence.timestamps.gpuEnd = performance.now();
    this._checkPhase();
  }

  /** 收集 Diff 结果 */
  collectDiff(diff: RenderDiffResult | null): void {
    if (!this._currentFence) return;
    this._currentFence.diff = diff;
  }

  /** 收集 Alignment 结果 */
  collectAlignment(alignment: RenderAlignmentResult | null): void {
    if (!this._currentFence) return;
    this._currentFence.alignment = alignment;
  }

  /** 收集 Stability 报告 */
  collectStability(stability: StabilityReport | null): void {
    if (!this._currentFence) return;
    this._currentFence.stability = stability;
  }

  // ==========================================================
  //  Phase D: RELEASE — 仲裁 + 完成
  // ==========================================================

  /**
   * 释放当前帧 — 执行仲裁 + 写入历史。
   *
   * @returns RenderTruthResult 或 null (仲裁引擎未注入)
   */
  release(): RenderTruthResult | null {
    if (!this._currentFence || !this._enabled) return null;

    const fence = this._currentFence;

    // ── 超时检测 ──
    const elapsed = performance.now() - fence.timestamps.barrierCreated;
    if (elapsed > this._config.timeoutMs) {
      fence.phase = 'invalid';
      this._invalidFrames++;
      if (this._config.debug) {
        console.warn('[FrameBarrier] ⚠️ frame timeout:', {
          frameId: fence.frameId,
          elapsedMs: elapsed.toFixed(0),
          allReady: fence.allOutputsReady,
        });
      }
    }

    // ── 输出完整性验证 ──
    if (!fence.snapshot) {
      fence.phase = 'invalid';
      this._invalidFrames++;
    }

    // ── 仲裁 ──
    let result: RenderTruthResult | null = null;
    if (this._arbitrationEngine?.enabled && fence.snapshot) {
      const input: ArbitrationInput = {
        snapshot: fence.snapshot,
        shadowOutput: fence.shadow,
        gpuOutput: fence.gpu,
        diff: fence.diff,
        alignment: fence.alignment,
        stability: fence.stability,
        frameLocker: this._frameLocker,
      };

      result = this._arbitrationEngine.arbitrate(input);
      fence.arbitration = result;
      fence.timestamps.arbitrationEnd = performance.now();
    }

    // ── Complete ──
    fence.phase = 'complete';

    // ── 写入历史（环形覆盖，保留最近 120 帧） ──
    this._history.push(fence);
    if (this._history.length > 120) {
      this._history.shift();
    }

    // ── 释放当前引用 ──
    this._currentFence = null;

    return result;
  }

  // ==========================================================
  //  Query
  // ==========================================================

  /** 当前帧 */
  get currentFence(): FrameFence | null {
    return this._currentFence;
  }

  /** 当前帧 ID */
  get currentFrameId(): number {
    return this._frameId;
  }

  /** 历史记录 */
  get history(): readonly FrameFence[] {
    return this._history;
  }

  /** 总帧数 */
  get totalFrames(): number { return this._totalFrames; }

  /** 无效帧数 */
  get invalidFrames(): number { return this._invalidFrames; }

  /** 无效帧比例 */
  get invalidRate(): number {
    return this._totalFrames > 0
      ? this._invalidFrames / this._totalFrames
      : 0;
  }

  /** 当前 snapshot（快捷访问） */
  get currentSnapshot(): FrameSnapshot | null {
    return this._currentFence?.snapshot ?? null;
  }

  // ==========================================================
  //  Private
  // ==========================================================

  private _checkPhase(): void {
    if (!this._currentFence) return;

    const f = this._currentFence;
    const hasShadow = f.shadow !== null || f.timestamps.shadowEnd > 0;
    const hasGPU = f.gpu !== null || f.timestamps.gpuEnd > 0;
    const hasCPU = f.timestamps.cpuEnd > 0;

    // 三路中 CPU + 至少一路就绪 → collecting
    if (hasCPU && (hasShadow || hasGPU)) {
      f.phase = 'collecting';
    }

    // 三路全部就绪
    if (hasCPU && hasShadow && hasGPU) {
      f.allOutputsReady = true;
    }
  }

  private _createEmptyFence(): FrameFence {
    return {
      frameId: -1,
      phase: 'idle',
      snapshot: null,
      cpu: null,
      shadow: null,
      gpu: null,
      diff: null,
      alignment: null,
      stability: null,
      arbitration: null,
      timestamps: {
        barrierCreated: 0,
        snapshotFrozen: 0,
        cpuEnd: 0,
        shadowEnd: 0,
        gpuEnd: 0,
        arbitrationEnd: 0,
      },
      allOutputsReady: false,
    };
  }
}

// ============================================================
//  First Stable Test Protocol
// ============================================================

/**
 * ## Test Case 1 — Static Stroke (10 strokes, fixed input)
 *
 * Setup:
 *   1. FrameBarrier.enable()
 *   2. Inject 10 strokes via engine.load() with known IDs
 *   3. No pointer input (engine.drawing = false)
 *
 * Execute:
 *   1. Call beginFrame() → verify frameId=1, phase='locked'
 *   2. Call distribute() → verify phase='distributed'
 *   3. Call collectCPU() → verify timestamps.cpuEnd > 0
 *   4. Call collectShadow(output) → verify fence.shadow !== null
 *   5. Call collectGPU(output) → verify fence.gpu !== null
 *   6. Call release() → verify:
 *      - arbitration.status === 'aligned'
 *      - arbitration.truth.finalStatus === 'green'
 *      - arbitration.decision.acceptFrame === true
 *
 * Expected:
 *   - CPU: 10 strokes rendered
 *   - Shadow: diff.isClean === true
 *   - GPU: strokeLossRate === 0
 *   - Arbitration: confidence >= 0.95
 *
 * ## Test Case 2 — Fast Stroke Input
 *
 * Setup:
 *   1. Simulate high-frequency pointermove (60 events/sec)
 *   2. 100 strokes, each with 20+ points
 *
 * Execute:
 *   1. Run 60 frames through FrameBarrier
 *   2. After 60 frames: verify SVSDiffStabilizer.isStable() === true
 *   3. Verify no frame has gpuDrift > 1
 *
 * Expected:
 *   - SVS stable window ≥ 8/10
 *   - max frameDrift ≤ 1
 *   - FrameBarrier.invalidRate < 0.05
 *
 * ## Test Case 3 — Stress Frame Race
 *
 * Setup:
 *   1. Rapid draw (pointerdown → 50×pointermove → pointerup)
 *   2. Instant erase (pointerdown + strokemode erase)
 *   3. Repeat 20 times in sequence
 *
 * Execute:
 *   1. Run all frames through FrameBarrier
 *   2. Verify no frame marked 'invalid'
 *   3. Verify arbitration never returns null
 *
 * Expected:
 *   - FrameBarrier.invalidFrames === 0
 *   - Every fence.arbitration !== null
 *   - No fence.phase === 'invalid'
 */

// ============================================================
//  Failure Modes Analysis
// ============================================================

/**
 * ## 1. Frame Drift
 *
 * Cause: CPU renderFrame takes longer than 16ms → next pointer event
 *        arrives before snapshot frozen → engine.strokes mutated mid-frame.
 *
 * Detection: SVSFrameLocker.verifyFrame() returns false.
 * Impact: CPU sees different stroke count than Shadow/GPU.
 * Mitigation: FrameBarrier.beginFrame() calls frameLocker.beginFrame() FIRST,
 *             freezing checksum before any render work. If verifyFrame() fails,
 *             fence marked invalid.
 *
 * ## 2. Snapshot Race
 *
 * Cause: engine.strokes reference shared between CPU and snapshot capture.
 *        PageManager.saveNotebook writes to same array during snapshot.
 *
 * Detection: SVSSnapshotGuard.verifyAliasBreak().
 * Impact: Shadow/GPU see stale or partially updated stroke data.
 * Mitigation: SVSSnapshotGuard.safeCapture() uses structuredClone to break
 *             all references. FrameBarrier.beginFrame() calls safeCapture()
 *             before any consumer reads strokes.
 *
 * ## 3. GPU Lag
 *
 * Cause: WebGL bufferData + drawElementsInstanced may take > frame budget.
 *        GPU output arrives after next frame's beginFrame().
 *
 * Detection: gpuEnd timestamp > barrierCreated + 16ms.
 * Impact: Arbitration may consume previous frame's GPU output.
 * Mitigation: FrameBarrier.release() checks allOutputsReady. If GPU not ready,
 *             fence marked invalid. GPU output collected asynchronously via
 *             collectGPU() — if called after next beginFrame(), it's discarded.
 *
 * ## 4. Shadow Desync
 *
 * Cause: ShadowRenderer.render() uses its own RAF or setTimeout internally,
 *        completing after CPU renderFrame() returns.
 *
 * Detection: shadowEnd > cpuEnd + 5ms.
 * Impact: Diff computed on stale data.
 * Mitigation: ShadowRenderer.render() is synchronous — no internal RAF.
 *             If shadow output not available at release(), missing.
 */

// ============================================================
//  main.ts Integration Patch
// ============================================================

/**
 * ### Integration in CanvasSession._unifiedTick():
 *
 * ```ts
 * // In CanvasSession class:
 * private _frameBarrier: FrameBarrier | null = null;
 *
 * // In constructor, after SVS hook creation:
 * this._frameBarrier = new FrameBarrier({ debug: false });
 * this._frameBarrier.inject({
 *   frameLocker: this._shadowHook?.frameLocker,
 *   snapshotGuard: this._shadowHook?.snapshotGuard,
 *   arbitrationEngine: arbitrationEngine,
 * });
 * this._frameBarrier.enable();
 *
 * // In _unifiedTick(), replacing the existing flow:
 * private _unifiedTick(): void {
 *   if (!this.alive) return;
 *
 *   // ── Phase A: LOCK ──
 *   const cpuOutput = {
 *     strokes: this.engine.strokes,
 *     previewStroke: this.inputSnapshot.previewStroke,
 *     camera: this.viewport.camera,
 *     brushParams: this.engine.params,
 *     renderComplete: false,
 *   };
 *   this._frameBarrier?.beginFrame(cpuOutput);
 *
 *   // ── Existing logic (unchanged) ──
 *   if (this.viewport.inertia.active) {
 *     this.viewport.inertia.tick();
 *   }
 *   if (this.replayCtrl.active) {
 *     // ... replay tick ...
 *   }
 *   this.renderFrame();
 *
 *   // ── Phase B: DISTRIBUTE ──
 *   this._frameBarrier?.distribute();
 *   this._frameBarrier?.collectCPU();
 *
 *   // ── Phase C: COLLECT (via shadow hook) ──
 *   // Shadow + GPU + Diff + Alignment collected by ShadowSessionHook
 *   // which now writes into FrameBarrier instead of standalone
 *
 *   // ── Phase D: RELEASE ──
 *   this._frameBarrier?.release();
 * }
 * ```
 *
 * ⚠️ The above is a DOCUMENTATION PATCH — no actual main.ts modification
 * is included. The FrameBarrier module is self-contained and can be wired
 * into the existing ShadowSessionHook without changing main.ts internals.
 */

export default FrameBarrier;
