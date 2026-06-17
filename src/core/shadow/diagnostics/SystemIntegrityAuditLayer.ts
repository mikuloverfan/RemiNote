// ============================================================
//  V11 Part 1 — System Integrity Audit Layer
//  评估: "系统当前是否可信" — 6 个健康维度
// ============================================================

import type { RenderDiffResult } from '../RenderDiffEngine';
import type { RenderAlignmentResult } from '../gpu/GPUAlignmentEngine';
import type { PixelMismatchReport } from '../pixel/PixelTruthDiffEngine';
import type { PixelStrokeAttributionResult } from '../pixel/PixelStrokeAttributionEngine';
import type { GPUCalibrationReport, CalibrationState } from '../gpu/GPUCalibrationLayer';
import type { StabilityReport } from '../SVSDiffStabilizer';

// ============================================================
//  Types
// ============================================================

export type SystemHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNSTABLE' | 'BROKEN';

export interface SystemIntegrityReport {
  frameId: number;
  overallHealth: number;          // 0~1
  snapshotIntegrity: number;
  pipelineConsistency: number;
  gpuHealth: number;
  pixelStability: number;
  attributionReliability: number;
  temporalStability: number;
  status: SystemHealthStatus;
  criticalFailures: string[];
}

export interface IntegrityInput {
  frameId: number;
  diff: RenderDiffResult | null;
  alignment: RenderAlignmentResult | null;
  pixelReport: PixelMismatchReport | null;
  attribution: PixelStrokeAttributionResult | null;
  calibration: GPUCalibrationReport | null;
  stability: StabilityReport | null;
}

// ============================================================
//  SystemIntegrityAuditLayer
// ============================================================

export class SystemIntegrityAuditLayer {
  private _enabled = false;
  private _lastReport: SystemIntegrityReport | null = null;

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }

  audit(input: IntegrityInput): SystemIntegrityReport {
    const { frameId, diff, alignment, pixelReport, attribution, calibration, stability } = input;
    const critical: string[] = [];

    // ── 1. Snapshot Integrity (diff + stability) ──
    let snapInt = 1.0;
    if (diff && !diff.isClean) {
      snapInt -= 0.3;
      if (diff.missingStrokes.length > 0) snapInt -= 0.2;
      if (diff.bboxMismatches.length > 2) snapInt -= 0.15;
    }
    if (stability && stability.state !== 'stable') snapInt -= 0.15;
    snapInt = Math.max(0, snapInt);
    if (snapInt < 0.6) critical.push('Snapshot integrity critical');

    // ── 2. Pipeline Consistency (CPU/Shadow/GPU agreement) ──
    let pipeCon = 1.0;
    if (diff && !diff.isClean) pipeCon -= 0.25;
    if (alignment && !alignment.isAligned) pipeCon -= 0.25;
    if (pixelReport && pixelReport.severity !== 'clean') pipeCon -= 0.2;
    pipeCon = Math.max(0, pipeCon);
    if (pipeCon < 0.4) critical.push('Pipeline consistency broken');

    // ── 3. GPU Health ──
    let gpuHealth = 1.0;
    if (alignment && !alignment.isAligned) {
      gpuHealth -= 0.3;
      if (alignment.metrics.strokeLossRate > 0.1) gpuHealth -= 0.3;
      if (alignment.metrics.gpuDrift > 2) gpuHealth -= 0.2;
    }
    if (calibration && calibration.calibrationState === 'UNSTABLE') gpuHealth -= 0.2;
    gpuHealth = Math.max(0, gpuHealth);
    if (gpuHealth < 0.4) critical.push('GPU health critical');

    // ── 4. Pixel Stability ──
    let pixStab = 1.0;
    if (pixelReport) {
      if (pixelReport.severity === 'critical') pixStab -= 0.6;
      else if (pixelReport.severity === 'major') pixStab -= 0.3;
      else if (pixelReport.severity === 'minor') pixStab -= 0.1;
      if (pixelReport.isFrozen) pixStab -= 0.3;
    }
    pixStab = Math.max(0, pixStab);
    if (pixStab < 0.3) critical.push('Pixel stability broken');

    // ── 5. Attribution Reliability ──
    let attrRel = 1.0;
    if (attribution) {
      const avgConf = attribution.strokeRanking.length > 0
        ? attribution.strokeRanking.reduce((s, a) => s + a.confidence, 0) / attribution.strokeRanking.length
        : 1;
      attrRel = avgConf;
      if (attribution.unresolvedPixels > 10) attrRel -= 0.2;
    }
    attrRel = Math.max(0, attrRel);
    if (attrRel < 0.5) critical.push('Attribution reliability low');

    // ── 6. Temporal Stability ──
    let tempStab = 1.0;
    if (stability) {
      if (stability.state === 'alert') tempStab = 0.2;
      else if (stability.state === 'unstable') tempStab = 0.4;
      else if (stability.state === 'degrading') tempStab = 0.7;
    }
    if (calibration && calibration.calibrationState === 'UNSTABLE') tempStab -= 0.15;
    tempStab = Math.max(0, tempStab);

    // ── Overall ──
    const overall = (snapInt + pipeCon + gpuHealth + pixStab + attrRel + tempStab) / 6;

    let status: SystemHealthStatus;
    if (overall >= 0.9 && critical.length === 0) status = 'HEALTHY';
    else if (overall >= 0.6) status = 'DEGRADED';
    else if (overall >= 0.3) status = 'UNSTABLE';
    else status = 'BROKEN';

    const report: SystemIntegrityReport = {
      frameId, overallHealth: overall,
      snapshotIntegrity: snapInt, pipelineConsistency: pipeCon,
      gpuHealth, pixelStability: pixStab,
      attributionReliability: attrRel, temporalStability: tempStab,
      status, criticalFailures: critical,
    };
    this._lastReport = report;
    return report;
  }

  get lastReport(): SystemIntegrityReport | null { return this._lastReport; }
}

export default SystemIntegrityAuditLayer;
