// ============================================================
//  Organic Animation Engine v2 — 生物级笔画动画 + 波传播
//
//  核心机制：
//  1. 弹簧-阻尼物理 — 每个点都是带质量的粒子
//  2. 有机噪声 — 模拟"活"的微动（非随机抖动）
//  3. 三阶段动画 — 苏醒 → 爬行 → 沉淀
//  4. ⭐ 波传播 — 笔画像毛毛虫一样从起点蠕动到终点
//  5. 包围盒约束 — 笔画不超出字的范围
//
//  对标 Apple Notes 的"笔迹重绘"：
//  写完一个字后，所有笔画像生物一样苏醒、爬动、变形，
//  最终沉淀为指定字体的优美形态。
// ============================================================

import type { CharacterStyleRules, TargetStrokeData, CharacterBBox } from './FontStyleSystem';

// ============================================================
//  Types
// ============================================================

export interface AnimationPoint {
  /** Current position */
  x: number;
  y: number;
  /** Original position (start of animation) */
  originX: number;
  originY: number;
  /** Target position (end of animation) */
  targetX: number;
  targetY: number;
  /** Velocity for spring-damper */
  vx: number;
  vy: number;
  /** Normalized position along stroke 0..1 (for wave propagation) */
  t?: number;
}

export interface StrokeAnimation {
  strokeId: string;
  points: AnimationPoint[];
  /** Reference to the original stroke's width for mutation */
  originalWidths?: number[];
  targetWidths?: number[];
}

export interface CharacterAnimation {
  /** Unique animation ID */
  id: string;
  strokes: StrokeAnimation[];
  bbox: CharacterBBox;
  styleRules: CharacterStyleRules;
  /** Animation start time (performance.now) */
  startTime: number;
  /** Target duration */
  durationMs: number;
  /** Current progress 0..1 */
  progress: number;
  /** Current phase */
  phase: AnimationPhase;
  /** Whether animation is complete */
  completed: boolean;
  /** Callback to trigger re-render */
  onFrame: (() => void) | null;
  /** ⭐ Enable wave propagation: points move sequentially from start to end */
  wavePropagation?: boolean;
  /** ⭐ Wave travel time as fraction of total duration (0..1). 0.5 = wave takes half the animation to travel */
  waveTravelFraction?: number;
}

export type AnimationPhase = 'wake' | 'crawl' | 'settle';

// ============================================================
//  Breathing Animation Config
// ============================================================

export interface BreathingConfig {
  amplitude: number;    // px, typically 0.3-1.0
  frequency: number;    // Hz, typically 0.5-1.5
  strokeIds: string[];
}

// ============================================================
//  Simple 2D Noise (hash-based, no external deps)
// ============================================================

