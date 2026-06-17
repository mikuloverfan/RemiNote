// ============================================================
//  Phase 4.2: Brush Registry — 唯一笔刷注册中心
//
//  管理 System Presets + User Presets。
//
//  约束：
//  ❌ 不修改 Geometry / Render / Input Layer
//  ❌ 不允许 UI 直接操作内部数组
//  ✅ 永远返回 deepClone
//  ✅ builtIn=true 的预设不可 rename/delete
// ============================================================

import type { Brush } from './BrushModel';
import type { FeelConfig } from '../feel/FeelConfig';
import { BrushPresets } from './BrushPresets';
import { FeelPresets } from '../feel/FeelPresets';

// ============================================================
//  Types
// ============================================================

export interface BrushPreset {
  id: string;
  name: string;
  brush: Brush;
  feel: FeelConfig;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
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

function clonePreset(p: BrushPreset): BrushPreset {
  return { id: p.id, name: p.name, brush: cloneBrush(p.brush), feel: cloneFeel(p.feel), builtIn: p.builtIn, createdAt: p.createdAt, updatedAt: p.updatedAt };
}

// ============================================================
//  ID generator
// ============================================================

let _idCounter = Date.now();
function genPresetId(): string { return `user-${++_idCounter}`; }

// ============================================================
//  BrushRegistry
// ============================================================

let _presets: BrushPreset[] = [];

function seedBuiltIn(): void {
  if (_presets.length > 0) return;
  const now = Date.now();
  const brushes = BrushPresets.listAll();
  const feels = FeelPresets.listAll();
  const defaultFeel = FeelPresets.getDefault();
  for (const b of brushes) {
    _presets.push({
      id: b.id,
      name: brushLabel(b.id),
      brush: cloneBrush(b as Brush),
      feel: cloneFeel(defaultFeel),
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function brushLabel(id: string): string {
  const map: Record<string, string> = {
    'pen-ps': 'PS钢笔', 'pencil': '铅笔', 'fountain-pen': '钢笔',
    'marker': '马克笔', 'ballpoint': '圆珠笔', 'brush-pen': '毛笔',
    'highlighter': '荧光笔',
  };
  return map[id] ?? id;
}

export const BrushRegistry = {
  /** Initialize from saved data. Call once at boot. */
  init(saved: BrushPreset[]): void {
    _presets = saved.map(p => clonePreset(p));
    if (_presets.length === 0) seedBuiltIn();
  },

  /** Get serializable snapshot for persistence. */
  snapshot(): BrushPreset[] {
    return _presets.map(p => clonePreset(p));
  },

  // ── Query ──

  getAll(): readonly BrushPreset[] {
    return _presets.map(p => clonePreset(p));
  },

  getBuiltIn(): readonly BrushPreset[] {
    return _presets.filter(p => p.builtIn).map(p => clonePreset(p));
  },

  getUser(): readonly BrushPreset[] {
    return _presets.filter(p => !p.builtIn).map(p => clonePreset(p));
  },

  get(id: string): BrushPreset | undefined {
    const p = _presets.find(x => x.id === id);
    return p ? clonePreset(p) : undefined;
  },

  exists(id: string): boolean {
    return _presets.some(x => x.id === id);
  },

  // ── Mutation ──

  create(name: string, brush: Brush, feel: FeelConfig): BrushPreset {
    const now = Date.now();
    const preset: BrushPreset = {
      id: genPresetId(),
      name,
      brush: cloneBrush(brush),
      feel: cloneFeel(feel),
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    };
    _presets.push(preset);
    return clonePreset(preset);
  },

  update(id: string, patch: Partial<Pick<BrushPreset, 'name' | 'brush' | 'feel'>>): BrushPreset | null {
    const idx = _presets.findIndex(p => p.id === id);
    if (idx === -1) return null;
    const p = _presets[idx];
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.brush !== undefined) p.brush = cloneBrush(patch.brush);
    if (patch.feel !== undefined) p.feel = cloneFeel(patch.feel);
    p.updatedAt = Date.now();
    return clonePreset(p);
  },

  delete(id: string): boolean {
    const p = _presets.find(x => x.id === id);
    if (!p || p.builtIn) return false;
    _presets = _presets.filter(x => x.id !== id);
    return true;
  },

  duplicate(id: string, newName?: string): BrushPreset | null {
    const p = _presets.find(x => x.id === id);
    if (!p) return null;
    return this.create(newName ?? `${p.name} (副本)`, p.brush, p.feel);
  },

  rename(id: string, newName: string): boolean {
    const p = _presets.find(x => x.id === id);
    if (!p || p.builtIn) return false;
    p.name = newName;
    p.updatedAt = Date.now();
    return true;
  },
} as const;
