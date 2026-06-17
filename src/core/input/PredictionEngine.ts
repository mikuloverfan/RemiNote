// ============================================================
//  Phase 9 Step 1: Input Prediction Layer
//  Linear prediction only — no Kalman, no AI, no curves.
//  Predicted points exist ONLY in session.runtime.predictedPoint.
//  NEVER in stroke.points, Workspace, save files, or Undo/Redo.
// ============================================================

export interface PredictedPoint {
  x: number;
  y: number;
  timestamp: number;
}

const PREDICTION_MS = 8;

export class PredictionEngine {
  /**
   * Compute a linear prediction based on the last two real input points.
   *
   *   vx = (b.x - a.x) / dt
   *   vy = (b.y - a.y) / dt
   *   px = b.x + vx * predictionMs
   *   py = b.y + vy * predictionMs
   *
   * @param a  The second-to-last real point (must have t).
   * @param b  The last real point (must have t).
   * @returns  A predicted point, or null if inputs are invalid.
   */
  predict(
    a: { x: number; y: number; t?: number },
    b: { x: number; y: number; t?: number },
  ): PredictedPoint | null {
    if (!a || !b || a.t == null || b.t == null) return null;

    const dt = b.t - a.t;
    if (dt <= 0) return null;

    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;

    return {
      x: b.x + vx * PREDICTION_MS,
      y: b.y + vy * PREDICTION_MS,
      timestamp: performance.now(),
    };
  }
}
