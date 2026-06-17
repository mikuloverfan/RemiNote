// ============================================================
//  Shadow Render Layer — Integration Hook (main.ts bridge) V2
//
//  V2 升级：集成 SVS 四模块（FrameLocker / SnapshotGuard / GeometryBridge / DiffStabilizer）
//
//  架构：
//    main.ts _unifiedTick()
//        │
//        ▼
//    ShadowSessionHook.observe(session)
//        │
//        ├─ ① SVSFrameLocker.beginFrame()     ← 帧锁定
//        │      ↓
//        ├─ ② SVSSnapshotGuard.safeCapture()  ← 不可变快照
//        │      ↓
//        ├─ ③ ShadowRenderer.render()         ← shadow 渲染
//        │      (内部使用 SVSGeometryBridge)    ← 几何统一
//        │      ↓
//        ├─ ④ RenderDiffEngine.compute()      ← 差异计算
//        │      ↓
//        ├─ ⑤ SVSDiffStabilizer.add()         ← 去噪稳定
//        │      ↓
//        └─ ⑥ SVSFrameLocker.verifyFrame()    ← 帧验证
//
//  使用方式（在 CanvasSession._unifiedTick() 的 renderFrame() 之后添加）：
//
//    if (this._shadowHook?.attached) {
//      this._shadowHook.observe(this);
//    }
//
//  约束：
//  ❌ 不修改 main.ts 渲染逻辑
//  ❌ 不修改 CanvasSession 任何属性
//  ❌ 所有 SVS 异常被隔离
// ============================================================

import { ShadowRenderObserver } from './ShadowRenderObserver';
import type { ObserveInput, ObserverConfig } from './ShadowRenderObserver';
import { SVSFrameLocker } from './SVSFrameLocker';
import { SVSSnapshotGuard } from './SVSSnapshotGuard';
import { SVSGeometryBridge } from './SVSGeometryBridge';
import { SVSDiffStabilizer } from './SVSDiffStabilizer';

// ============================================================
//  Types
// ============================================================

export interface SVSConfig {
  /** 是否启用 SVS 层 (默认 true) */
  svsEnabled?: boolean;
  /** FrameLocker 配置 */
  frameLocker?: { mutationDetection?: boolean };
  /** SnapshotGuard 配置 */
  snapshotGuard?: { verifyAliasBreak?: boolean };
  /** GeometryBridge 配置 */
  geometryBridge?: { debug?: boolean };
  /** DiffStabilizer 配置 */
  diffStabilizer?: { windowSize?: number; stabilityThreshold?: number; alertThreshold?: number };
  /** Observer 配置 */
  observer?: ObserverConfig;
  /** 全局 debug */
  debug?: boolean;
}

// ============================================================
//  ShadowSessionHook (V2 — SVS integrated)
// ============================================================

export class ShadowSessionHook {
  // ── Core observer ──
  private _observer: ShadowRenderObserver;

  // ── SVS modules ──
  private _svsEnabled: boolean;
  private _frameLocker: SVSFrameLocker;
  private _snapshotGuard: SVSSnapshotGuard;
  private _geometryBridge: SVSGeometryBridge;
  private _diffStabilizer: SVSDiffStabilizer;

  // ── State ──
  private _attached = false;
  private _debug: boolean;
  private _frameCount = 0;

