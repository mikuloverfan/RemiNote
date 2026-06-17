// ============================================================
//  V11 Part 3 — Render Production Hardener
//  工程稳定性: 防抖/隔离/抑制/恢复
// ============================================================

import type { SystemIntegrityReport } from '../diagnostics/SystemIntegrityAuditLayer';
import type { FinalRenderDecision, RenderMode } from '../policy/StabilityPolicyLayer';

// ============================================================
//  Types
// ============================================================

export interface ProductionRenderState {
  frameId: number;
  safeMode: boolean;
  activeLayers: string[];
  suppressedSignals: string[];
  systemLoad: number;
}

export interface HardenerConfig {
  /** 每帧最大诊断预算 (ms, 默认 2) */
  maxDiagnosticBudgetMs?: number;
  /** EMA alpha for system load (默认 0.2) */
  loadAlpha?: number;
  /** 恢复正常模式需要连续 clean 帧数 (默认 5) */
  recoveryFrames?: number;
  debug?: boolean;
}

// ============================================================
//  RenderProductionHardener
// ============================================================

export class RenderProductionHardener {
  private _config: Required<HardenerConfig>;
  private _enabled = false;
  private _lastState: ProductionRenderState | null = null;

  // Load tracking
  private _emaLoad = 0;
  private _frameStart = 0;

  // Recovery
  private _cleanStreak = 0;
  private _safeMode = false;
  private _suppressedLayers = new Set<string>();

  constructor(config: HardenerConfig = {}) {
    this._config = { maxDiagnosticBudgetMs: 2, loadAlpha: 0.2, recoveryFrames: 5, debug: false, ...config };
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }

  // Called at frame start
  beginFrame(): void { this._frameStart = performance.now(); }

  // Called after all diagnostics complete
  endFrame(integrity: SystemIntegrityReport, decision: FinalRenderDecision): ProductionRenderState {
    const frameEnd = performance.now();
    const frameTime = frameEnd - this._frameStart;
    const diagnosticTime = frameEnd - this._frameStart;
    this._emaLoad = this._config.loadAlpha * diagnosticTime + (1 - this._config.loadAlpha) * this._emaLoad;

    const activeLayers: string[] = ['cpu'];
    const suppressed: string[] = [];

    // ── Build active layers from decision ──
    if (decision.allowedSystems.shadow) activeLayers.push('shadow');
    else suppressed.push('shadow');

    if (decision.allowedSystems.gpu) activeLayers.push('gpu');
    else { suppressed.push('gpu'); this._suppressedLayers.add('gpu'); }

    if (decision.allowedSystems.pixelOverlay) activeLayers.push('pixel');
    else { suppressed.push('pixel'); this._suppressedLayers.add('pixel'); }

    // ── Diagnostic Throttling ──
    if (this._emaLoad > this._config.maxDiagnosticBudgetMs) {
      if (!this._suppressedLayers.has('pixel')) {
        suppressed.push('pixel (throttled)');
        this._suppressedLayers.add('pixel');
      }
      if (!this._suppressedLayers.has('gpu')) {
        suppressed.push('gpu (throttled)');
        this._suppressedLayers.add('gpu');
      }
    }

    // ── Failure Isolation ──
    if (integrity.gpuHealth < 0.4) {
      if (!this._suppressedLayers.has('gpu')) {
        suppressed.push('gpu (isolated)');
        this._suppressedLayers.add('gpu');
      }
    }
    if (integrity.pixelStability < 0.3) {
      if (!this._suppressedLayers.has('pixel')) {
        suppressed.push('pixel (isolated)');
        this._suppressedLayers.add('pixel');
      }
    }

    // ── Safe mode tracking ──
    if (decision.mode !== 'NORMAL') {
      this._safeMode = true;
      this._cleanStreak = 0;
    } else {
      this._cleanStreak++;
    }

    // ── Recovery ──
    if (this._safeMode && this._cleanStreak >= this._config.recoveryFrames) {
      this._safeMode = false;
      this._suppressedLayers.clear();
      if (this._config.debug) console.log('[Hardener] Recovered — all layers restored');
    }

    const state: ProductionRenderState = {
      frameId: integrity.frameId,
      safeMode: this._safeMode,
      activeLayers,
      suppressedSignals: suppressed,
      systemLoad: this._emaLoad,
    };

    this._lastState = state;
    return state;
  }

  get lastState(): ProductionRenderState | null { return this._lastState; }
  get isSafeMode(): boolean { return this._safeMode; }
}

export default RenderProductionHardener;
