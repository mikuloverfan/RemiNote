// ============================================================
//  Phase 4.1: Brush Persistence Foundation
//
//  唯一负责 Brush/Feel 状态的序列化、验证、存储。
//
//  约束：
//  ❌ 不修改 Geometry / Render / Input Pipeline / Workspace
//  ❌ 不使用 localStorage / window global / singleton cache
//  ✅ 使用 Obsidian Plugin.saveData() / loadData()
//  ✅ 必须有 version 字段支持未来迁移
//  ✅ 必须有 schema validation + fallback
//  ✅ deepClone 禁止引用泄漏
// ============================================================

import type { Brush } from './BrushModel';
import { DEFAULT_BRUSH } from './BrushModel';
import type { FeelConfig } from '../feel/FeelConfig';
import { DEFAULT_FEEL } from '../feel/FeelConfig';
import type { BrushPreset } from './BrushRegistry';

// ============================================================
//  Types
// ============================================================

export interface BrushState {
  /** 🟢 v2: brushLibrary added */
  version: 2;
  brush: Brush;
  feel: FeelConfig;
  selectedPresetId: string | null;
  selectedFeelPresetId: string | null;
  brushLibrary: BrushPreset[];
  /** epoch ms */
  updatedAt: number;
}

// ============================================================
//  Default state
// ============================================================

function createDefaultBrushState(): BrushState {
  return {
    version: 2,
    brush: deepCloneBrush(DEFAULT_BRUSH),
    feel: deepCloneFeel(DEFAULT_FEEL),
    selectedPresetId: 'pen-ps',
    selectedFeelPresetId: 'natural',
    brushLibrary: [],
    updatedAt: Date.now(),
  };
}

// ============================================================
//  Deep clone (prevent reference leaks)
// ============================================================

function deepCloneBrush(b: Readonly<Brush>): Brush {
  return {
    id: b.id,
    size: b.size,
    hardness: b.hardness,
    smoothing: b.smoothing,
    velocitySensitivity: b.velocitySensitivity,
    pressureCurve: b.pressureCurve,
    taperStart: b.taperStart,
    taperEnd: b.taperEnd,
  };
}

function deepCloneFeel(f: Readonly<FeelConfig>): FeelConfig {
  return {
    microJitter: f.microJitter,
    velocityDamping: f.velocityDamping,
    pressureResponse: f.pressureResponse,
    taperCurve: f.taperCurve,
    strokeAdhesion: f.strokeAdhesion,
  };
}

// ============================================================
//  Schema validation
// ============================================================

function isValidBrush(obj: unknown): obj is Brush {
  if (!obj || typeof obj !== 'object') return false;
  const b = obj as Record<string, unknown>;
  return typeof b.id === 'string'
    && typeof b.size === 'number' && b.size > 0
    && typeof b.hardness === 'number'
    && typeof b.smoothing === 'number'
    && typeof b.velocitySensitivity === 'number'
    && typeof b.pressureCurve === 'number'
    && typeof b.taperStart === 'number'
    && typeof b.taperEnd === 'number';
}

function isValidFeel(obj: unknown): obj is FeelConfig {
  if (!obj || typeof obj !== 'object') return false;
  const f = obj as Record<string, unknown>;
  return typeof f.microJitter === 'number'
    && typeof f.velocityDamping === 'number'
    && typeof f.pressureResponse === 'number'
    && typeof f.taperCurve === 'number'
    && typeof f.strokeAdhesion === 'number';
}

function isValidPresetArray(arr: unknown): arr is BrushPreset[] {
  if (!Array.isArray(arr)) return false;
  return arr.every(p => p && typeof p === 'object' && typeof (p as BrushPreset).id === 'string');
}

function validateAndRepair(raw: unknown): BrushState {
  const defaults = createDefaultBrushState();

  if (!raw || typeof raw !== 'object') return defaults;
  const r = raw as Record<string, unknown>;

  const version = (typeof r.version === 'number' ? r.version : 0) as number;
  // v0 / v1 → full defaults
  if (version < 1) return defaults;

  const brush = isValidBrush(r.brush) ? deepCloneBrush(r.brush as Brush) : defaults.brush;
  const feel = isValidFeel(r.feel) ? deepCloneFeel(r.feel as FeelConfig) : defaults.feel;

  // 🟢 v1 → v2 migration: add brushLibrary
  const brushLibrary: BrushPreset[] = (version >= 2 && isValidPresetArray(r.brushLibrary))
    ? (r.brushLibrary as BrushPreset[])
    : [];

  return {
    version: 2,
    brush,
    feel,
    selectedPresetId: typeof r.selectedPresetId === 'string' ? r.selectedPresetId : defaults.selectedPresetId,
    selectedFeelPresetId: typeof r.selectedFeelPresetId === 'string' ? r.selectedFeelPresetId : defaults.selectedFeelPresetId,
    brushLibrary,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}

// ============================================================
//  Serialize / Deserialize
// ============================================================

export function serializeBrushState(state: BrushState): string {
  return JSON.stringify({
    version: state.version,
    brush: state.brush,
    feel: state.feel,
    selectedPresetId: state.selectedPresetId,
    selectedFeelPresetId: state.selectedFeelPresetId,
    brushLibrary: state.brushLibrary,
    updatedAt: state.updatedAt,
  });
}

export function deserializeBrushState(json: string): BrushState {
  try {
    const raw = JSON.parse(json);
    return validateAndRepair(raw);
  } catch {
    return createDefaultBrushState();
  }
}

// ============================================================
//  Persistence API (consumes Obsidian Plugin ref)
// ============================================================

/**
 * Thin persistence wrapper.
 * Requires a reference to an Obsidian Plugin instance for saveData/loadData.
 * The plugin passes `this` (RemiNotePlugin) at boot time.
 */

interface PersistenceHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

let _host: PersistenceHost | null = null;

export const BrushPersistence = {
  /** Bind to Obsidian Plugin instance. Call once in onload. */
  bind(host: PersistenceHost): void {
    _host = host;
  },

  /** Load and validate brush state from Obsidian data.json. */
  async load(): Promise<BrushState> {
    if (!_host) return createDefaultBrushState();
    try {
      const raw = await _host.loadData();
      return validateAndRepair(raw);
    } catch {
      return createDefaultBrushState();
    }
  },

  /** Save brush state. Debounce is caller responsibility. */
  async save(state: BrushState): Promise<void> {
    if (!_host) return;
    try {
      state.updatedAt = Date.now();
      await _host.saveData(state);
    } catch {
      // Silently fail — persistence must never crash
    }
  },
} as const;