function hash2D(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

/** Smooth 2D noise using bilinear interpolation of hash grid. */
function smoothNoise2D(x: number, y: number, scale: number = 0.05): number {
  const sx = x * scale;
  const sy = y * scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;

  // Smoothstep
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const n00 = hash2D(ix, iy);
  const n10 = hash2D(ix + 1, iy);
  const n01 = hash2D(ix, iy + 1);
  const n11 = hash2D(ix + 1, iy + 1);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;

  return nx0 + (nx1 - nx0) * uy;
}

/**
 * Generate organic 2D noise displacement.
 * Uses layered noise for natural, non-repeating movement.
 */
function organicDisplacement(
  x: number,
  y: number,
  time: number,
  amplitude: number,
): { dx: number; dy: number } {
  if (amplitude <= 0) return { dx: 0, dy: 0 };

  // Three octaves of noise for rich organic movement
  const n1 = smoothNoise2D(x + time * 0.3, y, 0.04);
  const n2 = smoothNoise2D(x - time * 0.2, y + time * 0.15, 0.08);
  const n3 = smoothNoise2D(x + time * 0.1, y - time * 0.1, 0.15);

  // Combine octaves with decreasing weights
  const nx = (n1 - 0.5) * 1.0 + (n2 - 0.5) * 0.5 + (n3 - 0.5) * 0.25;
  const ny = (hash2D(y * 3 + time * 0.25, x * 3) - 0.5) * 1.0 +
             (hash2D(y * 5 - time * 0.18, x * 5 + time * 0.12) - 0.5) * 0.5 +
             (hash2D(y * 7 + time * 0.08, x * 7 - time * 0.06) - 0.5) * 0.25;

  return {
    dx: nx * amplitude,
    dy: ny * amplitude,
  };
}

// ============================================================
//  Organic Animation Engine
// ============================================================

export class OrganicAnimationEngine {
  private animations: Map<string, CharacterAnimation> = new Map();
  private _ticking = false;
  private _rafId: number | null = null;

  /** Singleton tick loop — runs requestAnimationFrame while animations are active. */
  private ensureTicking(): void {
    if (this._ticking) return;
    this._ticking = true;
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  private _tick(): void {
    const now = performance.now();
    let anyActive = false;

    for (const [id, anim] of this.animations) {
      if (anim.completed) continue;

      this.stepAnimation(anim, now);
      anyActive = true;

      // Trigger re-render
      anim.onFrame?.();
    }

    // Clean up completed animations
    for (const [id, anim] of this.animations) {
      if (anim.completed) {
        this.animations.delete(id);
      }
    }

    if (anyActive) {
      this._rafId = requestAnimationFrame(() => this._tick());
    } else {
      this._ticking = false;
      this._rafId = null;
    }
  }

  /**
   * Start a character-level animation.
   * @param targetData - Target stroke data with original and target points
   * @param bbox - Character bounding box
   * @param styleRules - Style rules for animation parameters
   * @param strokePointsRefs - Live stroke point arrays (mutated in-place)
   * @param strokeWidthRefs - Live stroke width references
   * @param onFrame - Frame callback
   * @param onComplete - Completion callback
   * @param enableWave - Enable wave propagation (毛毛虫蠕动)
   */
  startCharacterAnimation(
    targetData: TargetStrokeData[],
    bbox: CharacterBBox,
    styleRules: CharacterStyleRules,
    strokePointsRefs: Map<string, { x: number; y: number }[]>,
    strokeWidthRefs: Map<string, { width: number; _penParams?: { strokeWidth?: number } }>,
    onFrame: () => void,
    onComplete: () => void,
    enableWave: boolean = true,
  ): string {
    const id = `anim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const animStrokes: StrokeAnimation[] = [];

    for (const td of targetData) {
      const pts = strokePointsRefs.get(td.strokeId);
      if (!pts || pts.length === 0) continue;

      const animPts: AnimationPoint[] = [];
      const minLen = Math.min(pts.length, td.targetPoints.length);

      // Compute cumulative distance for wave propagation
      const dists: number[] = [0];
      for (let i = 1; i < minLen; i++) {
        dists.push(dists[i - 1] + Math.hypot(
          td.targetPoints[i].x - td.targetPoints[i - 1].x,
          td.targetPoints[i].y - td.targetPoints[i - 1].y
        ));
      }
      const totalLen = dists[dists.length - 1] || 1;

      for (let i = 0; i < minLen; i++) {
        const orig = td.originalPoints[i] ?? pts[i];
        const tgt = td.targetPoints[i];
        animPts.push({
          x: orig.x,
          y: orig.y,
          originX: orig.x,
          originY: orig.y,
          targetX: tgt.x,
          targetY: tgt.y,
          vx: 0,
          vy: 0,
          // ⭐ Normalized position along stroke for wave propagation
          t: dists[i] / totalLen,
        });
      }

      animStrokes.push({
        strokeId: td.strokeId,
        points: animPts,
        originalWidths: td.originalPoints.map((_, i) =>
          strokeWidthRefs.get(td.strokeId)?.width ?? 2,
        ),
        targetWidths: td.targetWidths,
      });
    }

    const anim: CharacterAnimation = {
      id,
      strokes: animStrokes,
      bbox,
      styleRules,
      startTime: performance.now(),
      durationMs: styleRules.animationDurationMs,
      progress: 0,
      phase: 'wake',
      completed: false,
      onFrame: () => {
        // Sync animation points back to actual stroke data
        for (const sa of animStrokes) {
          const pts = strokePointsRefs.get(sa.strokeId);
          if (!pts) continue;
          const minLen = Math.min(pts.length, sa.points.length);
          for (let i = 0; i < minLen; i++) {
            pts[i].x = sa.points[i].x;
            pts[i].y = sa.points[i].y;
          }
          // Sync widths if available
          if (sa.targetWidths && sa.originalWidths) {
            const strokeRef = strokeWidthRefs.get(sa.strokeId);
            if (strokeRef) {
              const t = anim.progress;
              const avgOrig = sa.originalWidths.reduce((a, b) => a + b, 0) / sa.originalWidths.length;
              const avgTgt = sa.targetWidths.reduce((a, b) => a + b, 0) / sa.targetWidths.length;
              const newWidth = avgOrig + (avgTgt - avgOrig) * t;
              strokeRef.width = newWidth;
              if (strokeRef._penParams) {
                strokeRef._penParams.strokeWidth = newWidth;
              }
            }
          }
        }
        onFrame();
      },
      // ⭐ Wave propagation: points propagate from start to end like a caterpillar
      wavePropagation: enableWave,
      waveTravelFraction: 0.5, // wave takes 50% of total duration to travel
    };

    this.animations.set(id, anim);
    this.ensureTicking();

    // Schedule completion
    const checkComplete = () => {
      const a = this.animations.get(id);
      if (!a || a.completed) {
        onComplete();
        return;
      }
      requestAnimationFrame(checkComplete);
    };
    requestAnimationFrame(checkComplete);

    return id;
  }

  /** Cancel a running animation immediately. */
  cancelAnimation(id: string): void {
    const anim = this.animations.get(id);
    if (anim) {
      anim.completed = true;
      this.animations.delete(id);
    }
  }

  /** Cancel all running animations. */
  cancelAll(): void {
    this.animations.clear();
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._ticking = false;
  }

  get activeCount(): number {
    return this.animations.size;
  }

  // ==========================================================
  //  Animation Step
  // ==========================================================

  private stepAnimation(anim: CharacterAnimation, now: number): void {
    const elapsed = now - anim.startTime;
    const rawProgress = Math.min(1, elapsed / anim.durationMs);

    // Determine phase
    if (rawProgress < 0.2) {
      anim.phase = 'wake';
    } else if (rawProgress < 0.85) {
      anim.phase = 'crawl';
    } else {
      anim.phase = 'settle';
    }

    // Compute eased progress (global)
    const globalT = this.easeProgress(rawProgress, anim.phase);
    anim.progress = rawProgress;

    const rules = anim.styleRules;
    const bbox = anim.bbox;

    // Noise amplitude varies by phase
    const noiseAmp = this.getPhaseNoise(rules.organicNoise, anim.phase, rawProgress);

    // Spring parameters vary by phase
    const stiffness = this.getPhaseStiffness(rules.springStiffness, anim.phase);
    const damping = rules.springDamping;

    for (const sa of anim.strokes) {
      for (let i = 0; i < sa.points.length; i++) {
        const p = sa.points[i];

        // ⭐ Wave propagation: compute local progress based on position along stroke
        let localT = globalT;
        if (anim.wavePropagation && anim.waveTravelFraction) {
          // Wave delay: points at the start (t=0) move first, points at end (t=1) move last
          // The wave takes `waveTravelFraction` of total duration to traverse the stroke
          const waveFront = Math.min(1, globalT / anim.waveTravelFraction);
          const pointDelay = (p.t ?? 0) * anim.waveTravelFraction;
          // localT is only active after the wave front passes this point
          if (globalT < pointDelay) {
            // This point hasn't started yet — stay at origin
            localT = 0;
          } else {
            // This point is active — remap its progress
            localT = (globalT - pointDelay) / (1 - pointDelay);
            localT = Math.min(1, Math.max(0, localT));
          }
        }

        // ── Spring force toward target ──
        const targetX = p.originX + (p.targetX - p.originX) * localT;
        const targetY = p.originY + (p.targetY - p.originY) * localT;

        const springFx = (targetX - p.x) * stiffness;
        const springFy = (targetY - p.y) * stiffness;

        // ── Organic noise ──
        const noise = organicDisplacement(p.x, p.y, elapsed * 0.001, noiseAmp);

        // ── Velocity update (semi-implicit Euler) ──
        p.vx = (p.vx + springFx) * damping + noise.dx * (1 - damping);
        p.vy = (p.vy + springFy) * damping + noise.dy * (1 - damping);

        // ── Position update ──
        let newX = p.x + p.vx;
        let newY = p.y + p.vy;

        // ── Bounding box constraint (soft clamp with bounce) ──
        const margin = 3; // px margin inside bbox
        const minX = bbox.x - margin;
        const maxX = bbox.x + bbox.w + margin;
        const minY = bbox.y - margin;
        const maxY = bbox.y + bbox.h + margin;

        if (newX < minX) {
          newX = minX;
          p.vx *= -0.4; // bounce
        } else if (newX > maxX) {
          newX = maxX;
          p.vx *= -0.4;
        }

        if (newY < minY) {
          newY = minY;
          p.vy *= -0.4;
        } else if (newY > maxY) {
          newY = maxY;
          p.vy *= -0.4;
        }

        p.x = newX;
        p.y = newY;
      }
    }

    // Mark complete
    if (rawProgress >= 1) {
      // Snap to exact targets
      for (const sa of anim.strokes) {
        for (const p of sa.points) {
          p.x = p.targetX;
          p.y = p.targetY;
          p.vx = 0;
          p.vy = 0;
        }
      }
      anim.completed = true;
    }
  }

  // ==========================================================
  //  Easing
  // ==========================================================

  private easeProgress(t: number, phase: AnimationPhase): number {
    switch (phase) {
      case 'wake':
        // Slow start — strokes "wake up" gently
        return this.easeOutBack(t / 0.2) * 0.15;
      case 'crawl':
        // Main movement — ease in-out with slight overshoot
        const ct = (t - 0.2) / 0.65; // normalize to 0..1 within crawl phase
        return 0.15 + (1 - 0.15) * this.easeInOutElastic(ct);
      case 'settle':
        // Fine settling — slow approach
        const st = (t - 0.85) / 0.15;
        return 0.85 + 0.15 * this.easeOutExpo(st);
      default:
        return t;
    }
  }

  private easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  private easeInOutElastic(t: number): number {
    const c5 = (2 * Math.PI) / 4.5;
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  }

  private easeOutExpo(t: number): number {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  // ==========================================================
  //  Phase-dependent parameters
  // ==========================================================

  private getPhaseNoise(baseNoise: number, phase: AnimationPhase, progress: number): number {
    switch (phase) {
      case 'wake':
        // High noise at wake — strokes "shiver" awake
        return baseNoise * 1.5 * (progress / 0.2);
      case 'crawl':
        // Moderate noise — organic crawling
        return baseNoise * (1 - (progress - 0.2) * 0.3);
      case 'settle':
        // Low noise — calming down
        const settleProgress = (progress - 0.85) / 0.15;
        return baseNoise * 0.3 * (1 - settleProgress);
      default:
        return baseNoise;
    }
  }

  private getPhaseStiffness(baseStiffness: number, phase: AnimationPhase): number {
    switch (phase) {
      case 'wake':
        // Very soft — just wobbling
        return baseStiffness * 0.3;
      case 'crawl':
        // Full strength — moving to target
        return baseStiffness * 1.0;
      case 'settle':
        // Extra strong — precise final positioning
        return baseStiffness * 2.0;
      default:
        return baseStiffness;
    }
  }
}

// ============================================================
//  Singleton
// ============================================================

export const organicAnimation = new OrganicAnimationEngine();

export default OrganicAnimationEngine;
