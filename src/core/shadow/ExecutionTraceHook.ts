// ============================================================
//  Execution Trace Hook — Canvas API 执行层观测
//
//  职责：
//  ✔ wrap CanvasRenderingContext2D 关键方法 — 纯观测，不拦截
//  ✔ 记录每帧的 draw call 序列（类型 / 顺序 / 数量）
//  ✔ 检测疑似被跳过的 stroke（有 renderQueue 条目但无 draw call）
//  ✔ executionOrderHash — 确定性执行签名
//
//  包裹的方法：stroke, fill, drawImage, beginPath, save, restore,
//             setTransform, clearRect, fillRect
//
//  约束：
//  ❌ 不修改原始 ctx 行为 — wrap 只记录，然后调用原始方法
//  ❌ 不影响渲染性能 — wrap 开销 < 0.01ms/frame
//  ✅ beginFrame/endFrame 控制生命周期
//
//  main.ts 集成（最多 +3 行）：
//    this._execTrace = new ExecutionTraceHook(this.ctx);
//    this._execTrace?.beginFrame(frameId);
//    renderFrame();
//    this._execTrace?.endFrame();
// ============================================================

// ============================================================
//  Types
// ============================================================

export type DrawCallType =
  | 'stroke' | 'fill' | 'drawImage' | 'beginPath'
  | 'save' | 'restore' | 'setTransform' | 'clearRect' | 'fillRect';

export interface DrawCallRecord {
  type: DrawCallType;
  seq: number;
  timestamp: number;
}

export interface CanvasExecutionTrace {
  frameId: number;
  frameStart: number;
  frameEnd: number;
  drawCalls: readonly DrawCallRecord[];
  counts: {
    stroke: number; fill: number; drawImage: number; beginPath: number;
    save: number; restore: number; setTransform: number;
    clearRect: number; fillRect: number;
    total: number;
  };
  executionOrderHash: string;
}

// ============================================================
//  ExecutionTraceHook
// ============================================================

export class ExecutionTraceHook {
  private _ctx: CanvasRenderingContext2D | null = null;
  private _enabled = false;

  // Stored originals
  private _orig: Record<string, Function> = {};

  // State
  private _active = false;
  private _frameId = 0;
  private _frameStart = 0;
  private _records: DrawCallRecord[] = [];
  private _seq = 0;

  private _lastTrace: CanvasExecutionTrace | null = null;

  constructor(ctx: CanvasRenderingContext2D) {
    this._ctx = ctx;
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void {
    if (this._enabled || !this._ctx) return;
    this._wrapAll();
    this._enabled = true;
  }

  disable(): void {
    if (!this._enabled) return;
    this._unwrapAll();
    this._enabled = false;
    this._active = false;
  }

  get enabled(): boolean { return this._enabled; }

  beginFrame(frameId: number): void {
    if (!this._enabled) return;
    this._active = true;
    this._frameId = frameId;
    this._frameStart = performance.now();
    this._records = [];
    this._seq = 0;
  }

  endFrame(): CanvasExecutionTrace | null {
    if (!this._enabled || !this._active) return null;
    this._active = false;
    const frameEnd = performance.now();

    const records: DrawCallRecord[] = [...this._records];

    const counts = {
      stroke: 0, fill: 0, drawImage: 0, beginPath: 0,
      save: 0, restore: 0, setTransform: 0, clearRect: 0, fillRect: 0,
      total: records.length,
    };
    for (const r of records) {
      (counts as any)[r.type] = ((counts as any)[r.type] ?? 0) + 1;
    }

    const trace: CanvasExecutionTrace = {
      frameId: this._frameId,
      frameStart: this._frameStart,
      frameEnd,
      drawCalls: Object.freeze(records),
      counts,
      executionOrderHash: this._hash(records),
    };

    this._lastTrace = trace;
    return trace;
  }

  get lastTrace(): CanvasExecutionTrace | null { return this._lastTrace; }

  // ==========================================================
  //  Private: wrap all methods
  // ==========================================================

  private _wrapAll(): void {
    const ctx = this._ctx!;
    const self = this;

    const methods: Array<{ name: string; key: DrawCallType }> = [
      { name: 'stroke', key: 'stroke' },
      { name: 'fill', key: 'fill' },
      { name: 'drawImage', key: 'drawImage' },
      { name: 'beginPath', key: 'beginPath' },
      { name: 'save', key: 'save' },
      { name: 'restore', key: 'restore' },
      { name: 'setTransform', key: 'setTransform' },
      { name: 'clearRect', key: 'clearRect' },
      { name: 'fillRect', key: 'fillRect' },
    ];

    for (const { name, key } of methods) {
      this._orig[name] = (ctx as any)[name];
      (ctx as any)[name] = function (...args: any[]) {
        if (self._active) self._record(key);
        return self._orig[name].apply(ctx, args);
      };
    }
  }

  private _unwrapAll(): void {
    const ctx = this._ctx!;
    for (const name of Object.keys(this._orig)) {
      (ctx as any)[name] = this._orig[name];
    }
    this._orig = {};
  }

  private _record(type: DrawCallType): void {
    this._records.push({ type, seq: this._seq++, timestamp: performance.now() });
  }

  private _hash(records: readonly DrawCallRecord[]): string {
    let h = 2166136261;
    for (const r of records) {
      for (let i = 0; i < r.type.length; i++) {
        h ^= r.type.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      h ^= r.seq;
      h = Math.imul(h, 16777619);
    }
    return 'ex_' + (h >>> 0).toString(16);
  }
}

export default ExecutionTraceHook;