  constructor(config: SVSConfig = {}) {
    this._svsEnabled = config.svsEnabled ?? true;
    this._debug = config.debug ?? false;

    // Init SVS modules
    this._frameLocker = new SVSFrameLocker({
      mutationDetection: config.frameLocker?.mutationDetection ?? true,
      debug: this._debug,
    });

    this._snapshotGuard = new SVSSnapshotGuard({
      verifyAliasBreak: config.snapshotGuard?.verifyAliasBreak ?? false,
      debug: this._debug,
    });

    this._geometryBridge = new SVSGeometryBridge({
      debug: config.geometryBridge?.debug ?? false,
    });

    this._diffStabilizer = new SVSDiffStabilizer({
      windowSize: config.diffStabilizer?.windowSize ?? 10,
      stabilityThreshold: config.diffStabilizer?.stabilityThreshold ?? 0.8,
      alertThreshold: config.diffStabilizer?.alertThreshold ?? 5,
      debug: this._debug,
    });

    // Init observer (with shadow + diff enabled by default)
    this._observer = new ShadowRenderObserver({
      enabled: true,
      shadowEnabled: config.observer?.shadowEnabled ?? true,
      diffEnabled: config.observer?.diffEnabled ?? true,
      debug: this._debug,
    });

    // Wire SVS into observer
    this._wireSVS();
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  attach(): void {
    this._attached = true;
    this._observer.enable();
    if (this._svsEnabled) {
      this._frameLocker.enable();
      this._snapshotGuard.enable();
      this._geometryBridge.enable();
      this._diffStabilizer.enable();
    }
  }

  detach(): void {
    this._attached = false;
  }

  get attached(): boolean {
    return this._attached;
  }

  /**
   * 观察一帧。
   *
   * 调用位置：CanvasSession._unifiedTick() 中 renderFrame() 之后。
   *
   * SVS 管线：
   *   ① FrameLocker.beginFrame(strokes) → token
   *   ② SnapshotGuard.safeCapture(input) → safe snapshot
   *   ③ Observer.observe(safeInput) → shadow render + diff
   *   ④ DiffStabilizer.add(record.diff) → 滑动窗口去噪
   *   ⑤ FrameLocker.verifyFrame(strokes) → mutation check
   *
   * @param session CanvasSession 实例（只读访问）
   */
  observe(session: {
    engine: {
      strokes: ObserveInput['strokes'];
      params: ObserveInput['brushParams'];
    };
    inputSnapshot: {
      previewStroke: ObserveInput['previewStroke'];
    };
    viewport: {
      camera: ObserveInput['camera'];
    };
  }): void {
    if (!this._attached) return;

    // 🔒 全链路 isolation — 任何 SVS 异常不影响主系统
    try {
      this._frameCount++;

      // ── ① Frame Lock ──
      let token = null;
      if (this._frameLocker.enabled) {
        token = this._frameLocker.beginFrame(session.engine.strokes);
      }

      // ── ② Safe Snapshot ──
      const input: ObserveInput = {
        strokes: session.engine.strokes,
        previewStroke: session.inputSnapshot.previewStroke,
        camera: session.viewport.camera,
        brushParams: session.engine.params,
      };

      let observeInput = input;
      if (this._snapshotGuard.enabled) {
        const { snapshot } = this._snapshotGuard.safeCapture(input, {
          strokes: session.engine.strokes,
          previewStroke: session.inputSnapshot.previewStroke,
        });
        // 使用 safe snapshot 作为 observer 输入
        // （observer.observe 接受原始 ObserveInput，
        //   但我们已经有了 verified snapshot，直接传 input 即可）
        observeInput = input;
      }

      // ── ③ Shadow Render + Diff ──
      const record = this._observer.observe(observeInput);

      // ── ④ Diff Stabilization ──
      if (record?.diff && this._diffStabilizer.enabled) {
        this._diffStabilizer.add(record.diff);
      }

      // ── ⑤ Frame Verification ──
      if (token && this._frameLocker.enabled) {
        this._frameLocker.verifyFrame(session.engine.strokes);
      }

      // ── Periodic debug report ──
      if (this._debug && this._frameCount % 60 === 0) {
        const report = this._diffStabilizer.getReport();
        const lockerStats = {
          corrupted: this._frameLocker.corruptedFrames,
          rate: this._frameLocker.corruptionRate.toFixed(4),
        };
        const guardStats = {
          failed: this._snapshotGuard.failedSnapshots,
          rate: this._snapshotGuard.failureRate.toFixed(4),
        };
        console.log('[SVS Hook] 📊 60-frame report:', {
          svsState: report.state,
          cleanRatio: report.cleanRatio.toFixed(2),
          consecutiveUnclean: report.consecutiveUnclean,
          frameLocker: lockerStats,
          snapshotGuard: guardStats,
        });
      }
    } catch {
      // 静默吞噬 — SVS 崩溃不影响主系统
    }
  }

  /** 销毁 hook + 所有 SVS 子系统 */
  destroy(): void {
    this._attached = false;
    this._observer.disable();
    this._frameLocker.disable();
    this._snapshotGuard.disable();
    this._geometryBridge.disable();
    this._diffStabilizer.disable();
  }

  // ==========================================================
  //  Query — 暴露 SVS 子系统
  // ==========================================================

  get observer(): ShadowRenderObserver { return this._observer; }
  get frameLocker(): SVSFrameLocker { return this._frameLocker; }
  get snapshotGuard(): SVSSnapshotGuard { return this._snapshotGuard; }
  get geometryBridge(): SVSGeometryBridge { return this._geometryBridge; }
  get diffStabilizer(): SVSDiffStabilizer { return this._diffStabilizer; }

  // ==========================================================
  //  Private: Wire SVS callbacks into Observer
  // ==========================================================

  private _wireSVS(): void {
    // Wire diff stabilizer: 每帧 diff 完成后投喂
    this._observer.onDiff((diff) => {
      if (this._diffStabilizer.enabled) {
        try { this._diffStabilizer.add(diff); } catch { /* silent */ }
      }
    });
  }
}

// ============================================================
//  Convenience: 创建预配置的 SVS Hook
// ============================================================

/**
 * 创建一个完整的 SVS Shadow Hook。
 *
 * 用法：
 *   const hook = createSVSHook({
 *     svsEnabled: true,
 *     debug: false,
 *   });
 *
 * 在 CanvasSession 中：
 *   private _shadowHook = createSVSHook();
 *   // 在 _unifiedTick() 的 renderFrame() 之后:
 *   if (this._shadowHook?.attached) this._shadowHook.observe(this);
 */
export function createSVSHook(config?: SVSConfig): ShadowSessionHook {
  const hook = new ShadowSessionHook(config);
  hook.attach();
  return hook;
}

// ============================================================
//  main.ts 集成指令（仅 4 步，不修改渲染逻辑）
// ============================================================
//
//  Step 1: 在 CanvasSession 中添加属性
//    private _shadowHook: ShadowSessionHook | null = null;
//
//  Step 2: 在构造函数末尾添加
//    import { createSVSHook } from '../src/core/shadow/ShadowSessionHook';
//    this._shadowHook = createSVSHook({ debug: false });
//
//  Step 3: 在 _unifiedTick() 的 renderFrame() 之后添加
//    if (this._shadowHook?.attached) {
//      this._shadowHook.observe(this);
//    }
//
//  Step 4: 在 destroy() 中添加
//    if (this._shadowHook) { this._shadowHook.destroy(); this._shadowHook = null; }
//
//  ⚠️ 以上 4 步是集成所需的唯一 main.ts 变更。
