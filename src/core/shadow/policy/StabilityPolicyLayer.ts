// ============================================================
//  V11 Part 2 — Stability Policy Layer (Final Judge)
//  决定: "这一帧是否允许输出给用户"
// ============================================================

import type { SystemIntegrityReport, SystemHealthStatus } from '../diagnostics/SystemIntegrityAuditLayer';

// ============================================================
//  Types
// ============================================================

export type RenderDecision = 'ACCEPT' | 'DEGRADE' | 'REJECT';
export type RenderMode = 'NORMAL' | 'SAFE_RENDER' | 'FALLBACK_CPU_ONLY' | 'DISABLE_GPU';

export interface FinalRenderDecision {
  decision: RenderDecision;
  confidence: number;
  mode: RenderMode;
  reason: string[];
  allowedSystems: {
    cpu: boolean;
    shadow: boolean;
    gpu: boolean;
    pixelOverlay: boolean;
  };
}

export interface PolicyConfig {
  /** hysteresis: 连续 N 帧 DEGRADE 才切换模式 (默认 3) */
  hysteresisFrames?: number;
  /** debug */
  debug?: boolean;
}

// ============================================================
//  StabilityPolicyLayer
// ============================================================

export class StabilityPolicyLayer {
  private _config: Required<PolicyConfig>;
  private _enabled = false;
  private _lastDecision: FinalRenderDecision | null = null;

  // Hysteresis state
  private _degradeStreak = 0;
  private _currentMode: RenderMode = 'NORMAL';

  constructor(config: PolicyConfig = {}) {
    this._config = { hysteresisFrames: 3, debug: false, ...config };
  }

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }

  evaluate(integrity: SystemIntegrityReport): FinalRenderDecision {
    const reasons: string[] = [];
    const allowed = { cpu: true, shadow: true, gpu: true, pixelOverlay: true };

    let decision: RenderDecision = 'ACCEPT';
    let confidence = integrity.overallHealth;
    let mode: RenderMode = 'NORMAL';

    // ── Rule 1: Hard Fail ──
    if (integrity.snapshotIntegrity < 0.6) {
      decision = 'REJECT';
      reasons.push('Snapshot integrity < 0.6 — REJECT');
    }
    if (integrity.gpuHealth < 0.4) {
      allowed.gpu = false;
      mode = 'DISABLE_GPU';
      reasons.push('GPU health < 0.4 — DISABLE_GPU');
      if (decision !== 'REJECT') decision = 'DEGRADE';
    }

    // ── Rule 2: Pixel Authority Override ──
    if (integrity.pixelStability < 0.3) {
      allowed.pixelOverlay = false;
      reasons.push('Pixel stability BROKEN — disable pixel overlay');
      if (decision !== 'REJECT') decision = 'DEGRADE';
    }

    // ── Rule 3: Attribution Gate ──
    if (integrity.attributionReliability < 0.5) {
      reasons.push('Attribution reliability < 0.5 — ignore root cause');
      confidence *= 0.8; // reduce confidence
    }

    // ── Rule 4: GPU Calibration Safety ──
    if (integrity.status === 'UNSTABLE' || integrity.status === 'BROKEN') {
      if (decision !== 'REJECT') decision = 'DEGRADE';
      mode = 'SAFE_RENDER';
      reasons.push('System UNSTABLE/BROKEN → SAFE_RENDER');
    }

    // ── Rule 5: Final Fusion Score ──
    if (integrity.status === 'HEALTHY') {
      decision = 'ACCEPT';
      mode = 'NORMAL';
      if (reasons.length === 0) reasons.push('All systems healthy');
    }

    // ── Hysteresis ──
    if (decision === 'DEGRADE') {
      this._degradeStreak++;
    } else {
      this._degradeStreak = 0;
    }

    if (this._degradeStreak >= this._config.hysteresisFrames && this._currentMode === 'NORMAL') {
      this._currentMode = mode;
      reasons.push(`Hysteresis: ${this._degradeStreak} consecutive DEGRADE → mode=${mode}`);
    }

    if (decision === 'ACCEPT' && this._degradeStreak === 0) {
      // Recovery: return to NORMAL after 3 clean frames
      if (this._currentMode !== 'NORMAL') {
        this._currentMode = 'NORMAL';
        reasons.push('Recovered → NORMAL mode');
      }
    }

    // Apply current mode
    mode = this._currentMode;

    const result: FinalRenderDecision = { decision, confidence, mode, reason: reasons, allowedSystems: allowed };
    this._lastDecision = result;
    return result;
  }

  get lastDecision(): FinalRenderDecision | null { return this._lastDecision; }
  get currentMode(): RenderMode { return this._currentMode; }
}

export default StabilityPolicyLayer;
