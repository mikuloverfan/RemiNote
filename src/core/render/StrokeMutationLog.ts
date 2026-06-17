// ============================================================
//  StrokeMutationLog — 记录"发生了什么变化（mutation log）"
//  从 diff comparison 升级为 event sourcing
//
//  核心概念：
//  - StrokeMutation: 单条 stroke 变更记录（add / update / delete）
//  - StrokeMutationLog: 变更队列，push → consume
//
//  架构意义（分水岭）：
//  ❌ 不再做 comparison（比较世界状态）
//  ✅ 开始做 event sourcing（记录世界变化）
//
//  性能：
//  diff contract: O(n²)
//  mutation log:  O(k) where k = 真实变化数
// ============================================================

// ============================================================
//  Types
// ============================================================

/** 单条 stroke 变更记录 */
export type StrokeMutation =
  | { type: 'add'; strokeId: string }
  | { type: 'update'; strokeId: string }
  | { type: 'delete'; strokeId: string };

// ============================================================
//  StrokeMutationLog
// ============================================================

/**
 * Stroke 变更日志 — 记录 workspace 中的所有 stroke 变化。
 *
 * 使用方式：
 * - Workspace.addStroke()    → mutationLog.push({ type: 'add', strokeId })
 * - Workspace.updateStroke() → mutationLog.push({ type: 'update', strokeId })
 * - Workspace.deleteStroke() → mutationLog.push({ type: 'delete', strokeId })
 * - Renderer.render()        → const mutations = mutationLog.consume()
 *
 * 单例模式 — Workspace 和 Renderer 共享同一个实例。
 */
export class StrokeMutationLog {
  private static _instance: StrokeMutationLog;

  static get instance(): StrokeMutationLog {
    if (!this._instance) this._instance = new StrokeMutationLog();
    return this._instance;
  }

  private _queue: StrokeMutation[] = [];

  /** 记录一条 stroke 变更。 */
  push(m: StrokeMutation): void {
    this._queue.push(m);
  }

  /**
   * 消费并清空队列。
   * 由 Renderer.render() 在每帧开始时调用。
   *
   * Phase 5 Step 2.5: 稳定层修复
   * - frameId 对齐 Renderer.frameHash，防止帧不一致
   * - 空队列返回 null，禁止空对象消费
   *
   * @param frameId 当前帧标识（与 Renderer.frameHash 对齐）
   * @returns { frameId, mutations } 或 null（队列为空）
   */
  consume(frameId: string): { frameId: string; mutations: StrokeMutation[] } | null {
    if (this._queue.length === 0) return null;

    const mutations = this._queue;
    this._queue = [];
    return { frameId, mutations };
  }

  /** 清空队列（不消费）。用于 session destroy 等场景。 */
  clear(): void {
    this._queue = [];
  }

  /** 当前队列中的变更数量。 */
  size(): number {
    return this._queue.length;
  }
}
