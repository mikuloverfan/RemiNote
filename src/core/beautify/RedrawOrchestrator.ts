// ============================================================
//  Redraw Orchestrator v2 — 体验优先分层流水线
//
//  不再依赖 OCR 作为主路径。
//  改为四层体验金字塔，每层都有可视效果：
//
//  Layer 0 (0ms):  🫧 笔画呼吸 + 🌊 墨迹波纹
//  Layer 1 (800ms): ✨ 几何美化（smooth + align + normalize）
//  Layer 2 (800ms): 🎨 风格化增强（方向量化 + 横细竖粗）
//
//  所有变换通过 OrganicAnimationEngine 做波传播动画。
//  PaddleOCR/ONNX/Tesseract 已移除，main.js 减小 ~35MB。
// ============================================================

import { getFontStyle } from './FontStyleSystem';
import type { FontStyleId, FontStyleDefinition, TargetStrokeData, CharacterBBox } from './FontStyleSystem';
import { beautifyStroke, aggressiveBeautifyStroke } from './StrokeBeautifyEngine';
import type { BeautifyConfig } from './StrokeBeautifyEngine';
import { organicAnimation } from './OrganicAnimationEngine';
import { visualEffects } from './VisualEffectLayer';
import { computeBBox } from './FontGlyphEngine';

// ============================================================
//  Types
// ============================================================

export type { FontStyleId } from './FontStyleSystem';

export interface RedrawConfig {
  enabled: boolean;
  styleId: FontStyleId;
  pauseMs: number;
  /** Layer 1: beautify strength (0-1) */
  beautifyStrength: number;
  /** Layer 2: stylize strength (0-1) */
  stylizeStrength: number;
}

export const DEFAULT_REDRAW_CONFIG: RedrawConfig = {
  enabled: false,
  styleId: 'kaiShu',
  pauseMs: 800,
  beautifyStrength: 0.6,
  stylizeStrength: 0.5,
};

export interface RedrawSession {
  engine: {
    strokes: Array<{
      id: string;
      points: Array<{ x: number; y: number; t?: number }>;
      width?: number;
      color?: string;
      _penParams?: Record<string, unknown>;
    }>;
  };
  markDirty: (strokeId?: string) => void;
  requestFullRebuild: () => void;
  strokeCache?: { clear(): void };
}

// ============================================================
//  RedrawOrchestrator
// ============================================================

export class RedrawOrchestrator {
  config: RedrawConfig = { ...DEFAULT_REDRAW_CONFIG };
  private _pendingIds: string[] = [];
  private _pendingBBox: { x: number; y: number; w: number; h: number } | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _sessionRef: RedrawSession | null = null;
  /** Map from strokeId to breathing effect ID for cleanup */
  private _breathingMap: Map<string, string> = new Map();

  constructor() {}

  // ==========================================================
  //  Public
  // ==========================================================

