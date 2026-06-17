// ============================================================
//  Render Divergence Root Cause Engine (RDRCE) — V2 PIXEL_DRIFT
// ============================================================

import type { FrameSnapshot } from '../FrameSnapshot';
import type { RenderVsSnapshotDiff } from '../RenderGroundTruthTap';
import type { CanvasExecutionTrace } from '../ExecutionTraceHook';
import type { RenderDiffResult } from '../RenderDiffEngine';
import type { RenderAlignmentResult } from '../gpu/GPUAlignmentEngine';
import type { RenderTruthResult } from '../arbitration/RenderTruthModel';

// ============================================================
//  Types
// ============================================================

export type PrimaryCause =
  | 'DATA_MUTATION'
  | 'RENDER_MISORDER'
  | 'CACHE_INVALIDATION'
  | 'GPU_DIVERGENCE'
  | 'INPUT_DESYNC'
  | 'PIXEL_DRIFT'
  | 'UNKNOWN';

export interface EvidenceItem { source: string; signal: string; weight: number; }
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface RootCauseReport {
  frameId: number;
  primaryCause: PrimaryCause;
  confidence: number;
  evidence: EvidenceItem[];
  secondaryCauses: string[];
  explanation: string;
  severity: Severity;
  _signalStrengths: Record<PrimaryCause, number>;
}

export interface DivergenceInput {
  snapshot: FrameSnapshot;
  renderTap: RenderVsSnapshotDiff | null;
  executionTrace: CanvasExecutionTrace | null;
  shadowDiff: RenderDiffResult | null;
  gpuAlignment: RenderAlignmentResult | null;
  arbitration: RenderTruthResult | null;
  pixelReport: import('../pixel/PixelTruthDiffEngine').PixelMismatchReport | null;
}

// ============================================================
//  Constants
// ============================================================

const WEIGHTS = { renderTap: 0.35, execTrace: 0.30, shadowDiff: 0.15, gpuAlignment: 0.15, arbitration: 0.05 } as const;

const ALL_CAUSES: PrimaryCause[] = [
  'DATA_MUTATION', 'RENDER_MISORDER', 'CACHE_INVALIDATION',
  'GPU_DIVERGENCE', 'INPUT_DESYNC', 'PIXEL_DRIFT', 'UNKNOWN',
];

// ============================================================
//  RenderDivergenceRootCauseEngine
// ============================================================

export class RenderDivergenceRootCauseEngine {
  private _enabled = false;
  private _lastReport: RootCauseReport | null = null;

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  analyze(input: DivergenceInput): RootCauseReport {
    const frameId = input.snapshot.frameId;
    const signals = this._collectSignals(input);

    let primaryCause: PrimaryCause = 'UNKNOWN';
    let maxSignal = 0;
    for (const cause of ALL_CAUSES) {
      if (signals.get(cause)! > maxSignal) { maxSignal = signals.get(cause)!; primaryCause = cause; }
    }

    const entropy = this._computeEntropy(signals);
    const confidence = Math.max(0, Math.min(1, maxSignal - entropy));
    const evidence = this._buildEvidence(input, primaryCause);

    const secondaryCauses: string[] = [];
    for (const cause of ALL_CAUSES) {
      const s = signals.get(cause)!;
      if (cause !== primaryCause && s > 0.15) secondaryCauses.push(`${cause} (${(s * 100).toFixed(0)}%)`);
    }

    const explanation = this._buildExplanation(primaryCause, evidence, input);
    const severity = this._computeSeverity(maxSignal, secondaryCauses.length, input);

    const report: RootCauseReport = {
      frameId, primaryCause, confidence, evidence, secondaryCauses, explanation, severity,
      _signalStrengths: Object.fromEntries(signals) as Record<PrimaryCause, number>,
    };
    this._lastReport = report;
    return report;
  }

  get lastReport(): RootCauseReport | null { return this._lastReport; }

  // ==========================================================
  //  Signal Collection
  // ==========================================================

