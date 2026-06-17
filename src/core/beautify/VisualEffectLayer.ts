// ============================================================
//  Visual Effect Layer — 笔迹视觉叠加效果
//
//  管理三种叠加效果（不修改原始笔画数据）：
//  1. 🫧 笔画呼吸（Breathing）— 写完即刻触发的微脉动
//  2. 🌊 墨迹波纹（Ripple）— 笔抬起时的扩散波纹
//  3. 💫 完成脉冲（Pulse）— 变形完成时的光晕反馈
//
//  所有效果通过 Canvas 2D 叠加层渲染，不侵入笔画数据。
// ============================================================

// ============================================================
//  Types
// ============================================================

export interface BreathingEffect {
  /** Unique ID */
  id: string;
  /** Stroke IDs this effect applies to */
  strokeIds: string[];
  /** Bounding box of the character cluster */
  bbox: { x: number; y: number; w: number; h: number };
  /** Current phase: 'active' when breathing, 'fading' when being cleared */
  phase: 'active' | 'fading';
  /** Start time (performance.now) */
  startTime: number;
  /** Fade progress 0..1 when in fading phase */
  fadeProgress: number;
  /** Callback to trigger re-render */
  onFrame: (() => void) | null;
  /** Whether this effect is done and can be removed */
  completed: boolean;
}

export interface RippleEffect {
  id: string;
  /** Center position */
  x: number; y: number;
  /** Start time */
  startTime: number;
  /** Duration */
  durationMs: number;
  /** Current radius 0..maxRadius */
  radius: number;
  maxRadius: number;
  /** Current opacity 0..1 */
  opacity: number;
  /** Ripple color */
  color: string;
  /** Completed flag */
  completed: boolean;
  onFrame: (() => void) | null;
}

export interface PulseEffect {
  id: string;
  /** Center position */
  cx: number; cy: number;
  /** Bounding box diagonal for sizing */
  diagonal: number;
  /** Start time */
  startTime: number;
  /** Duration */
  durationMs: number;
  /** Progress 0..1 */
  progress: number;
  /** Completed flag */
  completed: boolean;
  onFrame: (() => void) | null;
}

// ============================================================
//  Visual Effect Layer
// ============================================================

export class VisualEffectLayer {
  private breathings: Map<string, BreathingEffect> = new Map();
  private ripples: Map<string, RippleEffect> = new Map();
  private pulses: Map<string, PulseEffect> = new Map();
  private _ticking = false;
  private _rafId: number | null = null;
  private _overlayCtx: CanvasRenderingContext2D | null = null;

  /** Attach to an overlay canvas context for rendering. */
  attach(ctx: CanvasRenderingContext2D): void {
    this._overlayCtx = ctx;
  }

  /** Detach from canvas. */
  detach(): void {
    this._overlayCtx = null;
  }

  // ==========================================================
  //  🫧 Breathing
  // ==========================================================

  /**
   * Start breathing effect on a set of strokes.
   * Creates a subtle pulsating glow around the character.
   */
  startBreathing(
    strokeIds: string[],
    bbox: { x: number; y: number; w: number; h: number },
    onFrame: () => void,
  ): string {
    const id = `breath-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effect: BreathingEffect = {
      id, strokeIds, bbox,
      phase: 'active',
      startTime: performance.now(),
      fadeProgress: 0,
      onFrame,
      completed: false,
    };
    this.breathings.set(id, effect);
    this._ensureTicking();
    return id;
  }

  /** Stop breathing effect, with smooth fade-out. */
  stopBreathing(id: string): void {
    const effect = this.breathings.get(id);
    if (effect && effect.phase === 'active') {
      effect.phase = 'fading';
      effect.startTime = performance.now(); // reuse for fade timing
    }
  }

  /** Stop all breathing effects immediately. */
  stopAllBreathing(): void {
    for (const [id, effect] of this.breathings) {
      effect.phase = 'fading';
      effect.startTime = performance.now();
    }
  }

  // ==========================================================
  //  🌊 Ripple
  // ==========================================================

  /**
   * Create a ripple effect at a position.
   * Like a water ripple spreading from where the stroke ended.
   */
  startRipple(
    x: number, y: number,
    color: string = '#1a1a1a',
    onFrame: () => void,
  ): string {
    const id = `ripple-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effect: RippleEffect = {
      id, x, y,
      startTime: performance.now(),
      durationMs: 400,
      radius: 0,
      maxRadius: 25,
      opacity: 0.4,
      color,
      completed: false,
      onFrame,
    };
    this.ripples.set(id, effect);
    this._ensureTicking();
    return id;
  }

  // ==========================================================
  //  💫 Pulse
  // ==========================================================

  /**
   * Create a completion pulse effect.
   * A subtle glow that expands and fades around the character.
   */
  startPulse(
    cx: number, cy: number,
    diagonal: number,
    onFrame: () => void,
  ): string {
    const id = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effect: PulseEffect = {
      id, cx, cy, diagonal,
      startTime: performance.now(),
      durationMs: 500,
      progress: 0,
      completed: false,
      onFrame,
    };
    this.pulses.set(id, effect);
    this._ensureTicking();
    return id;
  }

  // ==========================================================
  //  Tick Loop
  // ==========================================================

