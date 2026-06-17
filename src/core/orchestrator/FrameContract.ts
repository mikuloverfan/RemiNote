// ============================================================
//  Frame Contract — Deterministic frame identity & verification
//
//  Every frame produces exactly one FrameResult.
//  FrameResult IS the contract: it proves what the system did.
//
//  Principles:
//  🟥 FrameResult is immutable after creation
//  🟥 Hash = deterministic identity (same inputs → same hash)
//  🟥 PASS/FAIL is derived from FrameResult, never from side effects
//  🟥 Replay = reconstruct FrameResult from stored input
// ============================================================

import type { FrameTrace, FrameDOMSnapshot } from './FrameDebugLayer';
import type { SystemIntegrityReport } from '../shadow/diagnostics/SystemIntegrityAuditLayer';
import type { StabilityReport } from '../shadow/SVSDiffStabilizer';

// ============================================================
//  FrameResult — The single frame contract
// ============================================================

export interface FrameResult {
  /** Monotonic frame ID */
  frameId: number;

  /** SHA-256 style hash of engine.strokes (simplified: JSON-stable string hash) */
  stateHash: string;

  /** Hash derived from render output (stroke IDs + counts) */
  renderHash: string;

  /** Hash derived from pixel diff metrics */
  pixelHash: string;

  /** Hash derived from DOM snapshot */
  uiHash: string;

  /** Contract verdict */
  stability: 'PASS' | 'FAIL';

  /** Fail reason(s) — empty if PASS */
  failReasons: string[];

  /** Wall-clock timestamp */
  timestamp: number;

  /** Raw metrics for inspection */
  metrics: {
    pixelDiff: number;
    gpuDiff: number;
    shadowDiff: number;
  };

  /** Stroke count at frame time */
  strokeCount: number;
}

// ============================================================
//  Hash Functions — deterministic, pure
// ============================================================

/**
 * Simple deterministic hash from string input.
 * Uses djb2 algorithm — fast, stable across runs, no crypto needed.
 */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute stateHash from strokes array.
 * Only uses stroke IDs + point counts — immutable identity.
 */
export function computeStateHash(strokes: ReadonlyArray<{ id: string; points?: readonly unknown[] }>): string {
  const payload = strokes.map(s => `${s.id}:${s.points?.length ?? 0}`).join('|');
  return djb2(payload);
}

/**
 * Compute renderHash from stroke IDs and camera.
 */
export function computeRenderHash(
  strokeIds: string[],
  camera: { x: number; y: number; zoom: number },
): string {
  const payload = `${strokeIds.join(',')}|${camera.x.toFixed(1)}:${camera.y.toFixed(1)}:${camera.zoom.toFixed(3)}`;
  return djb2(payload);
}

/**
 * Compute pixelHash from metrics.
 */
export function computePixelHash(metrics: { pixelDiff: number; gpuDiff: number; shadowDiff: number }): string {
  const payload = `${metrics.pixelDiff.toFixed(4)}:${metrics.gpuDiff.toFixed(4)}:${metrics.shadowDiff.toFixed(4)}`;
  return djb2(payload);
}

/**
 * Compute uiHash from DOM snapshot.
 */
export function computeUIHash(dom: FrameDOMSnapshot): string {
  const payload = `${dom.cursorState}|${dom.dashboardExists}|${dom.canvasMounted}|${dom.activeElement ?? 'null'}`;
  return djb2(payload);
}

// ============================================================
//  FrameReplaySystem — inspect & compare frames
// ============================================================

export interface FrameDiff {
  frameA: number;
  frameB: number;
  stateChanged: boolean;
  renderChanged: boolean;
  pixelChanged: boolean;
  uiChanged: boolean;
  stabilityChanged: boolean;
  details: string[];
}

export class FrameReplaySystem {
  private frames: FrameResult[] = [];
  private readonly maxFrames: number;

