// ============================================================
//  Phase 4.2.1: Brush Import / Export Safety Layer
//
//  仅处理数据交换，禁止修改 geometry/render/input。
// ============================================================

import type { BrushPreset } from './BrushRegistry';

// ============================================================
//  Types
// ============================================================

export interface ExportBundle {
  version: 1;
  exportedAt: number;
  presets: BrushPreset[];
}

export interface ImportResult {
  imported: BrushPreset[];
  skipped: number;
  errors: string[];
}

// ============================================================
//  Schema validation
// ============================================================

function isValidBrushForImport(obj: unknown): boolean {
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

function isValidFeelForImport(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const f = obj as Record<string, unknown>;
  return typeof f.microJitter === 'number'
    && typeof f.velocityDamping === 'number'
    && typeof f.pressureResponse === 'number'
    && typeof f.taperCurve === 'number'
    && typeof f.strokeAdhesion === 'number';
}

function isValidPresetForImport(obj: unknown): obj is BrushPreset {
  if (!obj || typeof obj !== 'object') return false;
  const p = obj as Record<string, unknown>;
  return typeof p.id === 'string'
    && typeof p.name === 'string'
    && isValidBrushForImport(p.brush)
    && isValidFeelForImport(p.feel)
    && typeof p.builtIn === 'boolean';
}

// ============================================================
//  Deep clone (import safety)
// ============================================================

function deepClonePreset(p: BrushPreset): BrushPreset {
  return JSON.parse(JSON.stringify(p)) as BrushPreset;
}

// ============================================================
//  ID regeneration for conflict
// ============================================================

function regenerateId(id: string): string {
  return id + '-import-' + Math.floor(Date.now() % 100000);
}

// ============================================================
//  Export
// ============================================================

export function exportPresets(presets: readonly BrushPreset[]): string {
  const bundle: ExportBundle = {
    version: 1,
    exportedAt: Date.now(),
    presets: presets.map(p => ({
      id: p.id,
      name: p.name,
      brush: p.brush,
      feel: p.feel,
      builtIn: false, // never export builtIn=true
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  };
  return JSON.stringify(bundle, null, 2);
}

// ============================================================
//  Import
// ============================================================

export function importPresets(
  rawText: string,
  existingIds: Set<string>,
): ImportResult {
  const result: ImportResult = { imported: [], skipped: 0, errors: [] };

  // Parse
  let bundle: unknown;
  try {
    bundle = JSON.parse(rawText);
  } catch {
    result.errors.push('Invalid JSON: could not parse file');
    return result;
  }

  if (!bundle || typeof bundle !== 'object') {
    result.errors.push('Invalid format: root must be an object');
    return result;
  }

  const b = bundle as Record<string, unknown>;

  // Version check
  if (typeof b.version !== 'number' || b.version < 1) {
    result.errors.push(`Unsupported version: ${b.version}`);
    return result;
  }

  // Presets array
  const presets = b.presets;
  if (!Array.isArray(presets)) {
    result.errors.push('Missing or invalid "presets" array');
    return result;
  }

  // Process each preset
  for (let i = 0; i < presets.length; i++) {
    const raw = presets[i];

    if (!isValidPresetForImport(raw)) {
      result.errors.push(`Preset[${i}]: invalid schema, skipped`);
      result.skipped++;
      continue;
    }

    const preset = raw as BrushPreset;
    const cloned = deepClonePreset(preset);

    // Force builtIn=false
    cloned.builtIn = false;

    // Conflict: duplicate id → regenerate
    if (existingIds.has(cloned.id)) {
      cloned.id = regenerateId(cloned.id);
    }

    result.imported.push(cloned);
  }

  return result;
}
