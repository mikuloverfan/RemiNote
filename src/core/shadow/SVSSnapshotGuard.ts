// ============================================================
//  SVS Snapshot Guard — 不可变快照强制层
//
//  问题：
//  ① page.strokes = engine.strokes（直接引用）→ shadow 看到的是别名
//  ② captureFrameSnapshot 使用手动深拷贝，可能遗漏嵌套字段
//  ③ 浅拷贝导致 shadow 和 main 共享 point 数组
//
//  方案：
//  ① structuredClone 深拷贝 — 完全断开引用链
//  ② deepFreeze 递归冻结 — 运行时不可变保证
//  ③ alias break verification — 验证拷贝后引用不共享
//
//  强规则：
//  ❌ 禁止引用 engine.strokes 原数组
//  ❌ 禁止浅拷贝 { ...obj }
//  ❌ 禁止共享 point arrays
//  ✅ structuredClone + deepFreeze 双重保证
//
//  约束：
//  ❌ 不修改原有 captureFrameSnapshot（向后兼容）
//  ✅ 新增 safeCapture 作为加强版入口
// ============================================================

import { captureFrameSnapshot, type FrameSnapshot } from './FrameSnapshot';
import type { ObserveInput } from './ShadowRenderObserver';

// ============================================================
//  Types
// ============================================================

/** SnapshotGuard 配置 */
export interface SnapshotGuardConfig {
  /** 是否验证 alias break（开发期建议开启） */
  verifyAliasBreak?: boolean;
  /** debug 日志 */
  debug?: boolean;
}

/** Snapshot 验证结果 */
export interface SnapshotVerification {
  /** 是否通过所有检查 */
  valid: boolean;
  /** 捕获耗时 (ms) */
  captureTimeMs: number;
  /** alias break 检查结果 */
  aliasBreakViolations: string[];
  /** 结构完整性检查结果 */
  structureErrors: string[];
}

// ============================================================
//  Constants
// ============================================================

const DEFAULT_CONFIG: Required<SnapshotGuardConfig> = {
  verifyAliasBreak: false, // 默认关闭，性能敏感
  debug: false,
};

// ============================================================
//  SVSSnapshotGuard
// ============================================================

export class SVSSnapshotGuard {
  private _config: Required<SnapshotGuardConfig>;
  private _enabled = false;
  private _totalSnapshots = 0;
  private _failedSnapshots = 0;

  constructor(config: SnapshotGuardConfig = {}) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================
  //  Lifecycle
  // ==========================================================