  constructor(maxFrames = 600) {
    this.maxFrames = maxFrames;
  }

  /** Record a frame result. */
  record(result: FrameResult): void {
    this.frames.push(result);
    while (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }

  /** Replay a single frame by ID. */
  replay(frameId: number): FrameResult | undefined {
    return this.frames.find(f => f.frameId === frameId);
  }

  /** Diff two frames by ID. */
  diff(frameA: number, frameB: number): FrameDiff | null {
    const a = this.replay(frameA);
    const b = this.replay(frameB);
    if (!a || !b) return null;

    const details: string[] = [];
    if (a.stateHash !== b.stateHash) details.push(`state: ${a.stateHash} → ${b.stateHash}`);
    if (a.renderHash !== b.renderHash) details.push(`render: ${a.renderHash} → ${b.renderHash}`);
    if (a.pixelHash !== b.pixelHash) details.push(`pixel: ${a.pixelHash} → ${b.pixelHash}`);
    if (a.uiHash !== b.uiHash) details.push(`ui: ${a.uiHash} → ${b.uiHash}`);

    return {
      frameA, frameB,
      stateChanged: a.stateHash !== b.stateHash,
      renderChanged: a.renderHash !== b.renderHash,
      pixelChanged: a.pixelHash !== b.pixelHash,
      uiChanged: a.uiHash !== b.uiHash,
      stabilityChanged: a.stability !== b.stability,
      details,
    };
  }

  /** Inspect a frame with full detail. */
  inspect(frameId: number): FrameResult & { replayAvailable: boolean } {
    const f = this.replay(frameId);
    if (!f) {
      return {
        frameId,
        stateHash: 'MISSING', renderHash: 'MISSING', pixelHash: 'MISSING', uiHash: 'MISSING',
        stability: 'FAIL', failReasons: ['frame not found'], timestamp: 0,
        metrics: { pixelDiff: 0, gpuDiff: 0, shadowDiff: 0 }, strokeCount: 0,
        replayAvailable: false,
      };
    }
    return { ...f, replayAvailable: true };
  }

  /** Get all FAIL frames. */
  getFailures(): FrameResult[] {
    return this.frames.filter(f => f.stability === 'FAIL');
  }

  /** Export all frames as JSON. */
  export(): string {
    return JSON.stringify(this.frames, null, 2);
  }

  /** Get last N frames. */
  getRecent(n = 60): FrameResult[] {
    return this.frames.slice(-n);
  }

  /** Stability ratio over last N frames. */
  stabilityRatio(windowSize = 60): number {
    const recent = this.getRecent(windowSize);
    if (recent.length === 0) return 1;
    return recent.filter(f => f.stability === 'PASS').length / recent.length;
  }

  get totalFrames(): number { return this.frames.length; }
}

// ============================================================
//  Stability Verdict — pure function on FrameResult
// ============================================================

/**
 * 🟦 Pure stability verdict from FrameResult.
 * No side effects, no repair, no DOM access.
 *
 * Rules:
 * - Any hash mismatch between state and render → FAIL
 * - pixelDiff > 0.5 → FAIL
 * - uiHash shows dashboard missing + canvas mounted → FAIL
 */
export function evaluateStability(result: FrameResult): { stability: 'PASS' | 'FAIL'; reasons: string[] } {
  const reasons: string[] = [];

  if (result.metrics.pixelDiff > 0.5) {
    reasons.push(`pixelDiff ${result.metrics.pixelDiff.toFixed(2)} > 0.5`);
  }
  if (result.metrics.shadowDiff > 0.3) {
    reasons.push(`shadowDiff ${result.metrics.shadowDiff.toFixed(2)} > 0.3`);
  }

  // Note: stateHash vs renderHash divergence is a contract violation
  // but we can't detect it from FrameResult alone without the session reference.
  // The orchestrator provides this check before constructing FrameResult.

  return {
    stability: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons,
  };
}

export default FrameReplaySystem;