  onStrokeEnd(session: RedrawSession): void {
    if (!this.config.enabled) return;
    const eng = session.engine;
    if (eng.strokes.length === 0) return;

    this._sessionRef = session;

    const lastStroke = eng.strokes[eng.strokes.length - 1];
    if (!lastStroke) return;
    if (!this._pendingIds.includes(lastStroke.id)) {
      this._pendingIds.push(lastStroke.id);
    }

    // ── 🫧 Layer 0: Immediate visual feedback ──
    this._startBreathingForPending(session);

    // 🌊 Ripple at stroke end
    const lastPt = lastStroke.points[lastStroke.points.length - 1];
    if (lastPt) {
      visualEffects.startRipple(
        lastPt.x, lastPt.y,
        (lastStroke as any)?.color || '#1a1a1a',
        () => { try { session.markDirty(); } catch {} },
      );
    }

    // Spatial trigger
    if (this._pendingBBox && lastStroke.points.length > 0) {
      const pt = lastStroke.points[0];
      const b = this._pendingBBox;
      const dist = Math.hypot(
        Math.max(0, b.x - pt.x, pt.x - (b.x + b.w)),
        Math.max(0, b.y - pt.y, pt.y - (b.y + b.h))
      );
      if (dist > Math.max(b.w, b.h) * 2) {
        this._triggerRedraw();
        this._pendingIds = [lastStroke.id];
        this._pendingBBox = null;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      }
    }

    const pendingStrokes = eng.strokes.filter(s => this._pendingIds.includes(s.id));
    this._pendingBBox = computeBBox(pendingStrokes);

    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._triggerRedraw(), this.config.pauseMs);
  }

  setFontStyle(styleId: FontStyleId): void { this.config.styleId = styleId; }
  get currentStyle(): FontStyleDefinition { return getFontStyle(this.config.styleId); }

  reset(): void {
    this._pendingIds = [];
    this._pendingBBox = null;
    visualEffects.stopAllBreathing();
    this._breathingMap.clear();
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._sessionRef = null;
  }

  // ==========================================================
  //  Layer 0: Breathing
  // ==========================================================

  private _startBreathingForPending(session: RedrawSession): void {
    const eng = session.engine;
    const pendingStrokes = eng.strokes.filter(s =>
      this._pendingIds.includes(s.id) && !(s as any)._done
    );
    if (pendingStrokes.length === 0) return;

    // Stop previous breathing for these strokes
    for (const s of pendingStrokes) {
      const breathId = this._breathingMap.get(s.id);
      if (breathId) {
        visualEffects.stopBreathing(breathId);
      }
    }

    const bbox = computeBBox(pendingStrokes);

    const breathId = visualEffects.startBreathing(
      pendingStrokes.map(s => s.id),
      bbox,
      () => { try { session.markDirty(); } catch {} },
    );

    for (const s of pendingStrokes) {
      this._breathingMap.set(s.id, breathId);
    }
  }

  // ==========================================================
  //  Trigger Redraw (Layers 1-2)
  // ==========================================================

  private _triggerRedraw(): void {
    const session = this._sessionRef;
    if (!session) return;
    const eng = session.engine;
    this._timer = null;

    const fresh = eng.strokes.filter(s => s.points && s.points.length >= 1 && !(s as any)._done);
    if (fresh.length === 0) return;

    const clusters = this._clusterStrokes(fresh);
    if (clusters.length === 0) return;

    for (const clusterIds of clusters) {
      const strokes = eng.strokes.filter(s => clusterIds.has(s.id) && !(s as any)._done);
      if (strokes.length === 0) continue;

      const bbox = computeBBox(strokes);

      // Stop breathing for these strokes
      for (const s of strokes) {
        const breathId = this._breathingMap.get(s.id);
        if (breathId) {
          visualEffects.stopBreathing(breathId);
        }
      }

      // ── Layer 1 + 2: Beautification & Stylization ──
      this._applyBeautify(session, strokes, bbox);
    }

    this._pendingIds = [];
    this._pendingBBox = null;
  }

  // ==========================================================
  //  Layer 1 + 2: Geometric Beautification + Stylization
  // ==========================================================

  private _applyBeautify(
    session: RedrawSession,
    strokes: RedrawSession['engine']['strokes'],
    bbox: CharacterBBox,
  ): void {
    const style = this.currentStyle;
    const beautifyConfig: Partial<BeautifyConfig> = {
      ...style.beautify,
      strength: this.config.beautifyStrength,
    };

    const targetData: TargetStrokeData[] = [];
    const strokePointsRefs = new Map<string, { x: number; y: number }[]>();
    const strokeWidthRefs = new Map<string, any>();

    for (const s of strokes) {
      if (s.points.length < 2) continue;

      const originalPts = s.points.map(p => ({ x: p.x, y: p.y }));

      // Layer 1: basic beautify (smooth + align)
      let beautifiedPts = beautifyStroke(originalPts, beautifyConfig as BeautifyConfig);

      // Layer 2: if enabled, apply aggressive stylization
      if (this.config.stylizeStrength > 0.1) {
        const stylized = aggressiveBeautifyStroke(
          beautifiedPts,
          this.config.styleId,
          s.width ?? 2,
        );
        // Blend between beautify and stylized based on strength
        const blend = this.config.stylizeStrength;
        if (stylized.points.length === beautifiedPts.length) {
          for (let i = 0; i < beautifiedPts.length; i++) {
            beautifiedPts[i] = {
              x: beautifiedPts[i].x + (stylized.points[i].x - beautifiedPts[i].x) * blend,
              y: beautifiedPts[i].y + (stylized.points[i].y - beautifiedPts[i].y) * blend,
            };
          }
        }
      }

      const targetWidths = beautifiedPts.map(() => s.width ?? 2);

      targetData.push({
        strokeId: s.id,
        originalPoints: originalPts,
        targetPoints: beautifiedPts,
        targetWidths,
      });

      strokePointsRefs.set(s.id, s.points as any);
      strokeWidthRefs.set(s.id, s);
    }

    if (targetData.length === 0) return;

    // Mark strokes as done (they're now being animated)
    for (const s of strokes) {
      (s as any)._done = true;
    }

    const charBBox: CharacterBBox = {
      x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h,
      cx: bbox.x + bbox.w / 2, cy: bbox.y + bbox.h / 2,
    };

    organicAnimation.startCharacterAnimation(
      targetData,
      charBBox,
      style.character,
      strokePointsRefs,
      strokeWidthRefs,
      () => {
        try { session.markDirty(); } catch {}
      },
      () => {
        // 💫 Completion pulse
        visualEffects.startPulse(
          charBBox.cx, charBBox.cy,
          Math.hypot(charBBox.w, charBBox.h),
          () => { try { session.markDirty(); } catch {} },
        );
        try {
          session.strokeCache?.clear();
          session.markDirty();
          session.requestFullRebuild();
        } catch {}
      },
      true, // enableWave
    );
  }

  // ==========================================================
  //  Stroke Clustering
  // ==========================================================

  private _clusterStrokes(
    strokes: Array<{ id: string; points: Array<{ x: number; y: number; t?: number }> }>,
  ): Set<string>[] {
    if (strokes.length === 0) return [];
    const clusters: Set<string>[] = [];
    let current = new Set<string>([strokes[0].id]);
    let currentBBox = computeBBox([strokes[0]] as any);

    for (let i = 1; i < strokes.length; i++) {
      const s = strokes[i];
      const firstPt = s.points[0];
      if (!firstPt) { current.add(s.id); continue; }
      const dist = Math.hypot(
        Math.max(0, currentBBox.x - firstPt.x, firstPt.x - (currentBBox.x + currentBBox.w)),
        Math.max(0, currentBBox.y - firstPt.y, firstPt.y - (currentBBox.y + currentBBox.h))
      );
      if (dist > Math.max(currentBBox.w, currentBBox.h) * 2) {
        clusters.push(current);
        current = new Set<string>([s.id]);
        currentBBox = computeBBox([s] as any);
      } else {
        current.add(s.id);
        const allStrokes = strokes.filter(x => current.has(x.id));
        currentBBox = computeBBox(allStrokes as any);
      }
    }
    if (current.size > 0) clusters.push(current);
    return clusters;
  }
}

export default RedrawOrchestrator;
