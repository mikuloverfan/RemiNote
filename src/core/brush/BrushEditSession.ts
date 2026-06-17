// ============================================================
//  Phase 4.2.2: Brush Edit Session ‚Ä?Immutable Editing Isolation
//
//  UI ÁºñËæë brush ‚Ü?workingBrush (deepClone)
//  engine.brush ‚Ü?unchanged until "apply"
//  Registry ‚Ü?unchanged until "apply"
// ============================================================

import type { Brush } from './BrushModel';
import LogManager from '../debug/LogManager';

import type { FeelConfig } from '../feel/FeelConfig';
import LogManager from '../debug/LogManager';


// ============================================================
//  Types
// ============================================================

export interface BrushEditSession {
  sessionId: string;
  originalPresetId: string;
  workingBrush: Brush;
  workingFeel: FeelConfig;
  status: 'editing' | 'applied' | 'canceled';
  createdAt: number;
}

// ============================================================
//  Deep clone helpers
// ============================================================

function cloneBrush(b: Brush): Brush {
  return { id: b.id, size: b.size, hardness: b.hardness, smoothing: b.smoothing, velocitySensitivity: b.velocitySensitivity, pressureCurve: b.pressureCurve, taperStart: b.taperStart, taperEnd: b.taperEnd };
}

function cloneFeel(f: FeelConfig): FeelConfig {
  return { microJitter: f.microJitter, velocityDamping: f.velocityDamping, pressureResponse: f.pressureResponse, taperCurve: f.taperCurve, strokeAdhesion: f.strokeAdhesion };
}

// ============================================================
//  Session Store (module-level, one active session at a time)
// ============================================================

let _session: BrushEditSession | null = null;
let _idCounter = 0;

export const BrushEditSession = {
  /** Create a new edit session from a preset's brush/feel. Auto-closes previous session. */
  create(presetId: string, brush: Brush, feel: FeelConfig): BrushEditSession {
    if (_session) {
      LogManager.warn("workspace", '[BrushEditSession] ‚ö†Ô∏è auto-closing previous session:', _session.sessionId);
    }
    _session = {
      sessionId: `edit-${++_idCounter}`,
      originalPresetId: presetId,
      workingBrush: cloneBrush(brush),
      workingFeel: cloneFeel(feel),
      status: 'editing',
      createdAt: Date.now(),
    };
    return _session;
  },

  /** Get current session or null. */
  get(): BrushEditSession | null {
    return _session;
  },

  /** Update workingBrush fields. */
  updateBrush(patch: Partial<Brush>): void {
    if (!_session || _session.status !== 'editing') return;
    Object.assign(_session.workingBrush, patch);
  },

  /** Update workingFeel fields. */
  updateFeel(patch: Partial<FeelConfig>): void {
    if (!_session || _session.status !== 'editing') return;
    Object.assign(_session.workingFeel, patch);
  },

  /** Reset workingBrush/Feel to original (re-read from registry). */
  resetToOriginal(brush: Brush, feel: FeelConfig): void {
    if (!_session) return;
    _session.workingBrush = cloneBrush(brush);
    _session.workingFeel = cloneFeel(feel);
  },

  /** Mark as applied. Caller handles registry/engine write. */
  apply(): BrushEditSession | null {
    if (!_session) return null;
    _session.status = 'applied';
    const s = _session;
    _session = null;
    return s;
  },

  /** Mark as canceled. No registry/engine write. */
  cancel(): void {
    _session = null;
  },
} as const;