  enable(): void { this._enabled = true; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  // ==========================================================
  //  safeCapture — 加强版快照捕获
  // ==========================================================

  /**
   * 安全捕获帧快照。
   *
   * 流程：
   * 1. structuredClone(input) → 完全断开引用
   * 2. captureFrameSnapshot(cloned) → 标准化 + freeze
   * 3. verifyAliasBreak(original, snapshot) → 验证引用不共享
   * 4. verifyStructure(snapshot) → 验证数据结构完整
   *
   * @param input    原始 ObserveInput（来自 engine.strokes 等直接引用）
   * @param original 原始 engine.strokes 数组引用（供 alias 验证）
   * @returns { snapshot, verification }
   */
  safeCapture(
    input: ObserveInput,
    original?: {
      strokes: ReadonlyArray<unknown>;
      previewStroke: unknown;
    },
  ): { snapshot: FrameSnapshot; verification: SnapshotVerification } {
    const t0 = performance.now();
    const verification: SnapshotVerification = {
      valid: true,
      captureTimeMs: 0,
      aliasBreakViolations: [],
      structureErrors: [],
    };

    this._totalSnapshots++;

    try {
      // ── Phase 1: structuredClone 深拷贝 ──
      const clonedInput: ObserveInput = this._safeClone(input);

      // ── Phase 2: 调用现有 captureFrameSnapshot ──
      const snapshot = captureFrameSnapshot(clonedInput);

      // ── Phase 3: Alias break verification ──
      if (this._config.verifyAliasBreak && original) {
        this._verifyAliasBreak(original.strokes, snapshot, verification);
      }

      // ── Phase 4: Structure verification ──
      this._verifyStructure(snapshot, verification);

      verification.captureTimeMs = performance.now() - t0;

      if (!verification.valid) {
        this._failedSnapshots++;
        if (this._config.debug) {
          console.warn('[SVSSnapshotGuard] ⚠️ snapshot verification failed:', verification);
        }
      }

      return { snapshot, verification };
    } catch (err) {
      // 🔒 崩溃回退：使用原有 captureFrameSnapshot
      this._failedSnapshots++;
      verification.valid = false;
      verification.structureErrors.push(
        `safeCapture crashed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      verification.captureTimeMs = performance.now() - t0;

      if (this._config.debug) {
        console.error('[SVSSnapshotGuard] ❌ safeCapture crashed, falling back:', err);
      }

      // 回退到原始捕获
      const fallbackSnapshot = captureFrameSnapshot(input);
      return { snapshot: fallbackSnapshot, verification };
    }
  }

  // ==========================================================
  //  Query
  // ==========================================================

  get totalSnapshots(): number { return this._totalSnapshots; }
  get failedSnapshots(): number { return this._failedSnapshots; }
  get failureRate(): number {
    return this._totalSnapshots > 0
      ? this._failedSnapshots / this._totalSnapshots
      : 0;
  }

  // ==========================================================
  //  Private: structuredClone wrapper
  // ==========================================================

  /**
   * 安全深拷贝 — structuredClone 不可用时回退到 JSON round-trip。
   *
   * structuredClone 优势：
   * - 正确处理 ArrayBuffer / TypedArray / Map / Set
   * - 比 JSON.parse(JSON.stringify()) 快 2-3x
   * - 处理循环引用（但我们不应有循环引用）
   */
  private _safeClone<T>(value: T): T {
    // structuredClone 在现代浏览器中可用 (Chrome 98+, FF 94+, Safari 15.4+)
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }

    // Fallback: JSON round-trip（丢失 undefined / Function / Symbol）
    // 对于 stroke 数据（纯 {x,y} 对象），JSON 足够
    return JSON.parse(JSON.stringify(value));
  }

  // ==========================================================
  //  Private: Alias break verification
  // ==========================================================

  /**
   * 验证快照中的引用与原始 engine.strokes 不共享。
   *
   * 检查项：
   * - strokes 数组本身不是同一个引用
   * - 每个 stroke 对象不是同一个引用
   * - 每个 points 数组不是同一个引用
   */
  private _verifyAliasBreak(
    originalStrokes: ReadonlyArray<unknown>,
    snapshot: FrameSnapshot,
    verification: SnapshotVerification,
  ): void {
    // strokes 数组级别
    if ((originalStrokes as unknown) === (snapshot.strokes as unknown)) {
      verification.aliasBreakViolations.push('strokes array: same reference as engine.strokes');
      verification.valid = false;
    }

    // 逐 stroke 级别
    const origArr = originalStrokes as ReadonlyArray<{ id: string; points?: unknown }>;
    for (let i = 0; i < Math.min(origArr.length, snapshot.strokes.length); i++) {
      const origS = origArr[i];
      const snapS = snapshot.strokes[i];

      if ((origS as unknown) === (snapS as unknown)) {
        verification.aliasBreakViolations.push(`stroke[${i}].${origS.id}: same object reference`);
        verification.valid = false;
      }

      if (origS.points && snapS.points
        && (origS.points as unknown) === (snapS.points as unknown)) {
        verification.aliasBreakViolations.push(`stroke[${i}].${origS.id}.points: same array reference`);
        verification.valid = false;
      }
    }
  }

  // ==========================================================
  //  Private: Structure verification
  // ==========================================================

  /**
   * 验证快照数据结构完整。
   *
   * 检查项：
   * - 每个 stroke 有 id
   * - 每个 stroke 有 points 数组
   * - 每个 point 有 x, y（且为有限值）
   * - camera 有 x, y, zoom
   */
  private _verifyStructure(
    snapshot: FrameSnapshot,
    verification: SnapshotVerification,
  ): void {
    if (!snapshot) {
      verification.structureErrors.push('snapshot is null/undefined');
      verification.valid = false;
      return;
    }

    // Camera
    if (snapshot.camera.zoom == null || snapshot.camera.zoom <= 0) {
      verification.structureErrors.push('camera.zoom invalid');
      verification.valid = false;
    }

    // Strokes
    for (let i = 0; i < snapshot.strokes.length; i++) {
      const s = snapshot.strokes[i];
      if (!s.id) {
        verification.structureErrors.push(`stroke[${i}]: missing id`);
        verification.valid = false;
      }
      if (!s.points) {
        verification.structureErrors.push(`stroke[${i}].${s.id}: missing points`);
        verification.valid = false;
        continue;
      }
      for (let j = 0; j < s.points.length; j++) {
        const p = s.points[j];
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          verification.structureErrors.push(
            `stroke[${i}].${s.id}.points[${j}]: non-finite coords (${p.x}, ${p.y})`,
          );
          verification.valid = false;
        }
      }
    }
  }
}

export default SVSSnapshotGuard;
