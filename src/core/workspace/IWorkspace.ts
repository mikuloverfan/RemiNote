// ============================================================
//  RemiNote — IWorkspace (Phase 6: Single Source of Truth)
//  Workspace owns all stroke state; Engine is input-only
// ============================================================

interface Stroke {
  id: string;
  points: { x: number; y: number; t?: number; speed?: number; _inkWidth?: number }[];
  color: string;
  width: number;
  _penParams?: {
    spacing: number;
    smoothness: number;
    strokeWidth: number;
    cornerKeep: number;
  };
  /** 🟢 Phase 3.2: Deterministic seed */
  seed?: number;
  /** 🟢 Phase 3.2: Canonical hash for consistency verification */
  canonicalHash?: string;
  /** 🟢 Phase 3.2: Canonical segments — SSOT for rendering */
  _canonicalSegments?: import('../render/DeterministicStrokeCore').CanonicalSegment[];
  /** 🟢 Phase 3.3.2: Brush snapshot — frozen at stroke creation, never uses current engine.brush */
  _brushSnapshot?: { size: number; smoothing: number; velocitySensitivity: number; pressureCurve: number; taperStart: number; taperEnd: number };
  /** Legacy segments — fallback for backward compat */
  segments?: any[];
}

interface IWorkspace {
  /** 🔴 Phase 0.2: 当前活跃 workspace ID — 唯一数据边界 */
  activeWorkspaceId: string;

  /** 只读 strokes Map — canonical state */
  readonly strokes: ReadonlyMap<string, Stroke>;

  /** 🔴 Phase 0.2: scoped stroke 查询 — 按 workspaceId 过滤，禁止 global fallback */
  getStrokes(workspaceId: string): Stroke[];

  /** 🔴 Phase 0.2: 完全重置 workspace — 唯一合法清空入口 */
  resetWorkspace(newWorkspaceId: string): void;

  /** 添加 stroke（Engine stroke:end / page load priming） */
  addStroke(stroke: Stroke): void;

  /** 更新 stroke 部分字段 */
  updateStroke(id: string, patch: Partial<Pick<Stroke, 'color' | 'width' | 'points'>>): void;

  /** 删除 stroke（eraser） */
  deleteStroke(id: string): boolean;

  /** Point-level erase + auto split（ported from Engine） */
  erasePointsFromStroke(strokeId: string, pointIndices: number[]): void;

  /** Hit-test for eraser */
  hitTestStroke(stroke: Stroke, pt: { x: number; y: number }, radius?: number): boolean;

  /** 🔴 Phase 0.3.5: 唯一渲染快照 — 含 frameToken(generation) 防 ghost stroke */
  getRenderSnapshot(workspaceId: string): Readonly<{ workspaceId: string; frameToken: { id: string; generation: number; timestamp: number }; strokes: ReadonlyArray<Readonly<Stroke>> }> | null;

  /** Phase 6: subscribe to Engine raw input events and build strokes */
  listenToEngine(engine: any): void;

  /** Subscribe to workspace events. Returns unsubscribe function. */
  subscribe(event: string, callback: (payload: any) => void): () => void;
}

export type { Stroke, IWorkspace };