  private _collectSignals(input: DivergenceInput): Map<PrimaryCause, number> {
    const s = new Map<PrimaryCause, number>();
    for (const c of ALL_CAUSES) s.set(c, 0);
    const { renderTap, executionTrace, shadowDiff, gpuAlignment, arbitration, pixelReport } = input;

    // DATA_MUTATION
    let dm = 0;
    if (renderTap) { if (renderTap.missingFromRender.length > 0) dm += 0.4; if (renderTap.extraInRender.length > 0) dm += 0.3; if (!renderTap.consistent) dm += 0.2; }
    if (shadowDiff && !shadowDiff.isClean) dm += 0.1;
    s.set('DATA_MUTATION', Math.min(1, dm) * WEIGHTS.renderTap);

    // RENDER_MISORDER
    let rm = 0;
    if (renderTap && !renderTap.orderMatch) rm += 0.6;
    if (executionTrace && renderTap) { if (renderTap.renderedStrokeCount === executionTrace.counts.stroke && !renderTap.orderMatch) rm += 0.3; }
    s.set('RENDER_MISORDER', Math.min(1, rm) * WEIGHTS.renderTap);

    // CACHE_INVALIDATION
    let ci = 0;
    if (renderTap && renderTap.missingFromRender.length > 0) { if (executionTrace && executionTrace.counts.stroke > 0) ci += 0.5; if (shadowDiff?.isClean && gpuAlignment?.isAligned) ci += 0.4; }
    if (arbitration && arbitration.status !== 'unstable' && renderTap && !renderTap.consistent) ci += 0.1;
    s.set('CACHE_INVALIDATION', Math.min(1, ci) * WEIGHTS.renderTap);

    // GPU_DIVERGENCE
    let gs = 0;
    if (gpuAlignment) { if (!gpuAlignment.isAligned) gs += 0.5; if (gpuAlignment.metrics.strokeLossRate > 0) gs += 0.3; if (gpuAlignment.metrics.gpuDrift > 0) gs += 0.1; }
    if (shadowDiff?.isClean && gpuAlignment && !gpuAlignment.isAligned) gs += 0.1;
    s.set('GPU_DIVERGENCE', Math.min(1, gs) * WEIGHTS.gpuAlignment);

    // INPUT_DESYNC
    let is_ = 0;
    if (arbitration) { if (arbitration.metrics.driftScore > 1) is_ += 0.4; if (arbitration.status === 'drifting') is_ += 0.3; }
    if (gpuAlignment && gpuAlignment.metrics.gpuDrift > 0) is_ += 0.2;
    if (shadowDiff && !shadowDiff.isClean && renderTap?.consistent) is_ += 0.1;
    s.set('INPUT_DESYNC', Math.min(1, is_) * WEIGHTS.execTrace);

    // PIXEL_DRIFT — external ground truth, highest authority
    let pd = 0;
    if (pixelReport) {
      if (pixelReport.severity === 'critical') pd += 0.8;
      else if (pixelReport.severity === 'major') pd += 0.5;
      else if (pixelReport.severity === 'minor') pd += 0.2;
      if (pixelReport.isFrozen) pd += 0.2;
      if (pixelReport.contentMismatch) pd += 0.6;
      if (pixelReport.cpuVsGpuHash && !pixelReport.cpuVsGpuHash.startsWith('match')) pd += 0.3;
      if (pixelReport.cpuVsShadowHash && !pixelReport.cpuVsShadowHash.startsWith('match')) pd += 0.2;
    }
    s.set('PIXEL_DRIFT', Math.min(1, pd) * 0.5);

    // UNKNOWN
    const maxOther = Math.max(
      s.get('DATA_MUTATION')!, s.get('RENDER_MISORDER')!, s.get('CACHE_INVALIDATION')!,
      s.get('GPU_DIVERGENCE')!, s.get('INPUT_DESYNC')!, s.get('PIXEL_DRIFT')!,
    );
    s.set('UNKNOWN', (maxOther < 0.15 ? 0.5 : 0) * 0.3);

    return s;
  }

  private _computeEntropy(signals: Map<PrimaryCause, number>): number {
    const values = ALL_CAUSES.map(c => signals.get(c)!);
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let e = 0;
    for (const v of values) { if (v > 0) { const p = v / total; e -= p * Math.log2(p); } }
    return e / Math.log2(ALL_CAUSES.length);
  }

  // ==========================================================
  //  Evidence Chain
  // ==========================================================