  private _ensureTicking(): void {
    if (this._ticking) return;
    this._ticking = true;
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  private _tick(): void {
    const now = performance.now();
    const ctx = this._overlayCtx;
    let anyActive = false;

    // ── Step all effects ──
    for (const [id, e] of this.breathings) {
      this._stepBreathing(e, now, ctx);
      if (!e.completed) anyActive = true;
      else this.breathings.delete(id);
    }

    for (const [id, e] of this.ripples) {
      this._stepRipple(e, now, ctx);
      if (!e.completed) anyActive = true;
      else this.ripples.delete(id);
    }

    for (const [id, e] of this.pulses) {
      this._stepPulse(e, now, ctx);
      if (!e.completed) anyActive = true;
      else this.pulses.delete(id);
    }

    if (anyActive) {
      this._rafId = requestAnimationFrame(() => this._tick());
    } else {
      this._ticking = false;
      this._rafId = null;
      // Clear overlay
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    }
  }

  // ==========================================================
  //  Step: Breathing
  // ==========================================================

  private _stepBreathing(e: BreathingEffect, now: number, ctx: CanvasRenderingContext2D | null): void {
    const elapsed = now - e.startTime;

    if (e.phase === 'active') {
      // Breathing oscillation: slow sine wave
      // 0.8Hz = ~1250ms period
      const breathPhase = (elapsed * 0.001) * 0.8 * Math.PI * 2;
      const breathValue = 0.5 + 0.5 * Math.sin(breathPhase); // 0..1 oscillation

      this._renderBreathing(ctx, e.bbox, breathValue);

      e.onFrame?.();

    } else if (e.phase === 'fading') {
      // Fade out over 300ms
      e.fadeProgress = Math.min(1, elapsed / 300);
      const breathValue = 0.5 + 0.5 * Math.sin(elapsed * 0.001 * 0.8 * Math.PI * 2);
      const fadeValue = breathValue * (1 - e.fadeProgress);

      this._renderBreathing(ctx, e.bbox, fadeValue);

      e.onFrame?.();

      if (e.fadeProgress >= 1) {
        e.completed = true;
      }
    }
  }

  private _renderBreathing(
    ctx: CanvasRenderingContext2D | null,
    bbox: { x: number; y: number; w: number; h: number },
    intensity: number,
  ): void {
    if (!ctx) return;

    // Clear previous frame
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Draw breathing glow around character bbox
    const glowRadius = Math.max(bbox.w, bbox.h) * 0.15 * (0.8 + 0.4 * intensity);
    const glowOpacity = 0.08 + 0.06 * intensity;

    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;

    ctx.save();
    ctx.globalAlpha = glowOpacity;

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    gradient.addColorStop(0, 'rgba(80, 80, 200, 0.3)');
    gradient.addColorStop(0.5, 'rgba(80, 80, 200, 0.1)');
    gradient.addColorStop(1, 'rgba(80, 80, 200, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(
      bbox.x - glowRadius,
      bbox.y - glowRadius,
      bbox.w + glowRadius * 2,
      bbox.h + glowRadius * 2,
    );
    ctx.restore();
  }

  // ==========================================================
  //  Step: Ripple
  // ==========================================================

  private _stepRipple(e: RippleEffect, now: number, ctx: CanvasRenderingContext2D | null): void {
    const elapsed = now - e.startTime;
    const t = Math.min(1, elapsed / e.durationMs);

    // Ease out
    const easeT = 1 - Math.pow(1 - t, 2);
    e.radius = e.maxRadius * easeT;
    e.opacity = 0.4 * (1 - easeT);

    if (ctx) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, e.opacity);
      ctx.beginPath();
      ctx.arc(e.x, e.y, Math.max(1, e.radius), 0, Math.PI * 2);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    e.onFrame?.();

    if (t >= 1) {
      e.completed = true;
    }
  }

  // ==========================================================
  //  Step: Pulse
  // ==========================================================

  private _stepPulse(e: PulseEffect, now: number, ctx: CanvasRenderingContext2D | null): void {
    const elapsed = now - e.startTime;
    e.progress = Math.min(1, elapsed / e.durationMs);

    // Pulse: expand and fade
    const baseRadius = e.diagonal * 0.3;
    const expandRadius = baseRadius * (1 + e.progress * 0.8);
    const opacity = 0.2 * (1 - e.progress);

    if (ctx && opacity > 0.01) {
      ctx.save();
      ctx.globalAlpha = opacity;

      const gradient = ctx.createRadialGradient(e.cx, e.cy, 0, e.cx, e.cy, expandRadius);
      gradient.addColorStop(0, 'rgba(100, 100, 255, 0.15)');
      gradient.addColorStop(0.6, 'rgba(100, 100, 255, 0.05)');
      gradient.addColorStop(1, 'rgba(100, 100, 255, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(e.cx - expandRadius, e.cy - expandRadius, expandRadius * 2, expandRadius * 2);
      ctx.restore();
    }

    e.onFrame?.();

    if (e.progress >= 1) {
      e.completed = true;
    }
  }
}

// ============================================================
//  Singleton
// ============================================================

export const visualEffects = new VisualEffectLayer();

export default VisualEffectLayer;