  private _buildEvidence(input: DivergenceInput, cause: PrimaryCause): EvidenceItem[] {
    const ev: EvidenceItem[] = [];
    const { renderTap, executionTrace, shadowDiff, gpuAlignment, arbitration, snapshot, pixelReport } = input;

    switch (cause) {
      case 'DATA_MUTATION':
        if (renderTap?.missingFromRender.length) ev.push({ source: 'renderTap', signal: `${renderTap.missingFromRender.length} strokes in snapshot but not rendered`, weight: 0.4 });
        if (renderTap?.extraInRender.length) ev.push({ source: 'renderTap', signal: `${renderTap.extraInRender.length} rendered but not in snapshot`, weight: 0.3 });
        if (shadowDiff && !shadowDiff.isClean) ev.push({ source: 'shadowDiff', signal: `Shadow disagrees`, weight: 0.15 });
        if (gpuAlignment && !gpuAlignment.isAligned) ev.push({ source: 'gpuAlignment', signal: `GPU disagrees`, weight: 0.15 });
        break;
      case 'RENDER_MISORDER':
        if (renderTap && !renderTap.orderMatch) ev.push({ source: 'renderTap', signal: 'Order mismatch', weight: 0.6 });
        if (executionTrace) ev.push({ source: 'execTrace', signal: `${executionTrace.counts.stroke} stroke() calls`, weight: 0.3 });
        ev.push({ source: 'snapshot', signal: `${snapshot.strokes.length} strokes`, weight: 0.1 });
        break;
      case 'CACHE_INVALIDATION':
        if (renderTap?.missingFromRender.length) ev.push({ source: 'renderTap', signal: `${renderTap.missingFromRender.length} missing — cache stale`, weight: 0.5 });
        if (shadowDiff?.isClean) ev.push({ source: 'shadowDiff', signal: 'Shadow agrees — cache outlier', weight: 0.25 });
        if (gpuAlignment?.isAligned) ev.push({ source: 'gpuAlignment', signal: 'GPU agrees — cache outlier', weight: 0.25 });
        break;
      case 'GPU_DIVERGENCE':
        if (gpuAlignment?.metrics.strokeLossRate) ev.push({ source: 'gpuAlignment', signal: `GPU loss: ${(gpuAlignment.metrics.strokeLossRate * 100).toFixed(1)}%`, weight: 0.5 });
        if (gpuAlignment?.metrics.gpuDrift) ev.push({ source: 'gpuAlignment', signal: `GPU drift: ${gpuAlignment.metrics.gpuDrift}`, weight: 0.25 });
        if (shadowDiff?.isClean) ev.push({ source: 'shadowDiff', signal: 'Shadow agrees — GPU outlier', weight: 0.25 });
        break;
      case 'INPUT_DESYNC':
        if (arbitration?.status === 'drifting') ev.push({ source: 'arbitration', signal: 'System drifting', weight: 0.4 });
        if (gpuAlignment?.metrics.gpuDrift) ev.push({ source: 'gpuAlignment', signal: `Frame drift: ${gpuAlignment.metrics.gpuDrift}`, weight: 0.3 });
        if (executionTrace) ev.push({ source: 'execTrace', signal: `${(executionTrace.frameEnd - executionTrace.frameStart).toFixed(1)}ms`, weight: 0.3 });
        break;
      case 'PIXEL_DRIFT':
        if (pixelReport) {
          ev.push({ source: 'pixelTruth', signal: `Severity: ${pixelReport.severity}`, weight: 0.4 });
          if (pixelReport.isFrozen) ev.push({ source: 'pixelTruth', signal: `Frozen: ${pixelReport.frozenFrameCount} frames`, weight: 0.3 });
          if (pixelReport.contentMismatch) ev.push({ source: 'pixelTruth', signal: 'Content missing from canvas', weight: 0.3 });
          if (pixelReport.cpuVsGpuHash && !pixelReport.cpuVsGpuHash.startsWith('match')) ev.push({ source: 'pixelTruth', signal: 'GPU pixel divergence', weight: 0.2 });
        }
        break;
      case 'UNKNOWN':
        ev.push({ source: 'system', signal: 'Multi-system conflict', weight: 0.5 });
        if (arbitration && !arbitration.decision.acceptFrame) ev.push({ source: 'arbitration', signal: arbitration.decision.reason, weight: 0.5 });
        break;
    }
    return ev;
  }

  // ==========================================================
  //  Explanation
  // ==========================================================

  private _buildExplanation(cause: PrimaryCause, evidence: EvidenceItem[], _input: DivergenceInput): string {
    const top = evidence.slice(0, 3).map(e => e.signal).join('; ');
    switch (cause) {
      case 'DATA_MUTATION': return `Stroke data modified mid-frame. ${top}.`;
      case 'RENDER_MISORDER': return `Render order mismatch. ${top}.`;
      case 'CACHE_INVALIDATION': return `Path2D cache dropped valid strokes. ${top}.`;
      case 'GPU_DIVERGENCE': return `GPU encoder/shader divergence. ${top}.`;
      case 'INPUT_DESYNC': return `Temporal/input desync. ${top}.`;
      case 'PIXEL_DRIFT': return `External pixel truth shows visual divergence despite structural consistency. ${top}. The canvas output does not match render intent — possible cache artifact, shader error, or dropped draw calls.`;
      case 'UNKNOWN': return `No dominant cause. ${top}.`;
    }
  }

  private _computeSeverity(maxSignal: number, secondaryCount: number, input: DivergenceInput): Severity {
    if (maxSignal > 0.7 && secondaryCount >= 2) return 'critical';
    if (input.pixelReport && input.pixelReport.severity === 'critical') return 'critical';
    if (input.gpuAlignment && !input.gpuAlignment.isAligned && maxSignal > 0.5) return 'critical';
    if (maxSignal > 0.6) return 'high';
    if (maxSignal > 0.3) return 'medium';
    return 'low';
  }
}

export default RenderDivergenceRootCauseEngine;
